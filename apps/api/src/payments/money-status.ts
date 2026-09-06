import { CommitmentStatus, PaymentStatus, PaymentType, StakeStatus } from '@prisma/client';

/**
 * User-facing money state of a MONEY commitment. Derived — never stored —
 * from Commitment/Stake/Payment rows so the UI can never drift from the
 * ledger. SELF/SOCIAL commitments have no money status (`null`).
 *
 *   payment_pending     결제 중        upfront charge requested, not confirmed
 *   payment_failed      결제 실패      last charge attempt failed; retry allowed
 *   funded              약속금 걸림    charged; commitment live
 *   refund_scheduled    환불 예정      commitment ended, settlement computed, refund not sent yet
 *   refund_in_progress  환불 중        refund requested at PG, awaiting confirmation
 *   refund_delayed      환불 지연      refund attempt failed; will be retried
 *   refunded            환불 완료      aggregate refund confirmed
 *   settled_no_refund   정산 완료      everything forfeited; nothing to refund
 */
export type MoneyStatus =
  | 'payment_pending'
  | 'payment_failed'
  | 'funded'
  | 'refund_scheduled'
  | 'refund_in_progress'
  | 'refund_delayed'
  | 'refunded'
  | 'settled_no_refund';

export interface MoneyStatusInput {
  commitmentStatus: CommitmentStatus;
  stakeStatus: StakeStatus | null;
  payments: Array<{ type: PaymentType; status: PaymentStatus; createdAt: Date }>;
  /** Ledger-derived. */
  refundableRemaining: bigint;
}

export function deriveMoneyStatus(input: MoneyStatusInput): MoneyStatus | null {
  if (input.stakeStatus === null) return null;
  const latest = (type: PaymentType) =>
    input.payments
      .filter((p) => p.type === type)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;

  switch (input.stakeStatus) {
    case 'pending': {
      const charge = latest('charge');
      if (charge?.status === 'failed') return 'payment_failed';
      return 'payment_pending';
    }
    case 'funded':
      return 'funded';
    case 'settling': {
      const refund = latest('refund');
      if (!refund) return 'refund_scheduled';
      if (refund.status === 'requested') return 'refund_in_progress';
      if (refund.status === 'failed') return 'refund_delayed';
      return 'refund_in_progress';
    }
    case 'settled': {
      const refund = latest('refund');
      if (input.refundableRemaining > 0n && refund?.status === 'failed') return 'refund_delayed';
      if (input.refundableRemaining > 0n && refund?.status === 'requested') return 'refund_in_progress';
      return input.refundableRemaining > 0n ? 'refund_scheduled' : 'settled_no_refund';
    }
    case 'refunded': {
      const refund = latest('refund');
      if (input.refundableRemaining > 0n && refund?.status === 'failed') return 'refund_delayed';
      if (input.refundableRemaining > 0n && refund?.status === 'requested') return 'refund_in_progress';
      return 'refunded';
    }
    default:
      return null;
  }
}

export const MONEY_STATUS_LABEL_KO: Record<MoneyStatus, string> = {
  payment_pending: '결제 중',
  payment_failed: '결제 실패',
  funded: '약속금 걸림',
  refund_scheduled: '환불 예정',
  refund_in_progress: '환불 중',
  refund_delayed: '환불 지연',
  refunded: '환불 완료',
  settled_no_refund: '정산 완료',
};
