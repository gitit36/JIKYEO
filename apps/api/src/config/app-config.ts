import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ProviderChoice = 'mock' | 'kr_pg' | 'vision' | 'apns';

/** Strongly-typed façade over `process.env`. Never read env vars directly elsewhere. */
@Injectable()
export class AppConfig {
  constructor(private readonly cfg: ConfigService) {}

  get nodeEnv(): 'development' | 'test' | 'production' {
    return (this.cfg.get<string>('NODE_ENV') as 'development' | 'test' | 'production') ?? 'development';
  }

  get port(): number {
    return Number(this.cfg.get<string>('PORT') ?? 3000);
  }

  get databaseUrl(): string {
    return this.required('DATABASE_URL');
  }

  get redisUrl(): string {
    return this.required('REDIS_URL');
  }

  get jwtSecret(): string {
    return this.required('JWT_SECRET');
  }

  /**
   * Signing secret for commitment quotes. Deliberately separate from the JWT
   * secret so rotating one does not invalidate the other, and so an
   * exfiltrated JWT secret cannot forge new quotes.
   */
  get quoteSigningSecret(): string {
    const v = this.cfg.get<string>('QUOTE_SIGNING_SECRET');
    if (!v || v.length === 0) {
      throw new Error('Missing required env var: QUOTE_SIGNING_SECRET');
    }
    if (v === this.cfg.get<string>('JWT_SECRET')) {
      throw new Error('QUOTE_SIGNING_SECRET must not equal JWT_SECRET');
    }
    return v;
  }

  get jwtAccessTtlSeconds(): number {
    return Number(this.cfg.get<string>('JWT_ACCESS_TTL') ?? 900);
  }

  get jwtRefreshTtlSeconds(): number {
    return Number(this.cfg.get<string>('JWT_REFRESH_TTL') ?? 2_592_000);
  }

  get s3(): {
    endpoint: string;
    region: string;
    bucketEvidence: string;
    accessKeyId: string;
    secretAccessKey: string;
  } {
    return {
      endpoint: this.required('S3_ENDPOINT'),
      region: this.required('S3_REGION'),
      bucketEvidence: this.required('S3_BUCKET_EVIDENCE'),
      accessKeyId: this.required('S3_ACCESS_KEY_ID'),
      secretAccessKey: this.required('S3_SECRET_ACCESS_KEY'),
    };
  }

  get paymentProvider(): ProviderChoice {
    const raw = this.cfg.get<string>('PAYMENT_PROVIDER') ?? 'mock';
    if (raw === 'kcp' || raw === 'kr_pg') return 'kr_pg';
    return (raw as ProviderChoice) ?? 'mock';
  }

  /**
   * Production MONEY is fail-closed. Not a hidden remote review switch.
   * Dev/test default on so fixtures can run; production requires MONEY_ENABLED=true.
   */
  get moneyEnabled(): boolean {
    const raw = this.cfg.get<string>('MONEY_ENABLED');
    if (this.nodeEnv === 'production') return raw === 'true';
    return raw !== 'false';
  }

  /** Dev/admin age fixtures only. Production always requires verified_adult. */
  get allowAgeFixture(): boolean {
    return this.nodeEnv !== 'production';
  }

  get verificationProvider(): ProviderChoice {
    return (this.cfg.get<string>('VERIFICATION_PROVIDER') as ProviderChoice) ?? 'mock';
  }

  get pushProvider(): ProviderChoice {
    return (this.cfg.get<string>('PUSH_PROVIDER') as ProviderChoice) ?? 'mock';
  }

  get maxStakePerOccurrenceKrw(): number {
    return Number(this.cfg.get<string>('MAX_STAKE_PER_OCCURRENCE_KRW') ?? 100_000);
  }

  get maxLossPerCommitmentKrw(): number {
    return Number(this.cfg.get<string>('MAX_LOSS_PER_COMMITMENT_KRW') ?? 500_000);
  }

  get defaultEvidenceRetentionDays(): number {
    return Number(this.cfg.get<string>('DEFAULT_EVIDENCE_RETENTION_DAYS') ?? 30);
  }

