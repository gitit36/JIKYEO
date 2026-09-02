import { FrozenClock } from '../../common/clock/clock';
import { DomainError } from '../../common/errors/domain-errors';
import { ScheduleService } from '../schedule/schedule.service';
import { QuoteService } from './quote.service';

function makeService(overrides?: Partial<Record<string, unknown>>): QuoteService {
  const cfg = {
    maxStakePerOccurrenceKrw: 100_000,
    maxLossPerCommitmentKrw: 500_000,
    ...(overrides ?? {}),
  } as unknown as ConstructorParameters<typeof QuoteService>[1];
  const clock = new FrozenClock(new Date('2026-09-02T14:00:00.000Z'));
  return new QuoteService(new ScheduleService(), cfg, clock);
}

describe('QuoteService', () => {
  it('computes 3 × 5,000 = 15,000 KRW authoritatively', () => {
    const svc = makeService();
    const q = svc.compute({
      timezone: 'Asia/Seoul',
      stakePerOccurrenceKrw: 5_000,
      schedule: {
        type: 'specific_days',
        days: ['MON', 'WED', 'FRI'],
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    expect(q.occurrenceCount).toBe(3);
    expect(q.stakePerOccurrence).toBe(5_000n);
    expect(q.maxLoss).toBe(15_000n);
    expect(q.currency).toBe('KRW');
    expect(q.quoteExpiresAt.toISOString()).toBe('2026-09-02T14:10:00.000Z');
  });

  it('rejects stake per occurrence above config limit', () => {
    const svc = makeService();
    expect(() =>
      svc.compute({
        timezone: 'Asia/Seoul',
        stakePerOccurrenceKrw: 100_001,
        schedule: {
          type: 'one_time',
          startDate: '2026-09-07',
          endDate: '2026-09-07',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
      }),
    ).toThrow(DomainError);
  });

  it('rejects max loss above per-commitment limit', () => {
    const svc = makeService();
    expect(() =>
      svc.compute({
        timezone: 'Asia/Seoul',
        stakePerOccurrenceKrw: 100_000,
        schedule: {
          type: 'daily',
          startDate: '2026-09-07',
          endDate: '2026-09-20',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
      }),
    ).toThrow(DomainError);
  });
});
