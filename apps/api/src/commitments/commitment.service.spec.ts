import { FrozenClock } from '../common/clock/clock';
import { DomainError, ValidationError } from '../common/errors/domain-errors';
import { AuditService } from '../audit/audit.service';
import { RuleBasedGoalSafetyClassifier } from '../safety/goal-safety.classifier';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { UsersService } from '../users/users.service';
import { CommitmentService } from './commitment.service';
import { CreateCommitmentDraftDto } from './dto/create-commitment.dto';
import { ScheduleDto } from './dto/schedule.dto';
import { QuoteCacheService } from './quote/quote-cache.service';
import { QuoteService } from './quote/quote.service';
import { ScheduleService } from './schedule/schedule.service';

/**
 * Unit tests for the Commitment activation flow with an in-memory Prisma stub.
 * DB-level integration tests live in ./commitment.integration.spec.ts (skipped
 * unless DATABASE_URL points at a running Postgres).
 */

interface StubDb {
  commitments: any[];
  stakes: any[];
  verificationRules: any[];
  occurrences: any[];
  observers: any[];
  audit: any[];
  consumedQuotes: Map<string, { jti: string; userId: string; commitmentId?: string }>;
}

function makeStubPrisma(db: StubDb) {
  return {
    commitment: {
      create: async ({ data }: { data: any }) => {
        const row = { id: `c${db.commitments.length + 1}`, ...data };
        db.commitments.push(row);
        return row;
      },
      findUnique: async () => null,
    },
    stake: { create: async ({ data }: { data: any }) => { db.stakes.push({ id: `s${db.stakes.length + 1}`, ...data }); return {}; } },
    verificationRule: { create: async ({ data }: { data: any }) => { db.verificationRules.push({ id: `v${db.verificationRules.length + 1}`, ...data }); return {}; } },
    commitmentObserver: { create: async ({ data }: { data: any }) => { db.observers.push(data); return {}; } },
    occurrence: {
      createMany: async ({ data }: { data: any[] }) => {
        for (const r of data) db.occurrences.push({ id: `o${db.occurrences.length + 1}`, ...r });
        return { count: data.length };
      },
    },
    consumedQuote: {
      create: async ({ data }: { data: { jti: string; userId: string } }) => {
        if (db.consumedQuotes.has(data.jti)) {
          throw Object.assign(new Error('unique constraint'), { code: 'P2002' });
        }
        db.consumedQuotes.set(data.jti, { ...data });
        return data;
      },
      update: async ({ where, data }: { where: { jti: string }; data: any }) => {
        const row = db.consumedQuotes.get(where.jti);
        if (row) db.consumedQuotes.set(where.jti, { ...row, ...data });
        return row;
      },
    },
    auditLog: { create: async ({ data }: { data: any }) => { db.audit.push(data); return {}; } },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        birthDate: null,
        displayName: 'Test',
        authProvider: 'email',
        authSubject: 'test@jikyeo.local',
        email: 'test@jikyeo.local',
        locale: 'ko-KR',
        timezone: 'Asia/Seoul',
        status: 'active',
        stakeTier: 'tier_1',
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
  } as any;
}

