import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import { ValidationError } from '../../common/errors/domain-errors';
import {
  ALL_WEEKDAYS,
  ScheduleInput,
  Weekday,
} from './schedule.types';

export interface OccurrencePlan {
  sequenceNo: number;
  windowStartAt: Date; // UTC
  deadlineAt: Date; // UTC
}

/**
 * Deterministic schedule → occurrence expansion.
 * - Uses commitment timezone for wall-clock interpretation (never device tz).
 * - `deadlineLocalTime <= windowStartLocalTime` means "spans past midnight into next day"
 *   (e.g., 22:00 window / 01:00 deadline).
 */
@Injectable()
export class ScheduleService {
  expand(input: ScheduleInput, timezone: string): OccurrencePlan[] {
    this.assertValid(input);
    const start = DateTime.fromISO(input.startDate, { zone: timezone });
    const end = DateTime.fromISO(input.endDate, { zone: timezone });
    if (!start.isValid || !end.isValid) throw new ValidationError('Invalid schedule dates');
    if (end < start) throw new ValidationError('End date is before start date');

    const localDates: DateTime[] = [];
    switch (input.type) {
      case 'one_time':
        localDates.push(start);
        break;
      case 'daily':
        for (let d = start; d <= end; d = d.plus({ days: 1 })) localDates.push(d);
        break;
      case 'specific_days': {
        const daysSet = new Set(input.days);
        for (let d = start; d <= end; d = d.plus({ days: 1 })) {
          if (daysSet.has(weekdayFromLuxon(d))) localDates.push(d);
        }
        break;
      }
      case 'x_per_week': {
        const allowed = new Set(input.allowedDays ?? ALL_WEEKDAYS);
        // Walk each ISO week from start to end; take the first N allowed days.
        let cursor = start.startOf('week');
        while (cursor <= end) {
          let picked = 0;
          for (let i = 0; i < 7 && picked < input.timesPerWeek; i++) {
            const d = cursor.plus({ days: i });
            if (d < start || d > end) continue;
            if (allowed.has(weekdayFromLuxon(d))) {
              localDates.push(d);
              picked++;
            }
          }
          cursor = cursor.plus({ weeks: 1 });
        }
        break;
      }
      case 'custom':
        for (const iso of input.dates) {
          const d = DateTime.fromISO(iso, { zone: timezone });
          if (!d.isValid || d < start || d > end) throw new ValidationError('Custom date out of range');
          localDates.push(d);
        }
        break;
    }

    const [wsH, wsM] = parseHm(input.windowStartLocalTime);
    const [dlH, dlM] = parseHm(input.deadlineLocalTime);
    const spansMidnight = dlH < wsH || (dlH === wsH && dlM < wsM);

    return localDates.map((d, idx) => {
      const windowStartLocal = d.set({ hour: wsH, minute: wsM, second: 0, millisecond: 0 });
      const deadlineLocal = spansMidnight
        ? d.plus({ days: 1 }).set({ hour: dlH, minute: dlM, second: 0, millisecond: 0 })
        : d.set({ hour: dlH, minute: dlM, second: 0, millisecond: 0 });
      return {
        sequenceNo: idx + 1,
        windowStartAt: windowStartLocal.toUTC().toJSDate(),
        deadlineAt: deadlineLocal.toUTC().toJSDate(),
      };
    });
  }

  countOccurrences(input: ScheduleInput, timezone: string): number {
    return this.expand(input, timezone).length;
  }

  private assertValid(input: ScheduleInput): void {
    if (!/^\d{2}:\d{2}$/.test(input.windowStartLocalTime)) {
      throw new ValidationError('windowStartLocalTime must be HH:mm');
    }
    if (!/^\d{2}:\d{2}$/.test(input.deadlineLocalTime)) {
      throw new ValidationError('deadlineLocalTime must be HH:mm');
    }
    if (input.type === 'specific_days' && input.days.length === 0) {
      throw new ValidationError('specific_days requires at least one day');
    }
    if (input.type === 'x_per_week' && (input.timesPerWeek < 1 || input.timesPerWeek > 7)) {
      throw new ValidationError('x_per_week.timesPerWeek must be 1..7');
    }
  }
}

function parseHm(s: string): [number, number] {
  const [h, m] = s.split(':').map((v) => parseInt(v, 10));
  return [h, m];
}

function weekdayFromLuxon(d: DateTime): Weekday {
  // luxon weekday: Mon=1..Sun=7
  return (['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const)[d.weekday - 1];
}
