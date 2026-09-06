import { Injectable } from '@nestjs/common';
import { EvidenceType, Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { ConflictError, DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationOrchestrator, PersistedResult } from '../verification/verification-orchestrator.service';
import { SubmitEvidenceDto } from './dto/submit-evidence.dto';
import { EvidenceStorage } from './storage/evidence-storage';

/**
 * Owns the submit-evidence pipeline for photo / gps / self.
 * Timer proof completes via the FocusTimerService.finish endpoint and calls
 * the same VerificationOrchestrator underneath.
 *
 * The service does NOT settle money. It records evidence and asks the
 * orchestrator for a PASS/UNCERTAIN/FAIL decision.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    private readonly orchestrator: VerificationOrchestrator,
    private readonly storage: EvidenceStorage,
  ) {}

  async issueUploadTicket(userId: string, occurrenceId: string, contentType?: string) {
    await this.assertOwnedActive(userId, occurrenceId);
    return this.storage.issueUploadTicket({
      userId,
      occurrenceId,
      contentType,
      extension: contentType?.split('/')[1] ?? 'jpg',
    });
  }

  async submit(userId: string, occurrenceId: string, dto: SubmitEvidenceDto): Promise<PersistedResult> {
    const occ = await this.assertOwnedActive(userId, occurrenceId);
    if (occ.status !== 'active' && occ.status !== 'scheduled' && occ.status !== 'uncertain') {
      throw new ConflictError('Occurrence is not open for evidence', { status: occ.status });
    }

    const receivedAt = this.clock.now();
    const retention = new Date(receivedAt.getTime() + this.cfg.defaultEvidenceRetentionDays * 86_400_000);

    // Route by evidence kind.
    if (dto.kind === 'photo') {
      if (!dto.photo) throw new ValidationError('photo payload required for kind=photo');
      const capturedAt = new Date(dto.photo.capturedAt);
      // Duplicate hash detection — the same image can't be reused across
      // occurrences by the same user. If it appears, we surface UNCERTAIN
      // rather than silently pass. (SRD §10, PRD §6.)
      const duplicate = await this.prisma.evidence.findFirst({
        where: { hash: dto.photo.hash, submittedByUserId: userId, NOT: { occurrenceId } },
        select: { id: true },
      });
      const evidence = await this.prisma.evidence.create({
        data: {
          occurrenceId,
          submittedByUserId: userId,
          evidenceType: 'photo' as EvidenceType,
          storageKey: dto.photo.storageKey,
          hash: dto.photo.hash,
          capturedAt,
          receivedAt,
          metadataJson: {
            type: 'photo',
            content_type: dto.photo.contentType ?? null,
            size_bytes: dto.photo.sizeBytes ?? null,
            duplicate_of_id: duplicate?.id ?? null,
          } as unknown as Prisma.InputJsonValue,
          retentionUntil: retention,
        },
      });

      await this.transitionToReviewing(occurrenceId);

      if (duplicate) {
        // Fabricate an UNCERTAIN result without calling the vision provider.
        return this.orchestrator.decidePhoto({
          occurrenceId,
          evidenceId: evidence.id,
          storageKey: dto.photo.storageKey,
          metadata: { forceResult: 'uncertain', duplicate_of_id: duplicate.id, hint: 'DUPLICATE_HASH' },
        });
      }
      return this.orchestrator.decidePhoto({
        occurrenceId,
        evidenceId: evidence.id,
        storageKey: dto.photo.storageKey,
        metadata: { content_type: dto.photo.contentType ?? null, size_bytes: dto.photo.sizeBytes ?? null },
      });
    }

    if (dto.kind === 'gps') {
      if (!dto.gps) throw new ValidationError('gps payload required for kind=gps');
      const capturedAt = new Date(dto.gps.capturedAt);
      const evidence = await this.prisma.evidence.create({
        data: {
          occurrenceId,
          submittedByUserId: userId,
          evidenceType: 'location' as EvidenceType,
          capturedAt,
          receivedAt,
          metadataJson: {
            type: 'location',
            lat: dto.gps.lat,
            lng: dto.gps.lng,
            accuracy_m: dto.gps.accuracyM,
            mock_location_suspected: !!dto.gps.mockLocationSuspected,
          } as unknown as Prisma.InputJsonValue,
          retentionUntil: retention,
        },
      });
      await this.transitionToReviewing(occurrenceId);
      return this.orchestrator.decideGps({
        occurrenceId,
        evidenceId: evidence.id,
        userLat: dto.gps.lat,
        userLng: dto.gps.lng,
        accuracyM: dto.gps.accuracyM,
        capturedAt,
        receivedAt,
        mockLocationSuspected: !!dto.gps.mockLocationSuspected,
      });
    }

    if (dto.kind === 'self') {
      if (!dto.self) throw new ValidationError('self payload required for kind=self');
      const evidence = await this.prisma.evidence.create({
        data: {
          occurrenceId,
          submittedByUserId: userId,
          evidenceType: 'self' as EvidenceType,
          capturedAt: receivedAt,
          receivedAt,
          metadataJson: { type: 'self', user_answer: dto.self.answer } as unknown as Prisma.InputJsonValue,
          retentionUntil: retention,
        },
      });
      await this.transitionToReviewing(occurrenceId);
      return this.orchestrator.decideSelf({
        occurrenceId,
        evidenceId: evidence.id,
        answer: dto.self.answer,
      });
    }

    throw new ValidationError('Unsupported evidence kind');
  }

  async listForOccurrence(userId: string, occurrenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: { select: { userId: true } } },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    const rows = await this.prisma.evidence.findMany({
      where: { occurrenceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((e) => ({
      evidenceId: e.id,
      status: e.status,
      hash: e.hash,
      metadata: e.metadataJson,
      deletedAt: e.deletedAt?.toISOString() ?? null,
      assetAvailable: e.status === 'active' && !!e.storageKey,
    }));
  }

  async getAsset(userId: string, occurrenceId: string, evidenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: { select: { userId: true } } },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    const row = await this.prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!row || row.occurrenceId !== occurrenceId) throw new NotFoundError('Evidence not found');
    if (row.status === 'deleted' || !row.storageKey || !(await this.storage.exists(row.storageKey))) {
      throw new DomainError('NOT_FOUND', '보관 기간이 지나 삭제된 증거예요.');
    }
    return { evidenceId: row.id, storageKey: row.storageKey, status: row.status };
  }

  private async transitionToReviewing(occurrenceId: string): Promise<void> {
    // Move `scheduled/active` → `evidence_submitted` → `reviewing` for the
    // duration of the verifier call. If verification finishes synchronously
    // (mock), the orchestrator will overwrite status. We split the writes
    // so a slow verifier still shows the user something sensible.
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.occurrence.findUnique({ where: { id: occurrenceId } });
      if (!o) throw new NotFoundError('Occurrence not found');
      if (o.status === 'pass' || o.status === 'fail' || o.status === 'void') {
        throw new DomainError('PROOF_ALREADY_SUBMITTED', '이미 판정이 끝난 회차예요.', { status: o.status });
      }
      await tx.occurrence.update({
        where: { id: occurrenceId },
        data: { status: 'reviewing' },
      });
    });
  }

  private async assertOwnedActive(userId: string, occurrenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: { select: { userId: true, status: true } } },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    if (occ.commitment.status !== 'active') {
      throw new ConflictError('Commitment is not active', { status: occ.commitment.status });
    }
    // Late evidence is still accepted within the network-grace window.
    // The provider will decide FAIL/UNCERTAIN based on the actual times.
    const grace = this.cfg.networkGraceSeconds * 1000;
    if (this.clock.now().getTime() > occ.deadlineAt.getTime() + grace) {
      throw new DomainError('OCCURRENCE_PAST_DEADLINE', '이 회차는 마감이 지났어요.');
    }
    return occ;
  }
}
