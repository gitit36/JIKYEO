import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class ApproveAppealDto {
  @IsIn(['pass', 'void'])
  correctedResult!: 'pass' | 'void';

  /** Dev/test only. Forces the mock PG to fail the supplemental refund once. */
  @IsOptional()
  @IsIn(['refund_fail'])
  simulate?: 'refund_fail';
}

export class RejectAppealDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  reason!: string;
}
