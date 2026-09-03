import { FrozenClock } from '../common/clock/clock';
import { CommitmentService } from '../commitments/commitment.service';
import { LedgerService } from '../payments/ledger.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { SettlementService } from './settlement.service';

/**
 * Phase 4 — MONEY lifecycle with MockPaymentProvider, end to end:
 *
 *   payment_pending ──charge──▶ signature_pending/funded ──sign──▶ active ──verdicts──▶ settlement
 *
 * Invariants pinned here (SRD §5, TRD §10):
 *   - MONEY never activates without a successful charge.
 *   - SELF never touches Payment/Stake/Ledger.
 *   - Charges, webhooks, settlements and refunds are all idempotent.
 *   - UNCERTAIN / system_hold never settle.
 *   - Closed ledger: deposit == forfeit + refund_paid.
 */

const USER = 'u1';
const C = 'c1';
const NOW = new Date('2026-09-14T12:00:00Z');

function make() {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const clock = new FrozenClock(NOW);
  const provider = new MockPaymentProvider();
  const ledger = new LedgerService(prisma);
  const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
  const policy = new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG, clock);
  const payments = new PaymentService(prisma, provider, ledger, clock, policy);
  const cfg = { nodeEnv: 'test' } as any;
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const commitments = new CommitmentService(prisma, {} as any, {} as any, {} as any, users, policy, clock, { log: async () => undefined } as any, money);
  return { db, clock, provider, ledger, payments, settlement, money, policy, commitments };
}

async function fundedThreeByFive(ctx = make()) {
  await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
  await ctx.payments.chargeUpfront(USER, C);
  return ctx;
}

async function activeThreeByFive(ctx = make()) {
  const funded = await fundedThreeByFive(ctx);
  await funded.commitments.sign(USER, C);
  return funded;
}

async function verdicts(ctx: ReturnType<typeof make>, statuses: string[]): Promise<void> {
  for (let i = 0; i < statuses.length; i += 1) {
    await ctx.db.setOccurrenceStatus(`${C}_o${i + 1}`, statuses[i]);
  }
}

function ledgerRows(ctx: ReturnType<typeof make>, type?: string) {
  return ctx.db.paymentLedger.rows.filter((r) => r.commitmentId === C && (!type || r.entryType === type));
}

async function expectClosedLedgerBalanced(ctx: ReturnType<typeof make>): Promise<void> {
  const totals = await ctx.ledger.totalsForCommitment(C);
  expect(ctx.ledger.isBalanced(totals)).toBe(true);
  expect(totals.deposit).toBe(totals.forfeit + totals.refundPaid);
}

