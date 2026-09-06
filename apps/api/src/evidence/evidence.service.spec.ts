import { FrozenClock } from '../common/clock/clock';
import { AppConfig } from '../config/app-config';
import { EvidenceService } from './evidence.service';
import { EvidenceStorage } from './storage/evidence-storage';
import { VerificationOrchestrator } from '../verification/verification-orchestrator.service';

/**
 * Unit tests for the evidence pipeline with in-memory Prisma stub.
 * We stub the orchestrator so we're only testing the routing/hash/dup logic.
 */
function makeStubPrisma(state: {
  occurrence: {
    id: string;
    status: string;
    deadlineAt: Date;
    commitment: { userId: string; status: string };
  };
  evidenceByHash?: Map<string, string>;
}) {
  const inserted: any[] = [];
  return {
    _inserted: inserted,
    occurrence: {
      findUnique: async ({ where }: any) => (state.occurrence.id === where.id ? state.occurrence : null),
      update: async ({ where, data }: any) => {
        state.occurrence = { ...state.occurrence, ...data };
        return state.occurrence;
      },
    },
    evidence: {
      findFirst: async ({ where }: any) => {
        if (!state.evidenceByHash) return null;
        const id = state.evidenceByHash.get(where.hash);
        return id ? { id } : null;
      },
      create: async ({ data }: any) => {
        const row = { id: `e${inserted.length + 1}`, ...data };
        inserted.push(row);
        state.evidenceByHash?.set(data.hash, row.id);
        return row;
      },
    },
    $transaction: async (fn: any) => fn({
      occurrence: {
        findUnique: async ({ where }: any) => (state.occurrence.id === where.id ? state.occurrence : null),
        update: async ({ where, data }: any) => { state.occurrence = { ...state.occurrence, ...data }; return state.occurrence; },
      },
    }),
  } as any;
}

function makeOrchestratorMock() {
  const calls: Array<{ kind: string; args: any }> = [];
  const mock = {
    async decidePhoto(args: any) { calls.push({ kind: 'photo', args }); return { occurrenceId: args.occurrenceId, resultId: 'r1', result: 'pass', reasonCode: 'MOCK', userMessage: '사진으로 확인됐어요.', confidence: 0.9, isMoneyCommitment: false }; },
    async decideGps(args: any) { calls.push({ kind: 'gps', args }); return { occurrenceId: args.occurrenceId, resultId: 'r1', result: 'pass', reasonCode: 'MOCK', userMessage: '장소가 확인됐어요.', confidence: 1, isMoneyCommitment: false }; },
    async decideSelf(args: any) { calls.push({ kind: 'self', args }); return { occurrenceId: args.occurrenceId, resultId: 'r1', result: args.answer === 'kept' ? 'pass' : 'fail', reasonCode: args.answer === 'kept' ? 'SELF_KEPT' : 'SELF_MISSED', userMessage: args.answer === 'kept' ? '약속을 지켰어요.' : '약속을 놓쳤어요.', confidence: null, isMoneyCommitment: false }; },
  };
  return { calls, mock: mock as unknown as VerificationOrchestrator };
}

function makeService(opts: Partial<Parameters<typeof makeStubPrisma>[0]> = {}) {
  const state = {
    occurrence: {
      id: 'o1',
      status: 'active' as const,
      deadlineAt: new Date('2026-09-07T13:00:00Z'),
      commitment: { userId: 'u1', status: 'active' as const },
    },
    evidenceByHash: new Map<string, string>(),
    ...opts,
  } as any;
  const prisma = makeStubPrisma(state);
  const clock = new FrozenClock(new Date('2026-09-07T12:30:00Z'));
  const cfg = { defaultEvidenceRetentionDays: 30, networkGraceSeconds: 180 } as unknown as AppConfig;
  const storage = {} as unknown as EvidenceStorage;
  const { calls, mock } = makeOrchestratorMock();
  const svc = new EvidenceService(prisma, clock, cfg, mock, storage);
  return { svc, prisma, orchestratorCalls: calls, state };
}

const SHA_ZERO = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const SHA_A = 'a'.repeat(64);

