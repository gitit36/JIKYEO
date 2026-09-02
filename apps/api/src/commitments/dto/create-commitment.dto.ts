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
  /**
   * Optional dev-mode: null observer means "나만 보기".
   * `observerUserId` may be a placeholder string in Phase 2 friend UX;
   * real friendships are wired in Phase 5.
   */
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
   *   - `social` → no quoteId, no stake. Requires an observer relation.
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

  // MONEY-only. Server rejects when set for SELF/SOCIAL and when missing for MONEY.
  @IsOptional()
  @IsInt()
  @Min(1)
  stakePerOccurrenceKrw?: number;

  // MONEY-only. Must match a valid single-use quote produced by /commitments/quote.
  @IsOptional()
  @IsString()
  quoteId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ObserverDto)
  observer?: ObserverDto;
}

export class ActivateCommitmentDto {
  @IsString()
  quoteId!: string;
}
