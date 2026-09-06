import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock';
import { PrismaService } from '../prisma/prisma.service';

const DEFAULT_TTL_MS = 55_000;

/**
 * Cross-process lease. A second overlapping worker must lose; we never
 * rely on an in-process timer alone for exclusivity.
 */
@Injectable()
export class JobLeaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async acquire(name: string, holder: string, ttlMs = DEFAULT_TTL_MS): Promise<boolean> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + ttlMs);
    try {
      await this.prisma.jobLease.create({ data: { name, holder, expiresAt } });
      return true;
    } catch (e) {
      if ((e as { code?: string }).code !== 'P2002') throw e;
    }
    const existing = await this.prisma.jobLease.findUnique({ where: { name } });
    if (!existing) return false;
    if (existing.expiresAt > now) return false;
    const stolen = await this.prisma.jobLease.updateMany({
      where: { name, expiresAt: existing.expiresAt },
      data: { holder, expiresAt },
    });
    return stolen.count === 1;
  }

  async release(name: string, holder: string): Promise<void> {
    await this.prisma.jobLease.deleteMany({ where: { name, holder } });
  }
}