describe('Phase 4 — MONEY activation gating', () => {
  it('MONEY cannot activate without a successful payment (declined charge keeps payment_pending)', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });

    await expect(ctx.payments.chargeUpfront(USER, C, { simulate: 'charge_fail' })).rejects.toMatchObject({
      code: 'PAYMENT_FAILED',
    });

    const c = await ctx.db.commitment.findUnique({ where: { id: C }, include: { stake: true } });
    expect(c!.status).toBe('payment_pending');
    expect(c!.stake.status).toBe('pending');
    expect(ledgerRows(ctx)).toHaveLength(0);
    expect((await ctx.money.forCommitment(C))!.status).toBe('payment_failed');

    // Even if verdicts somehow landed, nothing can settle without a deposit.
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.skipped).toBe('not_funded');
    expect(ctx.db.settlement.rows).toHaveLength(0);
  });

  it('a failed charge can be retried; success funds the stake but does not activate', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    await expect(ctx.payments.chargeUpfront(USER, C, { simulate: 'charge_fail' })).rejects.toMatchObject({ code: 'PAYMENT_FAILED' });

    const view = await ctx.payments.chargeUpfront(USER, C);
    expect(view.status).toBe('succeeded');
    expect(view.attempt).toBe(2);
    expect(view.amountKrw).toBe('15000');

    const c = await ctx.db.commitment.findUnique({ where: { id: C }, include: { stake: true } });
    expect(c!.status).toBe('signature_pending');
    expect(c!.stake.status).toBe('funded');
    expect(c!.signatureCompleted).toBe(false);
    expect(ledgerRows(ctx, 'deposit').map((r) => r.amount)).toEqual([15_000n]);
    expect((await ctx.money.forCommitment(C))!.status).toBe('funded');
  });

  it('payment success alone does not activate; /sign after funding is required and idempotent', async () => {
    const ctx = await fundedThreeByFive();
    const before = await ctx.db.commitment.findUnique({ where: { id: C } });
    expect(before!.status).toBe('signature_pending');
    expect(before!.signatureCompleted).toBe(false);

    const first = await ctx.commitments.sign(USER, C);
    expect(first.status).toBe('active');
    const second = await ctx.commitments.sign(USER, C);
    expect(second.status).toBe('active');
    expect(second.signedAt).toBe(first.signedAt);

    const after = await ctx.db.commitment.findUnique({ where: { id: C } });
    expect(after!.status).toBe('active');
    expect(after!.signatureCompleted).toBe(true);
  });

  it('signing before funding is rejected', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    await expect(ctx.commitments.sign(USER, C)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('payment_pending');
  });

  it('signature_pending is excluded from settlement (and therefore Today/Timer/deadline/verification gates)', async () => {
    const ctx = await fundedThreeByFive(); // funded but NOT yet signed → signature_pending
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.skipped).toBe('not_active');
    expect(ctx.db.settlement.rows).toHaveLength(0);
    expect(ledgerRows(ctx, 'forfeit')).toHaveLength(0);
  });

  it('charges the server-authoritative maxLoss (stake.maxTotalAmount), not a client value', async () => {
    const ctx = await fundedThreeByFive();
    const charge = ctx.db.payment.rows.find((p) => p.type === 'charge' && p.status === 'succeeded');
    expect(charge!.amount).toBe(15_000n);
  });

  it('SELF never creates a Payment/Stake flow', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: 'self1', userId: USER, count: 3 });

    await expect(ctx.payments.chargeUpfront(USER, 'self1')).rejects.toMatchObject({ code: 'PAYMENT_NOT_REQUIRED' });
    await ctx.db.setOccurrenceStatus('self1_o1', 'pass');
    await ctx.db.setOccurrenceStatus('self1_o2', 'fail');
    const report = await ctx.settlement.settleCommitment('self1');

    expect(report.skipped).toBe('not_money');
    expect(ctx.db.payment.rows).toHaveLength(0);
    expect(ctx.db.stake.rows).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
    expect(ctx.db.settlement.rows).toHaveLength(0);
    expect(ctx.provider.calls.charge).toBe(0);
    expect(await ctx.money.forCommitment('self1')).toBeNull();
  });
});

describe('Phase 4 — payment idempotency', () => {
  it('duplicate charge is prevented (sequential retry returns the same payment, PG called once)', async () => {
    const ctx = await fundedThreeByFive();
    const first = ctx.db.payment.rows[0];
    const again = await ctx.payments.chargeUpfront(USER, C);
    expect(again.paymentId).toBe(first.id);
    expect(ctx.provider.calls.charge).toBe(1);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'charge')).toHaveLength(1);
    expect(ledgerRows(ctx, 'deposit')).toHaveLength(1);
  });

  it('duplicate charge is prevented under concurrency (unique idempotency key wins)', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    const [a, b] = await Promise.all([ctx.payments.chargeUpfront(USER, C), ctx.payments.chargeUpfront(USER, C)]);
    expect(a.paymentId).toBe(b.paymentId);
    expect(ctx.provider.calls.charge).toBe(1);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'charge')).toHaveLength(1);
    expect(ledgerRows(ctx, 'deposit')).toHaveLength(1);
    const stake = await ctx.db.stake.findUnique({ where: { commitmentId: C } });
    expect(stake!.status).toBe('funded');
  });

  it('duplicate webhook is prevented (same eventId applied once; final state is not reopened)', async () => {
    const ctx = await fundedThreeByFive();
    const charge = ctx.db.payment.rows[0];
    const body = JSON.stringify({
      eventId: 'evt-1',
      providerPaymentKey: charge.providerPaymentKey,
      type: 'charge',
      status: 'succeeded',
      amount: '15000',
    });
    const headers = { 'x-mock-signature': 'valid' };

    const first = await ctx.payments.handleWebhook(body, headers);
    const second = await ctx.payments.handleWebhook(body, headers);
    expect(first.deduped).toBe(false);
    expect(first.outcome).toBe('ignored'); // sync path already finalised it
    expect(second).toMatchObject({ deduped: true, outcome: 'duplicate' });
    expect(ctx.db.paymentWebhookEvent.rows).toHaveLength(1);
    expect(ledgerRows(ctx, 'deposit')).toHaveLength(1);

    // A contradictory late webhook cannot flip a final payment.
    const contradicting = JSON.stringify({ ...JSON.parse(body), eventId: 'evt-2', status: 'failed' });
    await ctx.payments.handleWebhook(contradicting, headers);
    const p = await ctx.db.payment.findUnique({ where: { id: charge.id } });
    expect(p!.status).toBe('succeeded');
  });

  it('rejects a webhook with an invalid signature and records nothing', async () => {
    const ctx = await fundedThreeByFive();
    await expect(
      ctx.payments.handleWebhook(JSON.stringify({ eventId: 'x', providerPaymentKey: 'k', type: 'charge', status: 'succeeded', amount: '1' }), {
        'x-mock-signature': 'nope',
      }),
    ).rejects.toMatchObject({ code: 'WEBHOOK_INVALID' });
    expect(ctx.db.paymentWebhookEvent.rows).toHaveLength(0);
  });
});

