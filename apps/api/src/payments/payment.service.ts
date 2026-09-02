import { Injectable, Logger } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { PaymentProvider, PaymentProviderResult, WebhookEvent } from './providers/payment-provider';

export interface PaymentView {
  paymentId: string;
  commitmentId: string | null;
  type: 'charge' | 'refund' | 'cancel';
  status: PaymentStatus;
  amountKrw: string;
  provider: string;
  failureCode: string | null;
  attempt: number;
  createdAt: string;
  completedAt: string | null;
}

export interface WebhookOutcome {
  deduped: boolean;
  outcome: 'applied' | 'ignored' | 'unmatched' | 'duplicate';
  paymentId: string | null;
}

/** Fixed ledger keys — one per commitment, so retries can never double-post. */
export const ledgerKeys = {
  deposit: (commitmentId: string) => `deposit:${commitmentId}`,
  refundPaid: (commitmentId: string) => `refund_paid:${commitmentId}`,
};

/**
 * Owns the Payment lifecycle for MONEY commitments (SRD §5, TRD §10):
 *
 *   charge  → Payment(charge, requested) → PG → succeeded: ledger `deposit`,
 *             Stake pending→funded, Commitment payment_pending→active.
 *             failed: Payment failed; Commitment stays payment_pending.
 *   refund  → Payment(refund, requested) → PG → succeeded: ledger `refund_paid`,
 *             Stake settling→refunded. failed: Payment failed (retryable).
 *   webhook → verified, deduped on (provider, eventId), then applied through
 *             the exact same idempotent transitions as the synchronous path.
 *
 * Money only ever changes via LedgerService; this service never writes
 * balances. All transitions are conditional `updateMany` so a duplicate
 * (sync + webhook, or two webhooks) is a no-op.
 *
 * SELF/SOCIAL commitments never reach this service: `chargeUpfront` rejects
 * them with PAYMENT_NOT_REQUIRED and no Payment/Stake row is created.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: PaymentProvider,
    private readonly ledger: LedgerService,
    private readonly clock: Clock,
  ) {}

  // ---------------------------------------------------------------- charge

  /**
   * Charge the server-authoritative max-loss amount for a payment_pending
   * MONEY commitment. Idempotent per commitment: a second call while a charge
   * is in flight or already succeeded returns that payment without touching
   * the PG again. A failed attempt may be retried (new attempt number).
   */
  async chargeUpfront(
    userId: string,
    commitmentId: string,
    opts: { simulate?: 'charge_fail' } = {},
  ): Promise<PaymentView> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    if (c.enforcementMode !== 'money' || !c.stake) {
      throw new DomainError('PAYMENT_NOT_REQUIRED', '이 약속에는 결제가 필요하지 않아요.');
    }
    if (c.status === 'cancelled') {
      throw new DomainError('INVALID_STATE_TRANSITION', '취소된 약속에는 결제할 수 없어요.');
    }

    const charges = await this.prisma.payment.findMany({
      where: { stakeId: c.stake.id, type: 'charge' },
      orderBy: { attempt: 'desc' },
    });
    const done = charges.find((p) => p.status === 'succeeded');
    if (done || c.stake.status !== 'pending') {
      // Already funded — never charge twice.
      if (done) return toView(done);
      throw new DomainError('PAYMENT_ALREADY_COMPLETED', '이미 결제가 완료된 약속이에요.');
    }
    const inFlight = charges.find((p) => p.status === 'requested');
    if (inFlight) return toView(inFlight);

    const attempt = (charges[0]?.attempt ?? 0) + 1;
    const amount = c.stake.maxTotalAmount;
    let payment: Payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          userId,
          stakeId: c.stake.id,
          commitmentId: c.id,
          provider: this.provider.name,
          type: 'charge',
          amount,
          currency: 'KRW',
          status: 'requested',
          attempt,
          idempotencyKey: `charge:${c.id}:${attempt}`,
        },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        // A concurrent request created this attempt first. Return it instead
        // of charging again — the PG is called at most once per attempt.
        const winner = await this.prisma.payment.findUnique({ where: { idempotencyKey: `charge:${c.id}:${attempt}` } });
        if (winner) return toView(winner);
      }
      throw e;
    }

    let result: PaymentProviderResult;
    try {
      result = await this.provider.charge({
        idempotencyKey: payment.idempotencyKey,
        userId,
        stakeId: c.stake.id,
        amount,
        currency: 'KRW',
        description: `JIKYEO 약속금 (${c.title})`,
        metadata: opts.simulate ? { simulate: opts.simulate } : undefined,
      });
    } catch (e) {
      // Provider unreachable: leave the payment `requested` so a webhook or
      // reconciliation can finish it. The commitment stays payment_pending.
      this.logger.warn(`charge provider error for ${payment.id}: ${(e as Error).message}`);
      throw new DomainError('PAYMENT_PROVIDER_ERROR', '결제사 연결에 문제가 있어요. 잠시 후 다시 시도해주세요.');
    }

    const updated = await this.applyChargeResult(payment.id, result.status, result.providerPaymentKey, result.failureCode ?? null);
    if (updated.status === 'failed') {
      throw new DomainError('PAYMENT_FAILED', '결제가 완료되지 않았어요. 다시 시도해주세요.', {
        paymentId: updated.id,
        failureCode: updated.failureCode,
      });
    }
    return toView(updated);
  }

  /**
   * Idempotent application of a charge outcome. Called by the synchronous
   * path AND by webhooks — whichever arrives second is a no-op.
   */
  async applyChargeResult(
    paymentId: string,
    status: PaymentProviderResult['status'],
    providerPaymentKey: string | null,
    failureCode: string | null,
  ): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundError('Payment not found');
      if (payment.status !== 'requested') return payment; // already final
      if (status === 'requested') return payment;
      if (!payment.stakeId || !payment.commitmentId) return payment;

      if (status === 'failed') {
        return tx.payment.update({
          where: { id: paymentId },
          data: { status: 'failed', failureCode, providerPaymentKey, completedAt: this.clock.now() },
        });
      }

      // succeeded (a charge cannot be 'partial').
      const now = this.clock.now();
      const funded = await tx.stake.updateMany({
        where: { id: payment.stakeId, status: 'pending' },
        data: { status: 'funded', fundedAt: now },
      });
      if (funded.count === 0) {
        // Someone else funded this stake first (e.g. a parallel attempt). Do
        // NOT post a second deposit; flag for reconciliation instead.
        this.logger.error(`duplicate successful charge detected for stake ${payment.stakeId}, payment ${paymentId}`);
        return tx.payment.update({
          where: { id: paymentId },
          data: { status: 'failed', failureCode: 'DUPLICATE_CHARGE_NEEDS_RECONCILIATION', providerPaymentKey, completedAt: now },
        });
      }
      const saved = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'succeeded', providerPaymentKey, completedAt: now },
      });
      await this.ledger.append(
        {
          userId: payment.userId,
          commitmentId: payment.commitmentId,
          paymentId: payment.id,
          entryType: 'deposit',
          amount: payment.amount,
          idempotencyKey: ledgerKeys.deposit(payment.commitmentId),
        },
        tx,
      );
      await tx.commitment.updateMany({
        where: { id: payment.commitmentId, status: 'payment_pending' },
        data: { status: 'active' },
      });
      return saved;
    });
  }

  // ---------------------------------------------------------------- refund

  /**
   * Request the aggregate refund for a commitment (called by SettlementService
   * once the commitment has closed). Idempotent: an in-flight or succeeded
   * refund is returned as-is; a failed one is retried with a new attempt.
   * The ledger `refund_paid` key is fixed per commitment, so even if the PG
   * confirmed twice we would post once.
   */
  async refundAggregate(commitmentId: string, amount: bigint, reason: string): Promise<PaymentView> {
    if (amount <= 0n) throw new DomainError('VALIDATION', 'refund amount must be positive');
    const charge = await this.prisma.payment.findFirst({
      where: { commitmentId, type: 'charge', status: 'succeeded' },
    });
    if (!charge || !charge.providerPaymentKey) {
      throw new DomainError('SETTLEMENT_NOT_READY', 'No successful charge to refund against');
    }
    const refunds = await this.prisma.payment.findMany({
      where: { commitmentId, type: 'refund' },
      orderBy: { attempt: 'desc' },
    });
    const done = refunds.find((p) => p.status === 'succeeded');
    if (done) return toView(done);
    const inFlight = refunds.find((p) => p.status === 'requested');
    if (inFlight) return toView(inFlight);

    const attempt = (refunds[0]?.attempt ?? 0) + 1;
    const payment = await this.prisma.payment.create({
      data: {
        userId: charge.userId,
        stakeId: charge.stakeId,
        commitmentId,
        provider: this.provider.name,
        type: 'refund',
        amount,
        currency: 'KRW',
        status: 'requested',
        attempt,
        idempotencyKey: `refund:${commitmentId}:${attempt}`,
      },
    });

    let result: PaymentProviderResult;
    try {
      result = await this.provider.refund({
        idempotencyKey: payment.idempotencyKey,
        providerPaymentKey: charge.providerPaymentKey,
        amount,
        reason,
      });
    } catch (e) {
      this.logger.warn(`refund provider error for ${payment.id}: ${(e as Error).message}`);
      // Leave `requested`; webhook/reconciliation resolves it. Status shows 환불 중.
      return toView(payment);
    }
    const updated = await this.applyRefundResult(payment.id, result.status, result.failureCode ?? null);
    return toView(updated);
  }

  async applyRefundResult(
    paymentId: string,
    status: PaymentProviderResult['status'],
    failureCode: string | null,
  ): Promise<Payment> {
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id: paymentId } });
      if (!payment) throw new NotFoundError('Payment not found');
      if (payment.status !== 'requested') return payment;
      if (status === 'requested') return payment;
      if (!payment.stakeId || !payment.commitmentId) return payment;
      const now = this.clock.now();

      if (status === 'failed') {
        return tx.payment.update({
          where: { id: paymentId },
          data: { status: 'failed', failureCode, completedAt: now },
        });
      }

      const saved = await tx.payment.update({
        where: { id: paymentId },
        data: { status: 'succeeded', completedAt: now },
      });
      await this.ledger.append(
        {
          userId: payment.userId,
          commitmentId: payment.commitmentId,
          paymentId: payment.id,
          entryType: 'refund_paid',
          amount: payment.amount,
          idempotencyKey: ledgerKeys.refundPaid(payment.commitmentId),
        },
        tx,
      );
      await tx.stake.updateMany({
        where: { id: payment.stakeId, status: { in: ['settling', 'settled'] } },
        data: { status: 'refunded', refundedAt: now },
      });
      return saved;
    });
  }

  // --------------------------------------------------------------- webhook

  /**
   * Verify, dedupe, and apply an inbound PG webhook. A redelivered event
   * (same provider + eventId) is recorded as a duplicate and does nothing.
   * Unknown payment keys are stored for reconciliation but not applied.
   */
  async handleWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): Promise<WebhookOutcome> {
    let event: WebhookEvent;
    try {
      event = await this.provider.verifyWebhook(rawBody, headers);
    } catch (e) {
      throw new DomainError('WEBHOOK_INVALID', (e as Error).message);
    }

    let row: { id: string };
    try {
      row = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: this.provider.name,
          eventId: event.eventId,
          providerPaymentKey: event.providerPaymentKey,
          eventType: event.type,
          eventStatus: event.status,
          amount: event.amount,
          payloadJson: (event.raw ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return { deduped: true, outcome: 'duplicate', paymentId: null };
      }
      throw e;
    }

    const payment = await this.matchPayment(event);
    let outcome: WebhookOutcome['outcome'] = 'unmatched';
    if (payment) {
      if (event.type === 'charge') {
        const before = payment.status;
        const after = await this.applyChargeResult(payment.id, event.status, event.providerPaymentKey, null);
        outcome = before !== after.status ? 'applied' : 'ignored';
      } else {
        const before = payment.status;
        const after = await this.applyRefundResult(payment.id, event.status, null);
        outcome = before !== after.status ? 'applied' : 'ignored';
      }
    }
    await this.prisma.paymentWebhookEvent.update({
      where: { id: row.id },
      data: { paymentId: payment?.id ?? null, processedAt: this.clock.now(), outcome },
    });
    return { deduped: false, outcome, paymentId: payment?.id ?? null };
  }

  private async matchPayment(event: WebhookEvent): Promise<Payment | null> {
    if (event.type === 'charge') {
      return this.prisma.payment.findFirst({
        where: { providerPaymentKey: event.providerPaymentKey, type: 'charge' },
        orderBy: { createdAt: 'desc' },
      });
    }
    // Refund/cancel webhooks reference the ORIGINAL charge key. Match the
    // most recent in-flight refund for that commitment.
    const charge = await this.prisma.payment.findFirst({
      where: { providerPaymentKey: event.providerPaymentKey, type: 'charge' },
    });
    if (!charge?.commitmentId) return null;
    return this.prisma.payment.findFirst({
      where: { commitmentId: charge.commitmentId, type: { in: ['refund', 'cancel'] }, status: 'requested' },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ---------------------------------------------------------------- reads

  async getOwned(userId: string, paymentId: string): Promise<PaymentView> {
    const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
    if (!p) throw new NotFoundError('Payment not found');
    if (p.userId !== userId) throw new ForbiddenError();
    return toView(p);
  }

  async listForCommitment(commitmentId: string): Promise<Payment[]> {
    return this.prisma.payment.findMany({ where: { commitmentId }, orderBy: { createdAt: 'asc' } });
  }

  async findSucceededRefund(commitmentId: string): Promise<PaymentView | null> {
    const p = await this.prisma.payment.findFirst({
      where: { commitmentId, type: 'refund', status: 'succeeded' },
      orderBy: { createdAt: 'desc' },
    });
    return p ? toView(p) : null;
  }

  /**
   * Reconciliation hook: re-query the PG for every `requested` payment older
   * than `olderThanMs` and apply the authoritative status. Safe to run
   * repeatedly; every application is idempotent.
   */
  async reconcileStale(olderThanMs = 5 * 60_000): Promise<{ checked: number; resolved: number }> {
    const cutoff = new Date(this.clock.now().getTime() - olderThanMs);
    const stale = await this.prisma.payment.findMany({
      where: { status: 'requested', createdAt: { lt: cutoff }, providerPaymentKey: { not: null } },
    });
    let resolved = 0;
    for (const p of stale) {
      const status = await this.provider.getStatus(p.providerPaymentKey!);
      const after = p.type === 'charge'
        ? await this.applyChargeResult(p.id, status.status, status.providerPaymentKey, status.failureCode ?? null)
        : await this.applyRefundResult(p.id, status.status, status.failureCode ?? null);
      if (after.status !== 'requested') resolved += 1;
    }
    return { checked: stale.length, resolved };
  }
}

export function toView(p: Payment): PaymentView {
  return {
    paymentId: p.id,
    commitmentId: p.commitmentId,
    type: p.type,
    status: p.status,
    amountKrw: p.amount.toString(),
    provider: p.provider,
    failureCode: p.failureCode,
    attempt: p.attempt,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
  };
}
