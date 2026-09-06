import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PaymentService } from '../payments/payment.service';
import { MoneyStatusService } from '../payments/money-status.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettlementService } from '../settlement/settlement.service';

export type MoneyCaseKind = 'refund_delayed' | 'unknown_payment' | 'expired_awaiting_refund';

@Injectable()
export class AdminMoneyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly money: MoneyStatusService,
    private readonly payments: PaymentService,
    private readonly settlement: SettlementService,
    private readonly audit: AuditService,
  ) {}

  async list(kind?: MoneyCaseKind) {
    const kinds = kind ? [kind] : (['refund_delayed', 'unknown_payment', 'expired_awaiting_refund'] as MoneyCaseKind[]);
    const out: Array<Record<string, unknown>> = [];
    for (const k of kinds) {
      const ids = await this.idsFor(k);
      for (const id of ids) {
        const row = await this.inspect(id);
        if (row) out.push({ kind: k, ...row });
      }
    }
    return out;
  }

  async inspect(commitmentId: string) {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      select: {
        id: true, userId: true, title: true, status: true,
        cancellationReason: true, signatureExpiresAt: true, cancelledAt: true,
      },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    const money = await this.money.forCommitment(c.id);
    const payments = await this.prisma.payment.findMany({
      where: { commitmentId: c.id },
      select: { id: true, type: true, status: true, amount: true, attempt: true, failureCode: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      commitmentId: c.id,
      title: c.title,
      status: c.status,
      cancellationReason: c.cancellationReason,
      signatureExpiresAt: c.signatureExpiresAt?.toISOString() ?? null,
      cancelledAt: c.cancelledAt?.toISOString() ?? null,
      money,
      payments: payments.map((p) => ({
        paymentId: p.id,
        type: p.type,
        status: p.status,
        amountKrw: p.amount.toString(),
        attempt: p.attempt,
        failureCode: p.failureCode,
        createdAt: p.createdAt.toISOString(),
      })),
    };
  }

  async retry(commitmentId: string, actorId: string | null) {
    const report = await this.settlement.retryRefund(commitmentId);
    await this.audit.log({
      actorType: 'admin',
      actorId,
      entityType: 'commitment',
      entityId: commitmentId,
      action: 'admin_retry_refund',
      after: { refundStatus: report.refund?.status ?? null },
    });
    return report;
  }

  async reconcile(commitmentId: string, actorId: string | null) {
    const payments = await this.prisma.payment.findMany({
      where: { commitmentId, status: 'requested' },
    });
    const results = [];
    for (const p of payments) {
      results.push(await this.payments.reconcilePayment(p));
    }
    await this.audit.log({
      actorType: 'admin',
      actorId,
      entityType: 'commitment',
      entityId: commitmentId,
      action: 'admin_reconcile',
      after: { checked: results.length },
    });
    return { checked: results.length, payments: results.map((p) => ({ paymentId: p.id, status: p.status, type: p.type })) };
  }

  assertAdmin(_unused?: never): void {
    if (_unused) throw new ForbiddenError();
  }

  private async idsFor(kind: MoneyCaseKind): Promise<string[]> {
    if (kind === 'unknown_payment') {
      const rows = await this.prisma.payment.findMany({
        where: { status: 'requested' },
        select: { commitmentId: true },
      });
      return [...new Set(rows.map((r) => r.commitmentId).filter(Boolean) as string[])];
    }
    if (kind === 'expired_awaiting_refund') {
      const rows = await this.prisma.commitment.findMany({
        where: { status: 'cancelled', cancellationReason: 'signature_expired' },
        include: { stake: true },
      });
      return rows
        .filter((r) => r.stake && (r.stake.status === 'funded' || r.stake.status === 'settling'))
        .map((r) => r.id);
    }
    const rows = await this.prisma.payment.findMany({
      where: { type: 'refund', status: 'failed' },
      select: { commitmentId: true },
    });
    const ids = [...new Set(rows.map((r) => r.commitmentId).filter(Boolean) as string[])];
    const delayed: string[] = [];
    for (const id of ids) {
      const m = await this.money.forCommitment(id);
      if (m?.status === 'refund_delayed') delayed.push(id);
    }
    return delayed;
  }
}
