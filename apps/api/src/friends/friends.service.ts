import { Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { otherOf, pairKey } from './friend-pair';

@Injectable()
export class FriendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async inviteCode(userId: string): Promise<{ inviteCode: string }> {
    const u = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!u) throw new NotFoundError('User not found');
    if (u.inviteCode) return { inviteCode: u.inviteCode };
    for (let i = 0; i < 6; i += 1) {
      const code = randomBytes(5).toString('base64url').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase();
      try {
        const row = await this.prisma.user.update({ where: { id: userId }, data: { inviteCode: code } });
        return { inviteCode: row.inviteCode! };
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
      }
    }
    throw new DomainError('VALIDATION', '초대 코드를 만들지 못했어요.');
  }

  async invite(userId: string, inviteCode: string) {
    const code = inviteCode.trim().toUpperCase();
    if (!code) throw new ValidationError('inviteCode required');
    const target = await this.prisma.user.findUnique({ where: { inviteCode: code } });
    if (!target || target.status !== 'active') throw new NotFoundError('사용자를 찾지 못했어요.');
    if (target.id === userId) throw new DomainError('VALIDATION', '자기 자신에게는 친구 요청을 보낼 수 없어요.');

    const key = pairKey(userId, target.id);
    const existing = await this.prisma.friendship.findUnique({ where: { pairKey: key } });
    if (existing?.status === 'blocked') {
      throw new DomainError('FORBIDDEN', '이 사용자와는 친구를 맺을 수 없어요.');
    }
    if (existing?.status === 'accepted') {
      return this.view(existing, userId, true);
    }
    if (existing?.status === 'pending') {
      if (existing.addresseeId === userId) {
        return this.accept(userId, existing.id);
      }
      return this.view(existing, userId, true);
    }

    const row = existing
      ? await this.prisma.friendship.update({
          where: { id: existing.id },
          data: { requesterId: userId, addresseeId: target.id, status: 'pending', blockedById: null },
        })
      : await this.prisma.friendship.create({
          data: { pairKey: key, requesterId: userId, addresseeId: target.id, status: 'pending' },
        });
    void this.notifications?.enqueue({
      userId: target.id,
      category: 'friend_request',
      dedupeKey: `friend_request:${row.id}`,
      deepLink: 'jikyeo://friends',
    }).catch(() => undefined);
    return this.view(row, userId, false);
  }

  async accept(userId: string, friendshipId: string) {
    const row = await this.mustOwnIncoming(userId, friendshipId);
    if (row.status === 'accepted') return this.view(row, userId, true);
    if (row.status !== 'pending') throw new DomainError('INVALID_STATE_TRANSITION', '이 요청은 수락할 수 없어요.');
    const updated = await this.prisma.friendship.update({
      where: { id: row.id, status: 'pending' },
      data: { status: 'accepted' },
    });
    void this.notifications?.enqueue({
      userId: row.requesterId,
      category: 'friend_accepted',
      dedupeKey: `friend_accepted:${row.id}`,
      deepLink: 'jikyeo://friends',
    }).catch(() => undefined);
    return this.view(updated, userId, false);
  }

  async decline(userId: string, friendshipId: string) {
    const row = await this.mustOwnIncoming(userId, friendshipId);
    if (row.status === 'declined') return this.view(row, userId, true);
    if (row.status !== 'pending') throw new DomainError('INVALID_STATE_TRANSITION', '이 요청은 거절할 수 없어요.');
    const updated = await this.prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'declined' },
    });
    return this.view(updated, userId, false);
  }

  async remove(userId: string, friendshipId: string) {
    const row = await this.mustBeMember(userId, friendshipId);
    if (row.status === 'blocked') throw new DomainError('FORBIDDEN', '차단된 관계는 삭제할 수 없어요.');
    await this.prisma.friendship.delete({ where: { id: row.id } });
    return { friendshipId, removed: true };
  }

  async block(userId: string, friendshipId: string) {
    const row = await this.mustBeMember(userId, friendshipId);
    if (row.status === 'blocked' && row.blockedById === userId) return this.view(row, userId, true);
    const updated = await this.prisma.friendship.update({
      where: { id: row.id },
      data: { status: 'blocked', blockedById: userId },
    });
    return this.view(updated, userId, false);
  }

  async listAccepted(userId: string) {
    const rows = await this.prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ requesterId: userId }, { addresseeId: userId }] },
      orderBy: { createdAt: 'desc' },
    });
    const ids = rows.map((r) => otherOf(r.requesterId, r.addresseeId, userId));
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return rows.map((r) => {
      const friendUserId = otherOf(r.requesterId, r.addresseeId, userId);
      return { friendshipId: r.id, friendUserId, displayName: names.get(friendUserId) ?? '친구', status: r.status };
    });
  }

  async listIncoming(userId: string) {
    const rows = await this.prisma.friendship.findMany({
      where: { addresseeId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.requesterId) } },
      select: { id: true, displayName: true },
    });
    const names = new Map(users.map((u) => [u.id, u.displayName]));
    return rows.map((r) => ({
      friendshipId: r.id,
      fromUserId: r.requesterId,
      displayName: names.get(r.requesterId) ?? '친구',
      kind: 'friend_request' as const,
    }));
  }

  async assertAccepted(userId: string, friendUserId: string): Promise<void> {
    if (userId === friendUserId) {
      throw new DomainError('VALIDATION', '자기 자신을 친구로 지정할 수 없어요.');
    }
    const row = await this.prisma.friendship.findUnique({ where: { pairKey: pairKey(userId, friendUserId) } });
    if (!row || row.status !== 'accepted') {
      throw new DomainError('FRIEND_NOT_SELECTED', '수락된 친구만 지정할 수 있어요.');
    }
  }

  async isAccepted(userId: string, friendUserId: string): Promise<boolean> {
    const row = await this.prisma.friendship.findUnique({ where: { pairKey: pairKey(userId, friendUserId) } });
    return !!row && row.status === 'accepted';
  }

  async canSeeSocially(viewerId: string, ownerId: string): Promise<boolean> {
    return this.isAccepted(viewerId, ownerId);
  }

  private async mustOwnIncoming(userId: string, friendshipId: string) {
    const row = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!row) throw new NotFoundError('Friend request not found');
    if (row.addresseeId !== userId) throw new ForbiddenError();
    return row;
  }

  private async mustBeMember(userId: string, friendshipId: string) {
    const row = await this.prisma.friendship.findUnique({ where: { id: friendshipId } });
    if (!row) throw new NotFoundError('Friendship not found');
    if (row.requesterId !== userId && row.addresseeId !== userId) throw new ForbiddenError();
    return row;
  }

  private view(row: { id: string; requesterId: string; addresseeId: string; status: string }, userId: string, idempotent: boolean) {
    return {
      friendshipId: row.id,
      status: row.status,
      friendUserId: otherOf(row.requesterId, row.addresseeId, userId),
      idempotent,
    };
  }
}
