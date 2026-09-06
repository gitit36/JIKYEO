import { Injectable, Logger, Optional } from '@nestjs/common';
import { Payment, PaymentStatus, Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { LostProviderResponseError, PaymentProvider, PaymentProviderResult, WebhookEvent } from './providers/payment-provider';
import { StakePolicyService } from '../stake-policy/stake-policy.service';
import { MoneyGateService } from '../users/money-gate.service';

export interface PaymentView {
  paymentId: string;
  commitmentId: string | null;
  type: 'charge' | 'refund' | 'cancel';
  status: PaymentStatus;
  amountKrw: string;
  provider: string;
  paymentMethod: string | null;
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

/** Fixed ledger keys — one per commitment (or per appeal occurrence). */
export const ledgerKeys = {
  deposit: (commitmentId: string) => `deposit:${commitmentId}`,
  refundPaid: (commitmentId: string) => `refund_paid:${commitmentId}`,
  refundPaidAppeal: (occurrenceId: string) => `refund_paid:appeal:${occurrenceId}`,
  reversal: (occurrenceId: string) => `reversal:${occurrenceId}`,
};

export function appealOccurrenceFromRefundKey(idempotencyKey: string): string | null {
  const m = /^refund:appeal:([^:]+)/.exec(idempotencyKey);
  return m?.[1] ?? null;
}

/**
 * Owns the Payment lifecycle for MONEY commitments (SRD §5, TRD §10):
 *
 *   charge  → Payment(charge, requested) → PG → succeeded: ledger `deposit`,
 *             Stake pending→funded, Commitment payment_pending→signature_pending.
 *             failed: Payment failed; reservation released; stays payment_pending.
 *             Payment success alone never activates — `/sign` does.
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
    private readonly stakePolicy: StakePolicyService,
    @Optional() private readonly cfg?: AppConfig,
    @Optional() private readonly moneyGate?: MoneyGateService,
  ) {}

  private get signatureExpirySeconds(): number {
    return this.cfg?.signatureExpirySeconds ?? 1_800;
  }

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
    opts: { simulate?: 'charge_fail' | 'charge_lost' } = {},
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
    await this.moneyGate?.assertCanUseMoney(userId);
    const accepted = await this.prisma.commitmentContract.findUnique({ where: { commitmentId } });
    if (!accepted) {
      throw new DomainError('TERMS_REQUIRED', '결제 전에 약관에 동의해주세요.');
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
    if (inFlight) {
      return this.finishCharge(inFlight, userId, c.stake.id, c.stake.maxTotalAmount, c.title, opts.simulate);
    }

    const attempt = (charges[0]?.attempt ?? 0) + 1;
    const amount = c.stake.maxTotalAmount;
    let payment: Payment;
    try {
      payment = await this.prisma.$transaction(async (tx) => {
        await lockUserPayments(tx, userId);
        await this.stakePolicy.assertPaymentFitsCap(userId, c.id, amount, tx);
        return tx.payment.create({
          data: {
            userId,
            stakeId: c.stake!.id,
            commitmentId: c.id,
            provider: this.provider.name,
            paymentMethod: null,
            type: 'charge',
            amount,
            currency: 'KRW',
            status: 'requested',
            attempt,
            idempotencyKey: `charge:${c.id}:${attempt}`,
          },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        const winner = await this.prisma.payment.findUnique({ where: { idempotencyKey: `charge:${c.id}:${attempt}` } });
        if (winner) return this.finishCharge(winner, userId, c.stake.id, amount, c.title, opts.simulate);
      }
      throw e;
    }

    return this.finishCharge(payment, userId, c.stake.id, amount, c.title, opts.simulate);
  }

  /**
   * Drive one charge attempt to a terminal (or still-unknown) outcome.
   * Always reuses `payment.idempotencyKey` so a lost response cannot open a
   * second PG operation.
   */
  private async finishCharge(
    payment: Payment,
    userId: string,
    stakeId: string,
    amount: bigint,
    title: string,
    simulate?: 'charge_fail' | 'charge_lost',
  ): Promise<PaymentView> {
    if (payment.status !== 'requested') return toView(payment);
    let result: PaymentProviderResult;
    try {
      result = await this.provider.charge({
        idempotencyKey: payment.idempotencyKey,
        userId,
        stakeId,
        amount,
        currency: 'KRW',
        description: `JIKYEO 약속금 (${title})`,
        metadata: simulate ? { simulate } : undefined,
      });
    } catch (e) {
      if (e instanceof LostProviderResponseError) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { providerPaymentKey: e.providerPaymentKey },
        });
      }
      this.logger.warn(`charge provider error for ${payment.id}: ${(e as Error).message}`);
      throw new DomainError('PAYMENT_PROVIDER_ERROR', '결제사 연결에 문제가 있어요. 잠시 후 다시 시도해주세요.');
    }

    const updated = await this.applyChargeResult(
      payment.id,
      result.status,
      result.providerPaymentKey,
      result.failureCode ?? null,
      result.paymentMethod ?? 'CARD',
    );
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
    paymentMethod?: string | null,
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
        data: {
          status: 'succeeded',
          providerPaymentKey,
          completedAt: now,
          paymentMethod: paymentMethod ?? payment.paymentMethod ?? 'CARD',
        },
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
      const expiresAt = new Date(now.getTime() + this.signatureExpirySeconds * 1000);
      await tx.commitment.updateMany({
        where: { id: payment.commitmentId, status: 'payment_pending' },
        data: { status: 'signature_pending', signatureExpiresAt: expiresAt },
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
    if (inFlight) {
      return this.finishRefund(inFlight, charge.providerPaymentKey, amount, reason);
    }

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
    return this.finishRefund(payment, charge.providerPaymentKey, amount, reason);
  }

  /**
   * Appeal correction only. Distinct from the one-shot commitment-end aggregate
   * refund. Idempotent per occurrence (`refund:appeal:<occurrenceId>:*`).
   * Cumulative successful `refund_paid` can never exceed the deposit.
   */
  async refundSupplemental(
    commitmentId: string,
    occurrenceId: string,
    amount: bigint,
    reason: string,
  ): Promise<PaymentView> {
    if (amount <= 0n) throw new DomainError('VALIDATION', 'refund amount must be positive');
    const totals = await this.ledger.totalsForCommitment(commitmentId);
    if (totals.refundPaid + amount > totals.deposit) {
      throw new DomainError('VALIDATION', '환불 금액이 결제액을 넘을 수 없어요.');
    }
    const charge = await this.prisma.payment.findFirst({
      where: { commitmentId, type: 'charge', status: 'succeeded' },
    });
    if (!charge || !charge.providerPaymentKey) {
      throw new DomainError('SETTLEMENT_NOT_READY', 'No successful charge to refund against');
    }
    const prefix = `refund:appeal:${occurrenceId}`;
    const refunds = await this.prisma.payment.findMany({
      where: { commitmentId, type: 'refund', idempotencyKey: { startsWith: prefix } },
      orderBy: { attempt: 'desc' },
    });
    const done = refunds.find((p) => p.status === 'succeeded');
    if (done) return toView(done);
    const inFlight = refunds.find((p) => p.status === 'requested');
    if (inFlight) {
      return this.finishRefund(inFlight, charge.providerPaymentKey, amount, reason);
    }

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
        idempotencyKey: `${prefix}:${attempt}`,
      },
    });
    return this.finishRefund(payment, charge.providerPaymentKey, amount, reason);
  }

  /** Retry every reversal that still lacks `refund_paid:appeal:<occ>`. */
  async refundUnpaidAppealSupplements(commitmentId: string): Promise<PaymentView | null> {
    const reversals = await this.prisma.paymentLedger.findMany({
      where: { commitmentId, entryType: 'reversal' },
    });
    let last: PaymentView | null = null;
    for (const r of reversals) {
      if (!r.occurrenceId) continue;
      const paid = await this.prisma.paymentLedger.findUnique({
        where: { idempotencyKey: ledgerKeys.refundPaidAppeal(r.occurrenceId) },
      });
      if (paid) continue;
      last = await this.refundSupplemental(
        commitmentId,
        r.occurrenceId,
        r.amount,
        `appeal_supplemental:${r.occurrenceId}`,
      );
    }
    return last;
  }

  private async finishRefund(
    payment: Payment,
    providerPaymentKey: string,
    amount: bigint,
    reason: string,
  ): Promise<PaymentView> {
    if (payment.status !== 'requested') return toView(payment);
    let result: PaymentProviderResult;
    try {
      result = await this.provider.refund({
        idempotencyKey: payment.idempotencyKey,
        providerPaymentKey,
        amount,
        reason,
      });
    } catch (e) {
      if (e instanceof LostProviderResponseError) {
        await this.prisma.payment.update({
          where: { id: payment.id },
          data: { providerPaymentKey: e.providerPaymentKey },
        });
      }
      this.logger.warn(`refund provider error for ${payment.id}: ${(e as Error).message}`);
      return toView({ ...payment, providerPaymentKey: (e as LostProviderResponseError).providerPaymentKey ?? payment.providerPaymentKey });
    }
    return toView(await this.applyRefundResult(payment.id, result.status, result.failureCode ?? null));
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
      const appealOcc = appealOccurrenceFromRefundKey(payment.idempotencyKey);
      await this.ledger.append(
        {
          userId: payment.userId,
          commitmentId: payment.commitmentId,
          occurrenceId: appealOcc,
          paymentId: payment.id,
          entryType: 'refund_paid',
          amount: payment.amount,
          idempotencyKey: appealOcc
            ? ledgerKeys.refundPaidAppeal(appealOcc)
            : ledgerKeys.refundPaid(payment.commitmentId),
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
  async reconcilePayment(payment: Payment): Promise<Payment> {
    if (payment.status !== 'requested') return payment;
    const key = payment.providerPaymentKey;
    if (!key) return payment;
    const status = await this.provider.getStatus(key);
    return payment.type === 'charge'
      ? this.applyChargeResult(payment.id, status.status, status.providerPaymentKey, status.failureCode ?? null)
      : this.applyRefundResult(payment.id, status.status, status.failureCode ?? null);
  }

  async reconcileStale(olderThanMs = 5 * 60_000): Promise<{ checked: number; resolved: number }> {
    const cutoff = new Date(this.clock.now().getTime() - olderThanMs);
    const stale = await this.prisma.payment.findMany({
      where: { status: 'requested', createdAt: { lt: cutoff } },
    });
    let resolved = 0;
    for (const p of stale) {
      const after = await this.reconcilePayment(p);
      if (after.status !== 'requested') resolved += 1;
    }
    return { checked: stale.length, resolved };
  }
}

/** Serialise cap-check + reservation insert per user (PG advisory lock). */
async function lockUserPayments(tx: { $executeRaw?: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> }, userId: string): Promise<void> {
  if (typeof tx.$executeRaw !== 'function') return;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${userId})::bigint)`;
  } catch {
    // In-memory test DB has no advisory locks; $transaction serialisation covers it.
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
    paymentMethod: p.paymentMethod ?? null,
    failureCode: p.failureCode,
    attempt: p.attempt,
    createdAt: p.createdAt.toISOString(),
    completedAt: p.completedAt?.toISOString() ?? null,
  };
}
