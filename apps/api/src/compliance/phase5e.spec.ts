import { FrozenClock } from '../common/clock/clock';
import { AuditService } from '../audit/audit.service';
import { CommitmentService } from '../commitments/commitment.service';
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

const USER = 'u1';
const C = 'c1';
const NOW = new Date('2026-09-14T12:00:00Z');
const WINDOW = 7 * 24 * 3600;

function make(cfgExtra: Record<string, unknown> = {}) {
  const db = new InMemoryMoneyDb();
  const prisma = db as unknown as PrismaService;
  const clock = new FrozenClock(NOW);
  const provider = new MockPaymentProvider();
  const ledger = new LedgerService(prisma);
  const users = { findById: async (id: string) => ({ id, stakeTier: 'tier_1' }) } as any;
  const policy = new StakePolicyService(prisma, users, DEFAULT_STAKE_POLICY_CONFIG, clock);
  const cfg = {
    nodeEnv: 'test',
    moneyEnabled: true,
    allowAgeFixture: true,
    appealWindowSeconds: WINDOW,
    ...cfgExtra,
  } as any;
  const moneyGate = new MoneyGateService(prisma, cfg);
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, cfg, moneyGate);
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const audit = new AuditService(prisma);
  const appeals = new AppealService(prisma, ledger, payments, audit, clock, cfg);
  const commitments = new CommitmentService(
    prisma, {} as any, {} as any, {} as any, users, policy, clock, audit, money, payments, cfg, appeals, moneyGate,
  );
  const terms = new TermsService(prisma, clock);
  const admin = new AdminMoneyService(prisma, money, payments, settlement, audit, clock);
  return { db, prisma, clock, provider, ledger, payments, settlement, money, policy, commitments, appeals, terms, moneyGate, admin, cfg };
}

async function windows(db: InMemoryMoneyDb, starts: Date[]) {
  for (let i = 0; i < starts.length; i += 1) {
    await db.occurrence.update({
      where: { id: `${C}_o${i + 1}` },
      data: { windowStartAt: starts[i], deadlineAt: new Date(starts[i].getTime() + 3_600_000) },
    });
  }
}

async function funded(count = 3) {
  const ctx = make();
  await ctx.db.user.create({
    data: { id: USER, stakeTier: 'tier_1', ageVerificationStatus: 'verified_adult', ageVerifiedAt: NOW, status: 'active' },
  });
  await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count });
  await ctx.payments.chargeUpfront(USER, C);
  await ctx.commitments.sign(USER, C);
  return ctx;
}

