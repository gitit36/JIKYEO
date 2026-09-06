import { Injectable, Optional } from '@nestjs/common';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError } from '../common/errors/domain-errors';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app-config';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { FriendsService } from './friends.service';

@Injectable()
export class FriendVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly clock: Clock,
    private readonly orchestrator: VerificationOrchestrator,
    @Optional() private readonly cfg?: AppConfig,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly audit?: AuditService,
  ) {}

  async request(ownerId: string, occurrenceId: string) {
    const occ = await this.loadOwnedFriendOccurrence(ownerId, occurrenceId);
    const existing = await this.prisma.friendVerifyRequest.findUnique({ where: { occurrenceId } });
    if (existing) return this.publicView(ownerId, existing.id, true);

    const now = this.clock.now();
    const graceMs = (this.cfg?.networkGraceSeconds ?? 180) * 1000;
    if (now.getTime() < occ.windowStartAt.getTime()) {
      throw new DomainError('OCCURRENCE_NOT_ACTIVE', '아직 확인을 요청할 수 없어요.');
    }
    if (now.getTime() > occ.deadlineAt.getTime() + graceMs) {
      throw new DomainError('OCCURRENCE_PAST_DEADLINE', '확인 요청 시간이 지났어요.');
    }

    const verifierId = occ.commitment.observers.find((o) => o.role === 'verifier' && o.observerUserId)?.observerUserId;
    if (!verifierId) throw new DomainError('FRIEND_NOT_SELECTED', '확인 친구가 지정되지 않았어요.');
    if (verifierId === ownerId) throw new DomainError('VALIDATION', '자기 자신을 확인할 수 없어요.');
    await this.friends.assertAccepted(ownerId, verifierId);

    const windowSec = this.cfg?.friendReviewWindowSeconds ?? 86_400;
    const row = await this.prisma.friendVerifyRequest.create({
      data: {
        occurrenceId,
        commitmentId: occ.commitmentId,
        ownerUserId: ownerId,
        verifierUserId: verifierId,
        status: 'pending',
        requestedAt: now,
        reviewDeadlineAt: new Date(now.getTime() + windowSec * 1000),
      },
    });
    const cur = await this.prisma.occurrence.findUnique({ where: { id: occurrenceId } });
    if (cur && (cur.status === 'scheduled' || cur.status === 'active')) {
      await this.prisma.occurrence.update({ where: { id: occurrenceId }, data: { status: 'reviewing' } });
    }

    void this.notifications?.enqueue({
      userId: verifierId,
      category: 'friend_verify_request',
      dedupeKey: `friend_verify_request:${row.id}`,
      deepLink: 'jikyeo://friends',
    }).catch(() => undefined);
    await this.audit?.log({
      actorType: 'user',
      actorId: ownerId,
      entityType: 'friend_verify_request',
      entityId: row.id,
      action: 'friend_verify_requested',
      after: { occurrenceId, verifierUserId: verifierId },
    });
    return this.publicView(ownerId, row.id, false);
  }

  async decide(verifierId: string, occurrenceId: string, decision: 'approved' | 'rejected') {
    const row = await this.prisma.friendVerifyRequest.findUnique({ where: { occurrenceId } });
    if (!row) throw new NotFoundError('Friend verify request not found');
    if (row.ownerUserId === verifierId) throw new DomainError('VALIDATION', '자기 자신의 약속은 확인할 수 없어요.');
    if (row.verifierUserId !== verifierId) throw new ForbiddenError();
    if (row.status === decision) return this.publicView(verifierId, row.id, true);
    if (row.status !== 'pending') {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 확인이 끝났어요.');
    }
    if (this.clock.now().getTime() > row.reviewDeadlineAt.getTime()) {
      await this.finish(row.id, 'expired');
      throw new DomainError('INVALID_STATE_TRANSITION', '확인 시간이 지났어요.');
    }
    if (!(await this.friends.isAccepted(verifierId, row.ownerUserId))) {
      await this.finish(row.id, 'expired');
      throw new ForbiddenError();
    }

    const claimed = await this.prisma.friendVerifyRequest.updateMany({
      where: { id: row.id, status: 'pending' },
      data: { status: decision, decidedAt: this.clock.now() },
    });
    if (claimed.count !== 1) {
      const latest = await this.prisma.friendVerifyRequest.findUnique({ where: { id: row.id } });
      if (latest?.status === decision) return this.publicView(verifierId, row.id, true);
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 확인이 끝났어요.');
    }

    const result = await this.orchestrator.decideFriend({
      occurrenceId: row.occurrenceId,
      answer: decision,
    });
    void this.notifications?.enqueue({
      userId: row.ownerUserId,
      category: decision === 'approved' ? 'friend_verify_approved' : 'friend_verify_rejected',
      dedupeKey: `friend_verify_${decision}:${row.id}`,
      deepLink: 'jikyeo://today',
    }).catch(() => undefined);
    await this.audit?.log({
      actorType: 'user',
      actorId: verifierId,
      entityType: 'friend_verify_request',
      entityId: row.id,
      action: 'friend_verified',
      after: { decision, resultId: result.resultId, reasonCode: result.reasonCode },
    });
    return { ...await this.publicView(verifierId, row.id, false), verification: result };
  }

  async inbox(verifierId: string) {
    const rows = await this.prisma.friendVerifyRequest.findMany({
      where: { verifierUserId: verifierId, status: 'pending' },
      orderBy: { reviewDeadlineAt: 'asc' },
    });
    const out = [];
    for (const r of rows) out.push(await this.publicView(verifierId, r.id, false));
    return out;
  }

  async get(userId: string, occurrenceId: string) {
    const row = await this.prisma.friendVerifyRequest.findUnique({ where: { occurrenceId } });
    if (!row) throw new NotFoundError('Friend verify request not found');
    if (row.ownerUserId !== userId && row.verifierUserId !== userId) throw new ForbiddenError();
    return this.publicView(userId, row.id, false);
  }

  async expireDue(): Promise<number> {
    const now = this.clock.now();
    const due = await this.prisma.friendVerifyRequest.findMany({
      where: { status: 'pending', reviewDeadlineAt: { lt: now } },
    });
    let n = 0;
    for (const row of due) {
      await this.finish(row.id, 'expired');
      n += 1;
    }
    return n;
  }

  async revokePair(a: string, b: string): Promise<number> {
    const rows = await this.prisma.friendVerifyRequest.findMany({
      where: {
        status: 'pending',
        OR: [
          { ownerUserId: a, verifierUserId: b },
          { ownerUserId: b, verifierUserId: a },
        ],
      },
    });
    for (const row of rows) await this.finish(row.id, 'revoked');
    return rows.length;
  }

  async adminList() {
    const rows = await this.prisma.friendVerifyRequest.findMany({ orderBy: { requestedAt: 'desc' }, take: 100 });
    return Promise.all(rows.map((r) => this.adminDetail(r.id)));
  }

  async adminDetail(id: string) {
    const row = await this.prisma.friendVerifyRequest.findUnique({ where: { id } });
    if (!row) throw new NotFoundError('Friend verify request not found');
    const results = await this.prisma.verificationResult.findMany({
      where: { occurrenceId: row.occurrenceId },
      orderBy: { createdAt: 'desc' },
    });
    return {
      requestId: row.id,
      occurrenceId: row.occurrenceId,
      commitmentId: row.commitmentId,
      ownerUserId: row.ownerUserId,
      verifierUserId: row.verifierUserId,
      status: row.status,
      requestedAt: row.requestedAt.toISOString(),
      reviewDeadlineAt: row.reviewDeadlineAt.toISOString(),
      decidedAt: row.decidedAt?.toISOString() ?? null,
      verificationResults: results.map((v) => ({
        resultId: v.id,
        verifierType: v.verifierType,
        result: v.result,
        reasonCode: v.reasonCode,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  private async finish(requestId: string, answer: 'expired' | 'revoked') {
    const claimed = await this.prisma.friendVerifyRequest.updateMany({
      where: { id: requestId, status: 'pending' },
      data: { status: 'expired', decidedAt: this.clock.now() },
    });
    if (claimed.count !== 1) return;
    const row = await this.prisma.friendVerifyRequest.findUnique({ where: { id: requestId } });
    if (!row) return;
    const existing = await this.prisma.verificationResult.findFirst({ where: { occurrenceId: row.occurrenceId } });
    if (!existing) {
      await this.orchestrator.decideFriend({
        occurrenceId: row.occurrenceId,
        answer,
      });
    }
    void this.notifications?.enqueue({
      userId: row.ownerUserId,
      category: 'friend_verify_expired',
      dedupeKey: `friend_verify_${answer}:${row.id}`,
      deepLink: 'jikyeo://today',
    }).catch(() => undefined);
    await this.audit?.log({
      actorType: 'system',
      actorId: null,
      entityType: 'friend_verify_request',
      entityId: row.id,
      action: answer === 'expired' ? 'friend_verify_expired' : 'friend_verify_revoked',
      after: { occurrenceId: row.occurrenceId },
    });
  }

  private async loadOwnedFriendOccurrence(ownerId: string, occurrenceId: string) {
    const occ = await this.prisma.occurrence.findUnique({
      where: { id: occurrenceId },
      include: {
        commitment: { include: { observers: true, verificationRule: true } },
      },
    });
    if (!occ) throw new NotFoundError('Occurrence not found');
    if (occ.commitment.userId !== ownerId) throw new ForbiddenError();
    if (occ.commitment.status !== 'active') {
      throw new DomainError('OCCURRENCE_NOT_ACTIVE', '아직 시작되지 않은 약속이에요.');
    }
    if (occ.commitment.verificationRule?.method !== 'friend') {
      throw new DomainError('VALIDATION', '친구 확인 약속이 아니에요.');
    }
    return occ;
  }

  private async publicView(viewerId: string, requestId: string, idempotent: boolean) {
    const row = await this.prisma.friendVerifyRequest.findUnique({ where: { id: requestId } });
    if (!row) throw new NotFoundError('Friend verify request not found');
    if (row.ownerUserId !== viewerId && row.verifierUserId !== viewerId) throw new ForbiddenError();
    const [owner, verifier, occ] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: row.ownerUserId }, select: { displayName: true } }),
      this.prisma.user.findUnique({ where: { id: row.verifierUserId }, select: { displayName: true } }),
      this.prisma.occurrence.findUnique({
        where: { id: row.occurrenceId },
        include: { commitment: { select: { title: true } } },
      }),
    ]);
    const name = owner?.displayName ?? '친구';
    const title = occ?.commitment.title ?? '약속';
    return {
      requestId: row.id,
      occurrenceId: row.occurrenceId,
      status: row.status,
      ownerDisplayName: name,
      verifierDisplayName: verifier?.displayName ?? '친구',
      title,
      windowStartAt: occ?.windowStartAt.toISOString() ?? null,
      deadlineAt: occ?.deadlineAt.toISOString() ?? null,
      reviewDeadlineAt: row.reviewDeadlineAt.toISOString(),
      question: `${name}님이 오늘 ‘${title}’ 약속을 지켰나요?`,
      idempotent,
    };
  }
}
