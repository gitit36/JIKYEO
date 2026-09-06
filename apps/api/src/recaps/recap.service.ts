import { Injectable, Optional } from '@nestjs/common';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock/clock';
import { NotFoundError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';
import { NotificationService } from '../notifications/notification.service';
import { PrismaService } from '../prisma/prisma.service';

export interface RecapView {
  recapId: string;
  localWeekStart: string;
  timezone: string;
  due: number;
  pass: number;
  fail: number;
  void: number;
  unresolved: number;
  completionRate: number | null;
  money: {
    keptKrw: string;
    netForfeitedKrw: string;
    refundPendingOrDelayedKrw: string;
  } | null;
}

@Injectable()
export class RecapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  async latestFor(userId: string): Promise<RecapView | null> {
    const row = await this.prisma.weeklyRecap.findFirst({
      where: { userId },
      orderBy: { localWeekStart: 'desc' },
    });
    return row ? toView(row) : null;
  }

  async getOwned(userId: string, localWeekStart: string): Promise<RecapView> {
    const row = await this.prisma.weeklyRecap.findUnique({
      where: { userId_localWeekStart: { userId, localWeekStart } },
    });
    if (!row) throw new NotFoundError('Recap not found');
    return toView(row);
  }

  async generateDue(): Promise<{ created: number }> {
    const users = await this.prisma.user.findMany({
      where: { status: 'active' },
      select: { id: true, timezone: true },
      take: 2000,
    });
    let created = 0;
    for (const u of users) {
      const before = await this.wouldCreate(u.id, u.timezone);
      const r = await this.generateForUser(u.id, u.timezone);
      if (r && before) created += 1;
    }
    return { created };
  }

  async generateForUser(userId: string, timezone?: string): Promise<RecapView | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundError('User not found');
    const tz = timezone ?? user.timezone ?? 'Asia/Seoul';
    const now = DateTime.fromJSDate(this.clock.now(), { zone: 'utc' }).setZone(tz);
    const week = previousWeek(now, this.cfg.recapLocalHour);
    if (now < week.readyAt) return this.existing(userId, week.localWeekStart);

    const existing = await this.prisma.weeklyRecap.findUnique({
      where: { userId_localWeekStart: { userId, localWeekStart: week.localWeekStart } },
    });
    if (existing) return toView(existing);

    const occs = await this.prisma.occurrence.findMany({
      where: {
        commitment: { userId },
        deadlineAt: { gte: week.startUtc, lte: week.endUtc },
      },
      include: { commitment: true, appeal: true },
    });
    if (occs.length === 0) return null;

    let pass = 0;
    let fail = 0;
    let voidN = 0;
    let unresolved = 0;
    let moneyDue = 0;
    let kept = 0n;
    const moneyOccIds: string[] = [];
    for (const o of occs) {
      const effective = effectiveOf(o.status, o.appeal);
      if (effective === 'pass') pass += 1;
      else if (effective === 'fail') fail += 1;
      else if (effective === 'void') voidN += 1;
      else unresolved += 1;
      if (o.commitment.enforcementMode === 'money') {
        moneyDue += 1;
        moneyOccIds.push(o.id);
        if (effective === 'pass' && o.stakeAmount != null) kept += o.stakeAmount;
      }
    }
    const completionRate = pass + fail === 0 ? null : pass / (pass + fail);
    let netForfeited = 0n;
    let refundPending = 0n;
    if (moneyDue > 0) {
      const money = await this.moneyFor(userId, moneyOccIds, new Set(occs.filter((o) => o.commitment.enforcementMode === 'money').map((o) => o.commitmentId)));
      netForfeited = money.netForfeited;
      refundPending = money.pendingOrDelayed;
    }

    try {
      const row = await this.prisma.weeklyRecap.create({
        data: {
          userId,
          localWeekStart: week.localWeekStart,
          timezone: tz,
          due: occs.length,
          passCount: pass,
          failCount: fail,
          voidCount: voidN,
          unresolvedCount: unresolved,
          completionRate,
          hasMoneySection: moneyDue > 0,
          keptKrw: moneyDue > 0 ? kept : null,
          netForfeitedKrw: moneyDue > 0 ? netForfeited : null,
          refundPendingOrDelayedKrw: moneyDue > 0 ? refundPending : null,
        },
      });
      await this.notifications?.enqueue({
        userId,
        category: 'weekly_recap',
        dedupeKey: `recap:${userId}:${week.localWeekStart}`,
        deepLink: `jikyeo://recap/${week.localWeekStart}`,
      });
      return toView(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') {
        return this.existing(userId, week.localWeekStart);
      }
      throw e;
    }
  }

  private async wouldCreate(userId: string, timezone: string): Promise<boolean> {
    const now = DateTime.fromJSDate(this.clock.now(), { zone: 'utc' }).setZone(timezone);
    const week = previousWeek(now, this.cfg.recapLocalHour);
    if (now < week.readyAt) return false;
    const existing = await this.prisma.weeklyRecap.findUnique({
      where: { userId_localWeekStart: { userId, localWeekStart: week.localWeekStart } },
    });
    return !existing;
  }

  private async existing(userId: string, localWeekStart: string): Promise<RecapView | null> {
    const row = await this.prisma.weeklyRecap.findUnique({
      where: { userId_localWeekStart: { userId, localWeekStart } },
    });
    return row ? toView(row) : null;
  }

  private async moneyFor(userId: string, occurrenceIds: string[], commitmentIds: Set<string>) {
    const rows = await this.prisma.paymentLedger.findMany({
      where: { userId, OR: [{ occurrenceId: { in: occurrenceIds } }, { commitmentId: { in: [...commitmentIds] } }] },
    });
    const credited = new Set(
      rows
        .filter((r) => r.entryType === 'refund_paid' && r.idempotencyKey.startsWith('refund_paid:appeal:') && r.occurrenceId)
        .map((r) => r.occurrenceId as string),
    );
    let netForfeited = 0n;
    for (const r of rows) {
      if (r.entryType !== 'forfeit' || !r.occurrenceId || !occurrenceIds.includes(r.occurrenceId)) continue;
      if (credited.has(r.occurrenceId)) continue;
      netForfeited += r.amount;
    }
    let pendingOrDelayed = 0n;
    for (const cid of commitmentIds) {
      const cRows = rows.filter((r) => r.commitmentId === cid);
      const earned = sum(cRows, 'refund_earned') + sum(cRows, 'reversal');
      const paid = sum(cRows, 'refund_paid');
      const remain = earned - paid > 0n ? earned - paid : 0n;
      if (remain > 0n) pendingOrDelayed += remain;
    }
    return { netForfeited, pendingOrDelayed };
  }
}