describe('Phase 4 — settlement (3 × 5,000 = 15,000 upfront)', () => {
  it('PASS / FAIL / PASS → 10,000 refundable, 5,000 forfeited', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);

    expect(report.occurrencesSettled).toBe(3);
    expect(report.totals).toMatchObject({ depositKrw: '15000', refundableKrw: '10000', forfeitedKrw: '5000' });
    expect(ctx.db.settlement.rows.map((s) => s.result).sort()).toEqual(['forfeited', 'refundable', 'refundable']);
    expect(ledgerRows(ctx, 'refund_earned').reduce((a, r) => a + r.amount, 0n)).toBe(10_000n);
    expect(ledgerRows(ctx, 'forfeit').reduce((a, r) => a + r.amount, 0n)).toBe(5_000n);
  });

  it('commitment-end aggregate refund is exactly one 10,000 refund', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);

    expect(report.completed).toBe(true);
    expect(report.refund).toMatchObject({ type: 'refund', status: 'succeeded', amountKrw: '10000' });
    const refunds = ctx.db.payment.rows.filter((p) => p.type === 'refund');
    expect(refunds).toHaveLength(1);
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ledgerRows(ctx, 'refund_paid').map((r) => r.amount)).toEqual([10_000n]);

    const c = await ctx.db.commitment.findUnique({ where: { id: C }, include: { stake: true } });
    expect(c!.status).toBe('completed');
    expect(c!.stake.status).toBe('refunded');
    expect((await ctx.money.forCommitment(C))!.status).toBe('refunded');
    // The mock PG retains exactly the forfeited amount.
    expect(ctx.provider.remainingFor(ctx.db.payment.rows[0].providerPaymentKey)).toBe(5_000n);
    await expectClosedLedgerBalanced(ctx);
  });

  it('all PASS → 15,000 refund', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'pass', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.refund).toMatchObject({ status: 'succeeded', amountKrw: '15000' });
    expect(report.totals).toMatchObject({ forfeitedKrw: '0', refundPaidKrw: '15000' });
    expect(ctx.provider.remainingFor(ctx.db.payment.rows[0].providerPaymentKey)).toBe(0n);
    await expectClosedLedgerBalanced(ctx);
  });

  it('all FAIL → 0 refund (no refund payment, stake settled, ledger balanced)', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(true);
    expect(report.refund).toBeNull();
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(0);
    expect(ctx.provider.calls.refund).toBe(0);
    const stake = await ctx.db.stake.findUnique({ where: { commitmentId: C } });
    expect(stake!.status).toBe('settled');
    expect((await ctx.money.forCommitment(C))!).toMatchObject({
      status: 'settled_no_refund',
      label: '정산 완료',
      refundableKrw: '0',
      forfeitedKrw: '15000',
      refundPaidKrw: '0',
    });
    await expectClosedLedgerBalanced(ctx);
  });

  it('VOID counts as refundable (cancelled remainder is returned)', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['fail', 'void', 'void']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.refund).toMatchObject({ status: 'succeeded', amountKrw: '10000' });
    await expectClosedLedgerBalanced(ctx);
  });

  it('UNCERTAIN cannot settle — commitment stays open, no refund, money still 약속금 걸림', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'uncertain', 'pass']);
    const report = await ctx.settlement.settleCommitment(C);

    expect(report.occurrencesSettled).toBe(2);
    expect(report.occurrencesPending).toBe(1);
    expect(report.completed).toBe(false);
    expect(report.refund).toBeNull();
    expect(ctx.db.settlement.rows.map((s) => s.occurrenceId).sort()).toEqual([`${C}_o1`, `${C}_o3`]);
    const c = await ctx.db.commitment.findUnique({ where: { id: C }, include: { stake: true } });
    expect(c!.status).toBe('active');
    expect(c!.stake.status).toBe('funded');
    expect((await ctx.money.forCommitment(C))!.status).toBe('funded');
    expect(ledgerRows(ctx, 'forfeit')).toHaveLength(0);
  });

  it('system_hold cannot settle — a platform outage never costs the user money', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'system_hold', 'fail']);
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.completed).toBe(false);
    expect(report.refund).toBeNull();
    expect(report.occurrencesPending).toBe(1);
    // The held occurrence has neither a Settlement nor any ledger entry.
    expect(ctx.db.settlement.rows.some((s) => s.occurrenceId === `${C}_o2`)).toBe(false);
    expect(ledgerRows(ctx).some((r) => r.occurrenceId === `${C}_o2`)).toBe(false);

    // Once the hold is lifted and the verdict lands, settlement resumes normally.
    await ctx.db.setOccurrenceStatus(`${C}_o2`, 'pass');
    const after = await ctx.settlement.settleCommitment(C);
    expect(after.completed).toBe(true);
    expect(after.refund).toMatchObject({ amountKrw: '10000', status: 'succeeded' });
    await expectClosedLedgerBalanced(ctx);
  });

  it('re-running settlement never double-settles or double-refunds', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await ctx.settlement.settleCommitment(C);
    await ctx.settlement.settleCommitment(C);
    await ctx.settlement.sweep();

    expect(ctx.db.settlement.rows).toHaveLength(3);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(1);
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(1);
    await expectClosedLedgerBalanced(ctx);
  });

  it('concurrent settlement passes are serialised by the unique settlement key', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await Promise.all([ctx.settlement.settleCommitment(C), ctx.settlement.settleCommitment(C)]);
    expect(ctx.db.settlement.rows).toHaveLength(3);
    expect(ledgerRows(ctx, 'refund_earned').reduce((a, r) => a + r.amount, 0n)).toBe(10_000n);
    expect(ledgerRows(ctx, 'forfeit').reduce((a, r) => a + r.amount, 0n)).toBe(5_000n);
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(1);
    await expectClosedLedgerBalanced(ctx);
  });
});

