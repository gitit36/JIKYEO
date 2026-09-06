import { Injectable, Optional } from '@nestjs/common';
import { CancellationReason, Commitment, EnforcementMode, Prisma, VerificationMethod } from '@prisma/client';
import { AppConfig } from '../config/app-config';
import { MoneyStatusService, MoneyView } from '../payments/money-status.service';
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
      if (!dto.stakePerOccurrenceKrw || dto.stakePerOccurrenceKrw <= 0) {
        throw new ValidationError('stakePerOccurrenceKrw is required for MONEY');
      }
      const user = await this.users.findById(userId);
      if (this.users.isMinor(user, this.clock.now())) {
        throw new DomainError('MINOR_STAKE_DISALLOWED', '미성년자는 약속금 기능을 사용할 수 없어요.');
      }
    } else {
      // SELF / SOCIAL: quote and stake fields must not be present at all.
      if (dto.quoteId) {
        throw new DomainError(
          'QUOTE_NOT_ALLOWED_FOR_MODE',
          '이 강제력에서는 약속금이 없어 서버 시세가 필요하지 않아요.',
        );
      }
      if (dto.stakePerOccurrenceKrw !== undefined && dto.stakePerOccurrenceKrw !== null) {
        throw new ValidationError('stakePerOccurrenceKrw not allowed for non-MONEY modes');
      }
    }

    if (dto.enforcementMode === 'social') {
      // SOCIAL requires a real observer relation. Until Phase 6 wires real
      // friend selection, the Release UI cannot produce this — we reject.
      if (!dto.observer || !dto.observer.observerUserId) {
        throw new DomainError(
          'FRIEND_NOT_SELECTED',
          '친구를 먼저 지정해주세요. (준비 중)',
        );
      }
    }

    // 3. Expand schedule server-side.
    const plans = this.schedule.expand(dto.schedule.toDomain(), dto.timezone);
    if (plans.length === 0) {
      throw new ValidationError('Schedule produces no occurrences');
    }

    // 4. Validate verification rule shape against method. Same for all modes.
    this.assertVerificationRule(dto.verification.method, dto.verification);

    // 5. Mode-specific quote verification + stake computation.
    let stakePerOccurrence: bigint | null = null;
    let maxLoss: bigint | null = null;
    let claimsJti: string | null = null;

    if (dto.enforcementMode === 'money') {
      const claims = this.quoteCache.verify(dto.quoteId!);
      claimsJti = claims.jti;
      stakePerOccurrence = Money.fromNumber(dto.stakePerOccurrenceKrw!);
      maxLoss = stakePerOccurrence * BigInt(plans.length);
      if (
        plans.length !== claims.occurrenceCount ||
        stakePerOccurrence.toString() !== claims.stakePerOccurrence ||
        maxLoss.toString() !== claims.maxLoss
      ) {
        throw new DomainError('QUOTE_EXPIRED', 'Quote no longer matches the schedule');
      }
      // Server-authoritative re-check of tier limits. Client cannot override.
      await this.stakePolicy.assertWithinLimits(
        userId,
        dto.stakePerOccurrenceKrw!,
        Number(maxLoss),
      );
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
          scheduleType: dto.schedule.type,
          scheduleJson: dto.schedule.toDomain() as unknown as Prisma.InputJsonValue,
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
        },
      });

      // Stake row exists only for MONEY. SELF/SOCIAL never create one — we
      // do not use zero-value Stake rows to represent "no money".
      if (dto.enforcementMode === 'money' && stakePerOccurrence !== null && maxLoss !== null) {
        await tx.stake.create({
          data: {
            commitmentId: commitment.id,
            perOccurrenceAmount: stakePerOccurrence,
            maxTotalAmount: maxLoss,
            currency: 'KRW',
            settlementMode: 'end_of_commitment',
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
            role: dto.observer.isVerifier ? 'verifier' : 'viewer',
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
          // Per-occurrence stakeAmount only exists for MONEY. Deliberately
          // NULL (not zero) for SELF/SOCIAL to keep money semantics honest.
          stakeAmount: stakePerOccurrence,
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
   * Owner cancel of an unsigned MONEY/SELF draft. Active/completed cannot use
   * this path. Funded signature_pending issues one full refund; uncharged
   * payment_pending cancels with no PG/ledger write.
   */
  async cancel(
    userId: string,
    commitmentId: string,
    opts: { simulateRefundFail?: boolean } = {},
  ): Promise<CancelUnsignedResult> {
    const c = await this.getOwned(userId, commitmentId);
    return this.cancelUnsigned({
      commitmentId: c.id,
      actorType: 'user',
      actorId: userId,
      reason: 'user_cancelled',
      simulateRefundFail: opts.simulateRefundFail,
    });
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
    return {
      commitmentId,
      status: (c?.status ?? 'cancelled') as CommitmentState,
      cancellationReason: (c?.cancellationReason ?? null) as CancellationReason | null,
      idempotent,
      money,
      refund,
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
