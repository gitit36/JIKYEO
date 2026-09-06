import { Injectable } from '@nestjs/common';
import { EnforcementMode, OccurrenceStatus } from '@prisma/client';
import { DateTime } from 'luxon';
import { Clock } from '../common/clock/clock';
import { PrismaService } from '../prisma/prisma.service';

export interface TodayOccurrence {
  id: string;
  commitmentId: string;
  commitmentTitle: string;
  category: string;
  enforcementMode: EnforcementMode;
  verificationMethod: string;
  sequenceNo: number;
  status: OccurrenceStatus;
  windowStartAt: Date;
  deadlineAt: Date;
  /** `null` for SELF/SOCIAL occurrences. */
  stakeAmountKrw: string | null;
}

export interface TodaySummary {
  /** Sum across MONEY occurrences only. SELF/SOCIAL never contribute. */
  atRiskKrw: string;
  /** Number of money commitments included in `atRiskKrw`. */
  moneyCount: number;
  count: number;
  items: TodayOccurrence[];
}

/** Live-status states that still hold money at risk for the current day. */
const ACTIVE_STATES: OccurrenceStatus[] = ['scheduled', 'active', 'evidence_submitted', 'reviewing', 'uncertain'];

@Injectable()
export class TodayService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  /**
   * "Today" is defined per commitment timezone: the user's app tells us its
   * IANA zone, but we compute the day boundary using the same zone stored on
   * each commitment for consistency. Server clock is authoritative.
   */
  async forUser(userId: string, tz: string): Promise<TodaySummary> {
    const now = DateTime.fromJSDate(this.clock.now(), { zone: tz });
    const startOfDayUtc = now.startOf('day').toUTC().toJSDate();
    const endOfDayUtc = now.endOf('day').toUTC().toJSDate();

    const rows = await this.prisma.occurrence.findMany({
      where: {
        // Only live commitments. payment_pending / signature_pending MONEY
        // is not enforceable yet and must not appear as "due today".
        commitment: { userId, status: 'active' },
        status: { in: ACTIVE_STATES },
        deadlineAt: { gte: startOfDayUtc, lte: endOfDayUtc },
      },
      orderBy: { deadlineAt: 'asc' },
      include: {
        commitment: {
          select: {
            id: true,
            title: true,
            category: true,
            enforcementMode: true,
            verificationRule: { select: { method: true } },
          },
        },
      },
    });

    // At-risk is a MONEY-only concept. SELF/SOCIAL occurrences carry NULL
    // stakeAmount and never appear in the top-of-home hero. The Home UI
    // hides the hero entirely when moneyCount === 0.
    let atRisk = 0n;
    let moneyCount = 0;
    for (const r of rows) {
      if (r.commitment.enforcementMode === 'money' && r.stakeAmount !== null) {
        atRisk += r.stakeAmount;
        moneyCount += 1;
      }
    }

    return {
      atRiskKrw: atRisk.toString(),
      moneyCount,
      count: rows.length,
      items: rows.map((r) => ({
        id: r.id,
        commitmentId: r.commitmentId,
        commitmentTitle: r.commitment.title,
        category: r.commitment.category,
        enforcementMode: r.commitment.enforcementMode,
        verificationMethod: r.commitment.verificationRule?.method ?? 'photo',
        sequenceNo: r.sequenceNo,
        status: r.status,
        windowStartAt: r.windowStartAt,
        deadlineAt: r.deadlineAt,
        stakeAmountKrw: r.stakeAmount?.toString() ?? null,
      })),
    };
  }
}
