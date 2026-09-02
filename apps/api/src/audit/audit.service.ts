import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorType: 'user' | 'system' | 'admin' | 'webhook';
  actorId?: string | null;
  entityType: string;
  entityId: string;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  deviceId?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId ?? null,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        beforeJson: (entry.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        afterJson: (entry.after ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        ip: entry.ip ?? null,
        deviceId: entry.deviceId ?? null,
      },
    });
  }
}