describe('EvidenceService — photo', () => {
  it('accepts a photo, records receivedAt, and dispatches to orchestrator.decidePhoto', async () => {
    const { svc, prisma, orchestratorCalls } = makeService();
    const r = await svc.submit('u1', 'o1', {
      kind: 'photo',
      photo: {
        storageKey: 'k1', hash: SHA_A, contentType: 'image/jpeg', sizeBytes: 1000,
        capturedAt: '2026-09-07T12:29:00Z',
      },
    });
    expect(prisma._inserted).toHaveLength(1);
    expect(prisma._inserted[0].hash).toBe(SHA_A);
    expect(prisma._inserted[0].storageKey).toBe('k1');
    expect(orchestratorCalls[0].kind).toBe('photo');
    expect(r.result).toBe('pass');
  });

  it('marks a duplicate-hash photo as UNCERTAIN without hitting the vision provider path', async () => {
    // Pre-populate: another occurrence's photo with the same hash exists.
    const preHashes = new Map<string, string>();
    preHashes.set(SHA_A, 'existing-evidence');
    const { svc, orchestratorCalls } = makeService({ evidenceByHash: preHashes });
    // First call finds the pre-populated hash; even though the mock findFirst
    // is stubbed by our prisma, it treats the pre-populated hash as an existing
    // *other* occurrence, so the code routes to a uncertain forced result.
    const r = await svc.submit('u1', 'o1', {
      kind: 'photo',
      photo: { storageKey: 'k2', hash: SHA_A, capturedAt: '2026-09-07T12:29:00Z' },
    });
    // The service passes forceResult=uncertain via metadata; our mock still
    // returns pass, but we verify the metadata flag was set on the call.
    expect(orchestratorCalls[0].args.metadata).toMatchObject({ forceResult: 'uncertain' });
    expect(r).toBeDefined();
  });

  it('rejects a photo submitted long past the deadline (past network grace)', async () => {
    const { svc } = makeService({
      occurrence: {
        id: 'o1', status: 'active' as const,
        deadlineAt: new Date('2026-09-07T10:00:00Z'), // 2.5h before now
        commitment: { userId: 'u1', status: 'active' as const },
      },
    });
    await expect(svc.submit('u1', 'o1', {
      kind: 'photo',
      photo: { storageKey: 'k1', hash: SHA_ZERO, capturedAt: '2026-09-07T12:29:00Z' },
    })).rejects.toMatchObject({ code: 'OCCURRENCE_PAST_DEADLINE' });
  });
});

describe('EvidenceService — self', () => {
  it('kept → PASS via orchestrator.decideSelf', async () => {
    const { svc, orchestratorCalls } = makeService();
    const r = await svc.submit('u1', 'o1', { kind: 'self', self: { answer: 'kept' } });
    expect(orchestratorCalls[0].kind).toBe('self');
    expect(orchestratorCalls[0].args.answer).toBe('kept');
    expect(r.result).toBe('pass');
  });

  it('missed → FAIL via orchestrator.decideSelf', async () => {
    const { svc, orchestratorCalls } = makeService();
    const r = await svc.submit('u1', 'o1', { kind: 'self', self: { answer: 'missed' } });
    expect(orchestratorCalls[0].args.answer).toBe('missed');
    expect(r.result).toBe('fail');
  });
});

describe('EvidenceService — gps', () => {
  it('routes to orchestrator.decideGps with user location and mock-suspected flag', async () => {
    const { svc, orchestratorCalls } = makeService();
    await svc.submit('u1', 'o1', {
      kind: 'gps',
      gps: { lat: 37.5665, lng: 126.978, accuracyM: 20, capturedAt: '2026-09-07T12:29:00Z', mockLocationSuspected: false },
    });
    expect(orchestratorCalls[0].kind).toBe('gps');
    expect(orchestratorCalls[0].args.userLat).toBe(37.5665);
    expect(orchestratorCalls[0].args.mockLocationSuspected).toBe(false);
  });
});

describe('EvidenceService — ownership', () => {
  it('rejects when the caller does not own the commitment', async () => {
    const { svc } = makeService({
      occurrence: {
        id: 'o1', status: 'active' as const,
        deadlineAt: new Date('2026-09-07T13:00:00Z'),
        commitment: { userId: 'someone-else', status: 'active' as const },
      },
    });
    await expect(svc.submit('u1', 'o1', { kind: 'self', self: { answer: 'kept' } }))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('rejects verification on a signature_pending commitment', async () => {
    const { svc } = makeService({
      occurrence: {
        id: 'o1', status: 'scheduled' as const,
        deadlineAt: new Date('2026-09-07T13:00:00Z'),
        commitment: { userId: 'u1', status: 'signature_pending' as const },
      },
    });
    await expect(svc.submit('u1', 'o1', { kind: 'self', self: { answer: 'kept' } }))
      .rejects.toMatchObject({ code: 'CONFLICT' });
  });
});
