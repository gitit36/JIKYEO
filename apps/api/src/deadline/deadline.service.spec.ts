import { FrozenClock } from '../common/clock/clock';
import { PrismaService } from '../prisma/prisma.service';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';
import { DeadlineService, HealthMonitor } from './deadline.service';

/**
 * Deadline sweeper is the ONE place where "no evidence + past deadline"
 * can become a behavioral FAIL. It must:
 *   - Never confirm FAIL while the platform is in `system_hold`.
 *   - Leave `reviewing` alone (verifier will finish).
 *   - Skip commitments that are not active.
 *   - Record FAIL via the orchestrator (not directly), so the result
 *     is captured in verification_result for Phase 4 to consume.
 */
describe('DeadlineService.sweep', () => {
  function make(opts: {
    now: Date;
    graceSeconds?: number;
    health?: 'ok' | 'system_hold';
    occurrences: Array<{
      id: string;
      status: 'scheduled' | 'active' | 'evidence_submitted' | 'reviewing' | 'uncertain';
      deadlineAt: Date;
      commitment: { id: string; userId: string; enforcementMode: 'self' | 'money'; status: 'active' | 'cancelled' | 'completed' };
      evidence?: Array<{ id: string }>;
      verificationResults?: Array<{ id: string }>;
    }>;
  }) {
    const clock = new FrozenClock(opts.now);
    const health = new HealthMonitor();
    health.set(opts.health ?? 'ok');
    const updates: Array<{ id: string; status: string }> = [];
    const orchestratorCalls: string[] = [];
    const stub = {
      occurrence: {
        findMany: async () => opts.occurrences,
        update: async ({ where, data }: any) => {
          updates.push({ id: where.id, status: data.status });
          return { id: where.id, ...data };
        },
      },
    } as unknown as PrismaService;
    const orchestrator = {
      async recordDeadlineFail(occurrenceId: string) {
        orchestratorCalls.push(occurrenceId);
        return {
          occurrenceId, resultId: 'r_' + occurrenceId, result: 'fail',
          reasonCode: 'DEADLINE_NO_EVIDENCE', userMessage: '증거가 없어 약속을 확인하지 못했어요.',
          confidence: null, isMoneyCommitment: true,
        };
      },
    } as unknown as VerificationOrchestrator;
    const cfg = { networkGraceSeconds: opts.graceSeconds ?? 180, nodeEnv: 'test' } as any;
    const svc = new DeadlineService(stub, clock, cfg, orchestrator, health);
    return { svc, updates, orchestratorCalls };
  }

  it('records a behavioral FAIL for a MONEY occurrence with no evidence past deadline', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, orchestratorCalls } = make({
      now,
      occurrences: [
        { id: 'o1', status: 'active', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'money', status: 'active' } },
      ],
    });
    const r = await svc.sweep();
    expect(r.failed).toBe(1);
    expect(orchestratorCalls).toEqual(['o1']);
  });

  it('records a behavioral FAIL for a SELF occurrence too (behavioral, not financial)', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, orchestratorCalls } = make({
      now,
      occurrences: [
        { id: 'o1', status: 'active', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'self', status: 'active' } },
      ],
    });
    const r = await svc.sweep();
    expect(r.failed).toBe(1);
    expect(orchestratorCalls).toEqual(['o1']);
  });

  it('never converts a missed proof into monetary FAIL during a system outage — puts it in system_hold', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, updates, orchestratorCalls } = make({
      now,
      health: 'system_hold',
      occurrences: [
        { id: 'o1', status: 'active', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'money', status: 'active' } },
      ],
    });
    const r = await svc.sweep();
    expect(r.failed).toBe(0);
    expect(r.heldForSystem).toBe(1);
    expect(orchestratorCalls).toEqual([]);
    expect(updates).toEqual([{ id: 'o1', status: 'system_hold' }]);
  });

  it('leaves reviewing rows alone even after deadline (verifier still running)', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, updates, orchestratorCalls } = make({
      now,
      occurrences: [
        { id: 'o1', status: 'reviewing', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'money', status: 'active' },
          evidence: [{ id: 'e1' }] },
      ],
    });
    const r = await svc.sweep();
    expect(r.failed).toBe(0);
    expect(orchestratorCalls).toEqual([]);
    expect(updates).toEqual([{ id: 'o1', status: 'reviewing' }]);
  });

  it('skips commitments that are no longer active (e.g. cancelled)', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, orchestratorCalls } = make({
      now,
      occurrences: [
        { id: 'o1', status: 'active', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'money', status: 'cancelled' } },
      ],
    });
    const r = await svc.sweep();
    expect(r.alreadyResolved).toBe(1);
    expect(orchestratorCalls).toEqual([]);
  });

  it('skips rows that already have a verification result (late verifier callback wins)', async () => {
    const now = new Date('2026-09-07T13:00:00Z');
    const deadline = new Date('2026-09-07T12:00:00Z');
    const { svc, orchestratorCalls } = make({
      now,
      occurrences: [
        { id: 'o1', status: 'uncertain', deadlineAt: deadline,
          commitment: { id: 'c1', userId: 'u1', enforcementMode: 'money', status: 'active' },
          verificationResults: [{ id: 'r1' }] },
      ],
    });
    const r = await svc.sweep();
    expect(r.alreadyResolved).toBe(1);
    expect(orchestratorCalls).toEqual([]);
  });
});