function fakeStakePolicy(tier: 'tier_1' | 'tier_2' | 'tier_3' = 'tier_2'): StakePolicyService {
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

function makeSubject(now = new Date('2026-09-02T05:00:00.000Z'), tier: 'tier_1' | 'tier_2' | 'tier_3' = 'tier_2') {
  const db: StubDb = { commitments: [], stakes: [], verificationRules: [], occurrences: [], observers: [], audit: [], consumedQuotes: new Map() };
  const stub: any = {
    ...makeStubPrisma(db),
  };
  stub.$transaction = async (fn: (tx: any) => Promise<string>) => fn(stub);

  const clock = new FrozenClock(now);
  const cfg = {
    jwtSecret: 'test-jwt-secret',
    quoteSigningSecret: 'test-quote-secret',
    maxStakePerOccurrenceKrw: 100_000,
    maxLossPerCommitmentKrw: 500_000,
  } as unknown as ConstructorParameters<typeof QuoteService>[1];
  const schedule = new ScheduleService();
  const cache = new QuoteCacheService(cfg, clock);
  const stakePolicy = fakeStakePolicy(tier);
  const quote = new QuoteService(schedule, cfg, clock, cache, stakePolicy);
  const users = new UsersService(stub);
  const safety = new RuleBasedGoalSafetyClassifier();
  const audit = new AuditService(stub);
  const service = new CommitmentService(stub, schedule, cache, safety, users, stakePolicy, clock, audit);
  return { service, quote, db, clock };
}

function buildMoneyDto(quoteId: string, overrides: Partial<CreateCommitmentDraftDto> = {}): CreateCommitmentDraftDto {
  const scheduleDto = new ScheduleDto();
  Object.assign(scheduleDto, {
    type: 'specific_days',
    days: ['MON', 'WED', 'FRI'],
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    windowStartLocalTime: '18:00',
    deadlineLocalTime: '21:00',
  });
  return {
    templateId: 'workout',
    title: '헬스장 가기',
    category: 'workout',
    enforcementMode: 'money',
    timezone: 'Asia/Seoul',
    schedule: scheduleDto,
    verification: {
      method: 'gps',
      gps: { lat: 37.5665, lng: 126.9780, radiusM: 150, userSelected: true },
    },
    stakePerOccurrenceKrw: 5_000,
    quoteId,
    observer: undefined,
    ...overrides,
  };
}

function buildSelfDto(overrides: Partial<CreateCommitmentDraftDto> = {}): CreateCommitmentDraftDto {
  const scheduleDto = new ScheduleDto();
  Object.assign(scheduleDto, {
    type: 'daily',
    startDate: '2026-09-07',
    endDate: '2026-09-09',
    windowStartLocalTime: '18:00',
    deadlineLocalTime: '22:00',
  });
  return {
    templateId: 'study',
    title: '매일 60분 공부하기',
    category: 'study',
    enforcementMode: 'self',
    timezone: 'Asia/Seoul',
    schedule: scheduleDto,
    verification: { method: 'timer', timerRequiredSeconds: 3600 },
    stakePerOccurrenceKrw: undefined,
    quoteId: undefined,
    observer: undefined,
    ...overrides,
  };
}

describe('CommitmentService.createAndActivate — MONEY mode', () => {
  it('persists Commitment, Stake, VerificationRule, and 3 Occurrences for MWF (KST)', async () => {
    const { service, quote, db } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'specific_days',
        days: ['MON', 'WED', 'FRI'],
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const result = await service.createAndActivate('u1', buildMoneyDto(q.quoteId));
    expect(result.occurrenceCount).toBe(3);
    expect(result.maxLossKrw).toBe('5000');
    expect(result.enforcementMode).toBe('money');
    // Phase 4: MONEY is NOT active until the upfront charge succeeds.
    expect(result.status).toBe('payment_pending');
    expect(result.paymentRequired).toBe(true);
    expect(db.commitments).toHaveLength(1);
    expect(db.commitments[0].status).toBe('payment_pending');
    expect(db.commitments[0].signatureCompleted).toBe(false);
    expect(db.stakes[0].status).toBe('pending');
    expect(db.commitments[0].enforcementMode).toBe('money');
    expect(db.commitments[0].timezone).toBe('Asia/Seoul');
    expect(db.commitments[0].maxLossAmount).toBe(5000n);
    expect(db.commitments[0].currency).toBe('KRW');
    expect(db.stakes).toHaveLength(1);
    expect(db.verificationRules).toHaveLength(1);
    expect(db.verificationRules[0].method).toBe('gps');
    expect(db.occurrences).toHaveLength(3);
    for (const o of db.occurrences) {
      expect(o.deadlineAt.getUTCHours()).toBe(12);
      expect(o.stakeAmount).toBeNull();
    }
  });

  it('rejects MONEY activation without quoteId', async () => {
    const { service } = makeSubject();
    const dto = buildMoneyDto('irrelevant', { quoteId: undefined });
    await expect(service.createAndActivate('u1', dto)).rejects.toMatchObject({
      code: 'QUOTE_REQUIRED_FOR_MODE',
    });
  });

  it('rejects an expired quote', async () => {
    const { service, quote, clock } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    clock.advance(11 * 60 * 1000);
    await expect(service.createAndActivate('u1', buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      }),
      verification: { method: 'photo' },
    }))).rejects.toBeInstanceOf(DomainError);
  });

  it('rejects when the schedule no longer matches the signed quote', async () => {
    const { service, quote } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'specific_days',
        days: ['MON', 'WED', 'FRI'],
        startDate: '2026-09-07',
        endDate: '2026-09-13',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const mismatched = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-11',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
    });
    await expect(service.createAndActivate('u1', mismatched)).rejects.toBeInstanceOf(DomainError);
  });

  it('blocks dangerous goals for MONEY mode with a calm Korean message', async () => {
    const { service, quote } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      },
    });
    const dto = buildMoneyDto(q.quoteId, {
      title: '자살 준비',
      category: 'custom',
      verification: { method: 'self' },
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '07:00',
        deadlineLocalTime: '09:00',
      }),
    });
    await expect(service.createAndActivate('u1', dto)).rejects.toMatchObject({ code: 'GOAL_UNSAFE' });
  });

  it('validates GPS rule fields', async () => {
    const { service, quote } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const dto = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
      verification: { method: 'gps' } as any,
    });
    await expect(service.createAndActivate('u1', dto)).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects GPS activation when userSelected is false (no silent default)', async () => {
    const { service, quote } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const dto = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
      verification: {
        method: 'gps',
        gps: { lat: 37.4979, lng: 127.0276, radiusM: 150, userSelected: false } as any,
      },
    });
    await expect(service.createAndActivate('u1', dto)).rejects.toMatchObject({
      code: 'GPS_TARGET_NOT_SELECTED',
    });
  });

  it('rejects GPS activation when coordinates are the null island (0,0)', async () => {
    const { service, quote } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const dto = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
      verification: {
        method: 'gps',
        gps: { lat: 0, lng: 0, radiusM: 150, userSelected: true } as any,
      },
    });
    await expect(service.createAndActivate('u1', dto)).rejects.toMatchObject({
      code: 'GPS_TARGET_NOT_SELECTED',
    });
  });
});

