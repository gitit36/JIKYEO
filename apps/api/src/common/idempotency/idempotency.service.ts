import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { Clock } from '../clock/clock';
import { ConflictError } from '../errors/domain-errors';

/**
 * Idempotency for money-side endpoints and webhooks.
 *
 * Contract:
 *   const result = await idempotency.run({scope, key, request}, () => doWork())
 *
 * - If the same (scope, key) was already seen with the SAME request hash, the
 *   cached response is returned instead of executing the operation again.
 * - If the same (scope, key) was seen with a DIFFERENT request hash, we throw
 *   `IDEMPOTENCY_MISMATCH` — the caller must not silently retry.
 */
@Injectable()
export class IdempotencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  async run<T>(args: {
    scope: string;
    key: string;
    request: unknown;
    ttlMs?: number;
    execute: () => Promise<T>;
  }): Promise<T> {
    const hash = this.hash(args.request);
    const now = this.clock.now();
    const expires = new Date(now.getTime() + (args.ttlMs ?? 24 * 60 * 60 * 1000));

    const existing = await this.prisma.idempotencyKey.findUnique({ where: { key: args.key } });
    if (existing) {
      if (existing.scope !== args.scope || existing.requestHash !== hash) {
        throw new ConflictError('Idempotency key reused with different request', {
          code: 'IDEMPOTENCY_MISMATCH',
        });
      }
      if (existing.responseJson) {
        return existing.responseJson as unknown as T;
      }
    } else {
      await this.prisma.idempotencyKey.create({
        data: {
          key: args.key,
          scope: args.scope,
          requestHash: hash,
          expiresAt: expires,
        },
      });
    }

    const result = await args.execute();

    await this.prisma.idempotencyKey.update({
      where: { key: args.key },
      data: { responseJson: result as unknown as object },
    });

    return result;
  }

  private hash(request: unknown): string {
    return createHash('sha256').update(JSON.stringify(request ?? null)).digest('hex');
  }
}
