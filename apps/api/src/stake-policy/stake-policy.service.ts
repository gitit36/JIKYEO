import { Inject, Injectable, Optional } from '@nestjs/common';
import { StakeTier } from '@prisma/client';
import { Clock, SystemClock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { StakePolicyResponse, StakeTierConfig } from './stake-policy.types';

/** Injection token for the provisional MVP tier table. */
export const STAKE_POLICY_CONFIG = 'STAKE_POLICY_CONFIG';

/**
 * Provisional MVP tier values as defined in PRD §15 / TRD §5b.
 *
 * These live behind an injection token so tests and dev fixtures can swap
 * them without touching product logic, and so legal/PG review can change
 * them without a code deploy.
 */
export const DEFAULT_STAKE_POLICY_CONFIG: Record<StakeTier, StakeTierConfig> = {
  tier_1: {
    tier: 'tier_1',
    maxPerOccurrenceKrw: 30_000,
    maxPerCommitmentKrw: 150_000,
    rollingMonthlyLossCapKrw: 300_000,
    suggestedAmountsKrw: [3_000, 5_000, 10_000, 30_000],
  },
  tier_2: {
    tier: 'tier_2',
    maxPerOccurrenceKrw: 50_000,
    maxPerCommitmentKrw: 300_000,
    rollingMonthlyLossCapKrw: 500_000,
    suggestedAmountsKrw: [5_000, 10_000, 30_000, 50_000],
  },
  tier_3: {
    tier: 'tier_3',
    maxPerOccurrenceKrw: 100_000,
    maxPerCommitmentKrw: 500_000,
    rollingMonthlyLossCapKrw: 1_000_000,
    suggestedAmountsKrw: [10_000, 30_000, 50_000, 100_000],
  },
};

/**
 * Server-authoritative source of truth for stake limits. The client renders
 * the values returned by `forUser`, but every enforcement point (quote,
 * commitment activation, later PG charge) re-consults this service rather
 * than trusting the client's echoed values.
 *
 * MVP tier assignment: every new user starts at TIER_1 (set via schema
 * default). Higher tiers are assigned via admin/fixture — automated
 * promotion is intentionally not built yet.
 */
@Injectable()
export class StakePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    @Optional() @Inject(STAKE_POLICY_CONFIG)
    private readonly config: Record<StakeTier, StakeTierConfig> = DEFAULT_STAKE_POLICY_CONFIG,
    @Optional() private readonly clock: Clock = new SystemClock(),
  ) {}

  configFor(tier: StakeTier): StakeTierConfig {
    return this.config[tier];
  }

  async tierOf(userId: string): Promise<StakeTier> {
    const u = await this.users.findById(userId);
    return u.stakeTier;
  }

  async forUser(userId: string): Promise<StakePolicyResponse> {
    const tier = await this.tierOf(userId);
    const cfg = this.configFor(tier);
    const forfeited = await this.rollingMonthlyForfeitKrw(userId);
    return {
      currentTier: tier,
      maxPerOccurrenceKrw: cfg.maxPerOccurrenceKrw,
      maxPerCommitmentKrw: cfg.maxPerCommitmentKrw,
      rollingMonthlyLossCapKrw: cfg.rollingMonthlyLossCapKrw,
      rollingMonthlyLossRemainingKrw: Math.max(0, cfg.rollingMonthlyLossCapKrw - forfeited),
      suggestedAmountsKrw: cfg.suggestedAmountsKrw,
    };
  }

  /**
   * Money actually forfeited by this user in the trailing 30 days, read from
   * the append-only ledger (settled FAIL occurrences only — behavioral FAILs
   * that have not settled do not count).
   */
  async rollingMonthlyForfeitKrw(userId: string): Promise<number> {
    const since = new Date(this.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000);
    const agg = await this.prisma.paymentLedger.aggregate({
      where: { userId, entryType: 'forfeit', createdAt: { gte: since } },
      _sum: { amount: true },
    });
    return Number(agg._sum.amount ?? 0n);
  }

  /**
   * Enforce this user's tier limits on a proposed MONEY commitment.
   * Throws a DomainError the API layer maps to 422.
   */
  async assertWithinLimits(
    userId: string,
    perOccurrenceKrw: number,
    maxLossKrw: number,
  ): Promise<void> {
    const tier = await this.tierOf(userId);
    const cfg = this.configFor(tier);
    if (perOccurrenceKrw > cfg.maxPerOccurrenceKrw) {
      throw new DomainError(
        'STAKE_TIER_LIMIT_EXCEEDED',
        `회차당 약속금은 최대 ${cfg.maxPerOccurrenceKrw.toLocaleString('ko-KR')}원까지 걸 수 있어요.`,
        { limitKrw: cfg.maxPerOccurrenceKrw, kind: 'perOccurrence', tier },
      );
    }
    if (maxLossKrw > cfg.maxPerCommitmentKrw) {
      throw new DomainError(
        'STAKE_TIER_LIMIT_EXCEEDED',
        `이번 약속의 최대 손실은 ${cfg.maxPerCommitmentKrw.toLocaleString('ko-KR')}원까지 걸 수 있어요.`,
        { limitKrw: cfg.maxPerCommitmentKrw, kind: 'perCommitment', tier },
      );
    }
    // Rolling monthly cap: the new commitment's max loss must fit in what
    // is left after the last 30 days of *settled* forfeits.
    const forfeited = await this.rollingMonthlyForfeitKrw(userId);
    if (forfeited + maxLossKrw > cfg.rollingMonthlyLossCapKrw) {
      const remaining = Math.max(0, cfg.rollingMonthlyLossCapKrw - forfeited);
      throw new DomainError(
        'STAKE_TIER_LIMIT_EXCEEDED',
        `이번 달에는 최대 ${remaining.toLocaleString('ko-KR')}원까지 더 걸 수 있어요.`,
        { limitKrw: remaining, kind: 'rollingMonthly', tier },
      );
    }
  }
}
