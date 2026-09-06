import { Injectable, Logger } from '@nestjs/common';
import { Clock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';

/**
 * Signal telling the deadline worker whether it may confirm FAIL.
 * Set to `system_hold` by ops during an outage; the worker will refuse
 * to convert candidate FAILs into real FAILs until this returns to `ok`.
 * We deliberately keep this as an in-memory flag for MVP; production
 * wires it to a shared Redis key.
 */
export type HealthSignal = 'ok' | 'system_hold';

@Injectable()
export class HealthMonitor {
  private state: HealthSignal = 'ok';
  get(): HealthSignal { return this.state; }
  set(state: HealthSignal): void { this.state = state; }
}

/**
 * Interval-based deadline processor. Runs every N seconds and:
 *   - Marks scheduled/active occurrences whose deadline has passed as
 *     `system_hold` if the platform is unhealthy.
 *   - Otherwise, if the occurrence has no evidence and no verification
 *     result, records a behavioral FAIL (`DEADLINE_NO_EVIDENCE`).
 *   - Never converts a system/infrastructure error into a monetary FAIL:
 *     the orchestrator emits a `uncertain` outcome on provider failure,
 *     which stays in `uncertain` and requires human/appeal review.
 *
 * A later hardening phase may wire BullMQ delayed jobs; for MVP the interval is enough
 * and avoids adding a Redis dependency.
 */
@Injectable()
export class DeadlineService {
  private readonly logger = new Logger('Deadline');

  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    private readonly orchestrator: VerificationOrchestrator,
    private readonly health: HealthMonitor,
  ) {}

  /**
   * Run one deadline sweep. Returns counts for tests/metrics.
   */
  async sweep(): Promise<DeadlineSweepReport> {
    const now = this.clock.now();
    const graceCutoff = new Date(now.getTime() - this.cfg.networkGraceSeconds * 1000);
    const candidates = await this.prisma.occurrence.findMany({
      where: {
        status: { in: ['scheduled', 'active', 'evidence_submitted', 'reviewing', 'uncertain'] },
        deadlineAt: { lt: graceCutoff },
      },
      include: {
        commitment: { select: { id: true, userId: true, enforcementMode: true, status: true, cancellationEffectiveAt: true } },
        evidence: { select: { id: true }, take: 1 },
        verificationResults: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });

    let failed = 0;
    let heldForSystem = 0;
    let alreadyResolved = 0;

    for (const occ of candidates) {
      if (occ.commitment.status !== 'active') {
        // Commitment was cancelled or completed — skip.
        alreadyResolved += 1;
        continue;
      }
      const cutoff = occ.commitment.cancellationEffectiveAt;
      if (cutoff && occ.windowStartAt.getTime() >= cutoff.getTime()) {
        alreadyResolved += 1;
        continue;
      }

      // If a result already exists, respect it. This lets late verifier
      // callbacks win over the sweep.
      const latest = occ.verificationResults?.[0];
      if (latest) {
        alreadyResolved += 1;
        continue;
      }

      if (this.health.get() === 'system_hold') {
        await this.prisma.occurrence.update({
          where: { id: occ.id },
          data: { status: 'system_hold' },
        });
        heldForSystem += 1;
        continue;
      }

      if ((occ.evidence?.length ?? 0) > 0 || occ.status === 'evidence_submitted' || occ.status === 'reviewing') {
        // Evidence present but no result yet — the verifier is still running.
        // Give it more time by leaving the row in `reviewing`.
        await this.prisma.occurrence.update({
          where: { id: occ.id },
          data: { status: 'reviewing' },
        });
        continue;
      }

      // Genuine candidate FAIL: past deadline, no evidence, platform healthy.
      // Record a behavioral FAIL through the orchestrator so settlement
      // has a proper VerificationResult to consume.
      await this.orchestrator.recordDeadlineFail(occ.id);
      failed += 1;
    }

    return {
      considered: candidates.length,
      failed,
      heldForSystem,
      alreadyResolved,
      at: now.toISOString(),
    };
  }

  onModuleInit(): void {
    if (this.cfg.nodeEnv === 'test') return;
    const intervalMs = 60_000;
    setInterval(() => {
      this.sweep().catch((e) => this.logger.error('sweep failed', (e as Error)?.stack));
    }, intervalMs).unref?.();
  }
}

export interface DeadlineSweepReport {
  considered: number;
  failed: number;
  heldForSystem: number;
  alreadyResolved: number;
  at: string;
}
