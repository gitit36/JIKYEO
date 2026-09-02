import { Injectable, Optional } from '@nestjs/common';
import { Commitment, EnforcementMode, Prisma, VerificationMethod } from '@prisma/client';
import { MoneyStatusService, MoneyView } from '../payments/money-status.service';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { Money } from '../common/money/money';
import { commitmentSM, CommitmentState } from '../common/state/commitment.state';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { GoalSafetyClassifier } from '../safety/goal-safety.classifier';
import { StakePolicyService } from '../stake-policy/stake-policy.service';
import { UsersService } from '../users/users.service';
import { CreateCommitmentDraftDto } from './dto/create-commitment.dto';
import { QuoteCacheService } from './quote/quote-cache.service';
import { ScheduleService } from './schedule/schedule.service';

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
  ) {}

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
   * Records the signature ritual for a MONEY commitment after payment.
   * Idempotent. Never changes money state; activation itself happens when
   * the upfront charge succeeds.
   */
  async sign(userId: string, commitmentId: string): Promise<{ commitmentId: string; status: CommitmentState; signedAt: string }> {
    const c = await this.getOwned(userId, commitmentId);
    if (c.status === 'cancelled') {
      throw new DomainError('INVALID_STATE_TRANSITION', '취소된 약속에는 서명할 수 없어요.');
    }
    const signedAt = c.signedAt ?? this.clock.now();
    if (!c.signatureCompleted) {
      await this.prisma.commitment.update({
        where: { id: c.id },
        data: { signedAt, signatureCompleted: true },
      });
    }
    return { commitmentId: c.id, status: c.status as CommitmentState, signedAt: signedAt.toISOString() };
  }

  async cancel(userId: string, commitmentId: string): Promise<void> {
    const c = await this.getOwned(userId, commitmentId);
    commitmentSM.assert(c.status as CommitmentState, 'cancelled');
    await this.prisma.$transaction(async (tx) => {
      await tx.commitment.update({ where: { id: c.id }, data: { status: 'cancelled' } });
      await tx.occurrence.updateMany({
        where: { commitmentId: c.id, status: 'scheduled' },
        data: { status: 'void' },
      });
    });
    // A funded MONEY commitment that is cancelled has its remaining
    // occurrences voided (→ refundable). The settlement sweep picks the
    // commitment up and issues the aggregate refund; no money moves here.
    await this.audit.log({
      actorType: 'user',
      actorId: userId,
      entityType: 'commitment',
      entityId: c.id,
      action: 'cancel',
    });
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
      // MONEY-only derived money state (결제 중 / 약속금 걸림 / 환불 예정 …). null otherwise.
      money: moneyViews.get(r.id) ?? null,
    }));
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
    return {
      id: c.id,
      title: c.title,
      category: c.category,
      direction: c.direction,
      status: c.status,
      enforcementMode: c.enforcementMode,
      signatureCompleted: c.signatureCompleted,
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
      occurrences: c.occurrences.map((o) => ({
        id: o.id,
        sequenceNo: o.sequenceNo,
        windowStartAt: o.windowStartAt.toISOString(),
        deadlineAt: o.deadlineAt.toISOString(),
        status: o.status,
        stakeKrw: o.stakeAmount?.toString() ?? null,
      })),
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
