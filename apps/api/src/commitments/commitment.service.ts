import { Injectable, Optional } from '@nestjs/common';
import { CancellationReason, Commitment, EnforcementMode, Prisma, VerificationMethod } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { MoneyStatusService, MoneyView } from '../payments/money-status.service';
import { LedgerService } from '../payments/ledger.service';
import { PaymentService, PaymentView } from '../payments/payment.service';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { Money } from '../common/money/money';
import { commitmentSM, CommitmentState } from '../common/state/commitment.state';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoalSafetyClassifier } from '../safety/goal-safety.classifier';
import { StakePolicyService } from '../stake-policy/stake-policy.service';
import { UsersService } from '../users/users.service';
import { AppealService, OccurrenceAppealSummary } from '../appeals/appeal.service';
import { MoneyGateService } from '../users/money-gate.service';
import { FriendsService } from '../friends/friends.service';
import { SharedCommitmentService } from '../friends/shared-commitment.service';
import { CreateCommitmentDraftDto } from './dto/create-commitment.dto';
import { QuoteCacheService } from './quote/quote-cache.service';
import { ScheduleService } from './schedule/schedule.service';

export interface CancelUnsignedResult {
  commitmentId: string;
  status: CommitmentState;
  cancellationReason: CancellationReason | null;
  idempotent: boolean;
  money: MoneyView | null;
  refund: PaymentView | null;
  effectiveAt: string | null;
  bindingOccurrenceCount: number;
  voidOccurrenceCount: number;
  bindingAmountKrw: string | null;
  futureRefundableAmountKrw: string | null;
}

interface ActivateResult {
  commitmentId: string;
  status: CommitmentState;
  enforcementMode: EnforcementMode;
  occurrenceCount: number;
  /** MONEY-only. `null` for SELF/SOCIAL. */
  maxLossKrw: string | null;
  /** True iff the client must complete `POST /commitments/:id/pay` before the commitment is live. */
  paymentRequired: boolean;
}

/**
 * Owns commitment creation & activation across all three enforcement modes.
 *
 *   - SELF   → no quote / no stake / no payment. Activates immediately.
 *   - SOCIAL → no quote / no stake. Requires a real observer relation
 *              before activation. Release builds without one are rejected
 *              (`FRIEND_NOT_SELECTED`).
 *   - MONEY  → server-quote required, single-use consumed, stake row
 *              created, StakePolicy tier limits re-enforced.
 *
 * Verification is decided by other services once evidence lands. The
 * commitment layer never makes verification or financial decisions.
 */