  get networkGraceSeconds(): number {
    return Number(this.cfg.get<string>('NETWORK_GRACE_SECONDS') ?? 180);
  }

  /** Server-authoritative window to sign after a successful MONEY charge. */
  get signatureExpirySeconds(): number {
    return Number(this.cfg.get<string>('SIGNATURE_EXPIRY_SECONDS') ?? 1800);
  }

  /** Deprecated notice window. Financial cutoff is cancellationRequestedAt. */
  get activeCancellationNoticeSeconds(): number {
    return Number(this.cfg.get<string>('ACTIVE_CANCELLATION_NOTICE_SECONDS') ?? 0);
  }

  /** Owner may appeal a final MONEY FAIL within this many seconds of decidedAt. */
  get appealWindowSeconds(): number {
    return Number(this.cfg.get<string>('APPEAL_WINDOW_SECONDS') ?? 7 * 24 * 3600);
  }

  /** Friend Verify review window. Persisted at request time; never recomputed. */
  get friendReviewWindowSeconds(): number {
    return Number(this.cfg.get<string>('FRIEND_REVIEW_WINDOW_SECONDS') ?? 86_400);
  }

  /** Local hour (0–23) to generate the previous week's recap. Default Monday 09:00. */
  get recapLocalHour(): number {
    return Number(this.cfg.get<string>('RECAP_LOCAL_HOUR') ?? 9);
  }

  /**
   * Encrypts APNs device tokens at rest. Distinct from JWT, quote, job, and admin secrets.
   */
  get pushTokenEncryptionSecret(): string {
    const v = this.cfg.get<string>('PUSH_TOKEN_ENCRYPTION_SECRET');
    if (!v || v.length === 0) {
      throw new Error('Missing required env var: PUSH_TOKEN_ENCRYPTION_SECRET');
    }
    if (
      v === this.cfg.get<string>('JWT_SECRET') ||
      v === this.cfg.get<string>('QUOTE_SIGNING_SECRET') ||
      v === this.cfg.get<string>('INTERNAL_JOB_SECRET') ||
      v === this.cfg.get<string>('ADMIN_API_SECRET')
    ) {
      throw new Error('PUSH_TOKEN_ENCRYPTION_SECRET must not equal JWT, quote, job, or admin secrets');
    }
    return v;
  }

  /**
   * Protects `POST /internal/jobs/*`. Distinct from JWT, quote signing,
   * and payment-webhook authenticity.
   */
  get internalJobSecret(): string {
    const v = this.cfg.get<string>('INTERNAL_JOB_SECRET');
    if (!v || v.length === 0) {
      throw new Error('Missing required env var: INTERNAL_JOB_SECRET');
    }
    if (v === this.cfg.get<string>('JWT_SECRET') || v === this.cfg.get<string>('QUOTE_SIGNING_SECRET')) {
      throw new Error('INTERNAL_JOB_SECRET must not equal JWT_SECRET or QUOTE_SIGNING_SECRET');
    }
    return v;
  }

  /** Protects `/admin/*` ops APIs. Distinct from JWT and the job secret. */
  get adminApiSecret(): string {
    const v = this.cfg.get<string>('ADMIN_API_SECRET');
    if (!v || v.length === 0) {
      throw new Error('Missing required env var: ADMIN_API_SECRET');
    }
    if (
      v === this.cfg.get<string>('JWT_SECRET') ||
      v === this.cfg.get<string>('INTERNAL_JOB_SECRET') ||
      v === this.cfg.get<string>('QUOTE_SIGNING_SECRET')
    ) {
      throw new Error('ADMIN_API_SECRET must not equal JWT_SECRET, INTERNAL_JOB_SECRET, or QUOTE_SIGNING_SECRET');
    }
    return v;
  }

  private required(key: string): string {
    const v = this.cfg.get<string>(key);
    if (!v || v.length === 0) {
      throw new Error(`Missing required env var: ${key}`);
    }
    return v;
  }
}
