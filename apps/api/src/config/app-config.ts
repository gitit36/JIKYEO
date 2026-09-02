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
    return (this.cfg.get<string>('PAYMENT_PROVIDER') as ProviderChoice) ?? 'mock';
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

  private required(key: string): string {
    const v = this.cfg.get<string>(key);
    if (!v || v.length === 0) {
      throw new Error(`Missing required env var: ${key}`);
    }
    return v;
  }
}
