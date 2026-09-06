import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { CommitmentCategory, EnforcementMode, VerificationMethod } from '@prisma/client';
import { ScheduleDto } from './schedule.dto';

const ENFORCEMENT_MODES: EnforcementMode[] = ['self', 'social', 'money'];

const CATEGORIES: CommitmentCategory[] = [
  'wakeup',
  'workout',
  'study',
  'read',
  'meditate',
  'screen',
  'custom',
];

const METHODS: VerificationMethod[] = [
  'photo',
  'gps',
  'timer',
  'self',
  'friend',
  'health',
  'screen_time',
  'timelapse',
];

export class GpsTargetDto {
  @IsNumber() lat!: number;
  @IsNumber() lng!: number;
  @IsInt() @Min(20) radiusM!: number;
  /**
   * The client must explicitly signal that the user picked the location on a
   * map. This gate exists specifically to prevent the client from silently
   * defaulting to a fixed coordinate. The MapKit picker in Phase 3 sets this
   * to `true`; DEBUG builds may set it via a mock-location toggle. Any request
   * missing this field is rejected — no default is ever assumed.
   */
  @IsBoolean() userSelected!: boolean;
  @IsOptional() @IsString() label?: string;
}

export class VerificationRuleDto {
  @IsIn(METHODS)
  method!: VerificationMethod;

  @IsOptional()
  @ValidateNested()
  @Type(() => GpsTargetDto)
  gps?: GpsTargetDto;

  @IsOptional()
  @IsInt()
  @Min(60)
  timerRequiredSeconds?: number;

  @IsOptional()
  @IsString()
  hint?: string;
}

export class ObserverDto {
  /** SOCIAL: accepted friend user id. Viewer only in Phase 5.1. */
  @IsOptional()
  @IsString()
  observerUserId?: string | null;

  @IsBoolean()
  isVerifier!: boolean;
}

export class CreateCommitmentDraftDto {
  @IsOptional()
  @IsString()
  templateId?: string;

  @IsString()
  title!: string;

  @IsIn(CATEGORIES)
  category!: CommitmentCategory;

  @IsString()
  timezone!: string;

  /**
   * User-chosen enforcement strength. Governs whether Stake/Quote/Payment
   * are created. See ERD §3 (Commitment / Stake) and SRD §SR-FR-013.
   *   - `self`   → no quoteId, no stake, no payment. Prove for yourself.
   *   - `social` → no quoteId, no stake. Requires one accepted-friend viewer.
   *   - `money`  → quoteId + stakePerOccurrenceKrw both required.
   */
  @IsIn(ENFORCEMENT_MODES)
  enforcementMode!: EnforcementMode;

  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule!: ScheduleDto;

  @ValidateNested()
  @Type(() => VerificationRuleDto)
  verification!: VerificationRuleDto;

  // MONEY-only. Commitment-level Stake. Preferred.
  @IsOptional()
  @IsInt()
  @Min(1)
  stakeTotalKrw?: number;

  /** @deprecated Alias of stakeTotalKrw. Never multiplied. */
  @IsOptional()
  @IsInt()
  @Min(1)
  stakePerOccurrenceKrw?: number;

  @IsOptional()
  @IsIn(['perfect', 'realistic', 'flexible'])
  contractStrictness?: 'perfect' | 'realistic' | 'flexible';

  // MONEY-only. Must match a valid single-use quote produced by /commitments/quote.
  @IsOptional()
  @IsString()
  quoteId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ObserverDto)
  observer?: ObserverDto;

  @IsOptional()
  @IsString()
  sharedCommitmentId?: string;
}

export class ActivateCommitmentDto {
  @IsString()
  quoteId!: string;
}
