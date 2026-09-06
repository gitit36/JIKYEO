import { Injectable, Logger } from '@nestjs/common';
import { OccurrenceStatus, Prisma, SettlementResult } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';
import { LedgerService, LedgerTotals } from '../payments/ledger.service';
import { PaymentService, PaymentView } from '../payments/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { financialStatus } from './financial-finality';
import { resolveContractV1, tallyContract } from './contract-v1';

/** Occurrence states that carry a final behavioral verdict. Everything else never settles. */
const FINAL_STATES: ReadonlySet<OccurrenceStatus> = new Set<OccurrenceStatus>(['pass', 'fail', 'void']);

export interface SettlementReport {
  commitmentId: string;
  skipped: 'not_money' | 'not_funded' | 'not_active' | null;
  occurrencesSettled: number;
  occurrencesPending: number;
  completed: boolean;
  totals: { depositKrw: string; refundableKrw: string; forfeitedKrw: string; refundPaidKrw: string } | null;
  refund: PaymentView | null;
}

export const settlementKeys = {
  occurrence: (occurrenceId: string) => `settle:${occurrenceId}`,
};

/**
 * Consumes behavioral verdicts and turns them into money movements — the
 * ONLY place where PASS/FAIL/VOID acquire financial meaning (SRD §5, TRD §10).
 *
 *   PASS  → Settlement(refundable) + ledger `refund_earned`
 *   FAIL  → Settlement(forfeited)  + ledger `forfeit`
 *   VOID  → Settlement(void)       + ledger `refund_earned`
 *   UNCERTAIN / system_hold / scheduled / active / reviewing → untouched
 *
 * When every occurrence of a funded MONEY commitment is final, the commitment
 * closes and ONE aggregate refund of `deposit − forfeited` is requested from
 * the PG. Nothing is ever paid to friends, other users, or pools.
 *
 * Idempotency: Settlement rows carry a unique `settle:<occurrenceId>` key,
 * ledger entries reuse that key, Stake transitions are conditional, and the
 * refund is delegated to PaymentService which is idempotent per commitment.
 * Re-running `settleCommitment` is therefore always safe and doubles as the
 * refund-retry path.
 */
