import { ScheduleService } from './schedule.service';

describe('ScheduleService', () => {
  const svc = new ScheduleService();

  it('expands MON/WED/FRI in a single week to 3 occurrences (KST)', () => {
    // 2026-09-07 (Mon) .. 2026-09-13 (Sun)
    const plans = svc.expand(
      {
        type: 'specific_days',
        days: ['MON', 'WED', 'FRI'],
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
      'Asia/Seoul',
    );
    expect(plans).toHaveLength(3);
    expect(plans[0].sequenceNo).toBe(1);
    expect(plans[2].sequenceNo).toBe(3);
    // KST 21:00 == UTC 12:00
    expect(plans[0].deadlineAt.toISOString()).toBe('2026-09-07T12:00:00.000Z');
    expect(plans[1].deadlineAt.toISOString()).toBe('2026-09-09T12:00:00.000Z');
    expect(plans[2].deadlineAt.toISOString()).toBe('2026-09-11T12:00:00.000Z');
  });

  it('handles deadlines that span past midnight', () => {
    const [plan] = svc.expand(
      {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '22:00',
        deadlineLocalTime: '01:00',
      },
      'Asia/Seoul',
    );
    // Window 22:00 KST (= 13:00 UTC), deadline 01:00 next day KST (= 16:00 UTC same day)
    expect(plan.windowStartAt.toISOString()).toBe('2026-09-07T13:00:00.000Z');
    expect(plan.deadlineAt.toISOString()).toBe('2026-09-07T16:00:00.000Z');
  });

  it('counts daily occurrences correctly', () => {
    expect(
      svc.countOccurrences(
        {
          type: 'daily',
          startDate: '2026-09-07',
          endDate: '2026-09-13',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
        'Asia/Seoul',
      ),
    ).toBe(7);
  });
});
