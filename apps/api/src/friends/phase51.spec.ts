import { FrozenClock } from '../common/clock/clock';
import { AuditService } from '../audit/audit.service';
import { CommitmentService } from '../commitments/commitment.service';
import { ScheduleDto } from '../commitments/dto/schedule.dto';
import { QuoteCacheService } from '../commitments/quote/quote-cache.service';
import { ScheduleService } from '../commitments/schedule/schedule.service';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { SettlementService } from '../settlement/settlement.service';
import { FriendsService } from './friends.service';
import { SharedCommitmentService } from './shared-commitment.service';
import { pairKey } from './friend-pair';
import { CreateCommitmentDraftDto } from '../commitments/dto/create-commitment.dto';

const NOW = new Date('2026-09-14T12:00:00Z');
const IAN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MINSU = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const JISU = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function sched(start = '2026-10-01', end = '2026-10-07') {
  const s = new ScheduleDto();
  Object.assign(s, {
    type: 'x_per_week',
    timesPerWeek: 3,
    startDate: start,
    endDate: end,
    windowStartLocalTime: '07:00',
    deadlineLocalTime: '21:00',
  });
  return s;
}

function make() {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const clock = new FrozenClock(NOW);
  const notifications = new NotificationService(prisma, clock, { pushTokenEncryptionSecret: 'x'.repeat(32) } as any);
  const friends = new FriendsService(prisma, clock, notifications);
  const schedule = new ScheduleService();
  const shared = new SharedCommitmentService(prisma, friends, schedule, clock, notifications);
  const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
  const policy = new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG, clock);
  const cfg = { nodeEnv: 'test', moneyEnabled: true, allowAgeFixture: true, jwtSecret: 'j', quoteSigningSecret: 'q', maxStakePerOccurrenceKrw: 100_000, maxLossPerCommitmentKrw: 500_000 } as any;
  const cache = new QuoteCacheService(cfg, clock);
  const ledger = new LedgerService(prisma);
  const provider = new MockPaymentProvider();
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, cfg);
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const audit = new AuditService(prisma);
  const commitments = new CommitmentService(
    prisma, schedule, cache, { classify: async () => ({ decision: 'safe', reasonCode: 'OK', userMessage: '' }) } as any,
    users, policy, clock, audit, undefined, payments, cfg, undefined, undefined, ledger, friends, shared,
  );
  return { db, prisma, clock, friends, shared, notifications, commitments, payments, settlement, ledger, policy, schedule };
}

async function users(db: InMemoryMoneyDb) {
  await db.user.create({ data: { id: IAN, displayName: 'Ian', status: 'active', inviteCode: 'IANCODE1', stakeTier: 'tier_1', ageVerificationStatus: 'verified_adult' } });
  await db.user.create({ data: { id: MINSU, displayName: 'Minsu', status: 'active', inviteCode: 'MINCODE1', stakeTier: 'tier_1', ageVerificationStatus: 'verified_adult' } });
  await db.user.create({ data: { id: JISU, displayName: 'Jisu', status: 'active', inviteCode: 'JISCODE1', stakeTier: 'tier_1' } });
}

async function becomeFriends(ctx: ReturnType<typeof make>, a: string, b: string) {
  const code = (await ctx.db.user.findUnique({ where: { id: b } }))!.inviteCode;
  const r = await ctx.friends.invite(a, code);
  return ctx.friends.accept(b, r.friendshipId);
}

function selfDto(userTitle: string, overrides: Partial<CreateCommitmentDraftDto> = {}): CreateCommitmentDraftDto {
  return {
    title: userTitle,
    category: 'workout',
    timezone: 'Asia/Seoul',
    enforcementMode: 'self',
    schedule: sched(),
    verification: { method: 'self' },
    ...overrides,
  } as CreateCommitmentDraftDto;
}

