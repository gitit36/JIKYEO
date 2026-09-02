/**
 * Schedule domain types. Serialized into `commitment.schedule_json`.
 * Timezone is fixed on the parent Commitment; schedules use *wall-clock* fields
 * (dates and HH:mm) and are expanded into UTC occurrences at activation time.
 */
export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export const ALL_WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

export type ScheduleInput =
  | OneTimeScheduleInput
  | DailyScheduleInput
  | SpecificDaysScheduleInput
  | XPerWeekScheduleInput
  | CustomScheduleInput;

export interface CommonScheduleFields {
  /** Local (wall-clock) start date, inclusive. YYYY-MM-DD. */
  startDate: string;
  /** Local (wall-clock) end date, inclusive. YYYY-MM-DD. */
  endDate: string;
  /** Local time when the occurrence's action window starts, HH:mm. */
  windowStartLocalTime: string;
  /** Local time when the occurrence's proof deadline falls, HH:mm. */
  deadlineLocalTime: string;
}

export interface OneTimeScheduleInput extends CommonScheduleFields {
  type: 'one_time';
}

export interface DailyScheduleInput extends CommonScheduleFields {
  type: 'daily';
}

export interface SpecificDaysScheduleInput extends CommonScheduleFields {
  type: 'specific_days';
  days: Weekday[];
}

export interface XPerWeekScheduleInput extends CommonScheduleFields {
  type: 'x_per_week';
  timesPerWeek: number;
  allowedDays?: Weekday[]; // if omitted, any day
}

export interface CustomScheduleInput extends CommonScheduleFields {
  type: 'custom';
  /** Explicit list of local YYYY-MM-DD dates. */
  dates: string[];
}
