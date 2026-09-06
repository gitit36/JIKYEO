import { Injectable, Optional } from '@nestjs/common';
import { CommitmentCategory } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { ScheduleService } from '../commitments/schedule/schedule.service';
import { ScheduleInput } from '../commitments/schedule/schedule.types';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { FriendsService } from './friends.service';

const PUBLIC_STATUS: Record<string, string> = {
  active: '진행 중',
  completed: '성공',
  cancelled: '끝남',
  draft: '준비 중',
  payment_pending: '준비 중',
  signature_pending: '준비 중',
};

@Injectable()
export class SharedCommitmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly friends: FriendsService,
    private readonly schedule: ScheduleService,
    private readonly clock: Clock,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async create(userId: string, input: {
    title: string;
    category: CommitmentCategory;
    timezone: string;
    schedule: ScheduleInput;
    inviteeUserIds?: string[];
  }) {
    const title = input.title.trim();
    if (!title) throw new ValidationError('title required');
    const plans = this.schedule.expand(input.schedule, input.timezone);
    if (plans.length === 0) throw new ValidationError('Schedule produces no occurrences');
    const invitees = [...new Set((input.inviteeUserIds ?? []).filter((id) => id && id !== userId))];
    for (const id of invitees) await this.friends.assertAccepted(userId, id);

    const shared = await this.prisma.sharedCommitment.create({
      data: {
        creatorId: userId,
        title,
        category: input.category,
        scheduleType: input.schedule.type,
        scheduleJson: input.schedule as object,
        timezone: input.timezone,
        startAt: plans[0].windowStartAt,
        endAt: plans[plans.length - 1].deadlineAt,
        status: 'open',
      },
    });
    await this.prisma.sharedParticipant.create({
      data: { sharedCommitmentId: shared.id, userId, status: 'accepted' },
    });
    for (const id of invitees) {
      await this.prisma.sharedParticipant.create({
        data: { sharedCommitmentId: shared.id, userId: id, status: 'invited' },
      });
    }
    for (const id of invitees) {
      void this.notifications?.enqueue({
        userId: id,
        category: 'shared_invite',
        dedupeKey: `shared_invite:${shared.id}:${id}`,
        deepLink: 'jikyeo://friends',
      }).catch(() => undefined);
    }
    return this.detail(userId, shared.id);
  }

  async inviteMore(userId: string, sharedId: string, inviteeUserIds: string[]) {
    const shared = await this.ownedOpen(userId, sharedId);
    this.assertJoinable(shared.startAt, shared.status);
    const ids = [...new Set(inviteeUserIds.filter((id) => id && id !== userId))];
    for (const id of ids) {
      await this.friends.assertAccepted(userId, id);
      const existing = await this.prisma.sharedParticipant.findUnique({
        where: { sharedCommitmentId_userId: { sharedCommitmentId: sharedId, userId: id } },
      });
      if (existing) continue;
      await this.prisma.sharedParticipant.create({
        data: { sharedCommitmentId: sharedId, userId: id, status: 'invited' },
      });
      void this.notifications?.enqueue({
        userId: id,
        category: 'shared_invite',
        dedupeKey: `shared_invite:${sharedId}:${id}`,
        deepLink: 'jikyeo://friends',
      }).catch(() => undefined);
    }
    return this.detail(userId, sharedId);
  }

  async acceptInvite(userId: string, sharedId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({ where: { id: sharedId } });
    if (!shared) throw new NotFoundError('Shared commitment not found');
    this.assertJoinable(shared.startAt, shared.status);
    const p = await this.prisma.sharedParticipant.findUnique({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: sharedId, userId } },
    });
    if (!p) throw new ForbiddenError();
    if (p.status === 'accepted') return this.detail(userId, sharedId);
    if (p.status !== 'invited') throw new DomainError('INVALID_STATE_TRANSITION', '이 초대는 수락할 수 없어요.');
    await this.prisma.sharedParticipant.update({ where: { id: p.id }, data: { status: 'accepted' } });
    void this.notifications?.enqueue({
      userId: shared.creatorId,
      category: 'shared_accepted',
      dedupeKey: `shared_accepted:${sharedId}:${userId}`,
      deepLink: 'jikyeo://friends',
    }).catch(() => undefined);
    return this.detail(userId, sharedId);
  }

  async declineInvite(userId: string, sharedId: string) {
    const p = await this.mustParticipant(userId, sharedId);
    if (p.status === 'declined') return { sharedCommitmentId: sharedId, status: 'declined', idempotent: true };
    if (p.status !== 'invited') throw new DomainError('INVALID_STATE_TRANSITION', '이 초대는 거절할 수 없어요.');
    await this.prisma.sharedParticipant.update({ where: { id: p.id }, data: { status: 'declined' } });
    return { sharedCommitmentId: sharedId, status: 'declined', idempotent: false };
  }

  async leave(userId: string, sharedId: string) {
    const p = await this.mustParticipant(userId, sharedId);
    if (p.status === 'left') return { sharedCommitmentId: sharedId, left: true, idempotent: true };
    await this.prisma.sharedParticipant.update({ where: { id: p.id }, data: { status: 'left' } });
    return { sharedCommitmentId: sharedId, left: true, idempotent: false };
  }

  async attachCommitment(userId: string, sharedId: string, commitmentId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({ where: { id: sharedId } });
    if (!shared) throw new NotFoundError('Shared commitment not found');
    this.assertJoinable(shared.startAt, shared.status);
    const p = await this.prisma.sharedParticipant.findUnique({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: sharedId, userId } },
    });
    if (!p || p.status !== 'accepted') {
      throw new DomainError('FORBIDDEN', '초대를 먼저 수락해주세요.');
    }
    if (p.commitmentId && p.commitmentId !== commitmentId) {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 이 같이하기에 참여 중이에요.');
    }
    await this.prisma.sharedParticipant.update({
      where: { id: p.id },
      data: { commitmentId },
    });
  }

  async definition(sharedId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({ where: { id: sharedId } });
    if (!shared) throw new NotFoundError('Shared commitment not found');
    return shared;
  }

  async lockIfStarted(sharedId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({ where: { id: sharedId } });
    if (!shared || shared.status !== 'open') return;
    if (this.clock.now().getTime() >= shared.startAt.getTime()) {
      await this.prisma.sharedCommitment.update({ where: { id: sharedId }, data: { status: 'locked' } });
    }
  }

  async home(userId: string) {
    const [friends, friendRequests, mine] = await Promise.all([
      this.friends.listAccepted(userId),
      this.friends.listIncoming(userId),
      this.prisma.sharedParticipant.findMany({
        where: { userId, status: { in: ['accepted', 'invited'] } },
        include: { shared: { include: { participants: true } } },
      }),
    ]);
    const sharedInvites = mine.filter((p) => p.status === 'invited').map((p) => ({
      sharedCommitmentId: p.sharedCommitmentId,
      title: p.shared.title,
      kind: 'shared_invite' as const,
    }));
    const shared = [];
    for (const p of mine.filter((x) => x.status === 'accepted')) {
      shared.push(await this.publicShared(userId, p.shared));
    }
    const watchingRows = await this.prisma.commitmentObserver.findMany({
      where: { observerUserId: userId },
      include: { commitment: { include: { occurrences: true, observers: true, stake: true } } },
    });
    const watching = [];
    for (const o of watchingRows) {
      const c = o.commitment;
      if (!c || c.sharedCommitmentId) continue;
      if (await this.mayView(userId, c)) watching.push(this.publicProgress(c));
    }
    return {
      shared,
      watching,
      friends,
      requests: [...friendRequests, ...sharedInvites],
      invite: await this.friends.inviteCode(userId),
    };
  }

  async detail(userId: string, sharedId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({
      where: { id: sharedId },
      include: { participants: true },
    });
    if (!shared) throw new NotFoundError('Shared commitment not found');
    const mine = shared.participants.find((p) => p.userId === userId);
    if (!mine) throw new ForbiddenError();
    return this.publicShared(userId, shared);
  }

  async socialCommitmentView(viewerId: string, commitmentId: string) {
    const c = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
      include: { occurrences: true, observers: true, stake: true },
    });
    if (!c) throw new NotFoundError('Commitment not found');
    const allowed = await this.mayView(viewerId, c);
    if (!allowed) throw new ForbiddenError();
    return this.publicProgress(c);
  }

  async notifyPartnerSelected(ownerId: string, partnerId: string, commitmentId: string) {
    void this.notifications?.enqueue({
      userId: partnerId,
      category: 'accountability_partner',
      dedupeKey: `accountability_partner:${commitmentId}:${partnerId}`,
      deepLink: 'jikyeo://friends',
    }).catch(() => undefined);
    void ownerId;
  }

  async notifyProgress(ownerId: string, commitmentId: string) {
    const observers = await this.prisma.commitmentObserver.findMany({
      where: { commitmentId, observerUserId: { not: null } },
    });
    for (const o of observers) {
      if (!o.observerUserId || !(await this.friends.isAccepted(ownerId, o.observerUserId))) continue;
      void this.notifications?.enqueue({
        userId: o.observerUserId,
        category: 'shared_progress',
        dedupeKey: `shared_progress:${commitmentId}:${o.observerUserId}`,
        deepLink: 'jikyeo://friends',
      }).catch(() => undefined);
    }
  }

  private async mayView(viewerId: string, c: {
    userId: string;
    sharedCommitmentId: string | null;
    observers: { observerUserId: string | null }[];
  }): Promise<boolean> {
    if (c.userId === viewerId) return true;
    if (!(await this.friends.isAccepted(viewerId, c.userId))) return false;
    if (c.observers.some((o) => o.observerUserId === viewerId)) return true;
    if (!c.sharedCommitmentId) return false;
    const [a, b] = await Promise.all([
      this.prisma.sharedParticipant.findUnique({
        where: { sharedCommitmentId_userId: { sharedCommitmentId: c.sharedCommitmentId, userId: viewerId } },
      }),
      this.prisma.sharedParticipant.findUnique({
        where: { sharedCommitmentId_userId: { sharedCommitmentId: c.sharedCommitmentId, userId: c.userId } },
      }),
    ]);
    return a?.status === 'accepted' && b?.status === 'accepted';
  }

  private async publicShared(viewerId: string, shared: {
    id: string;
    title: string;
    startAt: Date;
    endAt: Date;
    status: string;
    participants: { userId: string; status: string; commitmentId: string | null }[];
  }) {
    const members = [];
    for (const p of shared.participants.filter((x) => x.status === 'accepted')) {
      const name = (await this.prisma.user.findUnique({
        where: { id: p.userId },
        select: { displayName: true },
      }))?.displayName ?? '친구';
      let progress = null;
      if (p.commitmentId) {
        const c = await this.prisma.commitment.findUnique({
          where: { id: p.commitmentId },
          include: { occurrences: true, observers: true, stake: true },
        });
        if (c && await this.mayView(viewerId, c)) progress = this.publicProgress(c);
      }
      members.push({ userId: p.userId, displayName: name, participantStatus: p.status, progress });
    }
    return {
      sharedCommitmentId: shared.id,
      title: shared.title,
      startAt: shared.startAt.toISOString(),
      endAt: shared.endAt.toISOString(),
      status: shared.status,
      independentContracts: true,
      moneyIndependent: true,
      members,
    };
  }

  private publicProgress(c: {
    id: string;
    title: string;
    startAt: Date;
    endAt: Date;
    status: string;
    occurrences: { status: string }[];
    stake?: { maxTotalAmount: bigint } | null;
  }) {
    const pass = c.occurrences.filter((o) => o.status === 'pass').length;
    const fail = c.occurrences.filter((o) => o.status === 'fail').length;
    const due = c.occurrences.length;
    const latest = pass > 0 ? '지킴' : fail > 0 ? '놓침' : '진행 중';
    return {
      commitmentId: c.id,
      title: c.title,
      startAt: c.startAt.toISOString(),
      endAt: c.endAt.toISOString(),
      status: PUBLIC_STATUS[c.status] ?? c.status,
      progress: { pass, due },
      latestSignal: latest,
    };
  }

  private assertJoinable(startAt: Date, status: string) {
    if (status === 'locked' || this.clock.now().getTime() >= startAt.getTime()) {
      throw new DomainError('INVALID_STATE_TRANSITION', '이미 시작된 같이하기에는 참여할 수 없어요.');
    }
  }

  private async ownedOpen(userId: string, sharedId: string) {
    const shared = await this.prisma.sharedCommitment.findUnique({ where: { id: sharedId } });
    if (!shared) throw new NotFoundError('Shared commitment not found');
    if (shared.creatorId !== userId) throw new ForbiddenError();
    return shared;
  }

  private async mustParticipant(userId: string, sharedId: string) {
    const p = await this.prisma.sharedParticipant.findUnique({
      where: { sharedCommitmentId_userId: { sharedCommitmentId: sharedId, userId } },
    });
    if (!p) throw new ForbiddenError();
    return p;
  }
}
