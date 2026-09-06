import { Injectable, Optional } from '@nestjs/common';
import { Appeal, AppealStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';
import { NotificationService } from '../notifications/notification.service';
import { LedgerService } from '../payments/ledger.service';
import { ledgerKeys, PaymentService } from '../payments/payment.service';
import { PrismaService } from '../prisma/prisma.service';
import { APPEAL_REASON_CATEGORIES, AppealReasonCategory } from './dto/submit-appeal.dto';

export type SupplementalRefundStatus = 'none' | 'pending' | 'succeeded' | 'delayed';

export interface AppealView {
  appealId: string;
  occurrenceId: string;
  commitmentId: string;
  sequenceNo: number;
  status: AppealStatus;
  reasonCategory: string;
  explanation: string;
  originalResult: string;
  effectiveResult: string;
  correctedResult: string | null;
  rejectReason: string | null;
  supplementalRefundStatus: SupplementalRefundStatus;
  submittedAt: string;
  decidedAt: string | null;
  eligible: boolean;
}

export interface OccurrenceAppealSummary {
  occurrenceId: string;
  sequenceNo: number;
  originalResult: string;
  effectiveResult: string;
  status: AppealStatus | null;
  eligible: boolean;
  rejectReason: string | null;
  supplementalRefundStatus: SupplementalRefundStatus;
}

@Injectable()
export class AppealService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly payments: PaymentService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  get windowSeconds(): number {
    return this.cfg.appealWindowSeconds;
  }

  async submit(
    userId: string,
    occurrenceId: string,
    input: { reasonCategory: AppealReasonCategory; explanation: string },
  ): Promise<AppealView> {
    if (!APPEAL_REASON_CATEGORIES.includes(input.reasonCategory)) {
      throw new DomainError('VALIDATION', '사유를 선택해주세요.');
    }
    const explanation = input.explanation.trim();
    if (explanation.length < 1 || explanation.length > 500) {
      throw new DomainError('VALIDATION', '이유를 짧게 적어주세요.');
    }

    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: true, appeal: true },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    this.assertEligible(occ.commitment.enforcementMode, occ.status, occ.appeal);
    if (!this.withinWindow(occ.decidedAt)) {
      throw new DomainError('APPEAL_WINDOW_CLOSED', '이의 제기 기간이 지났어요.');
    }

    try {
      const row = await this.prisma.appeal.create({
        data: {
          occurrenceId: occ.id,
          userId,
          reasonCategory: input.reasonCategory,
          reasonText: explanation,
          originalResult: 'fail',
          status: 'submitted',
          submittedAt: this.clock.now(),
        },
      });
      await this.audit.log({
        actorType: 'user',
        actorId: userId,
        entityType: 'appeal',
        entityId: row.id,
        action: 'appeal_submitted',
        after: { occurrenceId: occ.id, reasonCategory: input.reasonCategory },
      });
      return this.toView(row, occ.commitmentId, occ.sequenceNo);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        throw new DomainError('APPEAL_ALREADY_EXISTS', '이미 이의를 제기한 회차예요.');
      }
      throw e;
    }
  }

  async getOwned(userId: string, occurrenceId: string): Promise<AppealView | OccurrenceAppealSummary> {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: true, appeal: true },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    if (occ.appeal) return this.toView(occ.appeal, occ.commitmentId, occ.sequenceNo);
    return this.summaryFor(occ, null);
  }

  async getOwnedById(userId: string, appealId: string): Promise<AppealView> {
    const row = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { occurrence: { include: { commitment: true } } },
    });
    if (!row) throw new NotFoundError('Appeal not found');
    if (row.occurrence.commitment.userId !== userId) throw new ForbiddenError();
    return this.toView(row, row.occurrence.commitmentId, row.occurrence.sequenceNo);
  }

  async summariesForCommitments(commitmentIds: string[]): Promise<Map<string, OccurrenceAppealSummary[]>> {
    const out = new Map<string, OccurrenceAppealSummary[]>();
    if (commitmentIds.length === 0) return out;
    const occs = await this.prisma.occurrence.findMany({
      where: { commitmentId: { in: commitmentIds } },
      include: { appeal: true, commitment: { select: { enforcementMode: true } } },
      orderBy: { sequenceNo: 'asc' },
    });
    for (const occ of occs) {
      const list = out.get(occ.commitmentId) ?? [];
      const base = this.summaryFor(occ, occ.appeal);
      if (occ.appeal?.status === 'approved') {
        base.supplementalRefundStatus = await this.supplementalStatus(occ.commitmentId, occ.appeal);
      }
      list.push(base);
      out.set(occ.commitmentId, list);
    }
    return out;
  }

  async listPending() {
    const rows = await this.prisma.appeal.findMany({
      where: { status: { in: ['submitted', 'reviewing'] } },
      include: { occurrence: { include: { commitment: { select: { id: true, title: true, userId: true } } } } },
      orderBy: { submittedAt: 'asc' },
      take: 200,
    });
    return Promise.all(
      rows.map((r) => this.toView(r, r.occurrence.commitmentId, r.occurrence.sequenceNo)),
    );
  }

  async adminDetail(appealId: string) {
    const row = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { occurrence: { include: { commitment: true } } },
    });
    if (!row) throw new NotFoundError('Appeal not found');
    if (row.status === 'submitted') {
      await this.prisma.appeal.updateMany({
        where: { id: appealId, status: 'submitted' },
        data: { status: 'reviewing' },
      });
      row.status = 'reviewing';
    }
    const [evidence, verification] = await Promise.all([
      this.prisma.evidence.findMany({
        where: { occurrenceId: row.occurrenceId },
        orderBy: { receivedAt: 'asc' },
      }),
      this.prisma.verificationResult.findMany({
        where: { occurrenceId: row.occurrenceId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      ...(await this.toView(row, row.occurrence.commitmentId, row.occurrence.sequenceNo)),
      commitmentTitle: row.occurrence.commitment.title,
      occurrenceStatus: row.occurrence.status,
      stakeKrw: row.occurrence.stakeAmount?.toString() ?? null,
      evidence: evidence.map((e) => ({
        evidenceId: e.id,
        evidenceType: e.evidenceType,
        receivedAt: e.receivedAt.toISOString(),
        capturedAt: e.capturedAt?.toISOString() ?? null,
        metadata: e.metadataJson,
      })),
      verification: verification.map((v) => ({
        resultId: v.id,
        result: v.result,
        reasonCode: v.reasonCode,
        reasonText: v.reasonText,
        userMessage: v.userMessage,
        confidence: v.confidence?.toString() ?? null,
        verifierType: v.verifierType,
        modelVersion: v.modelVersion,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  async approve(
    appealId: string,
    correctedResult: 'pass' | 'void',
    actorId: string | null,
    simulate?: 'refund_fail',
  ): Promise<AppealView> {
    if (correctedResult !== 'pass' && correctedResult !== 'void') {
      throw new DomainError('VALIDATION', 'correctedResult must be pass or void');
    }
    const existing = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { occurrence: { include: { commitment: true } } },
    });
    if (!existing) throw new NotFoundError('Appeal not found');
    if (existing.status === 'approved' && existing.correctedResult === correctedResult) {
      return this.toView(existing, existing.occurrence.commitmentId, existing.occurrence.sequenceNo);
    }
    if (existing.status === 'approved' || existing.status === 'rejected') {
      throw new DomainError('APPEAL_ALREADY_DECIDED', '이미 결정된 이의예요.');
    }

    const now = this.clock.now();
    const occ = existing.occurrence;
    await this.prisma.$transaction(async (tx) => {
      await lockOccurrence(tx, occ.id);
      const current = await tx.appeal.findUnique({ where: { id: appealId } });
      if (!current || current.status === 'approved' || current.status === 'rejected') return;
      await tx.appeal.update({
        where: { id: appealId },
        data: {
          status: 'approved',
          correctedResult,
          reviewerType: 'human',
          reviewerId: actorId,
          decidedAt: now,
        },
      });
      const settlement = await tx.settlement.findUnique({
        where: { idempotencyKey: `settle:${occ.id}` },
      });
      if (settlement?.result === 'forfeited' && occ.stakeAmount != null) {
        await this.ledger.append(
          {
            userId: occ.commitment.userId,
            commitmentId: occ.commitmentId,
            occurrenceId: occ.id,
            entryType: 'reversal',
            amount: occ.stakeAmount,
            idempotencyKey: ledgerKeys.reversal(occ.id),
          },
          tx,
        );
      }
    });

    const after = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { occurrence: { include: { commitment: true } } },
    });
    if (!after) throw new NotFoundError('Appeal not found');

    const settlement = await this.prisma.settlement.findUnique({
      where: { idempotencyKey: `settle:${occ.id}` },
    });
    if (settlement?.result === 'forfeited' && occ.stakeAmount != null) {
      await this.payments.refundSupplemental(
        occ.commitmentId,
        occ.id,
        occ.stakeAmount,
        simulate === 'refund_fail'
          ? `appeal_supplemental:${occ.id};simulate:refund_fail`
          : `appeal_supplemental:${occ.id}`,
      );
    }

    await this.audit.log({
      actorType: 'admin',
      actorId,
      entityType: 'appeal',
      entityId: appealId,
      action: 'appeal_approved',
      after: { occurrenceId: occ.id, correctedResult },
    });
    try { await this.notifications?.enqueueAppeal(occ.commitment.userId, appealId); } catch { /* outbox must not fail domain */ }
    return this.toView(after, occ.commitmentId, occ.sequenceNo);
  }

  async reject(appealId: string, reason: string, actorId: string | null): Promise<AppealView> {
    const text = reason.trim();
    if (!text) throw new DomainError('VALIDATION', '기각 이유를 적어주세요.');
    const existing = await this.prisma.appeal.findUnique({
      where: { id: appealId },
      include: { occurrence: { include: { commitment: true } } },
    });
    if (!existing) throw new NotFoundError('Appeal not found');
    if (existing.status === 'rejected') {
      return this.toView(existing, existing.occurrence.commitmentId, existing.occurrence.sequenceNo);
    }
    if (existing.status === 'approved') {
      throw new DomainError('APPEAL_ALREADY_DECIDED', '이미 결정된 이의예요.');
    }
    const row = await this.prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: 'rejected',
        decisionReason: text,
        reviewerType: 'human',
        reviewerId: actorId,
        decidedAt: this.clock.now(),
      },
    });
    await this.audit.log({
      actorType: 'admin',
      actorId,
      entityType: 'appeal',
      entityId: appealId,
      action: 'appeal_rejected',
      after: { occurrenceId: existing.occurrenceId, reason: text },
    });
    try { await this.notifications?.enqueueAppeal(existing.userId, appealId); } catch { /* outbox must not fail domain */ }
    return this.toView(row, existing.occurrence.commitmentId, existing.occurrence.sequenceNo);
  }

  isEligible(
    enforcementMode: string,
    occurrenceStatus: string,
    appeal: Appeal | null,
    decidedAt: Date | null,
  ): boolean {
    if (enforcementMode !== 'money') return false;
    if (occurrenceStatus !== 'fail') return false;
    if (appeal) return false;
    return this.withinWindow(decidedAt);
  }

  private assertEligible(mode: string, status: string, appeal: Appeal | null): void {
    if (mode !== 'money') {
      throw new DomainError('APPEAL_NOT_ELIGIBLE', '약속금 약속의 실패 회차만 이의를 제기할 수 있어요.');
    }
    if (status !== 'fail') {
      throw new DomainError('APPEAL_NOT_ELIGIBLE', '최종 실패인 회차만 이의를 제기할 수 있어요.');
    }
    if (appeal) {
      throw new DomainError('APPEAL_ALREADY_EXISTS', '이미 이의를 제기한 회차예요.');
    }
  }

  private withinWindow(decidedAt: Date | null): boolean {
    if (!decidedAt) return false;
    const elapsed = this.clock.now().getTime() - decidedAt.getTime();
    return elapsed <= this.windowSeconds * 1000;
  }

  private summaryFor(
    occ: {
      id: string;
      sequenceNo: number;
      status: string;
      decidedAt: Date | null;
      commitment: { enforcementMode: string } | { enforcementMode?: string };
      appeal?: Appeal | null;
    },
    appeal: Appeal | null,
  ): OccurrenceAppealSummary {
    const mode = (occ as { commitment: { enforcementMode: string } }).commitment.enforcementMode;
    const original = appeal?.originalResult ?? occ.status;
    const effective =
      appeal?.status === 'approved' && appeal.correctedResult ? appeal.correctedResult : original;
    return {
      occurrenceId: occ.id,
      sequenceNo: occ.sequenceNo,
      originalResult: original,
      effectiveResult: effective,
      status: appeal?.status ?? null,
      eligible: this.isEligible(mode, occ.status, appeal, occ.decidedAt),
      rejectReason: appeal?.status === 'rejected' ? appeal.decisionReason : null,
      supplementalRefundStatus: 'none',
    };
  }

  private async toView(row: Appeal, commitmentId: string, sequenceNo: number): Promise<AppealView> {
    const supplemental = await this.supplementalStatus(commitmentId, row);
    const effective =
      row.status === 'approved' && row.correctedResult ? row.correctedResult : row.originalResult;
    return {
      appealId: row.id,
      occurrenceId: row.occurrenceId,
      commitmentId,
      sequenceNo,
      status: row.status,
      reasonCategory: row.reasonCategory,
      explanation: row.reasonText,
      originalResult: row.originalResult,
      effectiveResult: effective,
      correctedResult: row.correctedResult,
      rejectReason: row.status === 'rejected' ? row.decisionReason : null,
      supplementalRefundStatus: supplemental,
      submittedAt: row.submittedAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      eligible: false,
    };
  }

  private async supplementalStatus(commitmentId: string, row: Appeal): Promise<SupplementalRefundStatus> {
    if (row.status !== 'approved') return 'none';
    const settlement = await this.prisma.settlement.findUnique({
      where: { idempotencyKey: `settle:${row.occurrenceId}` },
    });
    if (!settlement || settlement.result !== 'forfeited') return 'none';
    const paid = await this.prisma.paymentLedger.findUnique({
      where: { idempotencyKey: ledgerKeys.refundPaidAppeal(row.occurrenceId) },
    });
    if (paid) return 'succeeded';
    const refunds = await this.prisma.payment.findMany({
      where: {
        commitmentId,
        type: 'refund',
        idempotencyKey: { startsWith: `refund:appeal:${row.occurrenceId}` },
      },
    });
    if (refunds.some((p) => p.status === 'failed')) return 'delayed';
    if (refunds.some((p) => p.status === 'requested')) return 'pending';
    return 'pending';
  }
}

async function lockOccurrence(
  tx: Prisma.TransactionClient,
  occurrenceId: string,
): Promise<void> {
  if (typeof (tx as { $executeRaw?: unknown }).$executeRaw !== 'function') return;
  try {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${occurrenceId})::bigint)`;
  } catch {
    // In-memory test DB has no advisory locks.
  }
}