describe('Phase 4 — refund retry', () => {
  it('a failed refund shows 환불 지연, retry succeeds, and the ledger posts refund_paid exactly once', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    ctx.provider.failNextRefund = true;

    const first = await ctx.settlement.settleCommitment(C);
    expect(first.completed).toBe(true);
    expect(first.refund).toMatchObject({ status: 'failed', attempt: 1, failureCode: 'MOCK_PG_TIMEOUT' });
    expect((await ctx.money.forCommitment(C))!.status).toBe('refund_delayed');
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(0);
    const stakeMid = await ctx.db.stake.findUnique({ where: { commitmentId: C } });
    expect(stakeMid!.status).toBe('settling');

    const second = await ctx.settlement.retryRefund(C);
    expect(second.refund).toMatchObject({ status: 'succeeded', attempt: 2, amountKrw: '10000' });
    expect((await ctx.money.forCommitment(C))!.status).toBe('refunded');

    // Further retries are no-ops.
    const third = await ctx.settlement.retryRefund(C);
    expect(third.refund).toMatchObject({ status: 'succeeded', attempt: 2 });
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(2);
    expect(ctx.provider.calls.refund).toBe(2);
    expect(ledgerRows(ctx, 'refund_paid').map((r) => r.amount)).toEqual([10_000n]);
    expect(ctx.provider.remainingFor(ctx.db.payment.rows[0].providerPaymentKey)).toBe(5_000n);
    await expectClosedLedgerBalanced(ctx);
  });

  it('refund webhook confirming an in-flight refund is applied once and deduped afterwards', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await ctx.settlement.settleCommitment(C);
    const chargeKey = ctx.db.payment.rows[0].providerPaymentKey as string;
    const body = JSON.stringify({ eventId: 'evt-r1', providerPaymentKey: chargeKey, type: 'refund', status: 'succeeded', amount: '10000' });
    const r1 = await ctx.payments.handleWebhook(body, { 'x-mock-signature': 'valid' });
    const r2 = await ctx.payments.handleWebhook(body, { 'x-mock-signature': 'valid' });
    expect(r1.deduped).toBe(false);
    expect(r2.deduped).toBe(true);
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(1);
    await expectClosedLedgerBalanced(ctx);
  });
});

