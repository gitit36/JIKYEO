import { FrozenClock } from '../../common/clock/clock';
import { DomainError } from '../../common/errors/domain-errors';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../../stake-policy/stake-policy.service';
import { ScheduleService } from '../schedule/schedule.service';
import { QuoteCacheService } from './quote-cache.service';
import { QuoteService } from './quote.service';

// Fake StakePolicyService that pretends the caller is TIER_1 and delegates
// limit checks to the default config, so QuoteService is exercised the way
// the API layer would exercise it in production.
function fakeStakePolicy(tier: 'tier_1' | 'tier_2' | 'tier_3' = 'tier_1'): StakePolicyService {
  const cfg = DEFAULT_STAKE_POLICY_CONFIG[tier];
  return {
    async assertWithinLimits(_userId: string, perOccurrenceKrw: number, maxLossKrw: number) {
      if (perOccurrenceKrw > cfg.maxPerOccurrenceKrw) {
        throw new DomainError('STAKE_TIER_LIMIT_EXCEEDED', 'per-occurrence too high');
      }
      if (maxLossKrw > cfg.maxPerCommitmentKrw) {
        throw new DomainError('STAKE_TIER_LIMIT_EXCEEDED', 'max loss too high');
      }
    },
    async tierOf() { return tier; },
    configFor: () => cfg,
    async forUser() { throw new Error('not used'); },
  } as unknown as StakePolicyService;
}

function makeService(
  overrides?: Partial<Record<string, unknown>>,
  policy: StakePolicyService = fakeStakePolicy('tier_2'), // Tier 2 so the "config maxima" tests still exercise the config limits.
): { svc: QuoteService; cache: QuoteCacheService; clock: FrozenClock } {
  const cfg = {
    jwtSecret: 'test-jwt-secret',
    quoteSigningSecret: 'test-quote-secret',
    maxStakePerOccurrenceKrw: 100_000,
    maxLossPerCommitmentKrw: 500_000,
    ...(overrides ?? {}),
  } as unknown as ConstructorParameters<typeof QuoteService>[1];
  const clock = new FrozenClock(new Date('2026-09-02T14:00:00.000Z'));
  const cache = new QuoteCacheService(cfg, clock);
  return {
    svc: new QuoteService(new ScheduleService(), cfg, clock, cache, policy),
    cache,
    clock,
  };
}

describe('QuoteService', () => {
  it('computes 3 × 5,000 = 15,000 KRW authoritatively', async () => {
    const { svc } = makeService();
    const q = await svc.compute({
      userId: 'u1',
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

  it('signs and verifies a quote (with jti), rejects tampered payload', async () => {
    const { svc, cache } = makeService();
    const q = await svc.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakePerOccurrenceKrw: 5_000,
      schedule: {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    const claims = cache.verify(q.quoteId);
    expect(claims.occurrenceCount).toBe(3);
    expect(claims.stakePerOccurrence).toBe('5000');
    expect(claims.maxLoss).toBe('15000');
    expect(typeof claims.jti).toBe('string');
    expect(claims.jti.length).toBeGreaterThan(10);
    expect(() => cache.verify(q.quoteId.slice(0, -1) + 'X')).toThrow(DomainError);
  });

  it('rejects a quote signed with a different secret', async () => {
    const { svc, clock } = makeService();
    const q = await svc.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakePerOccurrenceKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    const badCache = new QuoteCacheService(
      { quoteSigningSecret: 'attacker-guess' } as unknown as any,
      clock,
    );
    expect(() => badCache.verify(q.quoteId)).toThrow(DomainError);
  });

  it('generates a fresh jti on every quote (uniqueness)', async () => {
    const { svc } = makeService();
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const q = await svc.compute({
        userId: 'u1',
        timezone: 'Asia/Seoul',
        stakePerOccurrenceKrw: 5_000,
        schedule: {
          type: 'one_time',
          startDate: '2026-09-07',
          endDate: '2026-09-07',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
      });
      seen.add(q.quoteId);
    }
    expect(seen.size).toBe(20);
  });

  it('rejects an expired quote', async () => {
    const { svc, cache, clock } = makeService();
    const q = await svc.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakePerOccurrenceKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    clock.advance(11 * 60 * 1000);
    expect(() => cache.verify(q.quoteId)).toThrow(DomainError);
  });

  it('rejects stake per occurrence above config limit', async () => {
    const { svc } = makeService();
    await expect(
      svc.compute({
        userId: 'u1',
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
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects max loss above per-commitment limit', async () => {
    const { svc } = makeService();
    await expect(
      svc.compute({
        userId: 'u1',
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
    ).rejects.toBeInstanceOf(DomainError);
  });

  it('enforces tier limits — TIER 1 rejects 30,001 KRW per occurrence', async () => {
    const { svc } = makeService({}, fakeStakePolicy('tier_1'));
    await expect(
      svc.compute({
        userId: 'u1',
        timezone: 'Asia/Seoul',
        stakePerOccurrenceKrw: 30_001,
        schedule: {
          type: 'one_time',
          startDate: '2026-09-07',
          endDate: '2026-09-07',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
      }),
    ).rejects.toMatchObject({ code: 'STAKE_TIER_LIMIT_EXCEEDED' });
  });

  it('enforces tier limits — TIER 1 allows exactly 30,000 KRW per occurrence', async () => {
    const { svc } = makeService({}, fakeStakePolicy('tier_1'));
    const q = await svc.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakePerOccurrenceKrw: 30_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    expect(q.stakePerOccurrence).toBe(30_000n);
  });

  it('enforces tier limits — TIER 1 rejects commitment max loss above 150,000 KRW', async () => {
    const { svc } = makeService({}, fakeStakePolicy('tier_1'));
    await expect(
      svc.compute({
        userId: 'u1',
        timezone: 'Asia/Seoul',
        stakePerOccurrenceKrw: 30_000,
        schedule: {
          // 30_000 * 6 = 180_000 > 150_000 tier1 max
          type: 'daily',
          startDate: '2026-09-07',
          endDate: '2026-09-12',
          windowStartLocalTime: '07:00',
          deadlineLocalTime: '09:00',
        },
      }),
    ).rejects.toMatchObject({ code: 'STAKE_TIER_LIMIT_EXCEEDED' });
  });
});
