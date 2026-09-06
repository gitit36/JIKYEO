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
import { allowedFailCount, ContractStrictnessMode, parseStrictness } from '../grace-policy';

export interface QuoteInput {
  userId: string;
  schedule: ScheduleInput;
  /** Commitment-level Stake. Occurrence count does not multiply this. */
  stakeTotalKrw: number;
  timezone: string;
  contractStrictness?: string;
}

export interface Quote {
  quoteId: string;
  occurrenceCount: number;
  stakeTotal: bigint;
  maxLoss: bigint;
  contractStrictness: ContractStrictnessMode;
  allowedFailCount: number;
  currency: 'KRW';
  quoteExpiresAt: Date;
}

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
    const stakeTotal = Money.fromNumber(input.stakeTotalKrw);
    if (stakeTotal <= 0n) {
      throw new ValidationError('Stake must be greater than 0');
    }
    if (stakeTotal > BigInt(this.cfg.maxStakePerOccurrenceKrw)) {
      throw new DomainError('STAKE_LIMIT_EXCEEDED', 'Stake exceeds allowed maximum', {
        limit: this.cfg.maxStakePerOccurrenceKrw,
      });
    }

    const occurrenceCount = this.schedule.countOccurrences(input.schedule, input.timezone);
    if (occurrenceCount <= 0) {
      throw new ValidationError('Schedule produces no occurrences');
    }

    const maxLoss = stakeTotal;
    if (maxLoss > BigInt(this.cfg.maxLossPerCommitmentKrw)) {
      throw new DomainError('STAKE_LIMIT_EXCEEDED', 'Max loss exceeds allowed per-commitment limit', {
        limit: this.cfg.maxLossPerCommitmentKrw,
      });
    }

    await this.stakePolicy.assertWithinLimits(
      input.userId,
      input.stakeTotalKrw,
      Number(maxLoss),
    );

    const contractStrictness = parseStrictness(input.contractStrictness);
    const allowed = allowedFailCount(contractStrictness, occurrenceCount);
    const now = this.clock.now();
    const quoteExpiresAt = new Date(now.getTime() + 10 * 60 * 1000);
    const quoteId = this.quoteCache.sign({
      jti: this.quoteCache.newJti(),
      occurrenceCount,
      stakePerOccurrence: stakeTotal.toString(),
      stakeTotal: stakeTotal.toString(),
      maxLoss: maxLoss.toString(),
      contractStrictness,
      allowedFailCount: allowed,
      quoteExpiresAt: quoteExpiresAt.toISOString(),
    });
    return {
      quoteId,
      occurrenceCount,
      stakeTotal,
      maxLoss,
      contractStrictness,
      allowedFailCount: allowed,
      currency: 'KRW',
      quoteExpiresAt,
    };
  }
}
