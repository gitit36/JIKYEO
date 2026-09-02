import { Injectable } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { AppConfig } from '../../config/app-config';
import { Clock } from '../../common/clock/clock';
import { DomainError } from '../../common/errors/domain-errors';

/**
 * A quote is authoritative when accompanied by a valid HMAC signature. This
 * lets the client hold a quoteId opaquely and re-present it at activation
 * without server round-tripping the entire schedule.
 *
 * Signed payload is bound to (jti, occurrenceCount, stakePerOccurrence,
 * maxLoss, quoteExpiresAt). `jti` is a unique identifier that is atomically
 * consumed on first successful activation — the same quote cannot activate
 * two commitments even under concurrent requests (see `ConsumedQuote`).
 */
export interface SignedQuoteClaims {
  jti: string;
  occurrenceCount: number;
  stakePerOccurrence: string; // bigint-serialized
  maxLoss: string;
  quoteExpiresAt: string; // ISO
}

@Injectable()
export class QuoteCacheService {
  constructor(private readonly cfg: AppConfig, private readonly clock: Clock) {}

  /** Fresh unique quote identifier, ~128 bits of entropy. */
  newJti(): string {
    return randomBytes(16).toString('base64url');
  }

  sign(claims: SignedQuoteClaims): string {
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const sig = createHmac('sha256', this.cfg.quoteSigningSecret).update(payload).digest('base64url');
    return `qt_${payload}.${sig}`;
  }

  verify(quoteId: string): SignedQuoteClaims {
    if (!quoteId.startsWith('qt_')) {
      throw new DomainError('QUOTE_EXPIRED', 'Invalid quote');
    }
    const [payloadRaw, sigRaw] = quoteId.slice(3).split('.');
    if (!payloadRaw || !sigRaw) throw new DomainError('QUOTE_EXPIRED', 'Invalid quote');
    const expected = createHmac('sha256', this.cfg.quoteSigningSecret).update(payloadRaw).digest('base64url');
    const a = Buffer.from(expected);
    const b = Buffer.from(sigRaw);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new DomainError('QUOTE_EXPIRED', 'Quote signature invalid');
    }
    const claims = JSON.parse(Buffer.from(payloadRaw, 'base64url').toString('utf8')) as SignedQuoteClaims;
    if (new Date(claims.quoteExpiresAt).getTime() < this.clock.now().getTime()) {
      throw new DomainError('QUOTE_EXPIRED', 'Quote expired');
    }
    return claims;
  }
}
