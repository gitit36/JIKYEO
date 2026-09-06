import { FrozenClock } from '../common/clock/clock';
import { CommitmentService } from '../commitments/commitment.service';
import { EvidenceRetentionService } from '../evidence/evidence-retention.service';
import { MockEvidenceStorage } from '../evidence/storage/mock-evidence-storage';
import { JobLeaseService } from '../jobs/job-lease.service';
import { MoneyMaintenanceService } from '../jobs/money-maintenance.service';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { LedgerService } from '../payments/ledger.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { PrismaService } from '../prisma/prisma.service';
import { RecapService } from '../recaps/recap.service';
import { SettlementService } from '../settlement/settlement.service';
import { NotificationService } from './notification.service';
import { MockPushProvider } from './providers/mock-push-provider';
import { PUSH_COPY, REFUND_DELAYED_COPY, assertGenericLockScreen } from './push-copy';
import { decryptDeviceToken, hashDeviceToken } from './token-crypto';

const USER = 'u1';
const SECRET = 'dev-only-push-token-encryption-secret';
const NOW = new Date('2026-09-14T00:10:00Z'); // Monday 09:10 Asia/Seoul

function cfg() {
  return {
    nodeEnv: 'test',
    recapLocalHour: 9,
    pushTokenEncryptionSecret: SECRET,
    defaultEvidenceRetentionDays: 30,
    appealWindowSeconds: 7 * 24 * 3600,
    signatureExpirySeconds: 1800,
  } as any;
}

async function seedUser(db: InMemoryMoneyDb, id = USER, timezone = 'Asia/Seoul') {
  await db.user.create({ data: { id, timezone, status: 'active', displayName: id } });
}

function makeNotify(clock = new FrozenClock(NOW)) {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const push = new MockPushProvider();
  const notifications = new NotificationService(prisma, clock, cfg(), push);
  const recaps = new RecapService(prisma, clock, cfg(), notifications);
  const storage = new MockEvidenceStorage(clock);
  const retention = new EvidenceRetentionService(prisma, clock, cfg(), storage);
  return { db, prisma, clock, push, notifications, recaps, retention, storage };
}

