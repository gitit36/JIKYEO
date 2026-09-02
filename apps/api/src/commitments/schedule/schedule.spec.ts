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

  it('one_time schedule expands to exactly one occurrence', () => {
    const plans = svc.expand(
      {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
      'Asia/Seoul',
    );
    expect(plans).toHaveLength(1);
    expect(plans[0].sequenceNo).toBe(1);
    expect(plans[0].deadlineAt.toISOString()).toBe('2026-09-07T00:00:00.000Z'); // 09:00 KST
  });

  it('daily 7-day expansion produces 7 sequential occurrences', () => {
    const plans = svc.expand(
      {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
      'Asia/Seoul',
    );
    expect(plans).toHaveLength(7);
    for (let i = 0; i < plans.length; i++) expect(plans[i].sequenceNo).toBe(i + 1);
    expect(plans.at(-1)!.deadlineAt.toISOString()).toBe('2026-09-13T00:00:00.000Z');
  });

  it('x_per_week fills N earliest allowed days per ISO week', () => {
    const plans = svc.expand(
      {
        type: 'x_per_week',
        timesPerWeek: 3,
        startDate: '2026-09-07', // Mon
        endDate: '2026-09-20',   // Sun of week 2
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
      'Asia/Seoul',
    );
    expect(plans).toHaveLength(6);
    // sequence numbers stable
    for (let i = 0; i < plans.length; i++) expect(plans[i].sequenceNo).toBe(i + 1);
    // first three deadlines are in the first ISO week
    expect(plans[0].deadlineAt.toISOString().startsWith('2026-09-')).toBe(true);
    expect(plans[2].deadlineAt.getUTCDate()).toBeLessThanOrEqual(13);
    expect(plans[3].deadlineAt.getUTCDate()).toBeGreaterThanOrEqual(14);
  });

  it('midnight-crossing deadline is stored as the correct next-day KST wall-clock in UTC', () => {
    // Window 22:00 KST → deadline 01:00 KST next day
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
    // 22:00 KST 09-07 == 13:00 UTC 09-07
    expect(plan.windowStartAt.toISOString()).toBe('2026-09-07T13:00:00.000Z');
    // 01:00 KST 09-08 == 16:00 UTC 09-07
    expect(plan.deadlineAt.toISOString()).toBe('2026-09-07T16:00:00.000Z');
    // deadline must be strictly after window start
    expect(plan.deadlineAt.getTime()).toBeGreaterThan(plan.windowStartAt.getTime());
  });

  it('same schedule expanded with a different timezone yields different UTC values (proving TZ matters at expansion time)', () => {
    const input = {
      type: 'one_time' as const,
      startDate: '2026-09-07',
      endDate: '2026-09-07',
      windowStartLocalTime: '09:00',
      deadlineLocalTime: '10:00',
    };
    const seoul = svc.expand(input, 'Asia/Seoul');
    const la = svc.expand(input, 'America/Los_Angeles');
    expect(seoul[0].deadlineAt.toISOString()).not.toBe(la[0].deadlineAt.toISOString());
  });

  it('once expanded, occurrence timestamps are absolute UTC — reading from any device timezone returns the same instant', () => {
    const plans = svc.expand(
      {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
      'Asia/Seoul',
    );
    // Simulate a "device timezone change" — the deadlines don't move; only
    // their wall-clock rendering does. This is exactly what happens once
    // Occurrence rows are persisted with their UTC deadlineAt.
    const asSeoulWall = plans.map((p) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' }).format(p.deadlineAt),
    );
    const asLaWall = plans.map((p) =>
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', dateStyle: 'short', timeStyle: 'short' }).format(p.deadlineAt),
    );
    // The wall-clock strings differ, but the underlying getTime() is identical.
    expect(asSeoulWall).not.toEqual(asLaWall);
    for (const p of plans) {
      // A second read using a different tz label must not mutate the epoch millis.
      const before = p.deadlineAt.getTime();
      new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(p.deadlineAt);
      expect(p.deadlineAt.getTime()).toBe(before);
    }
  });
});
