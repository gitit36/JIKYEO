import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';
import { EvidenceStorage } from './storage/evidence-storage';

const OPEN = new Set(['scheduled', 'active', 'evidence_submitted', 'reviewing', 'uncertain', 'system_hold']);
const PENDING_APPEAL = new Set(['submitted', 'reviewing']);

@Injectable()
export class EvidenceRetentionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly cfg: AppConfig,
    private readonly storage: EvidenceStorage,
  ) {}

  async purgeDue(): Promise<{ purged: number; held: number }> {
    const now = this.clock.now();
    const rows = await this.prisma.evidence.findMany({
      where: { status: 'active' },
      include: { occurrence: { include: { commitment: true, appeal: true } } },
      take: 500,
    });
    let purged = 0;
    let held = 0;
    for (const row of rows) {
      if (!this.isEligible(row, now)) {
        held += 1;
        continue;
      }
      const ok = await this.deleteOne(row.id);
      if (ok) purged += 1;
    }
    return { purged, held };
  }

  async deleteOne(evidenceId: string): Promise<boolean> {
    const row = await this.prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (!row) return false;
    if (row.status === 'deleted' && !row.storageKey) return true;
    if (row.storageKey) {
      try {
        await this.storage.delete(row.storageKey);
      } catch {
        return false;
      }
    }
    await this.prisma.evidence.update({
      where: { id: evidenceId },
      data: { status: 'deleted', deletedAt: this.clock.now(), storageKey: null },
    });
    return true;
  }

  isEligible(row: {
    status: string;
    occurrence: {
      status: string;
      decidedAt: Date | null;
      commitment: { enforcementMode: string };
      appeal: { status: string; decidedAt: Date | null } | null;
    } | null;
  }, now: Date): boolean {
    if (row.status === 'deleted') return false;
    const occ = row.occurrence;
    if (!occ) return false;
    if (OPEN.has(occ.status)) return false;
    if (occ.appeal && PENDING_APPEAL.has(occ.appeal.status)) return false;
    if (
      occ.commitment.enforcementMode === 'money'
      && occ.status === 'fail'
      && (!occ.appeal || PENDING_APPEAL.has(occ.appeal.status))
      && this.withinAppealWindow(occ.decidedAt, now)
    ) {
      return false;
    }
    const finalAt = occ.appeal?.decidedAt ?? occ.decidedAt;
    if (!finalAt) return false;
    const until = new Date(finalAt.getTime() + this.cfg.defaultEvidenceRetentionDays * 86_400_000);
    return now.getTime() >= until.getTime();
  }

  private withinAppealWindow(decidedAt: Date | null, now: Date): boolean {
    if (!decidedAt) return true;
    return now.getTime() <= decidedAt.getTime() + this.cfg.appealWindowSeconds * 1000;
  }
}
