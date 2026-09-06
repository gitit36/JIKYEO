import { FrozenClock } from '../common/clock/clock';
import { AuditService } from '../audit/audit.service';
import { CommitmentService } from '../commitments/commitment.service';
import { allowedFailCount } from '../commitments/grace-policy';
import { defaultTermsSnapshot, hashSnapshot, TERMS_VERSION, TermsService } from '../commitments/terms.service';
import { LedgerService } from '../payments/ledger.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { SettlementService } from '../settlement/settlement.service';
import { AppealService } from '../appeals/appeal.service';
import { AdminMoneyService } from '../admin/admin-money.service';
import { MoneyGateService } from '../users/money-gate.service';
import { ScheduleService } from '../commitments/schedule/schedule.service';
import { QuoteCacheService } from '../commitments/quote/quote-cache.service';
import { QuoteService } from '../commitments/quote/quote.service';

const USER = 'u1';
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
  const cfg = { nodeEnv: 'test', moneyEnabled: true, allowAgeFixture: true, appealWindowSeconds: WINDOW } as any;
  const moneyGate = new MoneyGateService(prisma, cfg);
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, cfg, moneyGate);
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const audit = new AuditService(prisma);
  const appeals = new AppealService(prisma, ledger, payments, audit, clock, cfg);
  const commitments = new CommitmentService(
    prisma, {} as any, {} as any, {} as any, users, policy, clock, audit, money, payments, cfg, appeals, moneyGate, ledger,
  );
  const terms = new TermsService(prisma, clock);
  const admin = new AdminMoneyService(prisma, money, payments, settlement, audit, clock, commitments);
  return { db, prisma, clock, provider, ledger, payments, settlement, money, policy, commitments, appeals, terms, admin, cfg };
}

async function funded(opts: {
  count?: number;
  stake?: bigint;
  strictness?: 'perfect' | 'realistic' | 'flexible';
  startAt?: Date;
} = {}) {
  const ctx = make();
  const count = opts.count ?? 10;
  const stake = opts.stake ?? 30_000n;
  const strictness = opts.strictness ?? 'realistic';
  await ctx.db.user.create({
    data: { id: USER, stakeTier: 'tier_1', ageVerificationStatus: 'verified_adult', ageVerifiedAt: NOW, status: 'active' },
  });
  await ctx.db.seedMoneyCommitment({
    id: C, userId: USER, perOccurrence: stake, count, strictness,
    allowedFailCount: allowedFailCount(strictness, count),
    startAt: opts.startAt,
  });
  await ctx.payments.chargeUpfront(USER, C);
  await ctx.commitments.sign(USER, C);
  return ctx;
}

async function verdicts(ctx: ReturnType<typeof make>, statuses: string[], deadline?: Date) {
  for (let i = 0; i < statuses.length; i += 1) {
    await ctx.db.setOccurrenceStatus(`${C}_o${i + 1}`, statuses[i], NOW, deadline);
  }
}

function ledgerOf(ctx: ReturnType<typeof make>, type: string) {
  return ctx.db.paymentLedger.rows.filter((r) => r.entryType === type);
}