describe('Phase 4 — ledger invariants', () => {
  it('no ledger imbalance across every closed scenario', async () => {
    const scenarios: string[][] = [
      ['pass', 'pass', 'pass'],
      ['pass', 'fail', 'pass'],
      ['fail', 'fail', 'fail'],
      ['fail', 'void', 'pass'],
      ['void', 'void', 'void'],
    ];
    for (const s of scenarios) {
      const ctx = await activeThreeByFive();
      await verdicts(ctx, s);
      await ctx.settlement.settleCommitment(C);
      const totals = await ctx.ledger.totalsForCommitment(C);
      const expectedForfeit = BigInt(s.filter((x) => x === 'fail').length) * 5_000n;
      expect(totals.forfeit).toBe(expectedForfeit);
      expect(totals.refundPaid).toBe(15_000n - expectedForfeit);
      expect(ctx.ledger.isBalanced(totals)).toBe(true);
      // Ledger is append-only: nothing ever mutated in place.
      expect(ctx.db.paymentLedger.rows.every((r) => r.amount > 0n)).toBe(true);
    }
  });

  it('every ledger entry carries a unique idempotency key (append-only, no duplicates)', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    await ctx.settlement.settleCommitment(C);
    const keys = ctx.db.paymentLedger.rows.map((r) => r.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(5); // deposit + 3 settlements + refund_paid
  });
});

describe('Phase 4 — StakePolicy still enforced', () => {
  function policyFor(tier: 'tier_1' | 'tier_2' | 'tier_3') {
    const users = { findById: async (id: string) => ({ id, stakeTier: tier }) } as any;
    const prisma = {
      paymentLedger: { findMany: async () => [], aggregate: async () => ({ _sum: { amount: 0n } }) },
      commitment: { findMany: async () => [] },
      payment: { findMany: async () => [] },
    } as any;
    return new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG);
  }

  it('TIER 1 rejects a 30,001 per-occurrence stake and a 150,001 max loss regardless of payment path', async () => {
    const policy = policyFor('tier_1');
    await expect(policy.assertWithinLimits(USER, 30_001, 30_001)).rejects.toMatchObject({ code: 'STAKE_TIER_LIMIT_EXCEEDED' });
    await expect(policy.assertWithinLimits(USER, 30_000, 150_001)).rejects.toMatchObject({ code: 'STAKE_TIER_LIMIT_EXCEEDED' });
    await expect(policy.assertWithinLimits(USER, 5_000, 15_000)).resolves.toBeUndefined();
  });

  it('settled forfeits reduce the rolling monthly loss budget; unsettled behavioral FAILs do not', async () => {
    const ctx = await activeThreeByFive();
    const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
    // In-memory ledger rows are stamped 2026-01-01; evaluate the 30-day window from just after that.
    const policy = new StakePolicyService(
      ctx.db as unknown as PrismaService,
      users,
      DEFAULT_STAKE_POLICY_CONFIG,
      new FrozenClock(new Date(2026, 0, 2)),
    );

    await verdicts(ctx, ['pass', 'fail', 'pass']);
    // Funded non-final: reserve full 15,000. Unsettled FAIL does not count as realized.
    expect((await policy.forUser(USER)).rollingMonthlyLossRemainingKrw).toBe(285_000);

    await ctx.settlement.settleCommitment(C);
    // Completed: reservation released, only the 5,000 settled forfeit remains.
    expect((await policy.forUser(USER)).rollingMonthlyLossRemainingKrw).toBe(295_000);
  });

  it('the charged amount equals stake.maxTotalAmount which was validated by StakePolicy at creation', async () => {
    const ctx = await fundedThreeByFive();
    const stake = await ctx.db.stake.findUnique({ where: { commitmentId: C } });
    const charge = ctx.db.payment.rows.find((p) => p.type === 'charge');
    expect(charge!.amount).toBe(stake!.maxTotalAmount);
    expect(Number(stake!.maxTotalAmount)).toBeLessThanOrEqual(DEFAULT_STAKE_POLICY_CONFIG.tier_1.maxPerCommitmentKrw);
  });

  it('concurrent charges cannot bypass the rolling cap; a commitment is never reserved and realized together', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: 'a', userId: USER, perOccurrence: 200_000n, count: 1 });
    await ctx.db.seedMoneyCommitment({ id: 'b', userId: USER, perOccurrence: 200_000n, count: 1 });
    const results = await Promise.allSettled([
      ctx.payments.chargeUpfront(USER, 'a'),
      ctx.payments.chargeUpfront(USER, 'b'),
    ]);
    const ok = results.filter((r) => r.status === 'fulfilled');
    const denied = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(denied).toHaveLength(1);
    expect((denied[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'STAKE_TIER_LIMIT_EXCEEDED' });
    expect(ctx.db.payment.rows.filter((p) => p.status === 'succeeded')).toHaveLength(1);
    expect(ctx.db.payment.rows.filter((p) => p.status === 'requested')).toHaveLength(0);
    const exp = await ctx.policy.rollingExposure(USER);
    expect(exp.reservedKrw).toBe(200_000);
    expect(exp.realizedForfeitKrw).toBe(0);
  });
});

