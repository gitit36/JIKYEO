import { FrozenClock } from '../common/clock/clock';
import { AdminGuard } from '../admin/admin.guard';
import { AdminMoneyService } from '../admin/admin-money.service';
import { AuditService } from '../audit/audit.service';
import { CommitmentService } from '../commitments/commitment.service';
import { LedgerService } from '../payments/ledger.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PaymentService } from '../payments/payment.service';
import { MockPaymentProvider } from '../payments/providers/mock-payment-provider';
import { InMemoryMoneyDb } from '../payments/testing/in-memory-money-db';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from '../stake-policy/stake-policy.service';
import { SettlementService } from '../settlement/settlement.service';
import { InternalJobGuard } from './internal-job.guard';
import { JobLeaseService } from './job-lease.service';
import { MoneyMaintenanceService } from './money-maintenance.service';

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
  const payments = new PaymentService(prisma, provider, ledger, clock, policy, { signatureExpirySeconds: 1800 } as any);
  const cfg = { nodeEnv: 'test', signatureExpirySeconds: 1800 } as any;
  const settlement = new SettlementService(prisma, ledger, payments, clock, cfg);
  const money = new MoneyStatusService(prisma, ledger);
  const audit = new AuditService(prisma);
  const commitments = new CommitmentService(
    prisma, {} as any, {} as any, {} as any, users, policy, clock, audit, money, payments, cfg,
  );
  const lease = new JobLeaseService(prisma, clock);
  const maintenance = new MoneyMaintenanceService(lease, commitments, settlement, payments, cfg);
  const admin = new AdminMoneyService(prisma, money, payments, settlement, audit, clock);
  return { db, clock, provider, ledger, payments, settlement, money, policy, commitments, lease, maintenance, admin };
}

async function funded(ctx = make()) {
  await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
  await ctx.payments.chargeUpfront(USER, C);
  return ctx;
}

describe('Phase 5A — unsigned cancel / expiry', () => {
  it('cancel before charge → no PG call and no ledger', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.status).toBe('cancelled');
    expect(r.cancellationReason).toBe('user_cancelled');
    expect(r.refund).toBeNull();
    expect(ctx.provider.calls.charge).toBe(0);
    expect(ctx.provider.calls.refund).toBe(0);
    expect(ctx.db.paymentLedger.rows).toHaveLength(0);
    expect((await ctx.db.commitment.findUnique({ where: { id: C } }))!.status).toBe('cancelled');
  });

  it('cancel after funding → one full refund, no forfeit/refund_earned', async () => {
    const ctx = await funded();
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.status).toBe('cancelled');
    expect(r.refund).toMatchObject({ status: 'succeeded', amountKrw: '15000' });
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit' || x.entryType === 'refund_earned')).toHaveLength(0);
    expect((await ctx.db.stake.findUnique({ where: { commitmentId: C } }))!.status).toBe('refunded');
    expect((await ctx.money.forCommitment(C))!.status).toBe('refunded');
  });

  it('automatic expiry → one full refund via the same path', async () => {
    const ctx = await funded();
    await ctx.db.commitment.update({
      where: { id: C },
      data: { signatureExpiresAt: new Date(NOW.getTime() - 1) },
    });
    const { expired } = await ctx.commitments.expireOverdue();
    expect(expired).toBe(1);
    const c = await ctx.db.commitment.findUnique({ where: { id: C } });
    expect(c!.status).toBe('cancelled');
    expect(c!.cancellationReason).toBe('signature_expired');
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid').map((x) => x.amount)).toEqual([15_000n]);
  });

  it('repeated cancel/sweep → no duplicate refund', async () => {
    const ctx = await funded();
    await ctx.commitments.cancel(USER, C);
    const again = await ctx.commitments.cancel(USER, C);
    expect(again.idempotent).toBe(true);
    await ctx.maintenance.run();
    await ctx.maintenance.run();
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.payment.rows.filter((p) => p.type === 'refund')).toHaveLength(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
  });

  it('sign versus expiry race → exactly one winner', async () => {
    const ctx = await funded();
    const [a, b] = await Promise.allSettled([
      ctx.commitments.sign(USER, C),
      ctx.commitments.cancelUnsigned({
        commitmentId: C, actorType: 'system', actorId: null, reason: 'signature_expired',
      }),
    ]);
    const signed = a.status === 'fulfilled' || b.status === 'fulfilled' && (b as PromiseFulfilledResult<any>).value.status === 'active'
      ? [a, b].find((x) => x.status === 'fulfilled' && (x as PromiseFulfilledResult<any>).value.status === 'active')
      : null;
    const cancelled = [a, b].find((x) => x.status === 'fulfilled' && (x as PromiseFulfilledResult<any>).value.status === 'cancelled');
    const winners = [signed, cancelled].filter(Boolean);
    expect(winners).toHaveLength(1);
    const c = await ctx.db.commitment.findUnique({ where: { id: C } });
    expect(['active', 'cancelled']).toContain(c!.status);
    if (c!.status === 'active') {
      expect(c!.signatureCompleted).toBe(true);
      expect(ctx.provider.calls.refund).toBe(0);
    } else {
      expect(c!.cancellationReason).toBe('signature_expired');
      expect(ctx.provider.calls.refund).toBe(1);
    }
  });

  it('unknown charge + cancel reconciles then refunds exactly once', async () => {
    const ctx = make();
    await ctx.db.seedMoneyCommitment({ id: C, userId: USER, perOccurrence: 5_000n, count: 3 });
    await expect(ctx.payments.chargeUpfront(USER, C, { simulate: 'charge_lost' })).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_ERROR',
    });
    const r = await ctx.commitments.cancel(USER, C);
    expect(r.status).toBe('cancelled');
    expect(r.refund).toMatchObject({ status: 'succeeded', amountKrw: '15000' });
    expect(ctx.provider.calls.charge).toBe(1);
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'deposit')).toHaveLength(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
  });

  it('failed unsigned refund remains retryable', async () => {
    const ctx = await funded();
    ctx.provider.failNextRefund = true;
    const first = await ctx.commitments.cancel(USER, C);
    expect(first.refund).toMatchObject({ status: 'failed' });
    expect((await ctx.money.forCommitment(C))!.status).toBe('refund_delayed');
    const second = await ctx.settlement.retryRefund(C);
    expect(second.refund).toMatchObject({ status: 'succeeded', amountKrw: '15000' });
    expect((await ctx.money.forCommitment(C))!.status).toBe('refunded');
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
  });

  it('cap reservation releases only after refund success', async () => {
    const ctx = await funded();
    const policy = ctx.policy;
    expect((await policy.rollingExposure(USER)).reservedKrw).toBe(15_000);
    ctx.provider.failNextRefund = true;
    await ctx.commitments.cancel(USER, C);
    expect((await policy.rollingExposure(USER)).reservedKrw).toBe(15_000);
    await ctx.settlement.retryRefund(C);
    expect((await policy.rollingExposure(USER)).reservedKrw).toBe(0);
    expect((await policy.rollingExposure(USER)).realizedForfeitKrw).toBe(0);
  });

  it('completed cannot be newly cancelled', async () => {
    const ctx = await funded();
    await ctx.commitments.sign(USER, C);
    await ctx.db.commitment.update({ where: { id: C }, data: { status: 'completed' } });
    await expect(ctx.commitments.cancel(USER, C)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
  });

  it('cancelled commitments never activate and do not settle occurrences', async () => {
    const ctx = await funded();
    await ctx.commitments.cancel(USER, C);
    await expect(ctx.commitments.sign(USER, C)).rejects.toMatchObject({ code: 'INVALID_STATE_TRANSITION' });
    await ctx.db.setOccurrenceStatus(`${C}_o1`, 'fail');
    const report = await ctx.settlement.settleCommitment(C);
    expect(report.skipped).toBe('not_active');
    expect(ctx.db.settlement.rows).toHaveLength(0);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'forfeit')).toHaveLength(0);
  });
});