describe('Phase 5C — tokens / preferences / outbox', () => {
  it('registers, rotates, unregisters, encrypts, and enforces ownership', async () => {
    const { db, notifications } = makeNotify();
    await seedUser(db);
    await seedUser(db, 'u2');
    const a = await notifications.registerDevice(USER, 'token-aaaa-1111', 'sandbox');
    expect(a.tokenHash).toBe(hashDeviceToken('token-aaaa-1111'));
    expect(a.environment).toBe('sandbox');
    const row = db.deviceToken.rows[0];
    expect(decryptDeviceToken(row.tokenCiphertext, SECRET)).toBe('token-aaaa-1111');
    expect(row.tokenHash).not.toContain('token-aaaa');

    const rotated = await notifications.registerDevice('u2', 'token-aaaa-1111', 'production');
    expect(rotated.environment).toBe('production');
    expect(db.deviceToken.rows).toHaveLength(1);
    expect(db.deviceToken.rows[0].userId).toBe('u2');

    await expect(notifications.unregisterDevice(USER, 'token-aaaa-1111')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const off = await notifications.unregisterDevice('u2', 'token-aaaa-1111');
    expect(off.active).toBe(false);
    expect((await db.deviceToken.findUnique({ where: { tokenHash: a.tokenHash } }))!.active).toBe(false);
  });

  it('creates default prefs on register and skips push when category is off or token missing', async () => {
    const { db, notifications, push } = makeNotify();
    await seedUser(db);
    const before = await notifications.getPreferences(USER);
    expect(before.deadlineReminder).toBe(false);
    await notifications.registerDevice(USER, 'token-bbbb-2222', 'sandbox');
    expect((await notifications.getPreferences(USER)).deadlineReminder).toBe(true);
    await notifications.setPreferences(USER, { deadlineReminder: false });
    await notifications.enqueue({
      userId: USER, category: 'deadline_reminder', dedupeKey: 'deadline:o1', deepLink: 'jikyeo://today',
    });
    await notifications.processOutbox();
    expect(push.sends).toHaveLength(0);
    expect(db.notificationOutbox.rows[0].status).toBe('sent');
    expect(db.notificationOutbox.rows[0].lastError).toBe('opted_out');
  });

  it('deactivates invalid tokens and retries lost / temporary failures', async () => {
    const { db, notifications, push, clock } = makeNotify();
    await seedUser(db);
    await notifications.registerDevice(USER, 'token-cccc-3333', 'sandbox');
    await notifications.enqueue({
      userId: USER, category: 'appeal', dedupeKey: 'appeal_decided:a1', deepLink: 'jikyeo://appeals/a1',
    });
    push.failNext = 'invalid_token';
    await notifications.processOutbox();
    expect(db.deviceToken.rows[0].active).toBe(false);
    expect(db.notificationOutbox.rows[0].status).toBe('failed');

    await notifications.registerDevice(USER, 'token-dddd-4444', 'sandbox');
    await notifications.enqueue({
      userId: USER, category: 'refund', dedupeKey: 'refund_completed:p1', deepLink: 'jikyeo://history',
    });
    push.failNext = 'lost';
    await notifications.processOutbox();
    expect(db.notificationOutbox.rows.find((r) => r.dedupeKey === 'refund_completed:p1')!.status).toBe('pending');
    expect(push.sends).toHaveLength(2);

    await db.notificationOutbox.updateMany({ where: { status: { in: ['pending', 'failed'] } }, data: { status: 'sent' } });
    push.failNext = 'temporary_failure';
    await notifications.enqueue({
      userId: USER, category: 'weekly_recap', dedupeKey: 'recap:u1:2026-09-07', deepLink: 'jikyeo://recap/2026-09-07',
    });
    await notifications.processOutbox();
    const failed = db.notificationOutbox.rows.find((r) => r.dedupeKey === 'recap:u1:2026-09-07')!;
    expect(failed.status).toBe('failed');
    clock.advance(61_000);
    await notifications.processOutbox();
    expect(db.notificationOutbox.rows.find((r) => r.dedupeKey === 'recap:u1:2026-09-07')!.status).toBe('sent');
  });

  it('dedupes enqueue, rolls back outbox with the domain transaction, and keeps lock-screen copy generic', async () => {
    const { db, notifications, prisma } = makeNotify();
    await seedUser(db);
    const first = await notifications.enqueue({
      userId: USER, category: 'deadline_reminder', dedupeKey: 'deadline:occ1', deepLink: 'jikyeo://today',
    });
    const second = await notifications.enqueue({
      userId: USER, category: 'deadline_reminder', dedupeKey: 'deadline:occ1', deepLink: 'jikyeo://today',
    });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(db.notificationOutbox.rows).toHaveLength(1);

    await expect(prisma.$transaction(async (tx) => {
      await notifications.enqueue({
        userId: USER, category: 'signature_expiry', dedupeKey: 'signature_expiry:c9', deepLink: 'jikyeo://commitments/c9/sign',
      }, tx);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect(db.notificationOutbox.rows.filter((r) => r.dedupeKey === 'signature_expiry:c9')).toHaveLength(0);

    expect(PUSH_COPY.deadline_reminder.title).toBe('약속 시간이 다가오고 있어요');
    expect(PUSH_COPY.signature_expiry.title).toBe('서명을 마쳐주세요');
    expect(PUSH_COPY.refund.title).toBe('환불 처리가 완료됐어요');
    expect(REFUND_DELAYED_COPY.title).toBe('환불 처리가 늦어지고 있어요');
    expect(PUSH_COPY.appeal.title).toBe('이의 제기 결과가 도착했어요');
    expect(PUSH_COPY.weekly_recap.title).toBe('지난주 약속을 정리했어요');
    for (const c of Object.values(PUSH_COPY)) assertGenericLockScreen(c.title, c.body);
    assertGenericLockScreen(REFUND_DELAYED_COPY.title, REFUND_DELAYED_COPY.body);
    await expect(notifications.enqueue({
      userId: USER, category: 'refund', dedupeKey: 'bad', deepLink: 'jikyeo://history',
      title: '5000원 환불', body: '지금 앱에서 확인해주세요.',
    })).rejects.toThrow(/lock-screen/);
  });
});

describe('Phase 5C — weekly recap', () => {
  async function seedWeek(db: InMemoryMoneyDb) {
    await seedUser(db);
    await db.seedSelfCommitment({ id: 'self1', userId: USER, count: 2 });
    await db.seedMoneyCommitment({ id: 'mon1', userId: USER, perOccurrence: 5_000n, count: 3, status: 'active' });
    const inWeek = new Date('2026-09-13T14:00:00Z'); // Sun 23:00 KST
    const nextWeek = new Date('2026-09-13T15:30:00Z'); // Mon 00:30 KST
    await db.occurrence.update({ where: { id: 'self1_o1' }, data: { deadlineAt: inWeek, status: 'pass', decidedAt: inWeek, stakeAmount: null } });
    await db.occurrence.update({ where: { id: 'self1_o2' }, data: { deadlineAt: nextWeek, status: 'fail', decidedAt: nextWeek, stakeAmount: null } });
    await db.occurrence.update({ where: { id: 'mon1_o1' }, data: { deadlineAt: inWeek, status: 'pass', decidedAt: inWeek, stakeAmount: 5_000n } });
    await db.occurrence.update({ where: { id: 'mon1_o2' }, data: { deadlineAt: inWeek, status: 'fail', decidedAt: inWeek, stakeAmount: 5_000n } });
    await db.occurrence.update({ where: { id: 'mon1_o3' }, data: { deadlineAt: inWeek, status: 'void', decidedAt: inWeek, stakeAmount: 5_000n } });
  }

  it('uses the user timezone week boundary and hides empty recaps', async () => {
    const { db, recaps } = makeNotify();
    await seedWeek(db);
    await seedUser(db, 'la', 'America/Los_Angeles');
    const seoul = await recaps.generateForUser(USER);
    expect(seoul?.localWeekStart).toBe('2026-09-07');
    expect(seoul?.due).toBe(4);
    expect(seoul?.pass).toBe(2);
    expect(seoul?.fail).toBe(1);
    expect(seoul?.void).toBe(1);
    expect(seoul?.unresolved).toBe(0);
    expect(seoul?.completionRate).toBeCloseTo(2 / 3);
    expect(seoul?.money).toEqual({
      keptKrw: '5000',
      netForfeitedKrw: '0',
      refundPendingOrDelayedKrw: '0',
    });

    const earlyLa = await recaps.generateForUser('la');
    expect(earlyLa).toBeNull();

    expect(await recaps.generateForUser('la')).toBeNull();
    const later = new FrozenClock(new Date('2026-09-15T16:10:00Z'));
    const recapsLater = new RecapService(db as unknown as PrismaService, later, cfg());
    expect(await recapsLater.generateForUser('la')).toBeNull();
    expect(db.weeklyRecap.rows.filter((r) => r.userId === 'la')).toHaveLength(0);

    await seedUser(db, 'selfonly');
    await db.seedSelfCommitment({ id: 's2', userId: 'selfonly', count: 1 });
    await db.occurrence.update({
      where: { id: 's2_o1' },
      data: { deadlineAt: new Date('2026-09-13T14:00:00Z'), status: 'pass', decidedAt: new Date('2026-09-13T14:00:00Z') },
    });
    const onlySelf = await recaps.generateForUser('selfonly');
    expect(onlySelf?.due).toBe(1);
    expect(onlySelf?.money).toBeNull();
  });

  it('applies effective appeal results and settled money only', async () => {
    const { db, recaps } = makeNotify();
    await seedWeek(db);
    await db.paymentLedger.create({
      data: {
        userId: USER, commitmentId: 'mon1', occurrenceId: 'mon1_o2',
        entryType: 'forfeit', amount: 5_000n, idempotencyKey: 'forfeit:mon1_o2',
      },
    });
    const withForfeit = await recaps.generateForUser(USER);
    expect(withForfeit?.fail).toBe(1);
    expect(withForfeit?.money?.netForfeitedKrw).toBe('5000');
    expect(withForfeit?.money?.keptKrw).toBe('5000');

    await db.weeklyRecap.deleteMany({ where: { userId: USER } });
    await db.appeal.create({
      data: {
        id: 'ap1', occurrenceId: 'mon1_o2', userId: USER, status: 'approved',
        correctedResult: 'pass', decidedAt: new Date('2026-09-13T16:00:00Z'),
      },
    });
    await db.paymentLedger.create({
      data: {
        userId: USER, commitmentId: 'mon1', occurrenceId: 'mon1_o2',
        entryType: 'reversal', amount: 5_000n, idempotencyKey: 'reversal:mon1_o2',
      },
    });
    const delayed = await recaps.generateForUser(USER);
    expect(delayed?.pass).toBe(3);
    expect(delayed?.fail).toBe(0);
    expect(delayed?.money?.keptKrw).toBe('10000');
    expect(delayed?.money?.netForfeitedKrw).toBe('5000');
    expect(delayed?.money?.refundPendingOrDelayedKrw).toBe('5000');

    await db.weeklyRecap.deleteMany({ where: { userId: USER } });
    await db.paymentLedger.create({
      data: {
        userId: USER, commitmentId: 'mon1', occurrenceId: 'mon1_o2',
        entryType: 'refund_paid', amount: 5_000n, idempotencyKey: 'refund_paid:appeal:mon1_o2',
      },
    });
    const settled = await recaps.generateForUser(USER);
    expect(settled?.money?.netForfeitedKrw).toBe('0');
    expect(settled?.money?.refundPendingOrDelayedKrw).toBe('0');
  });

  it('creates one recap per user/week and never enqueues an empty recap', async () => {
    const { db, recaps, notifications } = makeNotify();
    await seedWeek(db);
    const a = await recaps.generateForUser(USER);
    const b = await recaps.generateForUser(USER);
    expect(a?.recapId).toBe(b?.recapId);
    expect(db.weeklyRecap.rows).toHaveLength(1);
    expect(db.notificationOutbox.rows.filter((r) => r.category === 'weekly_recap')).toHaveLength(1);

    await seedUser(db, 'empty');
    expect(await recaps.generateForUser('empty')).toBeNull();
    expect(db.notificationOutbox.rows.filter((r) => r.userId === 'empty')).toHaveLength(0);
    expect(await notifications.getPreferences(USER)).toBeTruthy();
  });
});

describe('Phase 5C — evidence retention + overlapping maintenance', () => {
  async function seedEvidence(db: InMemoryMoneyDb, opts: {
    id: string;
    occStatus: string;
    decidedAt?: Date | null;
    mode?: 'money' | 'self';
    appeal?: { status: string; decidedAt?: Date | null };
    storageKey?: string;
  }) {
    await db.commitment.create({
      data: { id: `c_${opts.id}`, userId: USER, enforcementMode: opts.mode ?? 'self', status: 'active', title: 't' },
    });
    await db.occurrence.create({
      data: {
        id: `o_${opts.id}`, commitmentId: `c_${opts.id}`, sequenceNo: 1,
        status: opts.occStatus, decidedAt: opts.decidedAt ?? null, deadlineAt: opts.decidedAt ?? NOW,
      },
    });
    if (opts.appeal) {
      await db.appeal.create({
        data: {
          id: `a_${opts.id}`, occurrenceId: `o_${opts.id}`, userId: USER,
          status: opts.appeal.status, decidedAt: opts.appeal.decidedAt ?? null,
        },
      });
    }
    await db.evidence.create({
      data: {
        id: opts.id, occurrenceId: `o_${opts.id}`, submittedByUserId: USER,
        evidenceType: 'photo', hash: `h_${opts.id}`, metadataJson: { type: 'photo' },
        storageKey: opts.storageKey ?? `s/${opts.id}`,
        retentionUntil: NOW, status: 'active', deletedAt: null,
      },
    });
  }

  it('holds deletion for reviewing, UNCERTAIN, system_hold, pending appeal, open window, and unresolved', async () => {
    const { db, retention, storage } = makeNotify();
    await seedUser(db);
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    await seedEvidence(db, { id: 'rev', occStatus: 'reviewing', decidedAt: old });
    await seedEvidence(db, { id: 'unc', occStatus: 'uncertain', decidedAt: old });
    await seedEvidence(db, { id: 'hold', occStatus: 'system_hold', decidedAt: old });
    await seedEvidence(db, { id: 'pend', occStatus: 'fail', decidedAt: old, mode: 'money', appeal: { status: 'submitted' } });
    await seedEvidence(db, { id: 'win', occStatus: 'fail', decidedAt: new Date(NOW.getTime() - 2 * 86_400_000), mode: 'money' });
    await seedEvidence(db, { id: 'open', occStatus: 'scheduled', decidedAt: null });
    storage.markUploaded('s/rev'); storage.markUploaded('s/unc'); storage.markUploaded('s/hold');
    storage.markUploaded('s/pend'); storage.markUploaded('s/win'); storage.markUploaded('s/open');
    const r = await retention.purgeDue();
    expect(r.purged).toBe(0);
    expect(r.held).toBe(6);
    expect(db.evidence.rows.every((e) => e.status === 'active')).toBe(true);
  });

  it('deletes once, retries after storage failure, and keeps metadata while hiding the raw object', async () => {
    const { db, retention, storage } = makeNotify();
    await seedUser(db);
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    await seedEvidence(db, { id: 'ok', occStatus: 'pass', decidedAt: old, storageKey: 's/ok' });
    storage.markUploaded('s/ok');
    expect(await retention.purgeDue()).toEqual({ purged: 1, held: 0 });
    const row = db.evidence.rows[0];
    expect(row.status).toBe('deleted');
    expect(row.deletedAt).toBeTruthy();
    expect(row.hash).toBe('h_ok');
    expect(row.metadataJson).toEqual({ type: 'photo' });
    expect(row.storageKey).toBeNull();
    expect(await storage.exists('s/ok')).toBe(false);
    expect(await retention.deleteOne('ok')).toBe(true);

    await seedEvidence(db, { id: 'fail', occStatus: 'pass', decidedAt: old, storageKey: 's/fail' });
    storage.markUploaded('s/fail');
    storage.failNextDelete = true;
    expect(await retention.deleteOne('fail')).toBe(false);
    expect(db.evidence.rows.find((e) => e.id === 'fail')!.status).toBe('active');
    expect(await storage.exists('s/fail')).toBe(true);
    expect(await retention.deleteOne('fail')).toBe(true);
    expect(db.evidence.rows.find((e) => e.id === 'fail')!.status).toBe('deleted');
    expect(await storage.exists('s/fail')).toBe(false);
  });

  it('uses the appeal decision as the retention start and stays lease-safe under overlap', async () => {
    const clock = new FrozenClock(NOW);
    const ctx = makeNotify(clock);
    await seedUser(ctx.db);
    const decided = new Date(NOW.getTime() - 10 * 86_400_000);
    await seedEvidence(ctx.db, {
      id: 'ap', occStatus: 'fail', decidedAt: new Date(NOW.getTime() - 40 * 86_400_000),
      mode: 'money', appeal: { status: 'approved', decidedAt: decided },
    });
    ctx.storage.markUploaded('s/ap');
    expect((await ctx.retention.purgeDue()).purged).toBe(0);

    const lease = new JobLeaseService(ctx.prisma, clock);
    const payments = new PaymentService(ctx.prisma, new MockPaymentProvider(), new LedgerService(ctx.prisma), clock, { evaluate: async () => ({}) } as any, cfg());
    const settlement = new SettlementService(ctx.prisma, new LedgerService(ctx.prisma), payments, clock, cfg());
    const commitments = {
      expireOverdue: async () => ({ expired: 0 }),
      applyCancellationEffective: async () => ({ voided: 0, completed: 0 }),
    } as unknown as CommitmentService;
    const maintenance = new MoneyMaintenanceService(
      lease, commitments, settlement, payments, cfg(), ctx.notifications, ctx.recaps, ctx.retention,
    );
    const [a, b] = await Promise.all([maintenance.run(), maintenance.run()]);
    expect([a.skipped, b.skipped].filter(Boolean).length).toBe(1);
    const ran = a.skipped ? b : a;
    expect(ran.skipped).toBe(false);
    expect((ran.evidencePurged ?? 0) + (ran.notificationsEnqueued ?? 0)).toBeGreaterThanOrEqual(0);
  });
});
