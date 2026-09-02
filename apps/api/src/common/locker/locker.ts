import { Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AppConfig } from '../../config/app-config';
import { DomainError } from '../errors/domain-errors';

/**
 * Distributed lock (Redis SET NX PX). Used to serialize per-commitment
 * settlement and per-occurrence state transitions.
 */
@Injectable()
export class Locker {
  private readonly logger = new Logger('Locker');
  private readonly redis: Redis;

  constructor(cfg: AppConfig) {
    this.redis = new Redis(cfg.redisUrl, { maxRetriesPerRequest: 3 });
  }

  async withLock<T>(args: {
    key: string;
    ttlMs?: number;
    execute: () => Promise<T>;
  }): Promise<T> {
    const ttl = args.ttlMs ?? 10_000;
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const acquired = await this.redis.set(args.key, token, 'PX', ttl, 'NX');
    if (acquired !== 'OK') {
      throw new DomainError('LOCK_UNAVAILABLE', `Lock busy: ${args.key}`);
    }
    try {
      return await args.execute();
    } finally {
      await this.releaseIfOwned(args.key, token);
    }
  }

  private async releaseIfOwned(key: string, token: string): Promise<void> {
    const script = `
      if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
      else
        return 0
      end
    `;
    try {
      await this.redis.eval(script, 1, key, token);
    } catch (e) {
      this.logger.warn(`lock release failed: ${(e as Error).message}`);
    }
  }
}