function sum(rows: Array<{ entryType: string; amount: bigint }>, type: string): bigint {
  return rows.filter((r) => r.entryType === type).reduce((a, r) => a + r.amount, 0n);
}

function effectiveOf(status: string, appeal: { status: string; correctedResult: string | null } | null): string {
  if (appeal?.status === 'approved' && (appeal.correctedResult === 'pass' || appeal.correctedResult === 'void')) {
    return appeal.correctedResult;
  }
  return status;
}

function previousWeek(nowLocal: DateTime, recapLocalHour: number) {
  const thisMonday = nowLocal.minus({ days: nowLocal.weekday - 1 }).startOf('day');
  const start = thisMonday.minus({ weeks: 1 }).startOf('day');
  const end = start.plus({ days: 6 }).endOf('day');
  const readyAt = thisMonday.set({ hour: recapLocalHour, minute: 0, second: 0, millisecond: 0 });
  return {
    localWeekStart: start.toISODate()!,
    startUtc: start.toUTC().toJSDate(),
    endUtc: end.toUTC().toJSDate(),
    readyAt,
  };
}

function toView(row: {
  id: string;
  localWeekStart: string;
  timezone: string;
  due: number;
  passCount: number;
  failCount: number;
  voidCount: number;
  unresolvedCount: number;
  completionRate: { toNumber(): number } | number | null;
  hasMoneySection: boolean;
  keptKrw: bigint | null;
  netForfeitedKrw: bigint | null;
  refundPendingOrDelayedKrw: bigint | null;
}): RecapView {
  const rate = row.completionRate == null
    ? null
    : typeof row.completionRate === 'number'
      ? row.completionRate
      : row.completionRate.toNumber();
  return {
    recapId: row.id,
    localWeekStart: row.localWeekStart,
    timezone: row.timezone,
    due: row.due,
    pass: row.passCount,
    fail: row.failCount,
    void: row.voidCount,
    unresolved: row.unresolvedCount,
    completionRate: rate,
    money: row.hasMoneySection
      ? {
          keptKrw: (row.keptKrw ?? 0n).toString(),
          netForfeitedKrw: (row.netForfeitedKrw ?? 0n).toString(),
          refundPendingOrDelayedKrw: (row.refundPendingOrDelayedKrw ?? 0n).toString(),
        }
      : null,
  };
}
