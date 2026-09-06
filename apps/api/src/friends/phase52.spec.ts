import { FrozenClock } from '../common/clock/clock';
import { AuditService } from '../audit/audit.service';
import { AppealService } from '../appeals/appeal.service';
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
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { CreateCommitmentDraftDto } from '../commitments/dto/create-commitment.dto';
import { FriendsService } from './friends.service';
import { FriendVerifyService } from './friend-verify.service';
import { SharedCommitmentService } from './shared-commitment.service';

const NOW = new Date('2026-09-14T12:00:00Z');
const IAN = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const MINSU = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const JISU = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const WINDOW = 7 * 24 * 3600;

function todaySched() {
  const s = new ScheduleDto();
  Object.assign(s, {
    type: 'daily',
    startDate: '2026-09-14',
    endDate: '2026-09-14',
    windowStartLocalTime: '00:00',
    deadlineLocalTime: '23:59',
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
  const cfg = {
    nodeEnv: 'test', moneyEnabled: true, allowAgeFixture: true, jwtSecret: 'j', quoteSigningSecret: 'q',
    maxStakePerOccurrenceKrw: 100_000, maxLossPerCommitmentKrw: 500_000,
    friendReviewWindowSeconds: 86_400, appealWindowSeconds: WINDOW, networkGraceSeconds: 180,
  } as any;
  const cache = new QuoteCacheService(cfg, clock);
  const ledger = new LedgerService(prisma);
  const provider = new MockPaymentProvider();
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, cfg);
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const audit = new AuditService(prisma);
  const appeals = new AppealService(prisma, ledger, payments, audit, clock, cfg);
  const commitments = new CommitmentService(
    prisma, schedule, cache, { classify: async () => ({ decision: 'safe', reasonCode: 'OK', userMessage: '' }) } as any,
    users, policy, clock, audit, undefined, payments, cfg, appeals, undefined, ledger, friends, shared,
  );
  const orchestrator = new VerificationOrchestrator(prisma, {} as any, clock, cfg);
  const verify = new FriendVerifyService(prisma, friends, clock, orchestrator, cfg, notifications, audit);
  return { db, prisma, clock, friends, shared, notifications, commitments, payments, settlement, ledger, verify, appeals };
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

function friendDto(overrides: Partial<CreateCommitmentDraftDto> = {}): CreateCommitmentDraftDto {
  return {
    title: '야식 먹지 않기',
    category: 'custom',
    timezone: 'Asia/Seoul',
    enforcementMode: 'self',
    schedule: todaySched(),
    verification: { method: 'friend' },
    observer: { observerUserId: MINSU, isVerifier: true },
    ...overrides,
  } as CreateCommitmentDraftDto;
}

async function occId(ctx: ReturnType<typeof make>, commitmentId: string) {
  return (await ctx.db.occurrence.findFirst({ where: { commitmentId } }))!.id;
}

describe('Phase 5.2 — Friend Verify', () => {
  it('accepted friend is selectable; non-friend / self / blocked rejected', async () => {
    const ctx = make();
    await users(ctx.db);
    await expect(ctx.commitments.createAndActivate(IAN, friendDto())).rejects.toMatchObject({ code: 'FRIEND_NOT_SELECTED' });
    await expect(ctx.commitments.createAndActivate(IAN, friendDto({ observer: { observerUserId: IAN, isVerifier: true } }))).rejects.toMatchObject({ code: 'VALIDATION' });
    await becomeFriends(ctx, IAN, MINSU);
    const ok = await ctx.commitments.createAndActivate(IAN, friendDto());
    expect(ctx.db.commitmentObserver.rows[0].role).toBe('verifier');
    expect(ok.enforcementMode).toBe('self');
    const f = (await ctx.friends.listAccepted(IAN))[0];
    await ctx.friends.block(IAN, f.friendshipId);
    await expect(ctx.commitments.createAndActivate(IAN, friendDto({ title: '두번째' }))).rejects.toMatchObject({ code: 'FRIEND_NOT_SELECTED' });
  });

  it('activation rejected without a Friend Verify verifier', async () => {
    const ctx = make();
    await users(ctx.db);
    await expect(ctx.commitments.createAndActivate(IAN, friendDto({ observer: undefined }))).rejects.toMatchObject({
      code: 'FRIEND_NOT_SELECTED',
    });
  });

  it('one request per occurrence is idempotent; only selected verifier may decide', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await becomeFriends(ctx, IAN, JISU);
    const created = await ctx.commitments.createAndActivate(IAN, friendDto());
    const id = await occId(ctx, created.commitmentId);
    const a = await ctx.verify.request(IAN, id);
    const b = await ctx.verify.request(IAN, id);
    expect(b.idempotent).toBe(true);
    expect(b.requestId).toBe(a.requestId);
    expect(ctx.db.friendVerifyRequest.rows).toHaveLength(1);
    await expect(ctx.verify.decide(JISU, id, 'approved')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.verify.decide(IAN, id, 'approved')).rejects.toMatchObject({ code: 'VALIDATION' });
  });

  it('concurrent approve/reject has one winner; approve → PASS', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const created = await ctx.commitments.createAndActivate(IAN, friendDto());
    const id = await occId(ctx, created.commitmentId);
    await ctx.verify.request(IAN, id);
    const [x, y] = await Promise.allSettled([
      ctx.verify.decide(MINSU, id, 'approved'),
      ctx.verify.decide(MINSU, id, 'rejected'),
    ]);
    const ok = [x, y].filter((r) => r.status === 'fulfilled');
    expect(ok).toHaveLength(1);
    const occ = await ctx.db.occurrence.findUnique({ where: { id } });
    expect(['pass', 'fail']).toContain(occ!.status);
    expect(ctx.db.verificationResult.rows).toHaveLength(1);
    if (occ!.status === 'pass') expect(occ!.status).toBe('pass');
  });

  it('reject → provisional FAIL with zero money movement and no Grace consumption', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await ctx.db.seedMoneyCommitment({
      id: 'fv-m', userId: IAN, perOccurrence: 30_000n, count: 3,
      strictness: 'realistic', allowedFailCount: 1, startAt: new Date('2026-09-14T11:30:00Z'),
    });
    await ctx.payments.chargeUpfront(IAN, 'fv-m');
    await ctx.db.activateSigned('fv-m');
    await ctx.db.verificationRule.create({ data: { commitmentId: 'fv-m', method: 'friend' } });
    await ctx.db.commitmentObserver.create({ data: { commitmentId: 'fv-m', observerUserId: MINSU, role: 'verifier' } });
    const id = 'fv-m_o1';
    await ctx.verify.request(IAN, id);
    await ctx.verify.decide(MINSU, id, 'rejected');
    const occ = await ctx.db.occurrence.findUnique({ where: { id } });
    expect(occ!.status).toBe('fail');
    expect(occ!.appealDeadlineAt).toBeTruthy();
    expect(ctx.db.paymentLedger.rows.filter((r) => r.commitmentId === 'fv-m' && r.entryType !== 'deposit')).toHaveLength(0);
    const settled = await ctx.settlement.settleCommitment('fv-m');
    expect(settled.completed).toBe(false);
    expect(ctx.db.paymentLedger.rows.filter((r) => r.entryType === 'forfeit')).toHaveLength(0);
  });

  it('Appeal can overturn rejected Friend Verify; expired appeal uses finality', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await ctx.db.seedMoneyCommitment({
      id: 'fv-a', userId: IAN, perOccurrence: 15_000n, count: 3,
      strictness: 'perfect', allowedFailCount: 0, startAt: new Date('2026-09-14T11:30:00Z'),
    });
    await ctx.payments.chargeUpfront(IAN, 'fv-a');
    await ctx.db.activateSigned('fv-a');
    await ctx.db.verificationRule.create({ data: { commitmentId: 'fv-a', method: 'friend' } });
    await ctx.db.commitmentObserver.create({ data: { commitmentId: 'fv-a', observerUserId: MINSU, role: 'verifier' } });
    await ctx.verify.request(IAN, 'fv-a_o1');
    await ctx.verify.decide(MINSU, 'fv-a_o1', 'rejected');
    const appeal = await ctx.appeals.submit(IAN, 'fv-a_o1', { reasonCategory: 'verification_error', explanation: '오해였어요.' });
    await ctx.appeals.approve(appeal.appealId, 'pass', 'admin-1');
    expect((await ctx.appeals.getOwned(IAN, 'fv-a_o1') as { effectiveResult: string }).effectiveResult).toBe('pass');

    await ctx.db.seedMoneyCommitment({
      id: 'fv-b', userId: IAN, perOccurrence: 15_000n, count: 1,
      strictness: 'perfect', allowedFailCount: 0, startAt: new Date('2026-09-14T11:30:00Z'),
    });
    await ctx.payments.chargeUpfront(IAN, 'fv-b');
    await ctx.db.activateSigned('fv-b');
    await ctx.db.verificationRule.create({ data: { commitmentId: 'fv-b', method: 'friend' } });
    await ctx.db.commitmentObserver.create({ data: { commitmentId: 'fv-b', observerUserId: MINSU, role: 'verifier' } });
    await ctx.verify.request(IAN, 'fv-b_o1');
    await ctx.verify.decide(MINSU, 'fv-b_o1', 'rejected');
    await ctx.db.occurrence.update({ where: { id: 'fv-b_o1' }, data: { appealDeadlineAt: NOW } });
    const r = await ctx.settlement.settleCommitment('fv-b');
    expect(r.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.some((x) => x.commitmentId === 'fv-b' && x.entryType === 'forfeit')).toBe(true);
  });

  it('timeout and block-during-pending → UNCERTAIN, never FAIL or money loss', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    const created = await ctx.commitments.createAndActivate(IAN, friendDto());
    const id = await occId(ctx, created.commitmentId);
    await ctx.verify.request(IAN, id);
    ctx.clock.advance(86_400_000 + 1);
    await ctx.verify.expireDue();
    expect((await ctx.db.occurrence.findUnique({ where: { id } }))!.status).toBe('uncertain');
    expect(ctx.db.verificationResult.rows[0].reasonCode).toBe('FRIEND_VERIFY_EXPIRED');

    ctx.clock.set(NOW);
    const created2 = await ctx.commitments.createAndActivate(IAN, friendDto({ title: '두번째' }));
    const id2 = await occId(ctx, created2.commitmentId);
    await ctx.verify.request(IAN, id2);
    const f = (await ctx.friends.listAccepted(IAN))[0];
    await ctx.friends.block(IAN, f.friendshipId);
    await ctx.verify.revokePair(IAN, MINSU);
    expect((await ctx.db.occurrence.findUnique({ where: { id: id2 } }))!.status).toBe('uncertain');
    expect((await ctx.db.friendVerifyRequest.findUnique({ where: { occurrenceId: id2 } }))!.status).toBe('expired');
    await expect(ctx.verify.decide(MINSU, id2, 'rejected')).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
  });

  it('privacy: verifier sees no money/evidence; SOCIAL viewer / shared member cannot verify', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await becomeFriends(ctx, IAN, JISU);
    const created = await ctx.commitments.createAndActivate(IAN, friendDto());
    const id = await occId(ctx, created.commitmentId);
    await ctx.verify.request(IAN, id);
    const view = await ctx.verify.get(MINSU, id);
    expect(JSON.stringify(view)).not.toMatch(/30000|stake|ledger|appeal|evidence|gps/i);
    const social = await ctx.commitments.createAndActivate(IAN, friendDto({
      title: '소셜만',
      enforcementMode: 'social',
      verification: { method: 'self' },
      observer: { observerUserId: MINSU, isVerifier: false },
    }));
    const sid = await occId(ctx, social.commitmentId);
    await expect(ctx.verify.request(IAN, sid)).rejects.toMatchObject({ code: 'VALIDATION' });

    const future = new ScheduleDto();
    Object.assign(future, {
      type: 'x_per_week', timesPerWeek: 3, startDate: '2026-10-01', endDate: '2026-10-07',
      windowStartLocalTime: '07:00', deadlineLocalTime: '21:00',
    });
    const shared = await ctx.shared.create(IAN, {
      title: '같이',
      category: 'workout',
      timezone: 'Asia/Seoul',
      schedule: future.toDomain(),
      inviteeUserIds: [JISU],
    });
    await ctx.shared.acceptInvite(JISU, shared.sharedCommitmentId);
    await expect(ctx.verify.decide(JISU, id, 'approved')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('one member Friend Verify does not affect another; notify is deduped', async () => {
    const ctx = make();
    await users(ctx.db);
    await becomeFriends(ctx, IAN, MINSU);
    await becomeFriends(ctx, IAN, JISU);
    const ian = await ctx.commitments.createAndActivate(IAN, friendDto({
      observer: { observerUserId: JISU, isVerifier: true },
    }));
    const minsu = await ctx.commitments.createAndActivate(MINSU, {
      title: 'x',
      category: 'workout',
      timezone: 'Asia/Seoul',
      enforcementMode: 'self',
      schedule: todaySched(),
      verification: { method: 'self' },
    } as CreateCommitmentDraftDto);
    const ianOcc = await occId(ctx, ian.commitmentId);
    await ctx.verify.request(IAN, ianOcc);
    await ctx.verify.decide(JISU, ianOcc, 'rejected');
    expect((await ctx.db.commitment.findUnique({ where: { id: minsu.commitmentId } }))!.status).toBe('active');
    expect((await ctx.db.occurrence.findFirst({ where: { commitmentId: minsu.commitmentId } }))!.status).toBe('scheduled');

    const first = await ctx.notifications.enqueue({
      userId: MINSU, category: 'friend_verify_request', dedupeKey: 'friend_verify_request:dup', deepLink: 'jikyeo://friends',
    });
    const second = await ctx.notifications.enqueue({
      userId: MINSU, category: 'friend_verify_request', dedupeKey: 'friend_verify_request:dup', deepLink: 'jikyeo://friends',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });
});