describe('Phase 5.1 — friends / SOCIAL / shared', () => {
  it('send / accept / decline friend request', async () => {
    const ctx = make();
    await users(ctx.db);
    const sent = await ctx.friends.invite(IAN, 'MINCODE1');
    expect(sent.status).toBe('pending');
    const declined = await ctx.friends.decline(MINSU, sent.friendshipId);
    expect(declined.status).toBe('declined');
    const again = await ctx.friends.invite(IAN, 'MINCODE1');
    expect(again.status).toBe('pending');
    const ok = await ctx.friends.accept(MINSU, again.friendshipId);
    expect(ok.status).toBe('accepted');
    expect((await ctx.friends.listAccepted(IAN))[0].friendUserId).toBe(MINSU);
  });

  it('rejects self-friend', async () => {
    const ctx = make();
    await users(ctx.db);
    await expect(ctx.friends.invite(IAN, 'IANCODE1')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('duplicate request is idempotent', async () => {
    const ctx = make();
    await users(ctx.db);
    const a = await ctx.friends.invite(IAN, 'MINCODE1');
    const b = await ctx.friends.invite(IAN, 'MINCODE1');
    expect(b.idempotent).toBe(true);
    expect(b.friendshipId).toBe(a.friendshipId);
    expect(ctx.db.friendship.rows).toHaveLength(1);
    expect(pairKey(IAN, MINSU)).toContain(IAN.slice(0, 8));
  });

  it('remove/block revokes social visibility', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const created = await ctx.commitments.createAndActivate(IAN, selfDto('공개', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: false },
    }));
    const view = await ctx.shared.socialCommitmentView(MINSU, created.commitmentId);
    expect(view.title).toBe('공개');
    expect((view as { stake?: unknown }).stake).toBeUndefined();
    const f = (await ctx.friends.listAccepted(IAN))[0];
    await ctx.friends.block(IAN, f.friendshipId);
    await expect(ctx.shared.socialCommitmentView(MINSU, created.commitmentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const after = await ctx.shared.home(MINSU);
    expect(after.watching).toEqual([]);
    expect(after.friends).toEqual([]);
  });

  it('only an accepted friend may be SOCIAL partner', async () => {
    const ctx = make();
    await users(ctx.db);
    await expect(ctx.commitments.createAndActivate(IAN, selfDto('소셜', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: false },
    }))).rejects.toMatchObject({ code: 'FRIEND_NOT_SELECTED' });
    await becomeFriends(ctx, IAN, MINSU);
    const r = await ctx.commitments.createAndActivate(IAN, selfDto('소셜', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: true },
    }));
    expect(r.enforcementMode).toBe('social');
    expect(ctx.db.commitmentObserver.rows[0].role).toBe('viewer');
  });

  it('SOCIAL creates no Stake / Payment / Ledger', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await ctx.commitments.createAndActivate(IAN, selfDto('소셜', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: false },
    }));
    expect(ctx.db.stake.rows).toHaveLength(0);
    expect(ctx.db.payment.rows).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
  });

  it('create Shared Commitment + invite + accept', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const shared = await ctx.shared.create(IAN, {
      title: '9월에 운동 10번',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: sched().toDomain(),
      inviteeUserIds: [MINSU],
    });
    expect(shared.members).toHaveLength(1);
    await ctx.shared.acceptInvite(MINSU, shared.sharedCommitmentId);
    const d = await ctx.shared.detail(MINSU, shared.sharedCommitmentId);
    expect(d.members).toHaveLength(2);
    expect(d.moneyIndependent).toBe(true);
  });

  it('late join after start is rejected', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const shared = await ctx.shared.create(IAN, {
      title: '지난 목표',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: sched('2026-09-01', '2026-09-07').toDomain(),
      inviteeUserIds: [MINSU],
    });
    await expect(ctx.shared.acceptInvite(MINSU, shared.sharedCommitmentId)).rejects.toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
    });
  });

  it('each participant links an independent Commitment and may choose different modes', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await becomeFriends(ctx, IAN, JISU);
    const shared = await ctx.shared.create(IAN, {
      title: '4주 주 3회 운동',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: sched().toDomain(),
      inviteeUserIds: [MINSU, JISU],
    });
    await ctx.shared.acceptInvite(MINSU, shared.sharedCommitmentId);
    await ctx.shared.acceptInvite(JISU, shared.sharedCommitmentId);
    const ian = await ctx.commitments.createAndActivate(IAN, selfDto('x', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: false },
      sharedCommitmentId: shared.sharedCommitmentId,
    }));
    const minsu = await ctx.commitments.createAndActivate(MINSU, selfDto('x', {
      sharedCommitmentId: shared.sharedCommitmentId,
    }));
    expect(ian.enforcementMode).toBe('social');
    expect(minsu.enforcementMode).toBe('self');
    expect(ian.commitmentId).not.toBe(minsu.commitmentId);
    expect((await ctx.db.commitment.findUnique({ where: { id: ian.commitmentId } }))!.sharedCommitmentId).toBe(shared.sharedCommitmentId);
  });

  it('two MONEY participants have separate Stakes and one FAIL does not affect the other', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const shared = await ctx.shared.create(IAN, {
      title: '같이 운동',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: sched().toDomain(),
      inviteeUserIds: [MINSU],
    });
    await ctx.shared.acceptInvite(MINSU, shared.sharedCommitmentId);
    await ctx.db.seedMoneyCommitment({
      id: 'ian-m', userId: IAN, perOccurrence: 30_000n, count: 3, strictness: 'realistic', allowedFailCount: 0, startAt: new Date('2026-10-01'),
    });
    await ctx.db.commitment.update({ where: { id: 'ian-m' }, data: { sharedCommitmentId: shared.sharedCommitmentId } });
    await ctx.db.sharedParticipant.update({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: shared.sharedCommitmentId, userId: IAN } },
      data: { commitmentId: 'ian-m' },
    });
    await ctx.db.seedMoneyCommitment({
      id: 'min-m', userId: MINSU, perOccurrence: 10_000n, count: 3, strictness: 'perfect', allowedFailCount: 0, startAt: new Date('2026-10-01'),
    });
    await ctx.db.commitment.update({ where: { id: 'min-m' }, data: { sharedCommitmentId: shared.sharedCommitmentId } });
    await ctx.db.sharedParticipant.update({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: shared.sharedCommitmentId, userId: MINSU } },
      data: { commitmentId: 'min-m' },
    });
    await ctx.payments.chargeUpfront(IAN, 'ian-m');
    await ctx.payments.chargeUpfront(MINSU, 'min-m');
    await ctx.db.activateSigned('ian-m');
    await ctx.db.activateSigned('min-m');
    await ctx.db.setOccurrenceStatus('ian-m_o1', 'pass');
    await ctx.db.setOccurrenceStatus('ian-m_o2', 'pass');
    await ctx.db.setOccurrenceStatus('ian-m_o3', 'pass');
    await ctx.db.setOccurrenceStatus('min-m_o1', 'fail');
    await ctx.db.setOccurrenceStatus('min-m_o2', 'fail');
    await ctx.db.setOccurrenceStatus('min-m_o3', 'fail');
    await ctx.settlement.settleCommitment('ian-m');
    await ctx.settlement.settleCommitment('min-m');
    expect((await ctx.ledger.totalsForCommitment('ian-m')).refundPaid).toBe(30_000n);
    expect((await ctx.ledger.totalsForCommitment('min-m')).forfeit).toBe(10_000n);
    expect((await ctx.db.commitment.findUnique({ where: { id: 'ian-m' } }))!.status).toBe('completed');
    expect((await ctx.ledger.totalsForCommitment('ian-m')).forfeit).toBe(0n);
  });

  it('Grace is participant-specific; leave does not cancel others; creator cannot cancel others', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const shared = await ctx.shared.create(IAN, {
      title: '같이',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: sched().toDomain(),
      inviteeUserIds: [MINSU],
    });
    await ctx.shared.acceptInvite(MINSU, shared.sharedCommitmentId);
    await ctx.db.seedMoneyCommitment({
      id: 'ian-g', userId: IAN, perOccurrence: 15_000n, count: 10, strictness: 'realistic', allowedFailCount: 1, startAt: new Date('2026-10-01'),
    });
    await ctx.db.seedMoneyCommitment({
      id: 'min-g', userId: MINSU, perOccurrence: 15_000n, count: 3, strictness: 'perfect', allowedFailCount: 0, startAt: new Date('2026-10-01'),
    });
    expect((await ctx.db.commitment.findUnique({ where: { id: 'ian-g' } }))!.allowedFailCount).toBe(1);
    expect((await ctx.db.commitment.findUnique({ where: { id: 'min-g' } }))!.allowedFailCount).toBe(0);
    await ctx.shared.leave(MINSU, shared.sharedCommitmentId);
    expect((await ctx.db.sharedParticipant.findUnique({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: shared.sharedCommitmentId, userId: IAN } },
    }))!.status).toBe('accepted');
    await expect(ctx.commitments.cancel(IAN, 'min-g')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('friends cannot access money / evidence / private appeal data via social view', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await ctx.db.seedMoneyCommitment({ id: 'priv', userId: IAN, perOccurrence: 30_000n, count: 1 });
    await ctx.db.commitmentObserver.create({ data: { commitmentId: 'priv', observerUserId: MINSU, role: 'viewer' } });
    const view = await ctx.shared.socialCommitmentView(MINSU, 'priv');
    expect(JSON.stringify(view)).not.toMatch(/30000|stake|ledger|appeal|evidence|gps/i);
    await expect(ctx.commitments.getOwned(MINSU, 'priv')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('block prevents future SOCIAL selection; SELF stays private; social notify is deduped', async () => {
    const ctx = make();
    await users(ctx.db);
    const f = await becomeFriends(ctx, IAN, MINSU);
    await ctx.friends.block(IAN, f.friendshipId);
    await expect(ctx.commitments.createAndActivate(IAN, selfDto('막힘', {
      enforcementMode: 'social',
      observer: { observerUserId: MINSU, isVerifier: false },
    }))).rejects.toMatchObject({ code: 'FRIEND_NOT_SELECTED' });
    const self = await ctx.commitments.createAndActivate(IAN, selfDto('나만'));
    await expect(ctx.shared.socialCommitmentView(MINSU, self.commitmentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await ctx.db.friendship.update({ where: { id: f.friendshipId }, data: { status: 'accepted', blockedById: null } });
    const first = await ctx.notifications.enqueue({
      userId: MINSU, category: 'friend_request', dedupeKey: 'friend_request:dup', deepLink: 'jikyeo://friends',
    });
    const second = await ctx.notifications.enqueue({
      userId: MINSU, category: 'friend_request', dedupeKey: 'friend_request:dup', deepLink: 'jikyeo://friends',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});