@Injectable()
export class CommitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedule: ScheduleService,
    private readonly quoteCache: QuoteCacheService,
    private readonly safety: GoalSafetyClassifier,
    private readonly users: UsersService,
    private readonly stakePolicy: StakePolicyService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    @Optional() private readonly moneyStatus?: MoneyStatusService,
    @Optional() private readonly payments?: PaymentService,
    @Optional() private readonly cfg?: AppConfig,
    @Optional() private readonly appeals?: AppealService,
    @Optional() private readonly moneyGate?: MoneyGateService,
    @Optional() private readonly ledger?: LedgerService,
    @Optional() private readonly friends?: FriendsService,
    @Optional() private readonly shared?: SharedCommitmentService,
  ) {}

  get signatureExpirySeconds(): number {
    return this.cfg?.signatureExpirySeconds ?? 1_800;
  }

  async createAndActivate(userId: string, dto: CreateCommitmentDraftDto): Promise<ActivateResult> {
    // 1. Safety pre-check (server-authoritative). Applies to every mode.
    const safety = await this.safety.classify(dto.title);
    if (safety.decision === 'blocked') {
      throw new DomainError('GOAL_UNSAFE', safety.userMessage, { reasonCode: safety.reasonCode });
    }
    if (safety.decision === 'stake_disallowed' && dto.enforcementMode === 'money') {
      throw new DomainError('GOAL_UNSAFE', safety.userMessage, { reasonCode: safety.reasonCode });
    }

    // 2. Mode-specific gates.
    if (dto.enforcementMode === 'money') {
      if (!dto.quoteId) {
        throw new DomainError('QUOTE_REQUIRED_FOR_MODE', '금액 약속에는 서버 시세가 필요해요.');
      }
      const stakeIn = dto.stakeTotalKrw ?? dto.stakePerOccurrenceKrw;
      if (!stakeIn || stakeIn <= 0) {
        throw new ValidationError('stakeTotalKrw is required for MONEY');
      }
      await this.moneyGate?.assertCanUseMoney(userId);
    } else {
      // SELF / SOCIAL: quote and stake fields must not be present at all.
      if (dto.quoteId) {
        throw new DomainError(
          'QUOTE_NOT_ALLOWED_FOR_MODE',
          '이 강제력에서는 약속금이 없어 서버 시세가 필요하지 않아요.',
        );
      }
      if (dto.stakeTotalKrw != null || dto.stakePerOccurrenceKrw != null) {
        throw new ValidationError('stake not allowed for non-MONEY modes');
      }
    }

    if (dto.enforcementMode === 'social' || dto.verification.method === 'friend') {
      if (!dto.observer || !dto.observer.observerUserId) {
        throw new DomainError('FRIEND_NOT_SELECTED', '친구를 먼저 지정해주세요.');
      }
      if (dto.observer.observerUserId === userId) {
        throw new DomainError('VALIDATION', '자기 자신을 친구로 지정할 수 없어요.');
      }
      if (this.friends) {
        await this.friends.assertAccepted(userId, dto.observer.observerUserId);
      }
    }

    let scheduleInput = dto.schedule.toDomain();
    if (dto.sharedCommitmentId && this.shared) {
      const def = await this.shared.definition(dto.sharedCommitmentId);
      dto.title = def.title;
      dto.category = def.category;
      dto.timezone = def.timezone;
      scheduleInput = def.scheduleJson as unknown as import('./schedule/schedule.types').ScheduleInput;
    }

    // 3. Expand schedule server-side.
    const plans = this.schedule.expand(scheduleInput, dto.timezone);
    if (plans.length === 0) {
      throw new ValidationError('Schedule produces no occurrences');
    }

    if (dto.verification.method === 'photo' && this.cfg && !this.cfg.photoEnabled) {
      throw new DomainError('METHOD_UNAVAILABLE', '사진 확인은 아직 준비 중이에요.');
    }

    // 4. Validate verification rule shape against method. Same for all modes.
    this.assertVerificationRule(dto.verification.method, dto.verification);

    // 5. Mode-specific quote verification + stake computation.
    let stakeTotal: bigint | null = null;
    let maxLoss: bigint | null = null;
    let claimsJti: string | null = null;
    let contractStrictness: 'perfect' | 'realistic' | 'flexible' | null = null;
    let allowedFails: number | null = null;

    if (dto.enforcementMode === 'money') {
      const claims = this.quoteCache.verify(dto.quoteId!);
      claimsJti = claims.jti;
      const requested = Money.fromNumber(dto.stakeTotalKrw ?? dto.stakePerOccurrenceKrw!);
      const quotedTotal = claims.stakeTotal ?? claims.stakePerOccurrence;
      stakeTotal = requested;
      maxLoss = requested;
      contractStrictness = claims.contractStrictness ?? 'realistic';
      allowedFails = claims.allowedFailCount;
      if (
        plans.length !== claims.occurrenceCount ||
        requested.toString() !== quotedTotal ||
        maxLoss.toString() !== claims.maxLoss ||
        (dto.contractStrictness && dto.contractStrictness !== claims.contractStrictness)
      ) {
        throw new DomainError('QUOTE_EXPIRED', 'Quote no longer matches the schedule');
      }
      await this.stakePolicy.assertWithinLimits(userId, Number(requested), Number(maxLoss));
    }

    // 6. Persist in one transaction.
    // MONEY commitments are NOT active yet: they wait in `payment_pending`
    // until the upfront charge succeeds (PaymentService.chargeUpfront), and
    // the signature ritual is recorded afterwards (`sign`). SELF/SOCIAL have
    // no payment step and activate immediately with the signature.
    const initialStatus: CommitmentState = dto.enforcementMode === 'money' ? 'payment_pending' : 'active';
    const commitmentId = await this.prisma.$transaction(async (tx) => {
      // MONEY: consume the single-use quote first. Unique-PK on jti serialises
      // concurrent reuse; SELF/SOCIAL skip this entirely.
      if (claimsJti) {
        try {
          await tx.consumedQuote.create({ data: { jti: claimsJti, userId } });
        } catch (e) {
          const err = e as { code?: string };
          if (err.code === 'P2002') {
            throw new DomainError('QUOTE_ALREADY_CONSUMED', '이미 사용된 약속이에요.');
          }
          throw e;
        }
      }

      const commitment = await tx.commitment.create({
        data: {
          userId,
          title: dto.title.trim(),
          category: dto.category,
          direction: 'do_action',
          enforcementMode: dto.enforcementMode,
          scheduleType: scheduleInput.type,
          scheduleJson: scheduleInput as unknown as Prisma.InputJsonValue,
          startAt: plans[0].windowStartAt,
          endAt: plans[plans.length - 1].deadlineAt,
          timezone: dto.timezone,
          strictness: 'normal',
          extensionAllowed: false,
          status: initialStatus,
          maxLossAmount: maxLoss ?? null,
          currency: dto.enforcementMode === 'money' ? 'KRW' : null,
          signedAt: initialStatus === 'active' ? this.clock.now() : null,
          signatureCompleted: initialStatus === 'active',
          contractVersion: 'v1',
          ...({
            contractStrictness,
            allowedFailCount: allowedFails,
            sharedCommitmentId: dto.sharedCommitmentId ?? null,
          } as object),
        } as Prisma.CommitmentUncheckedCreateInput,
      });

      if (dto.enforcementMode === 'money' && stakeTotal !== null && maxLoss !== null) {
        await tx.stake.create({
          data: {
            commitmentId: commitment.id,
            perOccurrenceAmount: maxLoss,
            maxTotalAmount: maxLoss,
            currency: 'KRW',
            settlementMode: 'contract_v1',
            recipientType: 'platform',
            status: 'pending',
          },
        });
      }

      await tx.verificationRule.create({
        data: {
          commitmentId: commitment.id,
          method: dto.verification.method,
          ruleJson: this.buildRuleJson(dto.verification) as unknown as Prisma.InputJsonValue,
          fallbackType: 'appeal',
        },
      });

      if (dto.observer && dto.observer.observerUserId) {
        await tx.commitmentObserver.create({
          data: {
            commitmentId: commitment.id,
            observerUserId: dto.observer.observerUserId,
            role: dto.verification.method === 'friend' ? 'verifier' : 'viewer',
            notifyOnSuccess: true,
            notifyOnFail: true,
          },
        });
      }

      await tx.occurrence.createMany({
        data: plans.map((p) => ({
          commitmentId: commitment.id,
          sequenceNo: p.sequenceNo,
          windowStartAt: p.windowStartAt,
          deadlineAt: p.deadlineAt,
          periodKey: p.periodKey ?? null,
          stakeAmount: null,
          status: 'scheduled' as const,
        })),
      });

      if (claimsJti) {
        await tx.consumedQuote.update({
          where: { jti: claimsJti },
          data: { commitmentId: commitment.id },
        });
      }

      return commitment.id;
    });

    if (dto.sharedCommitmentId && this.shared) {
      await this.shared.attachCommitment(userId, dto.sharedCommitmentId, commitmentId);
      await this.shared.lockIfStarted(dto.sharedCommitmentId);
    }
    if (dto.enforcementMode === 'social' && dto.observer?.observerUserId) {
      await this.shared?.notifyPartnerSelected(userId, dto.observer.observerUserId, commitmentId);
    }

    await this.audit.log({
      actorType: 'user',
      actorId: userId,
      entityType: 'commitment',
      entityId: commitmentId,
      action: 'create_and_activate',
      after: {
        title: dto.title,
        enforcementMode: dto.enforcementMode,
        occurrenceCount: plans.length,
        maxLossKrw: maxLoss?.toString() ?? null,
      },
    });

    return {
      commitmentId,
      status: initialStatus,
      enforcementMode: dto.enforcementMode,
      occurrenceCount: plans.length,
      maxLossKrw: maxLoss?.toString() ?? null,
      paymentRequired: initialStatus === 'payment_pending',
    };
  }

  /**
   * Records the signature ritual. MONEY: requires a funded Stake; transitions
   * `signature_pending → active`. Idempotent once active. Signing before
   * funding is rejected. SELF/SOCIAL are already active at create time.
   */
  async sign(userId: string, commitmentId: string): Promise<{ commitmentId: string; status: CommitmentState; signedAt: string }> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    if (c.status === 'cancelled') {
      throw new DomainError('INVALID_STATE_TRANSITION', '취소된 약속에는 서명할 수 없어요.');
    }
    if (c.enforcementMode === 'money') {
      if (!c.stake || c.stake.status === 'pending') {
        throw new DomainError('INVALID_STATE_TRANSITION', '결제가 끝나야 서명할 수 있어요.');
      }
    }
    if (c.status === 'active' && c.signatureCompleted && c.signedAt) {
      return { commitmentId: c.id, status: 'active', signedAt: c.signedAt.toISOString() };
    }
    const signedAt = c.signedAt ?? this.clock.now();
    commitmentSM.assert('signature_pending', 'active');
    const won = await this.prisma.commitment.updateMany({
      where: { id: c.id, status: 'signature_pending' },
      data: { status: 'active', signedAt, signatureCompleted: true },
    });
    if (won.count === 0) {
      const again = await this.prisma.commitment.findUnique({ where: { id: c.id } });
      if (again?.status === 'active' && again.signatureCompleted && again.signedAt) {
        return { commitmentId: c.id, status: 'active', signedAt: again.signedAt.toISOString() };
      }
      throw new DomainError('INVALID_STATE_TRANSITION', '이 약속은 이미 취소되었거나 시작할 수 없어요.');
    }
    return { commitmentId: c.id, status: 'active', signedAt: signedAt.toISOString() };
  }

  /**
   * Owner cancel. Unsigned (draft / payment_pending / signature_pending) keeps
   * the Phase 5A path. Active commitments schedule a future-only cutoff.
   */
  async cancel(
    userId: string,
    commitmentId: string,
    opts: { simulateRefundFail?: boolean } = {},
  ): Promise<CancelUnsignedResult> {
    const c = await this.getOwned(userId, commitmentId);
    if (c.status === 'active' || c.cancellationRequestedAt) {
      return this.cancelActive(userId, c.id);
    }
    return this.cancelUnsigned({
      commitmentId: c.id,
      actorType: 'user',
      actorId: userId,
      reason: 'user_cancelled',
      simulateRefundFail: opts.simulateRefundFail,
    });
  }

  async previewCancel(userId: string, commitmentId: string): Promise<CancelUnsignedResult> {
    const c = await this.getOwned(userId, commitmentId);
    if (c.status === 'completed' && !c.cancellationRequestedAt) {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 끝난 약속은 취소할 수 없어요.');
    }
    if (c.status === 'cancelled' || c.cancellationRequestedAt) {
      return this.cancelSnapshot(c.id, true, null, c.cancellationEffectiveAt ?? c.cancelledAt);
    }
    const now = this.clock.now();
    const effectiveAt = this.computeEffectiveAt(c.enforcementMode, now);
    return this.cancelSnapshot(c.id, true, null, effectiveAt);
  }

  async expireOverdue(): Promise<{ expired: number }> {
    const now = this.clock.now();
    const due = await this.prisma.commitment.findMany({
      where: { status: 'signature_pending', signatureExpiresAt: { lte: now } },
      select: { id: true },
      take: 200,
    });
    let expired = 0;
    for (const row of due) {
      try {
        const r = await this.cancelUnsigned({
          commitmentId: row.id,
          actorType: 'system',
          actorId: null,
          reason: 'signature_expired',
        });
        if (r.status === 'cancelled' && r.cancellationReason === 'signature_expired') expired += 1;
      } catch (e) {
        if ((e as DomainError).code === 'INVALID_STATE_TRANSITION') continue;
        throw e;
      }
    }
    return { expired };
  }

  async applyCancellationEffective(): Promise<{ voided: number; completed: number }> {
    const now = this.clock.now();
    const due = await this.prisma.commitment.findMany({
      where: {
        status: 'active',
        cancellationRequestedAt: { lte: now },
        cancellationReason: 'user_cancelled',
      },
      select: { id: true },
      take: 200,
    });
    let voided = 0;
    let completed = 0;
    for (const row of due) {
      voided += await this.voidEligibleFuture(row.id);
      if (await this.completeIfResolved(row.id)) completed += 1;
    }
    return { voided, completed };
  }

  private async cancelActive(userId: string, commitmentId: string): Promise<CancelUnsignedResult> {
    const c = await this.getOwned(userId, commitmentId);
    if (c.status === 'completed' && !c.cancellationRequestedAt) {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 끝난 약속은 취소할 수 없어요.');
    }
    if (c.status === 'cancelled') return this.cancelView(c.id, true);
    if (c.cancellationRequestedAt && c.cancellationEffectiveAt) {
      return this.cancelSnapshot(c.id, true, null, c.cancellationEffectiveAt);
    }
    if (c.status !== 'active') {
      throw new DomainError('INVALID_STATE_TRANSITION', '이 약속은 취소할 수 없어요.');
    }

    const now = this.clock.now();
    if (c.enforcementMode === 'money') {
      return this.cancelMoneyV1(c.id, userId, now, 'user_cancelled');
    }
    const effectiveAt = this.computeEffectiveAt(c.enforcementMode, now);
    const won = await this.prisma.commitment.updateMany({
      where: { id: c.id, status: 'active', cancellationRequestedAt: null },
      data: {
        cancellationRequestedAt: now,
        cancellationEffectiveAt: effectiveAt,
        cancellationReason: 'user_cancelled',
      },
    });
    if (won.count === 0) {
      const again = await this.prisma.commitment.findUnique({ where: { id: c.id } });
      if (again?.cancellationEffectiveAt) {
        return this.cancelSnapshot(again.id, true, null, again.cancellationEffectiveAt);
      }
      throw new DomainError('INVALID_STATE_TRANSITION', '이 약속은 취소할 수 없어요.');
    }

    if (effectiveAt.getTime() <= now.getTime()) {
      await this.voidEligibleFuture(c.id);
      await this.completeIfResolved(c.id);
    }

    await this.audit.log({
      actorType: 'user',
      actorId: userId,
      entityType: 'commitment',
      entityId: c.id,
      action: 'cancel_active',
      after: { effectiveAt: effectiveAt.toISOString(), mode: c.enforcementMode },
    });
    return this.cancelSnapshot(c.id, false, null, effectiveAt);
  }

  async cancelSystem(commitmentId: string, actorId: string | null): Promise<CancelUnsignedResult> {
    const c = await this.prisma.commitment.findUnique({ where: { id: commitmentId } });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.enforcementMode !== 'money') {
      return this.cancelUnsigned({ commitmentId, actorType: 'system', actorId, reason: 'system_cancelled' });
    }
    if (c.status === 'cancelled' && c.cancellationReason === 'system_cancelled') {
      return this.cancelView(c.id, true);
    }
    return this.cancelMoneyV1(c.id, actorId, this.clock.now(), 'system_cancelled');
  }

  private async cancelMoneyV1(
    commitmentId: string,
    actorId: string | null,
    now: Date,
    reason: 'user_cancelled' | 'system_cancelled',
  ): Promise<CancelUnsignedResult> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { stake: true },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.status === 'cancelled') return this.cancelView(c.id, true);
    const started = now.getTime() >= c.startAt.getTime();
    const abandon = reason === 'user_cancelled' && started;
    const outcome = abandon ? 'failed' : 'voided';
    const won = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.commitment.updateMany({
        where: { id: c.id, status: { in: ['active', 'signature_pending'] } },
        data: {
          status: abandon ? 'completed' : 'cancelled',
          cancelledAt: now,
          cancellationRequestedAt: now,
          cancellationEffectiveAt: now,
          cancellationReason: reason,
          ...({ contractOutcome: outcome } as object),
        } as object,
      });
      if (moved.count === 0) return 0;
      await tx.occurrence.updateMany({
        where: { commitmentId: c.id, status: { in: ['scheduled', 'active'] } },
        data: { status: 'void', failureReasonCode: abandon ? 'contract_abandoned' : 'commitment_cancelled', decidedAt: now },
      });
      if (c.stake) {
        await tx.stake.updateMany({
          where: { id: c.stake.id, status: { in: ['funded', 'pending'] } },
          data: { status: abandon ? 'settled' : 'settling', settledAt: now },
        });
      }
      return moved.count;
    });
    if (won === 0) return this.cancelView(c.id, true);

    let refund: PaymentView | null = null;
    if (abandon && this.ledger && c.stake) {
      await this.ledger.append({
        userId: c.userId,
        commitmentId: c.id,
        entryType: 'forfeit',
        amount: c.stake.maxTotalAmount,
        idempotencyKey: `contract_forfeit:${c.id}`,
      });
    } else if (this.payments) {
      const charge = await this.prisma.payment.findFirst({
        where: { commitmentId: c.id, type: 'charge', status: 'succeeded' },
      });
      if (charge) {
        refund = await this.payments.refundAggregate(c.id, charge.amount, `contract_cancel:${c.id}`);
      }
    }

    await this.audit.log({
      actorType: reason === 'system_cancelled' ? 'system' : 'user',
      actorId,
      entityType: 'commitment',
      entityId: c.id,
      action: abandon ? 'cancel_abandon' : 'cancel_money_v1',
      after: { reason, outcome, started },
    });
    return this.cancelSnapshot(c.id, false, refund, now);
  }

  async cancelUnsigned(input: {
    commitmentId: string;
    actorType: 'user' | 'system' | 'admin';
    actorId: string | null;
    reason: CancellationReason;
    simulateRefundFail?: boolean;
  }): Promise<CancelUnsignedResult> {
    let c = await this.prisma.commitment.findUnique({
      where: { id: input.commitmentId },
      include: { stake: true },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.status === 'active' || c.status === 'completed') {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 시작된 약속은 이 방법으로 취소할 수 없어요.');
    }
    if (c.status === 'cancelled') {
      return this.cancelView(c.id, true);
    }
    if (c.status !== 'payment_pending' && c.status !== 'signature_pending' && c.status !== 'draft') {
      throw new DomainError('INVALID_STATE_TRANSITION', '이 약속은 취소할 수 없어요.');
    }

    if (c.status === 'payment_pending' && this.payments) {
      const unknown = await this.prisma.payment.findMany({
        where: { commitmentId: c.id, type: 'charge', status: 'requested' },
      });
      for (const p of unknown) await this.payments.reconcilePayment(p);
      c = await this.prisma.commitment.findUnique({
        where: { id: c.id },
        include: { stake: true },
      });
      if (!c) throw new NotFoundError('Commitment not found');
      if (c.status === 'active' || c.status === 'completed') {
        throw new DomainError('INVALID_STATE_TRANSITION', '이미 시작된 약속은 이 방법으로 취소할 수 없어요.');
      }
      if (c.status === 'cancelled') return this.cancelView(c.id, true);
    }

    const stillUnknown = await this.prisma.payment.findFirst({
      where: { commitmentId: c.id, type: 'charge', status: 'requested', providerPaymentKey: { not: null } },
    });
    if (stillUnknown) {
      throw new DomainError('PAYMENT_PROVIDER_ERROR', '결제 결과를 확인한 뒤 다시 시도해주세요.');
    }

    const charge = await this.prisma.payment.findFirst({
      where: { commitmentId: c.id, type: 'charge', status: 'succeeded' },
    });
    const now = this.clock.now();
    commitmentSM.assert(c.status as CommitmentState, 'cancelled');

    const won = await this.prisma.$transaction(async (tx) => {
      const moved = await tx.commitment.updateMany({
        where: { id: c!.id, status: { in: ['draft', 'payment_pending', 'signature_pending'] } },
        data: {
          status: 'cancelled',
          cancelledAt: now,
          cancellationReason: input.reason,
        },
      });
      if (moved.count === 0) return 0;
      await tx.occurrence.updateMany({
        where: { commitmentId: c!.id, status: { in: ['scheduled', 'active'] } },
        data: { status: 'void' },
      });
      if (charge && c!.stake) {
        await tx.stake.updateMany({
          where: { id: c!.stake.id, status: 'funded' },
          data: { status: 'settling', settledAt: now },
        });
      }
      return moved.count;
    });

    if (won === 0) {
      const again = await this.prisma.commitment.findUnique({ where: { id: c.id } });
      if (again?.status === 'cancelled') return this.cancelView(c.id, true);
      throw new DomainError('INVALID_STATE_TRANSITION', '이 약속은 이미 시작되었어요.');
    }

    let refund: PaymentView | null = null;
    if (charge && this.payments) {
      const reason = input.simulateRefundFail
        ? `unsigned_cancel:${c.id}:simulate:refund_fail`
        : `unsigned_cancel:${c.id}`;
      refund = await this.payments.refundAggregate(c.id, charge.amount, reason);
    }

    await this.audit.log({
      actorType: input.actorType,
      actorId: input.actorId,
      entityType: 'commitment',
      entityId: c.id,
      action: input.reason === 'signature_expired' ? 'signature_expired' : 'cancel_unsigned',
      after: { reason: input.reason, refunded: refund?.status ?? null },
    });

    return this.cancelView(c.id, false, refund);
  }

  private async cancelView(
    commitmentId: string,
    idempotent: boolean,
    refund: PaymentView | null = null,
  ): Promise<CancelUnsignedResult> {
    const c = await this.prisma.commitment.findUnique({ where: { id: commitmentId } });
    const money = this.moneyStatus ? await this.moneyStatus.forCommitment(commitmentId) : null;
    if (!refund && this.payments) {
      refund = await this.payments.findSucceededRefund(commitmentId);
    }
    const effectiveAt = c?.cancellationEffectiveAt ?? c?.cancelledAt ?? null;
    return this.cancelSnapshot(commitmentId, idempotent, refund, effectiveAt);
  }

  private computeEffectiveAt(_mode: EnforcementMode, now: Date): Date {
    return now;
  }

  private async voidEligibleFuture(commitmentId: string): Promise<number> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: {
        occurrences: { include: { evidence: { select: { id: true }, take: 1 }, appeal: true } },
      },
    });
    const cutoff = c?.cancellationRequestedAt ?? c?.cancellationEffectiveAt;
    if (!c || !cutoff) return 0;
    const now = this.clock.now();
    if (cutoff.getTime() > now.getTime()) return 0;
    let voided = 0;
    for (const occ of c.occurrences) {
      if (!this.canVoidForCancel(occ, cutoff)) continue;
      const won = await this.prisma.$transaction(async (tx) => {
        const fresh = await tx.occurrence.findUnique({
          where: { id: occ.id },
          include: { evidence: { select: { id: true }, take: 1 }, appeal: true },
        });
        if (!fresh || !this.canVoidForCancel(fresh, cutoff)) return 0;
        const moved = await tx.occurrence.updateMany({
          where: { id: occ.id, status: { in: ['scheduled', 'active'] } },
          data: { status: 'void', failureReasonCode: 'commitment_cancelled', decidedAt: now },
        });
        return moved.count;
      });
      if (won === 1) voided += 1;
    }
    return voided;
  }

  private canVoidForCancel(
    occ: {
      status: string;
      windowStartAt: Date;
      evidence: { id: string }[];
      appeal: { status: string } | null;
    },
    effectiveAt: Date,
  ): boolean {
    if (!occ.windowStartAt || occ.windowStartAt.getTime() < effectiveAt.getTime()) return false;
    if (occ.evidence?.length) return false;
    if (occ.appeal && (occ.appeal.status === 'submitted' || occ.appeal.status === 'reviewing')) return false;
    if (!['scheduled', 'active'].includes(occ.status)) return false;
    return true;
  }

  private async completeIfResolved(commitmentId: string): Promise<boolean> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { occurrences: { include: { appeal: true } } },
    });
    if (!c || c.status !== 'active' || c.enforcementMode === 'money') return false;
    const open = c.occurrences.some((o) => {
      if (o.appeal && (o.appeal.status === 'submitted' || o.appeal.status === 'reviewing')) return true;
      return !['pass', 'fail', 'void'].includes(o.status);
    });
    if (open) return false;
    const won = await this.prisma.commitment.updateMany({
      where: { id: c.id, status: 'active' },
      data: { status: 'completed' },
    });
    return won.count === 1;
  }

  private async cancelSnapshot(
    commitmentId: string,
    idempotent: boolean,
    refund: PaymentView | null,
    effectiveAt: Date | null,
  ): Promise<CancelUnsignedResult> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: {
        stake: true,
        occurrences: { include: { evidence: { select: { id: true }, take: 1 }, appeal: true } },
      },
    });
    const money = this.moneyStatus ? await this.moneyStatus.forCommitment(commitmentId) : null;
    if (!refund && this.payments) {
      refund = await this.payments.findSucceededRefund(commitmentId);
    }
    const cutoff = c?.cancellationRequestedAt ?? effectiveAt ?? c?.cancellationEffectiveAt ?? c?.cancelledAt ?? this.clock.now();
    let binding = 0;
    let voidN = 0;
    const unsignedCancelled = c?.status === 'cancelled';
    for (const o of c?.occurrences ?? []) {
      const willVoid =
        o.status === 'void' && (o.failureReasonCode === 'commitment_cancelled' || o.failureReasonCode === 'contract_abandoned' || unsignedCancelled)
          ? true
          : this.canVoidForCancel(o, cutoff);
      if (willVoid) voidN += 1;
      else binding += 1;
    }
    const moneyMode = c?.enforcementMode === 'money';
    const v1 = moneyMode && c?.stake?.settlementMode === 'contract_v1';
    const started = !!(c?.startAt && cutoff.getTime() >= c.startAt.getTime());
    const abandon = v1 && started && c?.cancellationReason !== 'system_cancelled';
    const total = c?.stake?.maxTotalAmount ?? 0n;
    return {
      commitmentId,
      status: (c?.status ?? 'cancelled') as CommitmentState,
      cancellationReason: (c?.cancellationReason ?? null) as CancellationReason | null,
      idempotent,
      money,
      refund,
      effectiveAt: cutoff.toISOString(),
      bindingOccurrenceCount: binding,
      voidOccurrenceCount: voidN,
      bindingAmountKrw: moneyMode ? (v1 ? (abandon ? total.toString() : '0') : null) : null,
      futureRefundableAmountKrw: moneyMode ? (v1 ? (abandon ? '0' : total.toString()) : '0') : null,
    };
  }

  async getOwned(userId: string, commitmentId: string): Promise<Commitment> {
    const c = await this.prisma.commitment.findUnique({ where: { id: commitmentId } });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    return c;
  }

  async getOwnedList(userId: string): Promise<unknown[]> {
    const rows = await this.prisma.commitment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        verificationRule: { select: { method: true } },
        stake: { select: { perOccurrenceAmount: true, maxTotalAmount: true, status: true } },
        _count: { select: { occurrences: true } },
      },
    });
    const moneyViews = await this.moneyViewsFor(rows.filter((r) => r.enforcementMode === 'money').map((r) => r.id));
    const appealMap = await this.appealSummaries(rows.map((r) => r.id));
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      category: r.category,
      status: r.status,
      enforcementMode: r.enforcementMode,
      timezone: r.timezone,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      maxLossKrw: r.maxLossAmount?.toString() ?? null,
      verificationMethod: r.verificationRule?.method ?? null,
      perOccurrenceKrw: r.stake?.perOccurrenceAmount.toString() ?? null,
      occurrenceCount: r._count.occurrences,
      signatureExpiresAt: r.signatureExpiresAt?.toISOString() ?? null,
      cancellationReason: r.cancellationReason,
      cancellationRequestedAt: r.cancellationRequestedAt?.toISOString() ?? null,
      cancellationEffectiveAt: r.cancellationEffectiveAt?.toISOString() ?? null,
      // MONEY-only derived money state (결제 중 / 약속금 걸림 / 환불 예정 …). null otherwise.
      money: moneyViews.get(r.id) ?? null,
      appeals: r.enforcementMode === 'money' ? appealMap.get(r.id) ?? [] : [],
    }));
  }

  private async appealSummaries(commitmentIds: string[]): Promise<Map<string, OccurrenceAppealSummary[]>> {
    if (!this.appeals || commitmentIds.length === 0) return new Map();
    return this.appeals.summariesForCommitments(commitmentIds);
  }

  private async moneyViewsFor(commitmentIds: string[]): Promise<Map<string, MoneyView>> {
    if (!this.moneyStatus || commitmentIds.length === 0) return new Map();
    return this.moneyStatus.forCommitments(commitmentIds);
  }

  async getOwnedDetail(userId: string, commitmentId: string): Promise<unknown> {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: {
        verificationRule: true,
        stake: true,
        observers: true,
        occurrences: { orderBy: { sequenceNo: 'asc' } },
      },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    if (c.userId !== userId) throw new ForbiddenError();
    const money = c.enforcementMode === 'money' ? (await this.moneyViewsFor([c.id])).get(c.id) ?? null : null;
    const appealMap = await this.appealSummaries([c.id]);
    const appeals = appealMap.get(c.id) ?? [];
    const appealByOcc = new Map(appeals.map((a) => [a.occurrenceId, a]));
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      direction: c.direction,
      status: c.status,
      enforcementMode: c.enforcementMode,
      signatureCompleted: c.signatureCompleted,
      signatureExpiresAt: c.signatureExpiresAt?.toISOString() ?? null,
      cancellationReason: c.cancellationReason,
      cancellationRequestedAt: c.cancellationRequestedAt?.toISOString() ?? null,
      cancellationEffectiveAt: c.cancellationEffectiveAt?.toISOString() ?? null,
      money,
      timezone: c.timezone,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
      maxLossKrw: c.maxLossAmount?.toString() ?? null,
      verification: c.verificationRule
        ? { method: c.verificationRule.method, rule: c.verificationRule.ruleJson }
        : null,
      stake: c.stake
        ? {
            perOccurrenceKrw: c.stake.perOccurrenceAmount.toString(),
            maxTotalKrw: c.stake.maxTotalAmount.toString(),
            status: c.stake.status,
          }
        : null,
      observers: c.observers.map((o) => ({
        role: o.role,
        observerUserId: o.observerUserId,
      })),
      appeals,
      occurrences: c.occurrences.map((o) => {
        const a = appealByOcc.get(o.id);
        return {
          id: o.id,
          sequenceNo: o.sequenceNo,
          windowStartAt: o.windowStartAt.toISOString(),
          deadlineAt: o.deadlineAt.toISOString(),
          status: o.status,
          stakeKrw: o.stakeAmount?.toString() ?? null,
          originalResult: a?.originalResult ?? o.status,
          effectiveResult: a?.effectiveResult ?? o.status,
          appealOpenedAt: o.appealOpenedAt?.toISOString() ?? null,
          appealDeadlineAt: o.appealDeadlineAt?.toISOString() ?? null,
          appeal: a ?? null,
        };
      }),
    };
  }

  private buildRuleJson(v: CreateCommitmentDraftDto['verification']): Record<string, unknown> {
    switch (v.method) {
      case 'gps':
        return {
          lat: v.gps!.lat,
          lng: v.gps!.lng,
          radius_m: v.gps!.radiusM,
          user_selected: true,
          label: v.gps!.label ?? null,
          must_enter_before_deadline: true,
        };
      case 'timer':
        return { required_seconds: v.timerRequiredSeconds };
      case 'photo':
        return { hint: v.hint ?? null };
      case 'self':
      case 'friend':
        return { hint: v.hint ?? null };
      default:
        return {};
    }
  }

  private assertVerificationRule(method: VerificationMethod, v: CreateCommitmentDraftDto['verification']): void {
    switch (method) {
      case 'gps':
        if (!v.gps) throw new ValidationError('gps target required for GPS verification');
        if (v.gps.userSelected !== true) {
          throw new DomainError('GPS_TARGET_NOT_SELECTED', '장소를 먼저 선택해주세요.');
        }
        if (v.gps.lat === 0 && v.gps.lng === 0) {
          throw new DomainError('GPS_TARGET_NOT_SELECTED', '장소를 먼저 선택해주세요.');
        }
        if (Math.abs(v.gps.lat) > 90 || Math.abs(v.gps.lng) > 180) {
          throw new ValidationError('gps coordinates out of range');
        }
        if (v.gps.radiusM < 20 || v.gps.radiusM > 2_000) {
          throw new ValidationError('gps.radiusM must be 20..2000');
        }
        return;
      case 'timer':
        if (!v.timerRequiredSeconds || v.timerRequiredSeconds < 60) {
          throw new ValidationError('timerRequiredSeconds must be >= 60');
        }
        return;
      default:
        return;
    }
  }
}
