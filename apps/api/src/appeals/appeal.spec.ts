import { ExecutionContext } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AuditService } from '../audit/audit.service';
import { FrozenClock } from '../common/clock/clock';
import { CommitmentService } from '../commitments/commitment.service';
import { LedgerService } from '../payments/ledger.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { SettlementService } from '../settlement/settlement.service';
import { AppealService } from './appeal.service';

const USER = 'u1';
const OTHER = 'u2';
const C = 'c1';
const NOW = new Date('2026-09-14T12:00:00Z');
const WINDOW = 7 * 24 * 3600;

function make() {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const clock = new FrozenClock(NOW);
  const provider = new MockPaymentProvider();
  const ledger = new LedgerService(prisma);
  const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
  const policy = new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG, clock);
  const payments = new PaymentService(prisma, provider, ledger, clock, policy);
  const cfg = { nodeEnv: 'test', appealWindowSeconds: WINDOW } as any;
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const audit = new AuditService(prisma);
  const appeals = new AppealService(prisma, ledger, payments, audit, clock, cfg);
  const commitments = new CommitmentService(
    prisma, {} as any, {} as any, {} as any, users, policy, clock, audit, money, payments, cfg, appeals,
  );
  return { db, clock, provider, ledger, payments, settlement, money, policy, appeals, audit, commitments };
}

async function funded(ctx = make()) {
  await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
  await ctx.payments.chargeUpfront(USER, C);
  return ctx;
}

async function active(ctx = make()) {
  const f = await funded(ctx);
  await f.commitments.sign(USER, C);
  return f;
}

async function verdicts(ctx: ReturnType<typeof make>, statuses: string[], decidedAt = NOW): Promise<void> {
  for (let i = 0; i < statuses.length; i += 1) {
    const deadline = statuses[i] === 'fail' ? new Date(decidedAt.getTime() + WINDOW * 1000) : undefined;
    await ctx.db.setOccurrenceStatus(`${C}_o${i + 1}`, statuses[i], decidedAt, deadline);
  }
}

function ledgerOf(ctx: ReturnType<typeof make>, type?: string) {
  return ctx.db.paymentLedger.rows.filter((r) => r.commitmentId === C && (!type || r.entryType === type));
}

async function submitFail(ctx: ReturnType<typeof make>, occ = `${C}_o2`) {
  return ctx.appeals.submit(USER, occ, { reasonCategory: 'verification_error', explanation: '사진이 잘못 읽힌 것 같아요.' });
}

async function expireFails(ctx: ReturnType<typeof make>): Promise<void> {
  for (const o of ctx.db.occurrence.rows.filter((r) => r.status === 'fail')) {
    await ctx.db.occurrence.update({ where: { id: o.id }, data: { appealDeadlineAt: NOW } });
  }
}

async function lateAppeal(ctx: ReturnType<typeof make>, occ = `${C}_o2`) {
  const row = await ctx.db.appeal.create({
    data: {
      id: `ap_${occ}`,
      occurrenceId: occ,
      userId: USER,
      reasonCategory: 'verification_error',
      reasonText: 'legacy correction',
      originalResult: 'fail',
      status: 'submitted',
      submittedAt: NOW,
    },
  });
  return ctx.appeals.getOwnedById(USER, row.id);
}

