import { FrozenClock } from '../common/clock/clock';
import { AuditService } from '../audit/audit.service';
import { DeadlineService, HealthMonitor } from '../deadline/deadline.service';
import { JobLeaseService } from '../jobs/job-lease.service';
import { MoneyMaintenanceService } from '../jobs/money-maintenance.service';
import { LedgerService } from '../payments/ledger.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { RecapService } from '../recaps/recap.service';
import { SettlementService } from '../settlement/settlement.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { CommitmentService } from './commitment.service';

const USER = 'u1';
const C = 'c1';
const NOW = new Date('2026-09-14T12:00:00Z');
const NOTICE = 86_400;

function make() {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const clock = new FrozenClock(NOW);
  const provider = new MockPaymentProvider();
  const ledger = new LedgerService(prisma);
  const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
  const policy = new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG, clock);
  const cfg = {
    nodeEnv: 'test',
    signatureExpirySeconds: 1800,
    activeCancellationNoticeSeconds: NOTICE,
    recapLocalHour: 9,
    defaultEvidenceRetentionDays: 30,
    appealWindowSeconds: 7 * 24 * 3600,
  } as any;
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, cfg);
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const audit = new AuditService(prisma);
  const commitments = new CommitmentService(
    prisma, {} as any, {} as any, {} as any, users, policy, clock, audit, money, payments, cfg,
    undefined, undefined, ledger,
  );
  const lease = new JobLeaseService(prisma, clock);
  const maintenance = new MoneyMaintenanceService(lease, commitments, settlement, payments, cfg);
  const recaps = new RecapService(prisma, clock, cfg);
  return { db, prisma, clock, provider, ledger, payments, settlement, money, policy, commitments, lease, maintenance, recaps };
}

async function windows(db: InMemoryMoneyDb, id: string, starts: Date[]) {
  for (let i = 0; i < starts.length; i += 1) {
    await db.occurrence.update({
      where: { id: `${id}_o${i + 1}` },
      data: { windowStartAt: starts[i], deadlineAt: new Date(starts[i].getTime() + 3_600_000) },
    });
  }
}

async function fundedActive(count = 5) {
  const ctx = make();
  await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 15_000n, count });
  await ctx.payments.chargeUpfront(USER, C);
  await ctx.commitments.sign(USER, C);
  return ctx;
}

