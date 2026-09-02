import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import { Clock } from '../../common/clock/clock';
import { DomainError, ValidationError } from '../../common/errors/domain-errors';
import { Money } from '../../common/money/money';
import { ScheduleService } from '../schedule/schedule.service';
import { ScheduleInput } from '../schedule/schedule.types';

export interface QuoteInput {
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
  ) {}

  compute(input: QuoteInput): Quote {
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

    const now = this.clock.now();
    return {
      quoteId: `qt_${now.getTime().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      occurrenceCount,
      stakePerOccurrence: perOccurrence,
      maxLoss,
      currency: 'KRW',
      quoteExpiresAt: new Date(now.getTime() + 10 * 60 * 1000),
    };
  }
}