describe('CommitmentService.createAndActivate — SELF mode', () => {
  it('activates a SELF commitment without a quote and without creating a stake row', async () => {
    const { service, db } = makeSubject();
    const result = await service.createAndActivate('u1', buildSelfDto());
    expect(result.enforcementMode).toBe('self');
    expect(result.maxLossKrw).toBeNull();
    expect(result.occurrenceCount).toBe(3);
    // SELF never enters the payment flow: active immediately, no Payment/Stake.
    expect(result.status).toBe('active');
    expect(result.paymentRequired).toBe(false);
    expect(db.commitments).toHaveLength(1);
    expect(db.commitments[0].status).toBe('active');
    expect(db.commitments[0].signatureCompleted).toBe(true);
    expect(db.commitments[0].enforcementMode).toBe('self');
    expect(db.commitments[0].maxLossAmount).toBeNull();
    expect(db.commitments[0].currency).toBeNull();
    expect(db.stakes).toHaveLength(0);
    expect(db.consumedQuotes.size).toBe(0);
    for (const o of db.occurrences) {
      expect(o.stakeAmount).toBeNull();
    }
  });

  it('rejects a SELF activation that carries a stray quoteId (no client-side money leak)', async () => {
    const { service } = makeSubject();
    await expect(service.createAndActivate('u1', buildSelfDto({ quoteId: 'qt_leftover' }))).rejects.toMatchObject({
      code: 'QUOTE_NOT_ALLOWED_FOR_MODE',
    });
  });

  it('rejects a SELF activation that carries a stray stake amount', async () => {
    const { service } = makeSubject();
    await expect(service.createAndActivate('u1', buildSelfDto({ stakePerOccurrenceKrw: 5_000 }))).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('CommitmentService.createAndActivate — SOCIAL mode', () => {
  it('rejects SOCIAL activation when no observer is provided', async () => {
    const { service } = makeSubject();
    const dto = buildSelfDto({ enforcementMode: 'social' });
    await expect(service.createAndActivate('u1', dto)).rejects.toMatchObject({
      code: 'FRIEND_NOT_SELECTED',
    });
  });

  it('activates SOCIAL when a real observerUserId is provided', async () => {
    const { service, db } = makeSubject();
    const dto = buildSelfDto({
      enforcementMode: 'social',
      observer: { observerUserId: 'friend-1', isVerifier: false },
    });
    const result = await service.createAndActivate('u1', dto);
    expect(result.enforcementMode).toBe('social');
    expect(db.observers).toHaveLength(1);
    expect(db.stakes).toHaveLength(0);
  });
});

describe('Single-use quotes', () => {
  it('first use succeeds, second use with the same quote is rejected', async () => {
    const { service, quote, db } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const dto1 = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
      verification: { method: 'photo' },
    });
    await service.createAndActivate('u1', dto1);
    expect(db.commitments).toHaveLength(1);

    await expect(service.createAndActivate('u1', dto1)).rejects.toMatchObject({
      code: 'QUOTE_ALREADY_CONSUMED',
    });
    expect(db.commitments).toHaveLength(1);
  });

  it('records commitmentId provenance on the consumed quote row', async () => {
    const { service, quote, db } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    const dto = buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'one_time',
        startDate: '2026-09-07',
        endDate: '2026-09-07',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
      verification: { method: 'photo' },
    });
    const result = await service.createAndActivate('u1', dto);
    expect(db.consumedQuotes.size).toBe(1);
    const [{ commitmentId }] = Array.from(db.consumedQuotes.values());
    expect(commitmentId).toBe(result.commitmentId);
  });
});

describe('Timezone freeze', () => {
  it('does not change UTC deadline when the device timezone changes later', async () => {
    const { service, quote, db } = makeSubject();
    const q = await quote.compute({
      userId: 'u1',
      timezone: 'Asia/Seoul',
      stakeTotalKrw: 5_000,
      schedule: {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      },
    });
    await service.createAndActivate('u1', buildMoneyDto(q.quoteId, {
      schedule: Object.assign(new ScheduleDto(), {
        type: 'daily',
        startDate: '2026-09-07',
        endDate: '2026-09-09',
        windowStartLocalTime: '18:00',
        deadlineLocalTime: '21:00',
      }),
    }));
    for (const o of db.occurrences) {
      expect(o.deadlineAt.getUTCHours()).toBe(12);
    }
    expect(db.commitments[0].timezone).toBe('Asia/Seoul');
  });
});