describe('Phase 5E — cancellation cutoff', () => {
  it('voids occurrences that start inside the former 24h notice window', async () => {
    const ctx = await funded(3);
    await windows(ctx.db, [
      new Date(NOW.getTime() - 1),
      new Date(NOW.getTime() + 3_600_000),
      new Date(NOW.getTime() + 86_400_000),
    ]);
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.bindingOccurrenceCount).toBe(1);
    expect(r.voidOccurrenceCount).toBe(2);
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe('void');
  });

  it('keeps an already-started occurrence binding', async () => {
    const ctx = await funded(2);
    await windows(ctx.db, [new Date(NOW.getTime() - 1), new Date(NOW.getTime() + 1)]);
    await ctx.commitments.cancel(USER, C);
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o1` } }))!.status).toBe('scheduled');
    expect((await ctx.db.occurrence.findUnique({ where: { id: `${C}_o2` } }))!.status).toBe('void');
  });
});

describe('Phase 5E — financial finality', () => {
  it('cannot settle an unappealed FAIL before appealDeadlineAt', async () => {
    const ctx = await funded(1);
    const deadline = new Date(NOW.getTime() + WINDOW * 1000);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, deadline);
    const blocked = await ctx.settlement.settleCommitment(C);
    expect(blocked.completed).toBe(false);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(0);
  });

  it('settles once at or after the appeal deadline', async () => {
    const ctx = await funded(1);
    const deadline = new Date(NOW.getTime() + WINDOW * 1000);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, deadline);
    ctx.clock.advance(WINDOW * 1000);
    const first = await ctx.settlement.settleCommitment(C);
    expect(first.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(1);
    const again = await ctx.settlement.settleCommitment(C);
    expect(again.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(1);
  });

  it('pending appeal blocks settlement', async () => {
    const ctx = await funded(1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, new Date(NOW.getTime() + 60_000));
    await ctx.appeals.submit(USER, `${C}_o1`, { reasonCategory: 'verification_error', explanation: '다시 봐주세요.' });
    const blocked = await ctx.settlement.settleCommitment(C);
    expect(blocked.completed).toBe(false);
    expect(blocked.refund).toBeNull();
  });

  it('rejected appeal finalizes once', async () => {
    const ctx = await funded(1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, new Date(NOW.getTime() + 1));
    const a = await ctx.appeals.submit(USER, `${C}_o1`, { reasonCategory: 'other', explanation: '확인 부탁' });
    await ctx.appeals.reject(a.appealId, '근거가 부족해요.', 'admin');
    const first = await ctx.settlement.settleCommitment(C);
    expect(first.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(1);
    await ctx.settlement.settleCommitment(C);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(1);
  });

  it('approved appeal creates no normal-path forfeit', async () => {
    const ctx = await funded(1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, new Date(NOW.getTime() + 1));
    const a = await ctx.appeals.submit(USER, `${C}_o1`, { reasonCategory: 'verification_error', explanation: '오판' });
    await ctx.appeals.approve(a.appealId, 'pass', 'admin');
    const settled = await ctx.settlement.settleCommitment(C);
    expect(settled.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'reversal')).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_earned')).toHaveLength(1);
  });

  it('settlement / appeal / deadline race stays idempotent', async () => {
    const ctx = await funded(1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, NOW);
    const [a, b] = await Promise.all([ctx.settlement.settleCommitment(C), ctx.settlement.settleCommitment(C)]);
    expect(a.completed || b.completed).toBe(true);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(1);
    expect(ctx.db.settlement.rows).toHaveLength(1);
  });
});

describe('Phase 5E — terms, age, production, provider', () => {
  it('rejects payment without matching terms acceptance', async () => {
    const ctx = make();
    await ctx.db.user.create({ data: { id: USER, ageVerificationStatus: 'verified_adult', status: 'active' } });
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 1 });
    await ctx.db.commitmentContract.deleteMany({ where: { commitmentId: C } });
    await expect(ctx.payments.chargeUpfront(USER, C)).rejects.toMatchObject({ code: 'TERMS_REQUIRED' });
  });

  it('keeps an accepted snapshot immutable across policy changes', async () => {
    const ctx = await funded(2);
    const before = await ctx.terms.getAccepted(USER, C);
    expect(before.snapshot.documentVersion).toBe(TERMS_VERSION);
    const mutated = defaultTermsSnapshot('1', 99, '1');
    expect(hashSnapshot(mutated)).not.toBe(before.snapshotHash);
    const again = await ctx.terms.getAccepted(USER, C);
    expect(again.snapshotHash).toBe(before.snapshotHash);
    expect(again.snapshot.occurrenceCount).toBe(2);
    expect(again.snapshot.maxChargeKrw).toBe('10000');
  });

  it('rejects MONEY without verified 19+', async () => {
    const ctx = make({ allowAgeFixture: false, nodeEnv: 'development', moneyEnabled: true });
    await ctx.db.user.create({ data: { id: USER, ageVerificationStatus: 'unknown', status: 'active' } });
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 1 });
    await expect(ctx.moneyGate.assertCanUseMoney(USER)).rejects.toMatchObject({ code: 'AGE_UNVERIFIED' });
    await ctx.db.user.update({ where: { id: USER }, data: { ageVerificationStatus: 'underage' } });
    await expect(ctx.payments.chargeUpfront(USER, C)).rejects.toMatchObject({ code: 'AGE_UNVERIFIED' });
  });

  it('leaves SELF available without age verification', async () => {
    const ctx = make({ allowAgeFixture: false, moneyEnabled: true });
    await ctx.db.user.create({ data: { id: USER, ageVerificationStatus: 'unknown', status: 'active' } });
    await ctx.db.seedSelfCommitment({ id: 's1', userId: USER, count: 1 });
    await expect(ctx.moneyGate.assertCanUseMoney(USER)).rejects.toMatchObject({ code: 'AGE_UNVERIFIED' });
    expect((await ctx.db.commitment.findUnique({ where: { id: 's1' } }))!.status).toBe('active');
  });

  it('fails closed for production MONEY', async () => {
    const ctx = make({ nodeEnv: 'production', moneyEnabled: false, allowAgeFixture: false });
    await ctx.db.user.create({ data: { id: USER, ageVerificationStatus: 'verified_adult', status: 'active' } });
    await expect(ctx.moneyGate.assertCanUseMoney(USER)).rejects.toMatchObject({ code: 'MONEY_DISABLED' });
  });

  it('stores provider and payment method separately', async () => {
    const ctx = await funded(1);
    const pay = ctx.db.payment.rows.find((p) => p.type === 'charge');
    expect(pay).toBeTruthy();
    expect(pay!.provider).toBe('mock');
    expect(pay!.paymentMethod).toBe('CARD');
    expect(pay!.provider).not.toBe(pay!.paymentMethod);
  });

  it('exports an admin accounting summary without claiming PG reconciliation', async () => {
    const ctx = await funded(1);
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail', NOW, new Date(NOW.getTime() + WINDOW * 1000));
    const summary = await ctx.admin.accountingSummary();
    expect(summary.heldDepositsKrw).toBe('5000');
    expect(summary.provisionalFailKrw).toBe('5000');
    expect(summary.finalForfeitKrw).toBe('0');
    expect(summary.reconciledWithBankOrPg).toBe(false);
  });
});
