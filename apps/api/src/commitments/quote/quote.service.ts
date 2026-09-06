import { Injectable, Optional } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { Clock } from '../../common/clock/clock';
import { DomainError, ValidationError } from '../../common/errors/domain-errors';
import { Money } from '../../common/money/money';
import { StakePolicyService } from '../../stake-policy/stake-policy.service';
import { ScheduleService } from '../schedule/schedule.service';
import { ScheduleInput } from '../schedule/schedule.types';
import { MoneyGateService } from '../../users/money-gate.service';
import { QuoteCacheService } from './quote-cache.service';

export interface QuoteInput {
  /** Owning user id — required so the quote can be sized to the user's tier. */
  userId: string;
  schedule: ScheduleInput;
  stakePerOccurrenceKrw: number;
  timezone: string;
}

export interface Quote {
  quoteId: string;
  occurrenceCount: number;
  stakePerOccurrence: bigint;
  maxLoss: bigint;
  currency: 'KRW';
  quoteExpiresAt: Date;
}

/**
 * Server-authoritative quote. iOS shows this exact result on the review screen
 * and later posts `quoteId` to `POST /commitments/:id/pay`.
 * The client's own math is never trusted.
 */
@Injectable()
export class QuoteService {
  constructor(
    private readonly schedule: ScheduleService,
    private readonly cfg: AppConfig,
    private readonly clock: Clock,
    private readonly quoteCache: QuoteCacheService,
    private readonly stakePolicy: StakePolicyService,
    @Optional() private readonly moneyGate?: MoneyGateService,
  ) {}

  async compute(input: QuoteInput): Promise<Quote> {
    await this.moneyGate?.assertCanUseMoney(input.userId);
    const perOccurrence = Money.fromNumber(input.stakePerOccurrenceKrw);
    if (perOccurrence <= 0n) {
      throw new ValidationError('Stake must be greater than 0');
    }
    if (perOccurrence > BigInt(this.cfg.maxStakePerOccurrenceKrw)) {
      throw new DomainError('STAKE_LIMIT_EXCEEDED', 'Stake per occurrence exceeds allowed maximum', {
        limit: this.cfg.maxStakePerOccurrenceKrw,
      });
    }

    const occurrenceCount = this.schedule.countOccurrences(input.schedule, input.timezone);
    if (occurrenceCount <= 0) {
      throw new ValidationError('Schedule produces no occurrences');
    }

    const maxLoss = perOccurrence * BigInt(occurrenceCount);
    if (maxLoss > BigInt(this.cfg.maxLossPerCommitmentKrw)) {
      throw new DomainError('STAKE_LIMIT_EXCEEDED', 'Max loss exceeds allowed per-commitment limit', {
        limit: this.cfg.maxLossPerCommitmentKrw,
      });
    }

    // Server-authoritative tier gate. The client already knows its tier via
    // /v1/stake-policy but the quote must not trust that echoed value.
    await this.stakePolicy.assertWithinLimits(
      input.userId,
      input.stakePerOccurrenceKrw,
      Number(maxLoss),
    );

    const now = this.clock.now();
    const quoteExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const quoteId = this.quoteCache.sign({
      jti: this.quoteCache.newJti(),
      occurrenceCount,
      stakePerOccurrence: perOccurrence.toString(),
      maxLoss: maxLoss.toString(),
      quoteExpiresAt: quoteExpiresAt.toISOString(),
    });
    return {
      quoteId,
      occurrenceCount,
      stakePerOccurrence: perOccurrence,
      maxLoss,
      currency: 'KRW',
      quoteExpiresAt,
    };
  }
}
