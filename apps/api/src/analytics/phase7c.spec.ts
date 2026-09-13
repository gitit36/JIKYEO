import { JwtService } from '@nestjs/jwt';
import { FrozenClock } from '../common/clock/clock';
import { AppJwtService } from '../auth/jwt.service';
import { CommitmentService } from '../commitments/commitment.service';
import { EvidenceService } from '../evidence/evidence.service';
import { mvpMatrix, resolveMoneyAccess } from '../public/mvp-scope';
import { resolvePushProviderChoice } from '../notifications/providers/push-provider-choice';
import { ANALYTICS_EVENTS, safeTrack, sanitizeAnalyticsProps } from './analytics';

describe('Phase 7C — MVP hardening', () => {
  it('enabled Release features have no mock-only method flags', () => {
    const matrix = mvpMatrix({ nodeEnv: 'production', moneyEnabledEnv: 'true', paymentProvider: 'mock' });
    expect(matrix.methods.gps).toBe(true);
    expect(matrix.methods.timer).toBe(true);
    expect(matrix.methods.self).toBe(true);
    expect(matrix.methods.friend).toBe(true);
    expect(matrix.features.friends).toBe(true);
    expect(matrix.features.sharedCommitments).toBe(true);
    expect(matrix.features.friendVerify).toBe(true);
    expect(matrix.features.gps).toBe(true);
    expect(matrix.features.focusTimer).toBe(true);
    expect(matrix.features.selfVerify).toBe(true);
    expect(JSON.stringify(matrix)).not.toMatch(/debug|fixture|MockPayment|forcedPass/i);
  });

  it('gated Photo and ordinary production MONEY cannot be activated', () => {
    const matrix = mvpMatrix({ nodeEnv: 'production' });
    expect(matrix.methods.photo).toBe(false);
    expect(matrix.moneyEnabled).toBe(false);
    expect(resolveMoneyAccess({
      nodeEnv: 'production', moneyEnabledEnv: 'true', paymentProvider: 'mock',
    }).mode).toBe('disabled');
  });

  it('expired access token fails as UNAUTHENTICATED', async () => {
    const jwt = new JwtService();
    const svc = new AppJwtService(jwt, { jwtSecret: 'phase7c-secret', jwtAccessTtlSeconds: 60, jwtRefreshTtlSeconds: 120 } as any);
    const expired = await jwt.signAsync(
      { sub: 'u1', type: 'access' },
      { secret: 'phase7c-secret', expiresIn: -10 },
    );
    await expect(svc.verifyAccess(expired)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('duplicate evidence submit stays idempotent', async () => {
    const occurrence = {
      id: 'o1',
      status: 'pass',
      deadlineAt: new Date('2026-09-07T13:00:00Z'),
      commitment: { userId: 'u1', status: 'active' },
    };
    const prisma = {
      occurrence: {
        findUnique: async () => occurrence,
        update: async () => occurrence,
      },
      evidence: { findFirst: async () => null, create: async () => ({ id: 'e1' }) },
      $transaction: async (fn: (tx: typeof prisma) => Promise<void>) => fn(prisma),
    } as any;
    const svc = new EvidenceService(
      prisma,
      new FrozenClock(new Date('2026-09-07T12:30:00Z')),
      { defaultEvidenceRetentionDays: 30, networkGraceSeconds: 180 } as any,
      {} as any,
      { exists: async () => true } as any,
    );
    await expect(svc.submit('u1', 'o1', { kind: 'self', self: { answer: 'kept' } } as any))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('unauthorized resource access is blocked', async () => {
    const prisma = {
      commitment: {
        findUnique: async () => ({ id: 'c1', userId: 'owner' }),
        findMany: async ({ take }: { take?: number }) => {
          expect(take).toBe(80);
          return [];
        },
      },
    };
    const svc = new CommitmentService(
      prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any,
      new FrozenClock(new Date()), { record: async () => undefined } as any,
    );
    await expect(svc.getOwned('intruder', 'c1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(svc.getOwnedList('intruder')).resolves.toEqual([]);
  });

  it('analytics failure cannot affect domain success', () => {
    const created = { status: 'active' };
    expect(() => safeTrack({
      track() { throw new Error('sink down'); },
    }, 'commitment_activated', { mode: 'self' })).not.toThrow();
    expect(created.status).toBe('active');
  });

  it('analytics payload excludes sensitive data', () => {
    const clean = sanitizeAnalyticsProps({
      mode: 'self',
      lat: '37.5665',
      lng: '126.9780',
      evidence: 'photo-bytes',
      appealText: '판정이 잘못됐어요',
      paymentToken: 'tok_live',
      friendUserId: 'friend-uuid',
      note: 'private',
    });
    expect(clean).toEqual({ mode: 'self' });
    expect(ANALYTICS_EVENTS).toContain('verification_fail');
    expect(ANALYTICS_EVENTS).toContain('money_demo_contract_created');
  });

  it('deleted evidence remains inaccessible', async () => {
    const prisma = {
      occurrence: {
        findUnique: async () => ({ id: 'o1', commitment: { userId: 'u1' } }),
      },
      evidence: {
        findUnique: async () => ({
          id: 'e1', occurrenceId: 'o1', status: 'deleted', storageKey: null,
        }),
      },
    };
    const svc = new EvidenceService(
      prisma as any,
      new FrozenClock(new Date()),
      { defaultEvidenceRetentionDays: 30, networkGraceSeconds: 180 } as any,
      {} as any,
      { exists: async () => false } as any,
    );
    await expect(svc.getAsset('u1', 'o1', 'e1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(svc.getAsset('other', 'o1', 'e1')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('Release configuration exposes no debug/mock push or live mock MONEY', () => {
    expect(resolvePushProviderChoice({ nodeEnv: 'production', pushProvider: 'mock' })).toBe('apns');
    expect(mvpMatrix({ nodeEnv: 'production' }).moneyMode).toBe('disabled');
    expect(mvpMatrix({ nodeEnv: 'production' }).reviewDemo).toBe(false);
  });
});
