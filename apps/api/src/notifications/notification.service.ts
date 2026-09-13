import { Injectable, Optional } from '@nestjs/common';
import { NotificationCategory, Prisma } from '@prisma/client';
import { Clock } from '../common/clock/clock';
import { DomainError, ForbiddenError, NotFoundError, ValidationError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { PUSH_COPY, REFUND_DELAYED_COPY, assertGenericLockScreen } from './push-copy';
import { LostPushResponseError, PushProvider } from './providers/push-provider';
import { decryptDeviceToken, encryptDeviceToken, hashDeviceToken } from './token-crypto';

const CATEGORIES: NotificationCategory[] = [
  'deadline_reminder',
  'signature_expiry',
  'refund',
  'appeal',
  'weekly_recap',
  'friend_request',
  'friend_accepted',
  'shared_invite',
  'shared_accepted',
  'accountability_partner',
  'shared_progress',
  'friend_verify_request',
  'friend_verify_approved',
  'friend_verify_rejected',
  'friend_verify_expired',
];

export interface EnqueueInput {
  userId: string;
  category: NotificationCategory;
  dedupeKey: string;
  deepLink: string;
  title?: string;
  body?: string;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    @Optional() private readonly push?: PushProvider,
  ) {}

  async registerDevice(userId: string, token: string, environment: 'sandbox' | 'production') {
    if (!token || token.length < 8) throw new ValidationError('device token required');
    const tokenHash = hashDeviceToken(token);
    const tokenCiphertext = encryptDeviceToken(token, this.cfg.pushTokenEncryptionSecret);
    const existing = await this.prisma.deviceToken.findUnique({ where: { tokenHash } });
    const row = existing
      ? await this.prisma.deviceToken.update({
          where: { tokenHash },
          data: { userId, tokenCiphertext, environment, active: true },
        })
      : await this.prisma.deviceToken.create({
          data: { userId, tokenHash, tokenCiphertext, environment, active: true },
        });
    await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        deadlineReminder: true,
        signatureExpiry: true,
        refund: true,
        appeal: true,
        weeklyRecap: true,
        social: true,
      },
      update: {},
    });
    return { tokenHash: row.tokenHash, environment: row.environment, active: row.active };
  }

  async unregisterDevice(userId: string, token: string) {
    const tokenHash = hashDeviceToken(token);
    const row = await this.prisma.deviceToken.findUnique({ where: { tokenHash } });
    if (!row) throw new NotFoundError('Device token not found');
    if (row.userId !== userId) throw new ForbiddenError();
    await this.prisma.deviceToken.update({ where: { tokenHash }, data: { active: false } });
    return { tokenHash, active: false };
  }

  async getPreferences(userId: string) {
    const row = await this.prisma.notificationPreference.findUnique({ where: { userId } });
    return {
      deadlineReminder: row?.deadlineReminder ?? false,
      signatureExpiry: row?.signatureExpiry ?? false,
      refund: row?.refund ?? false,
      appeal: row?.appeal ?? false,
      weeklyRecap: row?.weeklyRecap ?? false,
      social: row?.social ?? true,
    };
  }

  async setPreferences(userId: string, prefs: Partial<{
    deadlineReminder: boolean;
    signatureExpiry: boolean;
    refund: boolean;
    appeal: boolean;
    weeklyRecap: boolean;
    social: boolean;
  }>) {
    const row = await this.prisma.notificationPreference.upsert({
      where: { userId },
      create: {
        userId,
        deadlineReminder: prefs.deadlineReminder ?? true,
        signatureExpiry: prefs.signatureExpiry ?? true,
        refund: prefs.refund ?? true,
        appeal: prefs.appeal ?? true,
        weeklyRecap: prefs.weeklyRecap ?? true,
        social: prefs.social ?? true,
      },
      update: {
        ...(prefs.deadlineReminder !== undefined ? { deadlineReminder: prefs.deadlineReminder } : {}),
        ...(prefs.signatureExpiry !== undefined ? { signatureExpiry: prefs.signatureExpiry } : {}),
        ...(prefs.refund !== undefined ? { refund: prefs.refund } : {}),
        ...(prefs.appeal !== undefined ? { appeal: prefs.appeal } : {}),
        ...(prefs.weeklyRecap !== undefined ? { weeklyRecap: prefs.weeklyRecap } : {}),
        ...(prefs.social !== undefined ? { social: prefs.social } : {}),
      },
    });
    return this.getPreferences(userId);
  }

  /** Idempotent enqueue. Never throws on duplicate. Domain callers ignore the result. */
  async enqueue(input: EnqueueInput, tx?: Prisma.TransactionClient): Promise<{ created: boolean }> {
    const copy = input.category === 'refund' && input.title
      ? { title: input.title, body: input.body ?? PUSH_COPY.refund.body }
      : PUSH_COPY[input.category];
    const title = input.title ?? copy.title;
    const body = input.body ?? copy.body;
    assertGenericLockScreen(title, body);
    const db = tx ?? this.prisma;
    try {
      await db.notificationOutbox.create({
        data: {
          userId: input.userId,
          category: input.category,
          dedupeKey: input.dedupeKey,
          title,
          body,
          deepLink: input.deepLink,
          status: 'pending',
          attempt: 0,
          nextAttemptAt: this.clock.now(),
        },
      });
      return { created: true };
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') return { created: false };
      throw e;
    }
  }

  enqueueRefund(userId: string, paymentId: string, delayed: boolean) {
    const copy = delayed ? REFUND_DELAYED_COPY : PUSH_COPY.refund;
    return this.enqueue({
      userId,
      category: 'refund',
      dedupeKey: delayed ? `refund_delayed:${paymentId}` : `refund_completed:${paymentId}`,
      deepLink: `jikyeo://history`,
      title: copy.title,
      body: copy.body,
    });
  }

  enqueueAppeal(userId: string, appealId: string) {
    return this.enqueue({
      userId,
      category: 'appeal',
      dedupeKey: `appeal_decided:${appealId}`,
      deepLink: `jikyeo://appeals/${appealId}`,
    });
  }

  async enqueueDue(): Promise<{ enqueued: number }> {
    const now = this.clock.now();
    let enqueued = 0;
    const soon = new Date(now.getTime() + 60 * 60 * 1000);
    const occs = await this.prisma.occurrence.findMany({
      where: {
        status: { in: ['scheduled', 'active'] },
        deadlineAt: { gte: now, lte: soon },
        commitment: { status: 'active' },
      },
      include: { commitment: { select: { userId: true } } },
      take: 500,
    });
    for (const o of occs) {
      const r = await this.enqueue({
        userId: o.commitment.userId,
        category: 'deadline_reminder',
        dedupeKey: `deadline:${o.id}`,
        deepLink: `jikyeo://today`,
      });
      if (r.created) enqueued += 1;
    }

    const unsigned = await this.prisma.commitment.findMany({
      where: {
        status: 'signature_pending',
        signatureExpiresAt: { gt: now },
      },
      take: 500,
    });
    for (const c of unsigned) {
      const r = await this.enqueue({
        userId: c.userId,
        category: 'signature_expiry',
        dedupeKey: `signature_expiry:${c.id}`,
        deepLink: `jikyeo://commitments/${c.id}/sign`,
      });
      if (r.created) enqueued += 1;
    }

    const refunds = await this.prisma.payment.findMany({
      where: { type: 'refund', status: { in: ['succeeded', 'failed'] } },
      take: 500,
    });
    for (const p of refunds) {
      if (!p.userId) continue;
      const r = await this.enqueueRefund(p.userId, p.id, p.status === 'failed');
      if (r.created) enqueued += 1;
    }

    const appeals = await this.prisma.appeal.findMany({
      where: { status: { in: ['approved', 'rejected'] } },
      take: 500,
    });
    for (const a of appeals) {
      const r = await this.enqueueAppeal(a.userId, a.id);
      if (r.created) enqueued += 1;
    }
    return { enqueued };
  }

  async processOutbox(): Promise<{ processed: number; sent: number }> {
    const now = this.clock.now();
    const rows = await this.prisma.notificationOutbox.findMany({
      where: { status: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } },
      take: 200,
    });
    let processed = 0;
    let sent = 0;
    for (const row of rows) {
      processed += 1;
      const ok = await this.deliver(row.id);
      if (ok) sent += 1;
    }
    return { processed, sent };
  }

  private async deliver(outboxId: string): Promise<boolean> {
    const row = await this.prisma.notificationOutbox.findUnique({ where: { id: outboxId } });
    if (!row || row.status === 'sent') return row?.status === 'sent';
    const prefs = await this.getPreferences(row.userId);
    const opted = optedIn(prefs, row.category);
    const devices = opted
      ? await this.prisma.deviceToken.findMany({ where: { userId: row.userId, active: true } })
      : [];
    if (!opted || devices.length === 0) {
      await this.prisma.notificationOutbox.update({
        where: { id: outboxId },
        data: { status: 'sent', sentAt: this.clock.now(), lastError: opted ? 'no_device' : 'opted_out' },
      });
      return true;
    }
    if (!this.push) throw new DomainError('INTERNAL', 'Push provider not configured');
    let anySuccess = false;
    let lastError: string | null = null;
    for (const d of devices) {
      let token: string;
      try {
        token = decryptDeviceToken(d.tokenCiphertext, this.cfg.pushTokenEncryptionSecret);
      } catch {
        await this.prisma.deviceToken.update({ where: { id: d.id }, data: { active: false } });
        continue;
      }
      try {
        const result = await this.push.send({
          deviceToken: token,
          title: row.title,
          body: row.body,
          deepLink: row.deepLink,
          category: row.category,
          environment: d.environment === 'production' ? 'production' : 'sandbox',
        });
        if (result === 'succeeded') anySuccess = true;
        else if (result === 'invalid_token') {
          await this.prisma.deviceToken.update({ where: { id: d.id }, data: { active: false } });
          lastError = 'invalid_token';
        } else if (result === 'permanent_failure' || result === 'not_configured') {
          lastError = result;
        } else {
          lastError = 'temporary_failure';
        }
      } catch (e) {
        if (e instanceof LostPushResponseError) {
          lastError = 'lost';
          continue;
        }
        lastError = (e as Error).message;
      }
    }
    const attempt = (row.attempt ?? 0) + 1;
    if (anySuccess) {
      await this.prisma.notificationOutbox.update({
        where: { id: outboxId },
        data: { status: 'sent', sentAt: this.clock.now(), attempt, lastError: null },
      });
      return true;
    }
    if (lastError === 'lost') {
      await this.prisma.notificationOutbox.update({
        where: { id: outboxId },
        data: { attempt, lastError, nextAttemptAt: this.clock.now() },
      });
      return false;
    }
    const stop =
      lastError === 'invalid_token' ||
      lastError === 'permanent_failure' ||
      attempt >= 8;
    await this.prisma.notificationOutbox.update({
      where: { id: outboxId },
      data: {
        status: 'failed',
        attempt,
        lastError,
        nextAttemptAt: stop
          ? new Date('2099-01-01T00:00:00.000Z')
          : new Date(this.clock.now().getTime() + backoffMs(attempt)),
      },
    });
    return false;
  }
}

function optedIn(prefs: {
  deadlineReminder: boolean;
  signatureExpiry: boolean;
  refund: boolean;
  appeal: boolean;
  weeklyRecap: boolean;
  social?: boolean;
}, category: NotificationCategory): boolean {
  switch (category) {
    case 'deadline_reminder': return prefs.deadlineReminder;
    case 'signature_expiry': return prefs.signatureExpiry;
    case 'refund': return prefs.refund;
    case 'appeal': return prefs.appeal;
    case 'weekly_recap': return prefs.weeklyRecap;
    case 'friend_request':
    case 'friend_accepted':
    case 'shared_invite':
    case 'shared_accepted':
    case 'accountability_partner':
    case 'shared_progress':
    case 'friend_verify_request':
    case 'friend_verify_approved':
    case 'friend_verify_rejected':
    case 'friend_verify_expired':
      return prefs.social ?? true;
    default: return false;
  }
}

function backoffMs(attempt: number): number {
  return Math.min(60 * 60_000, 60_000 * 2 ** Math.max(0, attempt - 1));
}

export { CATEGORIES };