describe('Phase 5F — MONEY V1 contract', () => {
  it('charges exactly one commitment-level Stake, not occurrence × amount', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n });
    const charges = ctx.db.payment.rows.filter((p) => p.type === 'charge' && p.status === 'succeeded');
    expect(charges).toHaveLength(1);
    expect(charges[0].amount).toBe(30_000n);
    expect((await ctx.db.stake.findUnique({ where: { commitmentId: C } }))!.maxTotalAmount).toBe(30_000n);
    expect(ledgerOf(ctx, 'deposit')).toHaveLength(1);
  });

  it('PERFECT all PASS → one full refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    await verdicts(ctx, ['pass', 'pass', 'pass']);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_earned')).toHaveLength(0);
  });

  it('PERFECT one financially-final FAIL → no refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    await verdicts(ctx, ['pass', 'fail', 'pass']);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(0);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(1);
    expect(ledgerOf(ctx, 'forfeit')[0].amount).toBe(15_000n);
  });

  it('REALISTIC 10 / 1 final FAIL → full refund', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    await verdicts(ctx, [...Array(9).fill('pass'), 'fail']);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(30_000n);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
  });

  it('REALISTIC 10 / 2 final FAIL → no refund', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    await verdicts(ctx, [...Array(8).fill('pass'), 'fail', 'fail']);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(0);
    expect(ledgerOf(ctx, 'forfeit')[0].amount).toBe(30_000n);
  });

  it('first FAIL inside Grace stays active with zero money movement', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail');
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(false);
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('active');
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_earned')).toHaveLength(0);
  });

  it('threshold-breaking provisional FAIL cannot settle', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    const future = new Date(NOW.getTime() + WINDOW * 1000);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, future);
    await ctx.db.setOccurrenceStatus(`${C}_o2`, 'fail', NOW, future);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(false);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
  });

  it('approved appeal returns contract within Grace and prevents forfeit', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    const future = new Date(NOW.getTime() + WINDOW * 1000);
    await verdicts(ctx, ['pass', 'fail', 'pass'], future);
    const a = await ctx.appeals.submit(USER, `${C}_o2`, { reasonCategory: 'other', explanation: 'x' });
    await ctx.appeals.approve(a.appealId, 'pass', 'admin-1');
    await ctx.db.setOccurrenceStatus(`${C}_o2`, 'fail', NOW, NOW);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
  });

  it('VOID does not consume Grace or create proportional refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    await verdicts(ctx, ['void', 'pass', 'pass']);
    const r = await ctx.settlement.settleCommitment(C);
    expect(r.completed).toBe(true);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(ledgerOf(ctx, 'refund_earned')).toHaveLength(0);
  });

  it('pre-start user cancel → one full refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, startAt: new Date(NOW.getTime() + 86_400_000) });
    const r = await ctx.commitments.cancel(USER, C);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
    expect(r.futureRefundableAmountKrw).toBe('15000');
  });

  it('post-start user abandonment → zero refund, one full forfeit', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, startAt: new Date(NOW.getTime() - 1) });
    await ctx.commitments.cancel(USER, C);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(0);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(1);
    expect(ledgerOf(ctx, 'forfeit')[0].amount).toBe(15_000n);
  });

  it('system cancellation → one full refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, startAt: new Date(NOW.getTime() - 1) });
    await ctx.commitments.cancelSystem(C, 'admin-1');
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
    expect(ledgerOf(ctx, 'forfeit')).toHaveLength(0);
  });

  it('V1 path never posts refund_earned or calls partial refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    const spy = jest.spyOn(ctx.payments, 'refundSupplemental');
    await verdicts(ctx, ['pass', 'pass', 'fail']);
    await ctx.settlement.settleCommitment(C);
    expect(ledgerOf(ctx, 'refund_earned')).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cap reservation is the full Stake once; success does not double-count', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    const before = await ctx.policy.rollingExposure(USER);
    expect(before.reservedKrw).toBe(15_000);
    expect(before.realizedForfeitKrw).toBe(0);
    await verdicts(ctx, ['pass', 'pass', 'pass']);
    await ctx.settlement.settleCommitment(C);
    const after = await ctx.policy.rollingExposure(USER);
    expect(after.reservedKrw).toBe(0);
    expect(after.realizedForfeitKrw).toBe(0);
  });

  it('accepted strictness/allowed-fail snapshot is immutable after policy changes', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    const accepted = await ctx.terms.getAccepted(USER, C);
    expect(accepted.snapshot.allowedFailCount).toBe(1);
    expect(accepted.snapshot.contractStrictness).toBe('realistic');
    const mutated = { ...accepted.snapshot, allowedFailCount: 99 };
    expect(hashSnapshot(mutated as any)).not.toBe(accepted.snapshotHash);
    expect((await ctx.terms.getAccepted(USER, C)).snapshot.allowedFailCount).toBe(1);
  });

  it('client cannot override allowed FAIL count', async () => {
    expect(allowedFailCount('realistic', 10)).toBe(1);
    expect(allowedFailCount('perfect', 10)).toBe(0);
    const ctx = make();
    await ctx.db.user.create({ data: { id: USER, stakeTier: 'tier_1', status: 'active' } });
    const schedule = new ScheduleService();
    const cfg = { jwtSecret: 'j', quoteSigningSecret: 'q-secret', maxStakePerOccurrenceKrw: 100_000, maxLossPerCommitmentKrw: 500_000 } as any;
    const cache = new QuoteCacheService(cfg, ctx.clock);
    const quote = new QuoteService(schedule, cfg, ctx.clock, cache, ctx.policy);
    const q = await quote.compute({
      userId: USER,
      stakeTotalKrw: 30_000,
      contractStrictness: 'realistic',
      timezone: 'Asia/Seoul',
      schedule: {
        type: 'daily', startDate: '2026-09-15', endDate: '2026-09-24',
        windowStartLocalTime: '07:00', deadlineLocalTime: '09:00',
      },
    });
    expect(q.allowedFailCount).toBe(1);
    expect(cache.verify(q.quoteId).allowedFailCount).toBe(1);
    expect(() => {
      const claims = cache.verify(q.quoteId);
      (claims as { allowedFailCount: number }).allowedFailCount = 99;
      expect(allowedFailCount(claims.contractStrictness, claims.occurrenceCount)).toBe(1);
    }).not.toThrow();
  });

  it('lost-response retry still produces exactly one full refund', async () => {
    const ctx = await funded({ count: 3, stake: 15_000n, strictness: 'perfect' });
    await verdicts(ctx, ['pass', 'pass', 'pass']);
    ctx.provider.loseNextRefund = true;
    await ctx.settlement.settleCommitment(C);
    await ctx.settlement.settleCommitment(C);
    expect(ledgerOf(ctx, 'refund_paid')).toHaveLength(1);
    expect(ledgerOf(ctx, 'refund_paid')[0].amount).toBe(15_000n);
  });

  it('weekly period target: missed planned day + 3 completions succeeds without Grace', async () => {
    const svc = new ScheduleService();
    const plans = svc.expand({
      type: 'x_per_week',
      timesPerWeek: 3,
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      windowStartLocalTime: '07:00',
      deadlineLocalTime: '21:00',
    }, 'Asia/Seoul');
    expect(plans).toHaveLength(3);
    expect(plans.every((p) => p.periodKey === plans[0].periodKey)).toBe(true);
    expect(plans[0].deadlineAt.getTime()).toBe(plans[2].deadlineAt.getTime());
    expect(plans[0].deadlineAt.getTime()).toBeGreaterThan(plans[0].windowStartAt.getTime());
  });

  it('fixed-time commitment does not receive implicit make-up', async () => {
    const svc = new ScheduleService();
    const plans = svc.expand({
      type: 'specific_days',
      days: ['MON', 'WED', 'FRI'],
      startDate: '2026-09-07',
      endDate: '2026-09-13',
      windowStartLocalTime: '18:00',
      deadlineLocalTime: '21:00',
    }, 'Asia/Seoul');
    expect(plans[0].periodKey).toBeUndefined();
    expect(plans[0].deadlineAt.toISOString()).toBe('2026-09-07T12:00:00.000Z');
    expect(plans[1].deadlineAt.toISOString()).toBe('2026-09-09T12:00:00.000Z');
  });

  it('SELF remains unaffected', async () => {
    const ctx = make();
    await ctx.db.seedSelfCommitment({ id: 's1', userId: USER, count: 2 });
    await ctx.db.setOccurrenceStatus('s1_o1', 'fail');
    const r = await ctx.settlement.settleCommitment('s1');
    expect(r.skipped).toBe('not_money');
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
  });

  it('admin accounting does not treat in-Grace FAIL as realized loss', async () => {
    const ctx = await funded({ count: 10, stake: 30_000n, strictness: 'realistic' });
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail');
    const sum = await ctx.admin.accountingSummary();
    expect(sum.finalForfeitKrw).toBe('0');
    expect(sum.graceUsedCount).toBe(1);
    expect(sum.reconciledWithBankOrPg).toBe(false);
  });
});