describe('Phase 4.1 — unknown provider outcomes', () => {
  it('lost charge response: retry/reconcile yields one PG charge and one deposit', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    await expect(ctx.payments.chargeUpfront(USER, C, { simulate: 'charge_lost' })).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
    const pending = ctx.db.payment.rows[0];
    expect(pending.status).toBe('requested');
    expect(pending.providerPaymentKey).toBeTruthy();
    expect(ctx.provider.calls.charge).toBe(1);
    expect(ledgerRows(ctx, 'deposit')).toHaveLength(0);
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('payment_pending');

    const view = await ctx.payments.chargeUpfront(USER, C);
    expect(view.status).toBe('succeeded');
    expect(view.paymentId).toBe(pending.id);
    expect(view.attempt).toBe(1);
    expect(ctx.provider.calls.charge).toBe(1);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'charge')).toHaveLength(1);
    expect(ledgerRows(ctx, 'deposit')).toHaveLength(1);
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('signature_pending');
  });

  it('lost refund response: retry yields one PG refund and one refund_paid', async () => {
    const ctx = await activeThreeByFive();
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    ctx.provider.loseNextRefund = true;
    const first = await ctx.settlement.settleCommitment(C);
    expect(first.refund?.status).toBe('requested');
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(0);

    const second = await ctx.settlement.retryRefund(C);
    expect(second.refund).toMatchObject({ status: 'succeeded', attempt: 1, amountKrw: '10000' });
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(1);
    expect(ledgerRows(ctx, 'refund_paid')).toHaveLength(1);
    await expectClosedLedgerBalanced(ctx);
  });
});

describe('Phase 4.1 — authorization', () => {
  it('payment, money, sign, settle, and settlements list deny the other user', async () => {
    const ctx = await fundedThreeByFive();
    await expect(ctx.payments.chargeUpfront('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.money.forOwnedCommitment('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.commitments.sign('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(ctx.payments.getOwned('u2', ctx.db.payment.rows[0].id)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    await ctx.db.seedMoneyCommitment({ id: 'other', userId: 'u2', perOccurrence: 5_000n, count: 1 });
    await ctx.payments.chargeUpfront('u2', 'other');
    await ctx.db.activateSigned('other');
    await ctx.db.setOccurrenceStatus('other_o1', 'fail');
    await ctx.settlement.settleCommitment('other');

    await ctx.db.activateSigned(C);
    await verdicts(ctx, ['fail', 'fail', 'fail']);
    await ctx.settlement.settleCommitment(C);

    const mine = await ctx.settlement.listForUser(USER);
    const theirs = await ctx.settlement.listForUser('u2');
    expect(mine.every((s) => s.commitmentId === C)).toBe(true);
    expect(theirs.every((s) => s.commitmentId === 'other')).toBe(true);
    expect(mine).toHaveLength(3);
    expect(theirs).toHaveLength(1);
  });
});