@Injectable()
export class SettlementService {
  private readonly logger = new Logger('Settlement');

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
  ) {}

  async listForUser(userId: string): Promise<Array<{
    settlementId: string;
    commitmentId: string;
    occurrenceId: string;
    sequenceNo: number;
    result: string;
    amountKrw: string;
    status: string;
    processedAt: string | null;
  }>> {
    const mine = await this.prisma.commitment.findMany({
      where: { userId },
      select: { id: true },
    });
    const ids = mine.map((c) => c.id);
    if (ids.length === 0) return [];
    const occs = await this.prisma.occurrence.findMany({
      where: { commitmentId: { in: ids } },
      select: { id: true, commitmentId: true, sequenceNo: true },
    });
    const occById = new Map(occs.map((o) => [o.id, o]));
    const rows = await this.prisma.settlement.findMany({
      where: { occurrenceId: { in: occs.map((o) => o.id) } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((s) => {
      const o = occById.get(s.occurrenceId)!;
      return {
        settlementId: s.id,
        commitmentId: o.commitmentId,
        occurrenceId: s.occurrenceId,
        sequenceNo: o.sequenceNo,
        result: s.result,
        amountKrw: s.amount.toString(),
        status: s.status,
        processedAt: s.processedAt?.toISOString() ?? null,
      };
    });
  }

  async settleCommitment(commitmentId: string): Promise<SettlementReport> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true, occurrences: { orderBy: { sequenceNo: 'asc' } } },
    });
    if (!c) throw new DomainError('NOT_FOUND', 'Commitment not found');
    const base: SettlementReport = {
      commitmentId,
      skipped: null,
      occurrencesSettled: 0,
      occurrencesPending: 0,
      completed: false,
      totals: null,
      refund: null,
    };
    if (c.enforcementMode !== 'money' || !c.stake) return { ...base, skipped: 'not_money' };
    // No deposit → nothing to settle. A payment_pending commitment can never
    // forfeit money it was never charged.
    if (c.stake.status === 'pending') return { ...base, skipped: 'not_funded' };
    // Funded but unsigned (signature_pending) is not enforceable and must
    // not settle. Cancelled unsigned recovery refunds via PaymentService,
    // never via occurrence forfeit/refund_earned.
    if (c.status !== 'active' && c.status !== 'completed') {
      if (!(c.stake.settlementMode === 'contract_v1' && c.status === 'cancelled')) {
        return { ...base, skipped: 'not_active' };
      }
    }

    if (c.stake.settlementMode === 'contract_v1') {
      return this.settleContractV1(c as any, base);
    }
    return this.settleLegacyProRata(c as any, base);
  }

  /** MONEY V1: one charge, one full refund or one full forfeit. No per-occurrence money. */
  private async settleContractV1(
    c: {
      id: string;
      userId: string;
      status: string;
      startAt: Date;
      endAt: Date;
      allowedFailCount: number | null;
      contractOutcome: string;
      cancellationReason: string | null;
      cancellationRequestedAt: Date | null;
      stake: { id: string; maxTotalAmount: bigint; status: string; settlementMode: string };
      occurrences: Array<{
        id: string;
        status: string;
        windowStartAt: Date;
        appealOpenedAt: Date | null;
        appealDeadlineAt: Date | null;
      }>;
    },
    base: SettlementReport,
  ): Promise<SettlementReport> {
    const appeals = await this.prisma.appeal.findMany({
      where: { occurrenceId: { in: c.occurrences.map((o) => o.id) } },
    });
    const appealByOcc = new Map(appeals.map((a) => [a.occurrenceId, a]));
    const now = this.clock.now();
    const tally = tallyContract(c.occurrences, appealByOcc, now);
    const startedAtCancel = (c.cancellationRequestedAt ?? now).getTime() >= c.startAt.getTime();
    const abandoned =
      c.contractOutcome === 'failed' ||
      (c.status === 'cancelled' &&
        c.cancellationReason === 'user_cancelled' &&
        startedAtCancel &&
        c.contractOutcome !== 'voided');
    if (c.status === 'cancelled' && !abandoned) {
      const refund = await this.payments.refundAggregate(c.id, c.stake.maxTotalAmount, `contract_cancel:${c.id}`);
      return {
        ...base,
        completed: true,
        skipped: 'not_active',
        totals: view(await this.ledger.totalsForCommitment(c.id)),
        refund,
      };
    }
    const allowed = c.allowedFailCount ?? 0;
    const remainingOpen = c.occurrences.filter((o) =>
      ['scheduled', 'active', 'evidence_submitted', 'reviewing', 'uncertain', 'system_hold'].includes(o.status),
    );
    const outcome = resolveContractV1({
      allowedFailCount: allowed,
      finalFail: tally.finalFail,
      pendingBehavioral: tally.pendingBehavioral,
      blocked: tally.blocked,
      provisionalFail: tally.provisionalFail,
      allWorkDone: remainingOpen.length === 0 && tally.pendingBehavioral === 0,
      alreadyFailed: c.contractOutcome === 'failed',
      alreadyVoided: c.contractOutcome === 'voided',
      abandonedAfterStart: abandoned,
    });
    if (outcome === 'pending') {
      return {
        ...base,
        occurrencesPending: tally.pendingBehavioral + tally.blocked + tally.provisionalFail,
        totals: view(await this.ledger.totalsForCommitment(c.id)),
      };
    }

    if (outcome === 'failed') {
      await this.closeUnstarted(c.id, 'contract_failed', now);
      await this.realizeFullForfeit(c, now);
      return {
        ...base,
        completed: true,
        totals: view(await this.ledger.totalsForCommitment(c.id)),
        refund: null,
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.commitment.updateMany({
        where: { id: c.id, status: { in: ['active', 'cancelled'] } },
        data: { status: c.status === 'cancelled' ? 'cancelled' : 'completed', ...({ contractOutcome: 'success' } as object) } as object,
      });
      await tx.stake.updateMany({
        where: { id: c.stake.id, status: { in: ['funded', 'settling'] } },
        data: { status: 'settling', settledAt: now },
      });
    });
    const refund = await this.payments.refundAggregate(c.id, c.stake.maxTotalAmount, `contract_success:${c.id}`);
    return {
      ...base,
      completed: true,
      totals: view(await this.ledger.totalsForCommitment(c.id)),
      refund,
    };
  }

  private async realizeFullForfeit(
    c: { id: string; userId: string; stake: { id: string; maxTotalAmount: bigint } },
    now: Date,
  ): Promise<void> {
    const key = `contract_forfeit:${c.id}`;
    await this.prisma.$transaction(async (tx) => {
      await tx.commitment.updateMany({
        where: { id: c.id },
        data: { status: 'completed', ...({ contractOutcome: 'failed' } as object) } as object,
      });
      await tx.stake.updateMany({
        where: { id: c.stake.id, status: { in: ['funded', 'settling'] } },
        data: { status: 'settled', settledAt: now },
      });
      await this.ledger.append(
        {
          userId: c.userId,
          commitmentId: c.id,
          entryType: 'forfeit',
          amount: c.stake.maxTotalAmount,
          idempotencyKey: key,
        },
        tx,
      );
    });
  }

  private async closeUnstarted(commitmentId: string, reason: string, now: Date): Promise<void> {
    await this.prisma.occurrence.updateMany({
      where: { commitmentId, status: { in: ['scheduled', 'active'] } },
      data: { status: 'void', failureReasonCode: reason, decidedAt: now },
    });
  }

  /** Isolated legacy pro-rata path. New MONEY V1 creation never enters this. */
  private async settleLegacyProRata(
    c: {
      id: string;
      userId: string;
      stake: { id: string };
      occurrences: Array<{
        id: string;
        status: string;
        stakeAmount: bigint | null;
        appealOpenedAt: Date | null;
        appealDeadlineAt: Date | null;
      }>;
    },
    base: SettlementReport,
  ): Promise<SettlementReport> {
    const appeals = await this.prisma.appeal.findMany({
      where: { occurrenceId: { in: c.occurrences.map((o) => o.id) } },
    });
    const appealByOcc = new Map(appeals.map((a) => [a.occurrenceId, a]));
    const now = this.clock.now();

    let settled = 0;
    let pending = 0;
    for (const occ of c.occurrences) {
      const appeal = appealByOcc.get(occ.id);
      const effective = financialStatus(occ, appeal, now);
      if (effective === 'pending') {
        pending += 1;
        continue;
      }
      if (occ.stakeAmount === null) {
        pending += 1;
        continue;
      }
      const didSettle = await this.settleOccurrence({
        userId: c.userId,
        commitmentId: c.id,
        occurrenceId: occ.id,
        status: effective,
        amount: occ.stakeAmount,
      });
      if (didSettle) settled += 1;
    }

    const blockingAppeals = await this.prisma.appeal.count({
      where: {
        occurrenceId: { in: c.occurrences.map((o) => o.id) },
        status: { in: ['submitted', 'reviewing'] },
      },
    });

    if (pending > 0 || blockingAppeals > 0) {
      const totals = await this.ledger.totalsForCommitment(c.id);
      return {
        ...base,
        occurrencesSettled: settled,
        occurrencesPending: Math.max(pending, blockingAppeals),
        totals: view(totals),
      };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.commitment.updateMany({ where: { id: c.id, status: 'active' }, data: { status: 'completed' } });
      await tx.stake.updateMany({ where: { id: c.stake!.id, status: 'funded' }, data: { status: 'settling', settledAt: now } });
    });

    const totals = await this.ledger.totalsForCommitment(c.id);
    const netForfeit = totals.forfeit - totals.reversal;
    const refundTotal = totals.deposit - netForfeit;
    const earned = totals.refundEarned + totals.reversal;
    if (refundTotal !== earned) {
      this.logger.error(
        `legacy ledger mismatch on ${c.id}: deposit-netForfeit=${refundTotal} but refund_earned=${earned}; holding refund`,
      );
      return { ...base, occurrencesSettled: settled, completed: true, totals: view(totals) };
    }

    if (refundTotal <= 0n) {
      await this.prisma.stake.updateMany({ where: { id: c.stake.id, status: 'settling' }, data: { status: 'settled' } });
      return { ...base, occurrencesSettled: settled, completed: true, totals: view(await this.ledger.totalsForCommitment(c.id)) };
    }

    const remaining = this.ledger.refundableRemaining(totals);
    let refund: PaymentView | null = null;
    if (remaining > 0n) {
      const unpaidAppeal = await this.payments.refundUnpaidAppealSupplements(c.id);
      if (unpaidAppeal) {
        refund = unpaidAppeal;
      } else {
        refund = await this.payments.refundAggregate(c.id, remaining, `commitment_end:${c.id}`);
      }
    } else {
      refund = await this.payments.findSucceededRefund(c.id);
    }
    return {
      ...base,
      occurrencesSettled: settled,
      completed: true,
      totals: view(await this.ledger.totalsForCommitment(c.id)),
      refund,
    };
  }

  /**
   * Explicit refund retry (also reachable by simply re-running settlement).
   * Only meaningful while the Stake is `settling` and no refund succeeded.
   */
  async retryRefund(commitmentId: string): Promise<SettlementReport> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true },
    });
    if (!c?.stake) throw new DomainError('PAYMENT_NOT_REQUIRED', 'No stake on this commitment');
    if (c.status === 'cancelled') {
      if (c.stake.settlementMode === 'contract_v1' && c.contractOutcome === 'failed') {
        return this.settleCommitment(commitmentId);
      }
      if (c.stake.status === 'settling' || c.stake.status === 'funded') {
        const charge = await this.prisma.payment.findFirst({
          where: { commitmentId, type: 'charge', status: 'succeeded' },
        });
        const reason = c.stake.settlementMode === 'contract_v1'
          ? `contract_cancel:${commitmentId}`
          : `unsigned_cancel:${commitmentId}`;
        const refund = charge
          ? await this.payments.refundAggregate(commitmentId, charge.amount, reason)
          : null;
        const totals = await this.ledger.totalsForCommitment(commitmentId);
        return {
          commitmentId,
          skipped: null,
          occurrencesSettled: 0,
          occurrencesPending: 0,
          completed: true,
          totals: view(totals),
          refund,
        };
      }
      const refund = await this.payments.findSucceededRefund(commitmentId);
      return {
        commitmentId,
        skipped: null,
        occurrencesSettled: 0,
        occurrencesPending: 0,
        completed: true,
        totals: view(await this.ledger.totalsForCommitment(commitmentId)),
        refund,
      };
    }
    if (c.stake.status === 'refunded' || c.stake.status === 'settled') {
      return this.settleCommitment(commitmentId);
    }
    if (c.stake.status !== 'settling') {
      throw new DomainError('SETTLEMENT_NOT_READY', '아직 정산이 시작되지 않았어요.');
    }
    return this.settleCommitment(commitmentId);
  }

  /**
   * Periodic sweep: every funded/settling MONEY stake gets a settlement pass.
   * Also re-drives stuck refunds and stale PG requests (reconciliation).
   */
  async sweep(): Promise<{ considered: number; completed: number; refundsRequested: number }> {
    const stakes = await this.prisma.stake.findMany({
      where: { status: { in: ['funded', 'settling'] } },
      select: { commitmentId: true },
      take: 500,
    });
    let completed = 0;
    let refundsRequested = 0;
    for (const s of stakes) {
      try {
        const c = await this.prisma.commitment.findUnique({ where: { id: s.commitmentId }, select: { status: true } });
        const r = c?.status === 'cancelled'
          ? await this.retryRefund(s.commitmentId)
          : await this.settleCommitment(s.commitmentId);
        if (r.completed) completed += 1;
        if (r.refund?.status === 'requested' || r.refund?.status === 'succeeded') refundsRequested += 1;
      } catch (e) {
        this.logger.error(`settlement failed for ${s.commitmentId}`, (e as Error)?.stack);
      }
    }
    try {
      await this.payments.reconcileStale();
    } catch (e) {
      this.logger.error('reconciliation failed', (e as Error)?.stack);
    }
    return { considered: stakes.length, completed, refundsRequested };
  }

  onModuleInit(): void {
    if (this.cfg.nodeEnv === 'test') return;
    setInterval(() => {
      this.sweep().catch((e) => this.logger.error('sweep failed', (e as Error)?.stack));
    }, 60_000).unref?.();
  }

  /** Returns true if this call created the settlement (false if it already existed). */
  private async settleOccurrence(input: {
    userId: string;
    commitmentId: string;
    occurrenceId: string;
    status: 'pass' | 'fail' | 'void';
    amount: bigint;
  }): Promise<boolean> {
    const key = settlementKeys.occurrence(input.occurrenceId);
    const now = this.clock.now();
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockOccurrence(tx, input.occurrenceId);
        const fresh = await tx.occurrence.findUnique({ where: { id: input.occurrenceId } });
        const appeal = await tx.appeal.findUnique({ where: { occurrenceId: input.occurrenceId } });
        const effective = fresh ? financialStatus(fresh, appeal, now) : null;
        if (!effective || effective === 'pending') return;
        const settledResult: SettlementResult =
          effective === 'pass' ? 'refundable' : effective === 'fail' ? 'forfeited' : 'void';
        const settledEntry = effective === 'fail' ? 'forfeit' : 'refund_earned';
        await tx.settlement.create({
          data: {
            occurrenceId: input.occurrenceId,
            result: settledResult,
            amount: input.amount,
            status: 'processed',
            idempotencyKey: key,
            processedAt: now,
          },
        });
        await this.ledger.append(
          {
            userId: input.userId,
            commitmentId: input.commitmentId,
            occurrenceId: input.occurrenceId,
            entryType: settledEntry,
            amount: input.amount,
            idempotencyKey: key,
          },
          tx,
        );
      });
      const existing = await this.prisma.settlement.findUnique({ where: { idempotencyKey: key } });
      return !!existing;
    } catch (e) {
      if ((e as Prisma.PrismaClientKnownRequestError | { code?: string }).code === 'P2002') {
        return false; // already settled — double settlement prevented
      }
      throw e;
    }
  }
}

async function lockOccurrence(
  tx: { $executeRaw?: (q: TemplateStringsArray, ...v: unknown[]) => Promise<unknown> },
  occurrenceId: string,
): Promise<void> {
  if (typeof tx.$executeRaw !== 'function') return;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${occurrenceId})::bigint)`;
  } catch {
    // In-memory test DB has no advisory locks; $transaction serialisation covers it.
  }
}

function view(t: LedgerTotals): NonNullable<SettlementReport['totals']> {
  return {
    depositKrw: t.deposit.toString(),
    refundableKrw: (t.refundEarned + t.reversal).toString(),
    forfeitedKrw: t.forfeit.toString(),
    refundPaidKrw: t.refundPaid.toString(),
  };
}
