import { Injectable } from '@nestjs/common';
import { EvidenceType, FocusTimerStatus, Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationOrchestrator, PersistedResult } from '../verification/verification-orchestrator.service';

/**
 * Server-authoritative Focus Timer.
 *
 * Timing is measured by the server, not the phone. The client sends
 * heartbeats to prove the app kept the session alive; the server records
 * gaps and background transitions. On `finish`, we build a TimerInput
 * and hand it to the verifier, which produces PASS / UNCERTAIN / FAIL.
 * A large heartbeat gap or app termination results in UNCERTAIN — not
 * FAIL — because the ambiguity may be a network hiccup.
 */
@Injectable()
export class FocusTimerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    private readonly orchestrator: VerificationOrchestrator,
  ) {}

  async start(userId: string, occurrenceId: string) {
    const occ = await this.assertOwned(userId, occurrenceId);
    // Read the required seconds from the verification rule.
    const commitment = await this.prisma.commitment.findUnique({
      where: { id: occ.commitmentId },
      include: { verificationRule: true },
    });
    if (!commitment) throw new NotFoundError('Commitment not found');
    if (commitment.status !== 'active') {
      // e.g. MONEY commitment still waiting for payment — not enforceable yet.
      throw new ConflictError('Commitment is not active', { status: commitment.status });
    }
    const rule = (commitment.verificationRule?.ruleJson as { required_seconds?: number }) ?? {};
    const requiredSeconds = rule.required_seconds ?? 0;
    if (requiredSeconds < 60) {
      throw new DomainError('TIMER_SESSION_INVALID', '이 약속은 집중 타이머로 증명하지 않아요.');
    }
    if (occ.status !== 'active' && occ.status !== 'scheduled' && occ.status !== 'uncertain') {
      throw new ConflictError('Occurrence is not open for timer', { status: occ.status });
    }
    // Cancel any pre-existing active session for the same occurrence.
    await this.prisma.focusTimerSession.updateMany({
      where: { occurrenceId, status: 'active' },
      data: { status: 'aborted', finishedAt: this.clock.now() },
    });
    const now = this.clock.now();
    const session = await this.prisma.focusTimerSession.create({
      data: {
        occurrenceId,
        userId,
        plannedDurationSeconds: requiredSeconds,
        serverStartedAt: now,
      },
    });
    // Move the occurrence into active for the duration of the session.
    await this.prisma.occurrence.update({
      where: { id: occurrenceId },
      data: { status: 'active' },
    }).catch(() => undefined);
    return {
      sessionId: session.id,
      serverStartedAt: session.serverStartedAt.toISOString(),
      plannedDurationSeconds: session.plannedDurationSeconds,
    };
  }

  async heartbeat(userId: string, sessionId: string, backgroundEvents?: number) {
    const session = await this.loadOwnedActive(userId, sessionId);
    const now = this.clock.now();
    const gap = session.lastHeartbeatAt
      ? Math.max(0, Math.floor((now.getTime() - session.lastHeartbeatAt.getTime()) / 1000))
      : 0;
    const updated = await this.prisma.focusTimerSession.update({
      where: { id: session.id },
      data: {
        lastHeartbeatAt: now,
        heartbeatCount: { increment: 1 },
        maxGapSeconds: Math.max(session.maxGapSeconds, gap),
        backgroundTransitions: backgroundEvents !== undefined
          ? { increment: Math.max(0, backgroundEvents) }
          : undefined,
      },
    });
    return {
      sessionId: updated.id,
      serverNow: now.toISOString(),
      heartbeatCount: updated.heartbeatCount,
      maxGapSeconds: updated.maxGapSeconds,
    };
  }

  async finish(userId: string, sessionId: string, opts?: { terminated?: boolean }): Promise<PersistedResult> {
    const session = await this.loadOwnedActive(userId, sessionId);
    const now = this.clock.now();
    const finished = await this.prisma.focusTimerSession.update({
      where: { id: session.id },
      data: {
        status: 'finished',
        finishedAt: now,
      },
    });
    // Create the evidence row referencing this session, then verify.
    const retention = new Date(now.getTime() + this.cfg.defaultEvidenceRetentionDays * 86_400_000);
    const evidence = await this.prisma.evidence.create({
      data: {
        occurrenceId: session.occurrenceId,
        submittedByUserId: userId,
        evidenceType: 'timer' as EvidenceType,
        capturedAt: session.serverStartedAt,
        receivedAt: now,
        retentionUntil: retention,
        metadataJson: {
          type: 'timer',
          session_id: finished.id,
          planned_duration_s: finished.plannedDurationSeconds,
          elapsed_s: Math.floor((now.getTime() - finished.serverStartedAt.getTime()) / 1000),
          heartbeats: finished.heartbeatCount,
          max_gap_s: finished.maxGapSeconds,
          background_events: finished.backgroundTransitions,
        } as unknown as Prisma.InputJsonValue,
      },
    });
    // Timer runs longer than planned; we synthesise a heartbeat gap array
    // for the verifier so its policy is unchanged.
    const gaps = finished.maxGapSeconds > 0 ? [finished.maxGapSeconds] : [];
    return this.orchestrator.decideTimer({
      occurrenceId: session.occurrenceId,
      evidenceId: evidence.id,
      requiredSeconds: finished.plannedDurationSeconds,
      startedAt: finished.serverStartedAt,
      finishedAt: now,
      heartbeatGaps: gaps,
      backgroundEvents: finished.backgroundTransitions,
      terminated: !!opts?.terminated,
    });
  }

  private async assertOwned(userId: string, occurrenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: { commitment: { select: { userId: true } } },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== userId) throw new ForbiddenError();
    return occ;
  }

  private async loadOwnedActive(userId: string, sessionId: string) {
    const s = await this.prisma.focusTimerSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundError('Timer session not found');
    if (s.userId !== userId) throw new ForbiddenError();
    if (s.status !== ('active' as FocusTimerStatus)) {
      throw new ConflictError('Timer session is not active', { status: s.status });
    }
    return s;
  }
}
