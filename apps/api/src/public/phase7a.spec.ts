import express from 'express';
import request from 'supertest';
import { ConfigService } from '@nestjs/config';
import { AdminAppealsController } from '../admin/admin-appeals.controller';
import { AdminFriendVerifyController } from '../admin/admin-friend-verify.controller';
import { AdminGuard } from '../admin/admin.guard';
import { AdminMoneyController } from '../admin/admin-money.controller';
import { AdminUsersController } from '../admin/admin-users.controller';
import { FrozenClock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { MoneyGateService } from '../users/money-gate.service';
import { defaultTermsSnapshot, hashSnapshot, TERMS_VERSION } from '../commitments/terms.service';
import { launchCopyMentionsPartialRefund, mountPublicPages, MONEY_POLICY_BODY, renderPublicPage } from './public-pages';
import { mvpMatrix, POLICY_VERSIONS, resolveMoneyAccess } from './mvp-scope';

function cfg(env: Record<string, string>): AppConfig {
  return new AppConfig({ get: (k: string) => env[k] } as ConfigService);
}

describe('Phase 7A — MVP freeze / review readiness', () => {
  it('ordinary production is fail-closed; mock MONEY is not live', () => {
    const ordinary = cfg({ NODE_ENV: 'production', MONEY_ENABLED: 'true', PAYMENT_PROVIDER: 'mock' });
    expect(ordinary.moneyEnabled).toBe(false);
    expect(ordinary.reviewDemoMoney).toBe(false);
    expect(ordinary.photoEnabled).toBe(false);
    expect(mvpMatrix({
      nodeEnv: 'production', moneyEnabledEnv: 'true', paymentProvider: 'mock',
    }).methods.photo).toBe(false);
    expect(resolveMoneyAccess({
      nodeEnv: 'production', moneyEnabledEnv: 'true', paymentProvider: 'mock',
    }).mode).toBe('disabled');
  });

  it('authorized review/demo MONEY is isolated from production', () => {
    const demo = cfg({
      NODE_ENV: 'production',
      REVIEW_DEMO_MONEY: 'true',
      PAYMENT_PROVIDER: 'mock',
    });
    expect(demo.moneyEnabled).toBe(true);
    expect(demo.reviewDemoMoney).toBe(true);
    expect(demo.photoEnabled).toBe(false);
    const matrix = mvpMatrix({
      nodeEnv: 'production',
      reviewDemoMoney: 'true',
      paymentProvider: 'mock',
    });
    expect(matrix.moneyMode).toBe('review_demo');
    expect(matrix.reviewDemo).toBe(true);
    expect(matrix.moneyEnabled).toBe(true);
    expect(mvpMatrix({
      nodeEnv: 'production',
      moneyEnabledEnv: 'true',
      paymentProvider: 'kr_pg',
    }).moneyMode).toBe('production');
  });

  it('ordinary production cannot activate MONEY', async () => {
    const gate = new MoneyGateService(
      { user: { findUnique: async () => ({ ageVerificationStatus: 'verified_adult' }) } } as any,
      cfg({ NODE_ENV: 'production' }),
    );
    await expect(gate.assertCanUseMoney('u1')).rejects.toMatchObject({ code: 'MONEY_DISABLED' });
  });

  it('public pages respond with current policy versions', async () => {
    const app = express();
    mountPublicPages(app);
    for (const path of ['/', '/terms', '/privacy', '/money-policy', '/support']) {
      const res = await request(app).get(path).expect(200);
      expect(res.headers['content-type']).toMatch(/text\/html/);
      expect(res.text).toContain('지켜');
    }
    expect(renderPublicPage('terms')).toContain(POLICY_VERSIONS.terms);
    expect(renderPublicPage('privacy')).toContain(POLICY_VERSIONS.privacy);
    expect(renderPublicPage('money-policy')).toContain(POLICY_VERSIONS.moneyPolicy);
    expect(renderPublicPage('support')).toContain('운영 정보 입력 전');
  });

  it('policy versions stay consistent and historical snapshots stay immutable', () => {
    expect(TERMS_VERSION).toBe(POLICY_VERSIONS.terms);
    const stored = defaultTermsSnapshot('15000', 10, 'realistic');
    const hash = hashSnapshot(stored);
    const laterCurrent = { ...POLICY_VERSIONS, privacy: 'privacy-v9', moneyPolicy: 'money-policy-v9' };
    expect(hashSnapshot(stored)).toBe(hash);
    expect(stored.documentVersion).toBe(TERMS_VERSION);
    expect(laterCurrent.privacy).not.toBe(POLICY_VERSIONS.privacy);
    expect(mvpMatrix({ nodeEnv: 'test' }).policyVersions).toEqual(POLICY_VERSIONS);
  });

  it('current MONEY policy copy does not describe proportional refunds', () => {
    expect(launchCopyMentionsPartialRefund(MONEY_POLICY_BODY)).toBe(false);
    expect(launchCopyMentionsPartialRefund(renderPublicPage('money-policy'))).toBe(false);
    expect(launchCopyMentionsPartialRefund(defaultTermsSnapshot('1000', 3).refundHandling)).toBe(false);
    expect(MONEY_POLICY_BODY).toContain('전액');
    expect(MONEY_POLICY_BODY).not.toMatch(/비례/);
  });

  it('Release debug/mock controls stay off the production matrix', () => {
    const matrix = mvpMatrix({ nodeEnv: 'production' });
    expect(matrix.deferred).toEqual(expect.arrayContaining(['real_vision', 'admin_web_ui']));
    expect(matrix.methods.photo).toBe(false);
    expect(matrix.moneyEnabled).toBe(false);
    expect(matrix.reviewDemo).toBe(false);
  });

  it('admin APIs stay authenticated', () => {
    const guard = new AdminGuard(cfg({
      ADMIN_API_SECRET: 'adm-secret',
      JWT_SECRET: 'jwt-secret-value',
      QUOTE_SIGNING_SECRET: 'quote-secret-value',
      INTERNAL_JOB_SECRET: 'job-secret-value',
    }));
    const deny = {
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    } as any;
    expect(() => guard.canActivate(deny)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    for (const cls of [AdminMoneyController, AdminAppealsController, AdminFriendVerifyController, AdminUsersController]) {
      const guards = Reflect.getMetadata('__guards__', cls) as unknown[] | undefined;
      expect(guards?.some((g) => g === AdminGuard || (g as { name?: string }).name === 'AdminGuard')).toBe(true);
    }
  });
});

describe('Phase 7A — photo unavailable in production create', () => {
  it('rejects photo commitments when the method is not production-enabled', async () => {
    const { CommitmentService } = await import('../commitments/commitment.service');
    const { ScheduleService } = await import('../commitments/schedule/schedule.service');
    const { QuoteCacheService } = await import('../commitments/quote/quote-cache.service');
    const { RuleBasedGoalSafetyClassifier } = await import('../safety/goal-safety.classifier');
    const { UsersService } = await import('../users/users.service');
    const { AuditService } = await import('../audit/audit.service');
    const { CreateCommitmentDraftDto } = await import('../commitments/dto/create-commitment.dto');
    const { ScheduleDto } = await import('../commitments/dto/schedule.dto');
    const prisma = {
      $transaction: async (fn: any) => fn(prisma),
      user: { findUnique: async () => ({ id: 'u1', stakeTier: 'tier_1', status: 'active' }) },
    } as any;
    const clock = new FrozenClock(new Date('2026-09-07T00:00:00Z'));
    const svc = new CommitmentService(
      prisma,
      new ScheduleService(),
      new QuoteCacheService({ quoteSigningSecret: 'q', jwtSecret: 'j', maxStakePerOccurrenceKrw: 1, maxLossPerCommitmentKrw: 1 } as any, clock),
      new RuleBasedGoalSafetyClassifier(),
      new UsersService(prisma),
      { assertWithinLimits: async () => undefined } as any,
      clock,
      new AuditService(prisma),
      undefined,
      undefined,
      { photoEnabled: false } as AppConfig,
    );
    const schedule = new ScheduleDto();
    Object.assign(schedule, {
      type: 'daily', startDate: '2026-09-14', endDate: '2026-09-14',
      windowStartLocalTime: '09:00', deadlineLocalTime: '21:00',
    });
    const dto = Object.assign(new CreateCommitmentDraftDto(), {
      title: '사진 인증',
      category: 'study',
      enforcementMode: 'self',
      timezone: 'Asia/Seoul',
      schedule,
      verification: { method: 'photo' },
    });
    await expect(svc.createAndActivate('u1', dto)).rejects.toMatchObject({ code: 'METHOD_UNAVAILABLE' });
  });
});