describe('Phase 5B — MONEY appeal eligibility', () => {
  it('only the owner may appeal a final MONEY FAIL', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await expect(
      ctx.appeals.submit(OTHER, `${C}_o2`, { reasonCategory: 'other', explanation: 'x' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const ok = await submitFail(ctx);
    expect(ok.status).toBe('submitted');
    expect(ok.originalResult).toBe('fail');
    expect(ok.effectiveResult).toBe('fail');
    expect(ledgerOf(ctx)).toHaveLength(1); // deposit only
  });

  it('rejects UNCERTAIN, system_hold, PASS, VOID, SELF', async () => {
    const ctx = await active();
    await verdicts(ctx, ['uncertain', 'pass', 'void']);
    await expect(submitFail(ctx, `${C}_o1`)).rejects.toMatchObject({ code: 'APPEAL_NOT_ELIGIBLE' });
    await expect(submitFail(ctx, `${C}_o2`)).rejects.toMatchObject({ code: 'APPEAL_NOT_ELIGIBLE' });
    await expect(submitFail(ctx, `${C}_o3`)).rejects.toMatchObject({ code: 'APPEAL_NOT_ELIGIBLE' });
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'system_hold');
    await expect(submitFail(ctx, `${C}_o1`)).rejects.toMatchObject({ code: 'APPEAL_NOT_ELIGIBLE' });

    const self = make();
    await self.db.seedSelfCommitment({ id: 's1', userId: USER, count: 1 });
    await self.db.setOccurrenceStatus('s1_o1', 'fail', NOW);
    await expect(
      self.appeals.submit(USER, 's1_o1', { reasonCategory: 'other', explanation: 'x' }),
    ).rejects.toMatchObject({ code: 'APPEAL_NOT_ELIGIBLE' });
  });

  it('enforces the 7-day boundary and one appeal per occurrence', async () => {
    const ctx = await active();
    const exactly = new Date(NOW.getTime() - WINDOW * 1000);
    const tooLate = new Date(NOW.getTime() - WINDOW * 1000 - 1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', exactly, new Date(NOW.getTime() + 1));
    await ctx.db.setOccurrenceStatus(`${C}_o2`, 'fail', tooLate, NOW);
    await ctx.db.setOccurrenceStatus(`${C}_o3`, 'fail', NOW, new Date(NOW.getTime() + WINDOW * 1000));
    await expect(submitFail(ctx, `${C}_o1`)).resolves.toMatchObject({ status: 'submitted' });
    await expect(submitFail(ctx, `${C}_o2`)).rejects.toMatchObject({ code: 'APPEAL_WINDOW_CLOSED' });
    await expect(submitFail(ctx, `${C}_o1`)).rejects.toMatchObject({ code: 'APPEAL_ALREADY_EXISTS' });
  });

  it('stays reviewable after the window if submitted in time', async () => {
    const ctx = await active();
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    const a = await submitFail(ctx, `${C}_o1`);
    ctx.clock.advance(WINDOW * 1000 + 60_000);
    const decided = await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    expect(decided.status).toBe('approved');
    expect(decided.effectiveResult).toBe('pass');
  });
});

describe('Phase 5B — pending appeal blocks settlement', () => {
  it('blocks the occurrence and the commitment while an appeal is pending', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await submitFail(ctx);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(false);
    expect(report.occurrencesPending).toBeGreaterThan(0);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('active');
  });
});

describe('Phase 5B — admin reject / approve', () => {
  it('reject creates no ledger or payment change', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const a = await submitFail(ctx);
    const before = ctx.db.paymentLedger.rows.length;
    const rejected = await ctx.appeals.reject(a.appealId, '증거가 부족해요.', 'admin-1');
    expect(rejected.status).toBe('rejected');
    expect(rejected.rejectReason).toBe('증거가 부족해요.');
    expect(ctx.db.paymentLedger.rows).toHaveLength(before);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(0);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(true);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(1);
    expect(ctx.db.auditLog.rows.some((r) => r.action === 'appeal_rejected')).toBe(true);
  });

  it('approve before settlement consumes corrected PASS, no reversal', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const a = await submitFail(ctx);
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(true);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_earned')).toHaveLength(3);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
    const occ = await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } });
    expect(occ!.status).toBe('fail');
  });

  it('approve before settlement with VOID is refundable and creates no reversal', async () => {
    const ctx = await active();
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    const a = await submitFail(ctx, `${C}_o1`);
    await ctx.appeals.approve(a.appealId, 'void', 'admin-1');
    await expireFails(ctx);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(true);
    expect(ctx.db.settlement.rows.find((s) => s.occurrenceId === `${C}_o1`)!.result).toBe('void');
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_earned').map((r) => r.amount)).toEqual([5_000n]);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(2);
  });

  it('approve after settlement appends one reversal and one supplemental refund', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(10_000n);
    const a = await lateAppeal(ctx);
    const decided = await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    expect(decided.effectiveResult).toBe('pass');
    expect(decided.originalResult).toBe('fail');
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect(ledgerOf(ctx, 'reversal')[0].amount).toBe(5_000n);
    const extras = ledgerOf(ctx, 'refund_paid');
    expect(extras).toHaveLength(2);
    expect(extras.map((r) => r.amount).sort((x, y) => Number(x - y))).toEqual([5_000n, 10_000n]);
    const totals = await ctx.ledger.totalsForCommitment(C);
    expect(totals.deposit).toBe(totals.forfeit - totals.reversal + totals.refundPaid);
    expect(totals.refundPaid).toBe(15_000n);
  });

  it('all-FAIL then approved appeal refunds one occurrence amount', async () => {
    const ctx = await active();
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(0);
    const a = await lateAppeal(ctx, `${C}_o1`);
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid')).toEqual([
      expect.objectContaining({ amount: 5_000n, idempotencyKey: `refund_paid:appeal:${C}_o1` }),
    ]);
    const totals = await ctx.ledger.totalsForCommitment(C);
    expect(totals.refundPaid).toBe(5_000n);
    expect(totals.deposit).toBe(totals.forfeit - totals.reversal + totals.refundPaid);
  });

  it('duplicate admin decision, retry, and reconcile stay idempotent', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    const a = await lateAppeal(ctx);
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    await ctx.settlement.retryRefund(C);
    await ctx.payments.reconcileStale(0);
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid').filter((r) => String(r.idempotencyKey).startsWith('refund_paid:appeal:'))).toHaveLength(1);
    expect(ctx.provider.calls.refund).toBe(2); // aggregate + one supplemental
  });

  it('lost supplemental refund response does not duplicate reversal or refund', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    const a = await lateAppeal(ctx);
    ctx.provider.loseNextRefund = true;
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid').filter((r) => String(r.idempotencyKey).includes('appeal'))).toHaveLength(0);
    const requested = ctx.db.payment.rows.filter((p) => p.type === 'refund' && p.status === 'requested');
    expect(requested).toHaveLength(1);
    const again = await ctx.payments.refundSupplemental(C, `${C}_o2`, 5_000n, `appeal_supplemental:${C}_o2`);
    expect(again.status).toBe('succeeded');
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid').filter((r) => String(r.idempotencyKey).includes('appeal'))).toHaveLength(1);
  });

  it('cumulative successful refunds cannot exceed the charge', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    await expect(ctx.payments.refundSupplemental(C, `${C}_o2`, 10_000n, 'too-much')).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    const a = await lateAppeal(ctx);
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    const totals = await ctx.ledger.totalsForCommitment(C);
    expect(totals.refundPaid).toBeLessThanOrEqual(totals.deposit);
    expect(totals.refundPaid).toBe(15_000n);
  });

  it('rolling loss-cap credit waits for the supplemental refund to succeed', async () => {
    const ctx = await active();
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    await expireFails(ctx);
    await ctx.settlement.settleCommitment(C);
    for (const r of ctx.db.paymentLedger.rows) r.createdAt = NOW;
    expect((await ctx.policy.rollingExposure(USER)).realizedForfeitKrw).toBe(15_000);
    const a = await lateAppeal(ctx, `${C}_o1`);
    ctx.provider.failNextRefund = true;
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    for (const r of ctx.db.paymentLedger.rows) r.createdAt = NOW;
    expect(ledgerOf(ctx, 'reversal')).toHaveLength(1);
    expect((await ctx.policy.rollingExposure(USER)).realizedForfeitKrw).toBe(15_000);
    await ctx.payments.refundSupplemental(C, `${C}_o1`, 5_000n, `appeal_supplemental:${C}_o1`);
    for (const r of ctx.db.paymentLedger.rows) r.createdAt = NOW;
    expect((await ctx.policy.rollingExposure(USER)).realizedForfeitKrw).toBe(10_000);
  });

  it('settlement-versus-appeal race stays financially correct', async () => {
    const ctx = await active();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const a = await submitFail(ctx);
    await Promise.all([
      ctx.settlement.settleCommitment(C),
      ctx.appeals.approve(a.appealId, 'pass', 'admin-1'),
    ]);
    await ctx.settlement.settleCommitment(C);
    const forfeit = ledgerOf(ctx, 'forfeit').filter((r) => r.occurrenceId === `${C}_o2`);
    const earned = ledgerOf(ctx, 'refund_earned').filter((r) => r.occurrenceId === `${C}_o2`);
    const reversal = ledgerOf(ctx, 'reversal');
    expect(forfeit.length + earned.length).toBe(1);
    if (forfeit.length === 1) {
      expect(reversal).toHaveLength(1);
      expect(earned).toHaveLength(0);
    } else {
      expect(earned).toHaveLength(1);
      expect(reversal).toHaveLength(0);
    }
    const totals = await ctx.ledger.totalsForCommitment(C);
    expect(totals.refundPaid + (totals.forfeit - totals.reversal)).toBe(totals.deposit);
  });

  it('admin guard rejects missing or wrong secret', () => {
    const guard = new AdminGuard({ adminApiSecret: 'secret' } as any);
    const ctx = (secret?: string) =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers: secret ? { 'x-admin-secret': secret } : {} }) }),
      }) as ExecutionContext;
    expect(() => guard.canActivate(ctx())).toThrow();
    expect(() => guard.canActivate(ctx('nope'))).toThrow();
    expect(guard.canActivate(ctx('secret'))).toBe(true);
    expect(true).toBe(true);
  });
});
