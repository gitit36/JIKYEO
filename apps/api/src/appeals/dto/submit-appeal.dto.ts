import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export const APPEAL_REASON_CATEGORIES = ['verification_error', 'evidence_misread', 'other'] as const;
export type AppealReasonCategory = (typeof APPEAL_REASON_CATEGORIES)[number];

export class SubmitAppealDto {
  @IsIn(APPEAL_REASON_CATEGORIES)
  reasonCategory!: AppealReasonCategory;

  @IsString()
  @MinLength(1)
  @MaxLength(500)
  explanation!: string;
}
