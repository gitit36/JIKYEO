import { Injectable } from '@nestjs/common';
import { ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { deriveMoneyStatus, MONEY_STATUS_LABEL_KO, MoneyStatus } from './money-status';

export interface MoneyView {
  status: MoneyStatus;
  label: string;
  perOccurrenceKrw: string;
  upfrontKrw: string;
  /** Ledger-derived. Accrued from PASS/VOID occurrences settled so far. */
  refundableKrw: string;
  /** Ledger-derived. Accrued from FAIL occurrences settled so far. */
  forfeitedKrw: string;
  refundPaidKrw: string;
  /** Deposit actually confirmed by the PG (0 while payment is pending/failed). */
  depositKrw: string;
}

/**
 * Read model for the money side of a MONEY commitment. Always computed from
 * Stake + Payment + ledger, never from the behavioral occurrence status, so
 * the UI cannot claim money was lost before settlement actually ran.
 */
@Injectable()
export class MoneyStatusService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  async forCommitment(commitmentId: string): Promise<MoneyView | null> {
    const map = await this.forCommitments([commitmentId]);
    return map.get(commitmentId) ?? null;
  }

  /** Same as `forCommitment` but enforces ownership. `null` for SELF/SOCIAL. */
  async forOwnedCommitment(userId: string, commitmentId: string): Promise<MoneyView | null> {
    const c = await this.prisma.commitment.findUnique({ where: { id: commitmentId }, select: { userId: true } });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    return this.forCommitment(commitmentId);
  }

  async forCommitments(commitmentIds: string[]): Promise<Map<string, MoneyView>> {
    const out = new Map<string, MoneyView>();
    if (commitmentIds.length === 0) return out;
    const commitments = await this.prisma.commitment.findMany({
      where: { id: { in: commitmentIds }, enforcementMode: 'money' },
      select: { id: true, status: true, stake: true },
    });
    if (commitments.length === 0) return out;
    const ids = commitments.map((c) => c.id);
    const [payments, ledgerRows] = await Promise.all([
      this.prisma.payment.findMany({
        where: { commitmentId: { in: ids } },
        select: { commitmentId: true, type: true, status: true, createdAt: true },
      }),
      this.prisma.paymentLedger.findMany({
        where: { commitmentId: { in: ids } },
        select: { commitmentId: true, entryType: true, amount: true },
      }),
    ]);

    for (const c of commitments) {
      if (!c.stake) continue;
      const totals = { deposit: 0n, refundEarned: 0n, refundPaid: 0n, forfeit: 0n, reversal: 0n };
      for (const r of ledgerRows) {
        if (r.commitmentId !== c.id) continue;
        switch (r.entryType) {
          case 'deposit': totals.deposit += r.amount; break;
          case 'refund_earned': totals.refundEarned += r.amount; break;
          case 'refund_paid': totals.refundPaid += r.amount; break;
          case 'forfeit': totals.forfeit += r.amount; break;
          case 'reversal': totals.reversal += r.amount; break;
        }
      }
      const status = deriveMoneyStatus({
        commitmentStatus: c.status,
        stakeStatus: c.stake.status,
        payments: payments.filter((p) => p.commitmentId === c.id),
        refundableRemaining: this.ledger.refundableRemaining(totals),
      });
      if (!status) continue;
      out.set(c.id, {
        status,
        label: MONEY_STATUS_LABEL_KO[status],
        perOccurrenceKrw: c.stake.perOccurrenceAmount.toString(),
        upfrontKrw: c.stake.maxTotalAmount.toString(),
        refundableKrw: (totals.refundEarned + totals.reversal).toString(),
        forfeitedKrw: (totals.forfeit - totals.reversal > 0n ? totals.forfeit - totals.reversal : 0n).toString(),
        refundPaidKrw: totals.refundPaid.toString(),
        depositKrw: totals.deposit.toString(),
      });
    }
    return out;
  }
}
