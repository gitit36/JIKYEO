import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';

export const TERMS_VERSION = 'terms-v1';

export interface TermsSnapshot {
  documentVersion: string;
  perOccurrenceKrw: string;
  occurrenceCount: number;
  maxChargeKrw: string;
  passVoidRefund: true;
  provisionalFail: true;
  appealDays: 7;
  cancellationCutoff: 'cancellation_requested_at';
  refundToOriginalMethod: true;
  noPrizePayout: true;
  refundHandling: string;
  statutoryRightsPreserved: true;
}

export interface TermsView {
  documentVersion: string;
  snapshot: TermsSnapshot;
  snapshotHash: string;
  acceptedAt: string | null;
}

const REFUND_GUIDANCE =
  '환불은 원래 결제 수단으로 돌아가며, 최종 정산 때 한 번에 처리돼요. 처리가 늦으면 다시 시도해요.';

@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async preview(userId: string, commitmentId: string): Promise<TermsView> {
    const c = await this.ownedMoney(userId, commitmentId);
    const existing = await this.prisma.commitmentContract.findUnique({ where: { commitmentId } });
    if (existing) return this.stored(existing);
    const snapshot = this.buildSnapshot(c);
    return { documentVersion: snapshot.documentVersion, snapshot, snapshotHash: hashSnapshot(snapshot), acceptedAt: null };
  }

  async accept(
    userId: string,
    commitmentId: string,
    input: { documentVersion: string; snapshotHash: string },
  ): Promise<TermsView> {
    const c = await this.ownedMoney(userId, commitmentId);
    const existing = await this.prisma.commitmentContract.findUnique({ where: { commitmentId } });
    if (existing) {
      if (existing.snapshotHash !== input.snapshotHash) {
        throw new DomainError('TERMS_MISMATCH', '이미 동의한 계약과 달라요.');
      }
      return this.stored(existing);
    }
    const snapshot = this.buildSnapshot(c);
    if (input.documentVersion !== snapshot.documentVersion || input.snapshotHash !== hashSnapshot(snapshot)) {
      throw new DomainError('TERMS_MISMATCH', '약관 내용이 바뀌었어요. 다시 확인해주세요.');
    }
    const row = await this.prisma.commitmentContract.create({
      data: {
        id: randomUUID(),
        commitmentId,
        userId,
        documentVersion: snapshot.documentVersion,
        snapshotJson: snapshot as object,
        snapshotHash: hashSnapshot(snapshot),
        acceptedAt: this.clock.now(),
      },
    });
    return this.stored(row);
  }

  async getAccepted(userId: string, commitmentId: string): Promise<TermsView> {
    await this.ownedMoney(userId, commitmentId);
    const row = await this.prisma.commitmentContract.findUnique({ where: { commitmentId } });
    if (!row) throw new DomainError('TERMS_REQUIRED', '결제 전에 약관에 동의해주세요.');
    return this.stored(row);
  }

  async assertAccepted(commitmentId: string): Promise<void> {
    const row = await this.prisma.commitmentContract.findUnique({ where: { commitmentId } });
    if (!row) throw new DomainError('TERMS_REQUIRED', '결제 전에 약관에 동의해주세요.');
  }

  private buildSnapshot(c: {
    stake: { perOccurrenceAmount: bigint; maxTotalAmount: bigint } | null;
    occurrences: { id: string }[];
  }): TermsSnapshot {
    if (!c.stake) throw new DomainError('PAYMENT_NOT_REQUIRED', '이 약속에는 결제가 필요하지 않아요.');
    return defaultTermsSnapshot(
      c.stake.perOccurrenceAmount.toString(),
      c.occurrences.length,
      c.stake.maxTotalAmount.toString(),
    );
  }

  private stored(row: {
    documentVersion: string;
    snapshotJson: unknown;
    snapshotHash: string;
    acceptedAt: Date;
  }): TermsView {
    return {
      documentVersion: row.documentVersion,
      snapshot: row.snapshotJson as TermsSnapshot,
      snapshotHash: row.snapshotHash,
      acceptedAt: row.acceptedAt.toISOString(),
    };
  }

  private async ownedMoney(userId: string, commitmentId: string) {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true, occurrences: { select: { id: true } } },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    if (c.enforcementMode !== 'money' || !c.stake) {
      throw new DomainError('PAYMENT_NOT_REQUIRED', '이 약속에는 결제가 필요하지 않아요.');
    }
    return c;
  }
}

export function defaultTermsSnapshot(
  perOccurrenceKrw: string,
  occurrenceCount: number,
  maxChargeKrw: string,
): TermsSnapshot {
  return {
    documentVersion: TERMS_VERSION,
    perOccurrenceKrw,
    occurrenceCount,
    maxChargeKrw,
    passVoidRefund: true,
    provisionalFail: true,
    appealDays: 7,
    cancellationCutoff: 'cancellation_requested_at',
    refundToOriginalMethod: true,
    noPrizePayout: true,
    refundHandling: REFUND_GUIDANCE,
    statutoryRightsPreserved: true,
  };
}

export function hashSnapshot(snapshot: TermsSnapshot): string {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
