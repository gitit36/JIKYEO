import { Inject, Injectable, Optional } from '@nestjs/common';
import { StakeTier } from '@prisma/client';
import { Clock, SystemClock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-errors';
import { Prisma } from '@prisma/client';
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
    const { reservedKrw, realizedForfeitKrw } = await this.rollingExposure(userId);
    return {
      currentTier: tier,
      maxPerOccurrenceKrw: cfg.maxPerOccurrenceKrw,
      maxPerCommitmentKrw: cfg.maxPerCommitmentKrw,
      rollingMonthlyLossCapKrw: cfg.rollingMonthlyLossCapKrw,
      rollingMonthlyLossRemainingKrw: Math.max(0, cfg.rollingMonthlyLossCapKrw - reservedKrw - realizedForfeitKrw),
      suggestedAmountsKrw: cfg.suggestedAmountsKrw,
    };
  }

  /**
   * A commitment consumes the rolling cap exactly once:
   *   - funded / settling / unknown-in-flight MONEY → reserve full maxTotalAmount
   *   - completed / cancelled → count only settled forfeit inside the window
   * Never both.
   */
  async rollingExposure(
    userId: string,
    tx?: PrismaService | Prisma.TransactionClient,
    excludeCommitmentId?: string,
  ): Promise<{ reservedKrw: number; realizedForfeitKrw: number }> {
    const db = tx ?? this.prisma;
    const since = new Date(this.clock.now().getTime() - 30 * 24 * 60 * 60 * 1000);
    const [commitments, inFlight, moneyRows] = await Promise.all([
      db.commitment.findMany({
        where: { userId, enforcementMode: 'money' },
        include: { stake: true },
      }),
      db.payment.findMany({
        where: { userId, type: 'charge', status: 'requested' },
        select: { commitmentId: true },
      }),
      db.paymentLedger.findMany({
        where: {
          userId,
          entryType: { in: ['forfeit', 'reversal', 'refund_paid'] },
          createdAt: { gte: since },
        },
        select: { commitmentId: true, occurrenceId: true, amount: true, entryType: true, idempotencyKey: true },
      }),
    ]);
    const requestedIds = new Set(inFlight.map((p) => p.commitmentId).filter(Boolean) as string[]);
    let reservedKrw = 0;
    const reservedIds = new Set<string>();
    for (const c of commitments) {
      if (c.id === excludeCommitmentId) continue;
      if (c.status === 'completed') continue;
      const stake = c.stake;
      if (!stake) continue;
      // Cancelled unsigned stays reserved until the refund actually succeeds.
      const reserved =
        stake.status === 'funded' ||
        stake.status === 'settling' ||
        requestedIds.has(c.id);
      if (!reserved) continue;
      reservedKrw += Number(stake.maxTotalAmount);
      reservedIds.add(c.id);
    }
    let realizedForfeitKrw = 0;
    const completedIds = new Set(
      commitments.filter((c) => c.status === 'completed').map((c) => c.id),
    );
    const creditedReversals = new Set<string>();
    for (const r of moneyRows) {
      if (r.entryType === 'refund_paid' && r.idempotencyKey?.startsWith('refund_paid:appeal:') && r.occurrenceId) {
        creditedReversals.add(r.occurrenceId);
      }
    }
    for (const r of moneyRows) {
      if (r.entryType !== 'forfeit') continue;
      if (reservedIds.has(r.commitmentId)) continue;
      if (!completedIds.has(r.commitmentId)) continue;
      realizedForfeitKrw += Number(r.amount);
    }
    for (const r of moneyRows) {
      if (r.entryType !== 'reversal' || !r.occurrenceId) continue;
      if (reservedIds.has(r.commitmentId)) continue;
      if (!completedIds.has(r.commitmentId)) continue;
      if (!creditedReversals.has(r.occurrenceId)) continue;
      realizedForfeitKrw -= Number(r.amount);
    }
    if (realizedForfeitKrw < 0) realizedForfeitKrw = 0;
    return { reservedKrw, realizedForfeitKrw };
  }

  /** @deprecated use rollingExposure().realizedForfeitKrw */
  async rollingMonthlyForfeitKrw(userId: string): Promise<number> {
    return (await this.rollingExposure(userId)).realizedForfeitKrw;
  }

  /**
   * Atomically-called at charge time (caller holds the per-user lock).
   * Rejects when reserved + realized + candidate > tier cap.
   */
  async assertPaymentFitsCap(
    userId: string,
    candidateCommitmentId: string,
    candidateMaxTotalKrw: bigint,
    tx?: PrismaService | Prisma.TransactionClient,
  ): Promise<void> {
    const tier = await this.tierOf(userId);
    const cfg = this.configFor(tier);
    const { reservedKrw, realizedForfeitKrw } = await this.rollingExposure(userId, tx, candidateCommitmentId);
    const candidate = Number(candidateMaxTotalKrw);
    if (reservedKrw + realizedForfeitKrw + candidate > cfg.rollingMonthlyLossCapKrw) {
      const remaining = Math.max(0, cfg.rollingMonthlyLossCapKrw - reservedKrw - realizedForfeitKrw);
      throw new DomainError(
        'STAKE_TIER_LIMIT_EXCEEDED',
        `이번 달에는 최대 ${remaining.toLocaleString('ko-KR')}원까지 더 걸 수 있어요.`,
        { limitKrw: remaining, kind: 'rollingMonthly', tier },
      );
    }
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
        `약속금은 최대 ${cfg.maxPerOccurrenceKrw.toLocaleString('ko-KR')}원까지 걸 수 있어요.`,
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
    const { reservedKrw, realizedForfeitKrw } = await this.rollingExposure(userId);
    if (reservedKrw + realizedForfeitKrw + maxLossKrw > cfg.rollingMonthlyLossCapKrw) {
      const remaining = Math.max(0, cfg.rollingMonthlyLossCapKrw - reservedKrw - realizedForfeitKrw);
      throw new DomainError(
        'STAKE_TIER_LIMIT_EXCEEDED',
        `이번 달에는 최대 ${remaining.toLocaleString('ko-KR')}원까지 더 걸 수 있어요.`,
        { limitKrw: remaining, kind: 'rollingMonthly', tier },
      );
    }
  }
}
