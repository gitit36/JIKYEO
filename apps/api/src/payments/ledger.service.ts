import { Injectable } from '@nestjs/common';
import { LedgerEntryType, PaymentLedger, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface LedgerEntryInput {
  userId: string;
  commitmentId: string;
  occurrenceId?: string | null;
  paymentId?: string | null;
  entryType: LedgerEntryType;
  amount: bigint;
  /** Required. Prevents duplicate posts. */
  idempotencyKey: string;
}

export interface LedgerTotals {
  deposit: bigint;
  refundEarned: bigint;
  refundPaid: bigint;
  forfeit: bigint;
  reversal: bigint;
}

/**
 * Append-only money ledger.
 *
 * Rules:
 * - The only way money changes is by calling `LedgerService.append(...)`.
 * - Every entry has an `idempotencyKey` — duplicates return the existing row.
 * - The service accepts a Prisma tx client so callers can atomically post
 *   ledger entries together with state transitions.
 *
 * Sign convention:
 *   deposit         : + user deposited (charge)
 *   refund_earned   : + occurrence PASSed, amount is now claimable by the user
 *   refund_paid     : + amount actually refunded to the user by the PG
 *   forfeit         : + occurrence FAILed, amount is retained by the platform
 *   reversal        : + when a FAIL is later overturned (appeal approved),
 *                       the previously-forfeited amount becomes refund_earned again
 *
 * Invariant at end-of-commitment:
 *   totals.deposit == totals.forfeit + totals.refundPaid
 *   (0 ≤ refundPaid ≤ deposit − forfeit + reversal)
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async append(input: LedgerEntryInput, tx?: Prisma.TransactionClient): Promise<PaymentLedger> {
    const db = tx ?? this.prisma;
    const existing = await db.paymentLedger.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (existing) return existing;

    return db.paymentLedger.create({
      data: {
        userId: input.userId,
        commitmentId: input.commitmentId,
        occurrenceId: input.occurrenceId ?? null,
        paymentId: input.paymentId ?? null,
        entryType: input.entryType,
        amount: input.amount,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  async totalsForCommitment(commitmentId: string, tx?: Prisma.TransactionClient): Promise<LedgerTotals> {
    const db = tx ?? this.prisma;
    const rows = await db.paymentLedger.findMany({
      where: { commitmentId },
      select: { entryType: true, amount: true },
    });
    const totals: LedgerTotals = {
      deposit: 0n,
      refundEarned: 0n,
      refundPaid: 0n,
      forfeit: 0n,
      reversal: 0n,
    };
    for (const r of rows) {
      switch (r.entryType) {
        case 'deposit':
          totals.deposit += r.amount;
          break;
        case 'refund_earned':
          totals.refundEarned += r.amount;
          break;
        case 'refund_paid':
          totals.refundPaid += r.amount;
          break;
        case 'forfeit':
          totals.forfeit += r.amount;
          break;
        case 'reversal':
          totals.reversal += r.amount;
          break;
      }
    }
    return totals;
  }

  /**
   * The amount that is currently earmarked to be refunded but has not yet been
   * paid out by the PG. Used by the settlement worker to know how much to send.
   */
  refundableRemaining(totals: LedgerTotals): bigint {
    const earned = totals.refundEarned + totals.reversal;
    const paid = totals.refundPaid;
    return earned - paid > 0n ? earned - paid : 0n;
  }

  /**
   * Sanity check invariant used by tests and reconciliation.
   * Returns `true` when the ledger is internally consistent for a *closed*
   * commitment (all settlements done, all refunds paid).
   */
  isBalanced(totals: LedgerTotals): boolean {
    return totals.deposit === totals.forfeit + totals.refundPaid;
  }
}
