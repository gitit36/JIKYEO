import { DomainError } from '../common/errors/domain-errors';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { DEFAULT_STAKE_POLICY_CONFIG, StakePolicyService } from './stake-policy.service';

function makeService(tier: 'tier_1' | 'tier_2' | 'tier_3' = 'tier_1', forfeitedThisMonthKrw = 0): StakePolicyService {
  const stub = {
    paymentLedger: {
      findMany: async () =>
        forfeitedThisMonthKrw > 0
          ? [{
              commitmentId: 'done1',
              occurrenceId: 'o1',
              amount: BigInt(forfeitedThisMonthKrw),
              entryType: 'forfeit',
              idempotencyKey: 'settle:o1',
            }]
          : [],
      aggregate: async () => ({ _sum: { amount: BigInt(forfeitedThisMonthKrw) } }),
    },
    commitment: {
      findMany: async (args: { where?: { id?: { in?: string[] } } } = {}) => {
        if (args.where?.id?.in?.includes('done1') || forfeitedThisMonthKrw > 0) {
          return [{ id: 'done1', status: 'completed', enforcementMode: 'money', stake: null }];
        }
        return [];
      },
    },
    payment: { findMany: async () => [] },
    user: {
      findUnique: async () => ({
        id: 'u1',
        stakeTier: tier,
        birthDate: null,
        displayName: 'Test',
        authProvider: 'email',
        authSubject: 'test@x',
        email: 'test@x',
        locale: 'ko-KR', timezone: 'Asia/Seoul', status: 'active',
        createdAt: new Date(), updatedAt: new Date(),
      }),
    },
  } as unknown as PrismaService;
  const users = new UsersService(stub);
  return new StakePolicyService(stub, users, DEFAULT_STAKE_POLICY_CONFIG);
}

describe('StakePolicyService', () => {
  it('resolves TIER 1 limits and suggested amounts for a new user', async () => {
    const svc = makeService('tier_1');
    const r = await svc.forUser('u1');
    expect(r.currentTier).toBe('tier_1');
    expect(r.maxPerOccurrenceKrw).toBe(30_000);
    expect(r.maxPerCommitmentKrw).toBe(150_000);
    expect(r.rollingMonthlyLossCapKrw).toBe(300_000);
    expect(r.rollingMonthlyLossRemainingKrw).toBe(300_000);
    expect(r.suggestedAmountsKrw).toEqual([3_000, 5_000, 10_000, 30_000]);
  });

  it('resolves TIER 2 higher limits', async () => {
    const svc = makeService('tier_2');
    const r = await svc.forUser('u1');
    expect(r.maxPerOccurrenceKrw).toBe(50_000);
    expect(r.maxPerCommitmentKrw).toBe(300_000);
  });

  it('resolves TIER 3 highest limits', async () => {
    const svc = makeService('tier_3');
    const r = await svc.forUser('u1');
    expect(r.maxPerOccurrenceKrw).toBe(100_000);
    expect(r.maxPerCommitmentKrw).toBe(500_000);
  });

  it('TIER 1 accepts exactly 30,000 per occurrence', async () => {
    const svc = makeService('tier_1');
    await expect(svc.assertWithinLimits('u1', 30_000, 30_000)).resolves.toBeUndefined();
  });

  it('TIER 1 rejects 30,001 per occurrence', async () => {
    const svc = makeService('tier_1');
    await expect(svc.assertWithinLimits('u1', 30_001, 30_001)).rejects.toMatchObject({
      code: 'STAKE_TIER_LIMIT_EXCEEDED',
    });
  });

  it('TIER 1 rejects commitment max loss above 150,000', async () => {
    const svc = makeService('tier_1');
    await expect(svc.assertWithinLimits('u1', 30_000, 150_001)).rejects.toMatchObject({
      code: 'STAKE_TIER_LIMIT_EXCEEDED',
    });
  });

  it('rolling monthly cap: remaining = cap − settled forfeits, and a new commitment must fit', async () => {
    const svc = makeService('tier_1', 250_000);
    const r = await svc.forUser('u1');
    expect(r.rollingMonthlyLossRemainingKrw).toBe(50_000);
    await expect(svc.assertWithinLimits('u1', 10_000, 50_000)).resolves.toBeUndefined();
    await expect(svc.assertWithinLimits('u1', 10_000, 60_000)).rejects.toMatchObject({
      code: 'STAKE_TIER_LIMIT_EXCEEDED',
      details: { kind: 'rollingMonthly', limitKrw: 50_000 },
    });
  });

  it('TIER 2 rejects above 50,000 per occurrence', async () => {
    const svc = makeService('tier_2');
    await expect(svc.assertWithinLimits('u1', 50_001, 50_001)).rejects.toBeInstanceOf(DomainError);
  });

  it('TIER 3 rejects above 100,000 per occurrence', async () => {
    const svc = makeService('tier_3');
    await expect(svc.assertWithinLimits('u1', 100_001, 100_001)).rejects.toBeInstanceOf(DomainError);
  });

  it('is not authoritative from the client — the value we assert against comes from the server-loaded user row', async () => {
    // Even though the "client" wants to be TIER 3, the user row says TIER 1.
    const svc = makeService('tier_1');
    await expect(svc.assertWithinLimits('u1', 80_000, 80_000)).rejects.toMatchObject({
      code: 'STAKE_TIER_LIMIT_EXCEEDED',
    });
  });
});
