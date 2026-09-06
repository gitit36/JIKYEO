import { Injectable, Optional } from '@nestjs/common';
import { Prisma, VerificationOutcome, VerifierType } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { DomainError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { appealWindowFields } from '../settlement/financial-finality';
import { VerificationDecision, VerificationProvider } from './providers/verification-provider';

/**
 * Coordinates producing a VerificationResult for an Occurrence.
 *
 * Boundary invariants (SRD §SR-FR-007):
 *   - Every outcome is exactly one of pass / uncertain / fail.
 *   - This service NEVER settles money. It only records the behavioral
 *     result. SettlementService reads the result and decides financial
 *     consequences.
 *   - System / infrastructure error paths must return `uncertain`, never
 *     `fail`, so a system outage cannot cost the user money.
 */
@Injectable()
export class VerificationOrchestrator {
  constructor(
    private readonly prisma: PrismaService,
    private readonly provider: VerificationProvider,
    private readonly clock: Clock,
    @Optional() private readonly cfg?: AppConfig,
  ) {}

  /**
   * Look up the occurrence + rule, call the appropriate verifier, and
   * persist:
   *   - VerificationResult row
   *   - Occurrence.status transition (via typed state machine caller side)
   *
   * Returns the recorded VerificationResult payload.
   */
  async decidePhoto(input: {
    occurrenceId: string;
    evidenceId: string;
    storageKey: string;
    metadata: Record<string, unknown>;
  }): Promise<PersistedResult> {
    const occ = await this.loadOccurrenceForVerification(input.occurrenceId);
    let decision: VerificationDecision;
    try {
      decision = await this.provider.verifyPhoto({
        occurrenceId: input.occurrenceId,
        goalText: occ.commitment.title,
        proofRule: (occ.commitment.verificationRule?.ruleJson as Record<string, unknown>) ?? {},
        storageKey: input.storageKey,
        metadata: input.metadata,
      });
    } catch (e) {
      // Infrastructure failure → UNCERTAIN, not FAIL. See SRD §9.
      decision = systemHoldDecision(String(e));
    }
    return this.persist(input.occurrenceId, input.evidenceId, 'photo', decision, occ.commitment.enforcementMode === 'money');
  }

  async decideGps(input: {
    occurrenceId: string;
    evidenceId: string;
    userLat: number;
    userLng: number;
    accuracyM: number;
    capturedAt: Date;
    receivedAt: Date;
    mockLocationSuspected: boolean;
  }): Promise<PersistedResult> {
    const occ = await this.loadOccurrenceForVerification(input.occurrenceId);
    const rule = (occ.commitment.verificationRule?.ruleJson as {
      lat?: number;
      lng?: number;
      radius_m?: number;
    }) ?? {};
    if (rule.lat === undefined || rule.lng === undefined || !rule.radius_m) {
      // Rule missing target → treat as uncertain rather than failing user.
      return this.persist(
        input.occurrenceId,
        input.evidenceId,
        'gps',
        systemHoldDecision('GPS_RULE_MISSING'),
        occ.commitment.enforcementMode === 'money',
      );
    }
    let decision: VerificationDecision;
    try {
      decision = await this.provider.verifyGps({
        occurrenceId: input.occurrenceId,
        targetLat: rule.lat,
        targetLng: rule.lng,
        radiusM: rule.radius_m,
        userLat: input.userLat,
        userLng: input.userLng,
        accuracyM: input.accuracyM,
        capturedAt: input.capturedAt,
        receivedAt: input.receivedAt,
        deadlineAt: occ.deadlineAt,
        mockLocationSuspected: input.mockLocationSuspected,
      });
    } catch (e) {
      decision = systemHoldDecision(String(e));
    }
    return this.persist(input.occurrenceId, input.evidenceId, 'gps', decision, occ.commitment.enforcementMode === 'money');
  }

  async decideTimer(input: {
    occurrenceId: string;
    evidenceId: string;
    requiredSeconds: number;
    startedAt: Date;
    finishedAt: Date;
    heartbeatGaps: number[];
    backgroundEvents: number;
    terminated: boolean;
  }): Promise<PersistedResult> {
    const occ = await this.loadOccurrenceForVerification(input.occurrenceId);
    let decision: VerificationDecision;
    try {
      decision = await this.provider.verifyTimer(input);
    } catch (e) {
      decision = systemHoldDecision(String(e));
    }
    return this.persist(input.occurrenceId, input.evidenceId, 'timer', decision, occ.commitment.enforcementMode === 'money');
  }

  /**
   * Direct self-verify. Only produces `pass` or `fail` — no `uncertain`
   * path because the user is asserting knowledge about themselves.
   */
  async decideSelf(input: {
    occurrenceId: string;
    evidenceId: string;
    answer: 'kept' | 'missed';
  }): Promise<PersistedResult> {
    const occ = await this.loadOccurrenceForVerification(input.occurrenceId);
    const decision: VerificationDecision = input.answer === 'kept'
      ? {
          result: 'pass',
          confidence: null,
          reasonCode: 'SELF_KEPT',
          userMessage: '약속을 지켰어요.',
        }
      : {
          result: 'fail',
          confidence: null,
          reasonCode: 'SELF_MISSED',
          userMessage: '약속을 놓쳤어요.',
        };
    return this.persist(input.occurrenceId, input.evidenceId, 'self', decision, occ.commitment.enforcementMode === 'money');
  }

  /**
   * Recorded when a candidate FAIL is confirmed by the deadline worker
   * (i.e. deadline passed with no evidence AND no system outage).
   */
  async recordDeadlineFail(occurrenceId: string): Promise<PersistedResult> {
    const occ = await this.loadOccurrenceForVerification(occurrenceId);
    const decision: VerificationDecision = {
      result: 'fail',
      confidence: null,
      reasonCode: 'DEADLINE_NO_EVIDENCE',
      userMessage: '증거가 없어 약속을 확인하지 못했어요.',
    };
    return this.persist(occurrenceId, null, 'rule', decision, occ.commitment.enforcementMode === 'money');
  }

  private async loadOccurrenceForVerification(occurrenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        commitment: { include: { verificationRule: true } },
      },
    });
    if (!occ) throw new DomainError('NOT_FOUND', 'Occurrence not found');
    if (occ.commitment.status !== 'active') {
      throw new DomainError('OCCURRENCE_NOT_ACTIVE', '아직 시작되지 않은 약속이에요.');
    }
    return occ;
  }

  /**
   * Persist verification result and transition the occurrence status
   * accordingly. Written as a single transaction so a partial write can't
   * leave an occurrence in an inconsistent state.
   */
  private async persist(
    occurrenceId: string,
    evidenceId: string | null,
    verifierType: VerifierType,
    decision: VerificationDecision,
    isMoneyCommitment: boolean,
  ): Promise<PersistedResult> {
    const status = mapOutcomeToOccurrenceStatus(decision.result);
    const result = await this.prisma.$transaction(async (tx) => {
      const created = await tx.verificationResult.create({
        data: {
          occurrenceId,
          evidenceId,
          verifierType,
          result: decision.result,
          confidence: decision.confidence !== null && decision.confidence !== undefined
            ? new Prisma.Decimal(decision.confidence)
            : null,
          reasonCode: decision.reasonCode,
          reasonText: decision.userMessage,
          userMessage: decision.userMessage,
          modelVersion: decision.modelVersion ?? null,
        },
      });
      const now = this.clock.now();
      const current = await tx.occurrence.findUnique({ where: { id: occurrenceId } });
      const moneyFail = isMoneyCommitment && decision.result === 'fail';
      const window = moneyFail
        ? appealWindowFields(now, this.cfg?.appealWindowSeconds ?? 7 * 24 * 3600, current ?? undefined)
        : null;
      await tx.occurrence.update({
        where: { id: occurrenceId },
        data: {
          status,
          decidedAt: now,
          failureReasonCode: decision.result === 'fail' ? decision.reasonCode : null,
          ...(window ? window : {}),
        },
      });
      return created;
    });
    return {
      occurrenceId,
      resultId: result.id,
      result: decision.result,
      reasonCode: decision.reasonCode,
      userMessage: decision.userMessage,
      confidence: decision.confidence ?? null,
      isMoneyCommitment,
    };
  }
}

export interface PersistedResult {
  occurrenceId: string;
  resultId: string;
  result: VerificationOutcome;
  reasonCode: string;
  userMessage: string;
  confidence: number | null;
  /** True iff the parent Commitment is MONEY. Result UI adapts. */
  isMoneyCommitment: boolean;
}

function mapOutcomeToOccurrenceStatus(outcome: VerificationOutcome): 'pass' | 'uncertain' | 'fail' {
  return outcome;
}

function systemHoldDecision(reasonDetail: string): VerificationDecision {
  return {
    result: 'uncertain',
    confidence: null,
    reasonCode: 'SYSTEM_HOLD',
    userMessage: '지금은 확인이 어려워요. 잠시 후 다시 시도해주세요.',
    modelVersion: reasonDetail.slice(0, 32),
  };
}