describe('Phase 5D — active cancellation', () => {
  it('SELF cuts off immediately with no money movement', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: C, userId: USER, count: 3 });
    await windows(ctx.db, C, [
      new Date(NOW.getTime() - 1),
      NOW,
      new Date(NOW.getTime() + 86_400_000),
    ]);
    const preview = await ctx.commitments.previewCancel(USER, C);
    expect(preview.bindingOccurrenceCount).toBe(1);
    expect(preview.voidOccurrenceCount).toBe(2);
    expect(preview.bindingAmountKrw).toBeNull();
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.effectiveAt).toBe(NOW.toISOString());
    expect(r.voidOccurrenceCount).toBe(2);
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o1` } }))!.status).toBe('scheduled');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe('void');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.failureReasonCode).toBe('commitment_cancelled');
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
    expect(ctx.db.settlement.rows).toHaveLength(0);
    expect(ctx.provider.calls.refund).toBe(0);
    const again = await ctx.commitments.cancel(USER, C);
    expect(again.idempotent).toBe(true);
    expect(again.effectiveAt).toBe(r.effectiveAt);
  });

  it('MONEY V1 pre-start cancel refunds the full Stake once', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({
      id: C, userId: USER, perOccurrence: 15_000n, count: 3, startAt: new Date(NOW.getTime() + 86_400_000),
    });
    await ctx.payments.chargeUpfront(USER, C);
    await ctx.commitments.sign(USER, C);
    const preview = await ctx.commitments.previewCancel(USER, C);
    expect(preview.futureRefundableAmountKrw).toBe('15000');
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.status).toBe('cancelled');
    expect(r.idempotent).toBe(false);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')[0].amount).toBe(15_000n);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_earned')).toHaveLength(0);
    const again = await ctx.commitments.cancel(USER, C);
    expect(again.idempotent).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
  });

  it('MONEY V1 post-start abandon forfeits the full Stake once', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({
      id: C, userId: USER, perOccurrence: 15_000n, count: 3, startAt: new Date(NOW.getTime() - 1),
    });
    await ctx.payments.chargeUpfront(USER, C);
    await ctx.commitments.sign(USER, C);
    const preview = await ctx.commitments.previewCancel(USER, C);
    expect(preview.futureRefundableAmountKrw).toBe('0');
    await ctx.commitments.cancel(USER, C);
    expect(ctx.db.commitment.rows[0].status).toBe('completed');
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')[0].amount).toBe(15_000n);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(0);
    expect(ctx.db.occurrence.rows.every((o) => o.status === 'void')).toBe(true);
  });

  it('SELF never overwrites reviewing, final, evidenced, or appealed occurrences', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: C, userId: USER, count: 5 });
    const effective = new Date(NOW.getTime() + NOTICE * 1000);
    await windows(ctx.db, C, [effective, effective, effective, effective, effective]);
    await ctx.db.occurrence.update({ where: { id: `${C}_o1` }, data: { status: 'reviewing' } });
    await ctx.db.setOccurrenceStatus(`${C}_o2`, 'pass', NOW);
    await ctx.db.evidence.create({ data: { id: 'e3', occurrenceId: `${C}_o3`, submittedByUserId: USER } });
    await ctx.db.setOccurrenceStatus(`${C}_o4`, 'fail', NOW);
    await ctx.db.appeal.create({ data: { id: 'ap4', occurrenceId: `${C}_o4`, userId: USER, status: 'submitted' } });
    await ctx.commitments.cancel(USER, C);
    ctx.clock.advance(NOTICE * 1000);
    await ctx.commitments.applyCancellationEffective();
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o1` } }))!.status).toBe('reviewing');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe('pass');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o3` } }))!.status).toBe('scheduled');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o4` } }))!.status).toBe('fail');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o5` } }))!.status).toBe('void');
  });

  it('SELF repeated cancellation is idempotent', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: C, userId: USER, count: 2 });
    await windows(ctx.db, C, [NOW, new Date(NOW.getTime() + 2 * NOTICE * 1000)]);
    const first = await ctx.commitments.cancel(USER, C);
    ctx.clock.advance(3_600_000);
    const again = await ctx.commitments.cancel(USER, C);
    expect(again.idempotent).toBe(true);
    expect(again.effectiveAt).toBe(first.effectiveAt);
    expect(ctx.db.commitment.rows[0].cancellationRequestedAt.toISOString()).toBe(NOW.toISOString());
  });

  it('SELF keeps each cancellation race behaviorally correct', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: C, userId: USER, count: 2 });
    const effective = new Date(NOW.getTime() + NOTICE * 1000);
    await windows(ctx.db, C, [effective, effective]);
    await ctx.commitments.cancel(USER, C);
    ctx.clock.advance(NOTICE * 1000);

    await ctx.db.evidence.create({ data: { id: 'e1', occurrenceId: `${C}_o1`, submittedByUserId: USER } });
    await ctx.db.occurrence.update({ where: { id: `${C}_o1` }, data: { status: 'reviewing' } });
    await ctx.commitments.applyCancellationEffective();
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o1` } }))!.status).toBe('reviewing');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe('void');

    const health = new HealthMonitor();
    const deadline = new DeadlineService(ctx.prisma, ctx.clock, { networkGraceSeconds: 0 } as any, {
      recordDeadlineFail: async (id: string) => {
        await ctx.db.occurrence.update({ where: { id }, data: { status: 'fail', decidedAt: ctx.clock.now() } });
      },
    } as any, health);
    ctx.db.occurrence.rows[1].deadlineAt = new Date(ctx.clock.now().getTime() - 1);
    const before = (await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status;
    await deadline.sweep();
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe(before);

    const [a, b] = await Promise.all([ctx.maintenance.run(), ctx.maintenance.run()]);
    expect([a.skipped, b.skipped].filter(Boolean).length).toBe(1);
    expect(ctx.db.occurrence.rows.filter((o) => o.status === 'void')).toHaveLength(1);
  });

  it('recap treats cancelled VOID as neither PASS nor FAIL', async () => {
    const ctx = make();
    await ctx.db.user.create({ data: { id: USER, timezone: 'Asia/Seoul', status: 'active' } });
    await ctx.db.seedSelfCommitment({ id: C, userId: USER, count: 3 });
    const inWeek = new Date('2026-09-13T14:00:00Z');
    await ctx.db.occurrence.update({ where: { id: `${C}_o1` }, data: { deadlineAt: inWeek, windowStartAt: inWeek, status: 'pass', decidedAt: inWeek } });
    await ctx.db.occurrence.update({ where: { id: `${C}_o2` }, data: { deadlineAt: inWeek, windowStartAt: inWeek, status: 'void', failureReasonCode: 'commitment_cancelled', decidedAt: inWeek } });
    await ctx.db.occurrence.update({ where: { id: `${C}_o3` }, data: { deadlineAt: inWeek, windowStartAt: inWeek, status: 'fail', decidedAt: inWeek } });
    const recap = await ctx.recaps.generateForUser(USER);
    expect(recap?.due).toBe(3);
    expect(recap?.pass).toBe(1);
    expect(recap?.fail).toBe(1);
    expect(recap?.void).toBe(1);
    expect(recap?.completionRate).toBeCloseTo(0.5);
    expect(recap?.money).toBeNull();
  });

  it('enforces owner and cross-user authorization', async () => {
    const ctx = await fundedActive(1);
    await windows(ctx.db, C, [NOW]);
    await expect(ctx.commitments.previewCancel('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.commitments.cancel('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.commitments.cancel(USER, 'missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('completed commitments cannot be newly cancelled', async () => {
    const ctx = await fundedActive(1);
    await windows(ctx.db, C, [NOW]);
    await ctx.db.commitment.update({ where: { id: C }, data: { status: 'completed' } });
    await expect(ctx.commitments.previewCancel(USER, C)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    await expect(ctx.commitments.cancel(USER, C)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });
});

function clockAdvance(ctx: { clock: FrozenClock }, ms: number) {
  ctx.clock.advance(ms);
}
