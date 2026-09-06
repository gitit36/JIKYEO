import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min, ValidateNested } from 'class-validator';
import { ScheduleInput, Weekday } from '../schedule/schedule.types';

const WEEKDAYS: Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export class ScheduleDto {
  @IsIn(['one_time', 'daily', 'specific_days', 'x_per_week', 'custom'])
  type!: ScheduleInput['type'];

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  startDate!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  endDate!: string;

  @Matches(/^\d{2}:\d{2}$/)
  windowStartLocalTime!: string;

  @Matches(/^\d{2}:\d{2}$/)
  deadlineLocalTime!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEEKDAYS, { each: true })
  days?: Weekday[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(7)
  timesPerWeek?: number;

  @IsOptional()
  @IsArray()
  @IsIn(WEEKDAYS, { each: true })
  allowedDays?: Weekday[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dates?: string[];

  toDomain(): ScheduleInput {
    return this as unknown as ScheduleInput;
  }
}

export class QuoteRequestDto {
  @ValidateNested()
  @Type(() => ScheduleDto)
  schedule!: ScheduleDto;

  /** Commitment-level Stake. Preferred. */
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

  @IsString()
  timezone!: string;
}