describe('Phase 5A — maintenance + admin auth', () => {
  it('overlapping maintenance runs remain idempotent', async () => {
    const ctx = await funded();
    await ctx.db.commitment.update({
      where: { id: C },
      data: { signatureExpiresAt: new Date(NOW.getTime() - 1) },
    });
    const [a, b] = await Promise.all([ctx.maintenance.run(), ctx.maintenance.run()]);
    expect([a.skipped, b.skipped].filter(Boolean).length).toBeGreaterThanOrEqual(0);
    expect(a.skipped !== b.skipped || a.expired + b.expired >= 1).toBe(true);
    expect(ctx.provider.calls.refund).toBe(1);
    expect(ctx.db.paymentLedger.rows.filter((x) => x.entryType === 'refund_paid')).toHaveLength(1);
    const c = await ctx.db.commitment.findUnique({ where: { id: C } });
    expect(c!.status).toBe('cancelled');
  });

  it('non-admin and cross-user ops access denied', async () => {
    const ctx = await funded();
    await expect(ctx.commitments.cancel('u2', C)).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const adminCfg = {
      adminApiSecret: 'adm-secret',
      internalJobSecret: 'job-secret',
    } as any;
    const adminGuard = new AdminGuard(adminCfg);
    const jobGuard = new InternalJobGuard(adminCfg);
    const deny = {
      switchToHttp: () => ({
        getRequest: () => ({ headers: { authorization: 'Bearer user-jwt' } }),
      }),
    } as any;
    expect(() => adminGuard.canActivate(deny)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => jobGuard.canActivate(deny)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));

    const allowAdmin = {
      switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-admin-secret': 'adm-secret' } }) }),
    } as any;
    expect(adminGuard.canActivate(allowAdmin)).toBe(true);
  });

  it('admin list includes refund_delayed without provider secrets', async () => {
    const ctx = await funded();
    ctx.provider.failNextRefund = true;
    await ctx.commitments.cancel(USER, C);
    const rows = await ctx.admin.list('refund_delayed');
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toMatch(/providerPaymentKey|secret|mockpg-/);
    expect(rows[0].commitmentId).toBe(C);
  });
});
