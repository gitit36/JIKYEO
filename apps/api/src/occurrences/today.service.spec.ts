import { FrozenClock } from '../common/clock/clock';
import { TodayService } from './today.service';

/**
 * `/occurrences/today` MUST:
 *   1. Return ONLY today's occurrences and today's at-risk sum for the caller's timezone.
 *   2. Sum at-risk over MONEY commitments only. SELF/SOCIAL never contribute.
 *   3. Expose `moneyCount` so Home can hide the money hero entirely when zero.
 */

interface StubOccurrence {
  id: string;
  commitmentId: string;
  sequenceNo: number;
  status: string;
  windowStartAt: Date;
  deadlineAt: Date;
  stakeAmount: bigint | null;
  commitment: {
    id: string;
    title: string;
    category: string;
    enforcementMode: 'self' | 'social' | 'money';
    status?: 'active' | 'payment_pending' | 'signature_pending' | 'completed' | 'cancelled';
    verificationRule: { method: string };
  };
}

function makeService(occurrences: StubOccurrence[], now: Date) {
  const stub = {
    occurrence: {
      findMany: async ({ where }: any) => {
        const start = where.deadlineAt.gte.getTime();
        const end = where.deadlineAt.lte.getTime();
        return occurrences.filter((o) => {
          const t = o.deadlineAt.getTime();
          const commitmentStatus = o.commitment.status ?? 'active';
          if (where.commitment?.status && commitmentStatus !== where.commitment.status) return false;
          return t >= start && t <= end && (where.status.in as string[]).includes(o.status);
        });
      },
    },
  } as any;
  const clock = new FrozenClock(now);
  return new TodayService(stub, clock);
}

function kstAt(dateISO: string, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const [y, mo, d] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 9, m));
}

describe('TodayService (Home money semantics)', () => {
  it('MWF MONEY commitment 5,000원: on Monday returns 1 occurrence and 5,000 at risk (not the 15,000 max-loss)', async () => {
    const mon = kstAt('2026-09-07', '21:00');
    const wed = kstAt('2026-09-09', '21:00');
    const fri = kstAt('2026-09-11', '21:00');

    const shared = {
      id: 'c1', title: '헬스장 가기', category: 'workout',
      enforcementMode: 'money' as const,
      verificationRule: { method: 'gps' },
    };
    const rows: StubOccurrence[] = [
      { id: 'o1', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '18:00'), deadlineAt: mon,
        stakeAmount: 5000n, commitment: shared },
      { id: 'o2', commitmentId: 'c1', sequenceNo: 2, status: 'scheduled',
        windowStartAt: kstAt('2026-09-09', '18:00'), deadlineAt: wed,
        stakeAmount: 5000n, commitment: shared },
      { id: 'o3', commitmentId: 'c1', sequenceNo: 3, status: 'scheduled',
        windowStartAt: kstAt('2026-09-11', '18:00'), deadlineAt: fri,
        stakeAmount: 5000n, commitment: shared },
    ];

    const nowMon = new Date(Date.UTC(2026, 8, 7, 1, 0, 0));
    const svc = makeService(rows, nowMon);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(1);
    expect(s.moneyCount).toBe(1);
    expect(s.atRiskKrw).toBe('5000');
    expect(s.items[0].stakeAmountKrw).toBe('5000');
    expect(s.items[0].enforcementMode).toBe('money');
  });

  it('does not include occurrences whose deadline is on other days', async () => {
    const rows: StubOccurrence[] = [
      { id: 'o1', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-10', '07:00'), deadlineAt: kstAt('2026-09-10', '09:00'),
        stakeAmount: 3000n,
        commitment: { id: 'c1', title: '일찍 일어나기', category: 'wakeup', enforcementMode: 'money', verificationRule: { method: 'photo' } } },
    ];
    const now = new Date(Date.UTC(2026, 8, 11, 3, 0, 0));
    const svc = makeService(rows, now);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(0);
    expect(s.atRiskKrw).toBe('0');
    expect(s.moneyCount).toBe(0);
  });

  it('sums today across multiple MONEY commitments (different commitmentIds)', async () => {
    const now = new Date(Date.UTC(2026, 8, 7, 3, 0, 0));
    const today = kstAt('2026-09-07', '21:00');
    const rows: StubOccurrence[] = [
      { id: 'a', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '18:00'), deadlineAt: today,
        stakeAmount: 5000n,
        commitment: { id: 'c1', title: '헬스장', category: 'workout', enforcementMode: 'money', verificationRule: { method: 'gps' } } },
      { id: 'b', commitmentId: 'c2', sequenceNo: 1, status: 'active',
        windowStartAt: kstAt('2026-09-07', '19:00'), deadlineAt: today,
        stakeAmount: 3000n,
        commitment: { id: 'c2', title: '명상', category: 'meditate', enforcementMode: 'money', verificationRule: { method: 'timer' } } },
    ];
    const svc = makeService(rows, now);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(2);
    expect(s.moneyCount).toBe(2);
    expect(s.atRiskKrw).toBe('8000');
  });

  it('SELF/SOCIAL occurrences do not contribute to at-risk sum', async () => {
    const now = new Date(Date.UTC(2026, 8, 7, 3, 0, 0));
    const today = kstAt('2026-09-07', '21:00');
    const rows: StubOccurrence[] = [
      // SELF (no stake)
      { id: 'a', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '18:00'), deadlineAt: today,
        stakeAmount: null,
        commitment: { id: 'c1', title: '공부', category: 'study', enforcementMode: 'self', verificationRule: { method: 'timer' } } },
      // MONEY (contributes)
      { id: 'b', commitmentId: 'c2', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '19:00'), deadlineAt: today,
        stakeAmount: 5000n,
        commitment: { id: 'c2', title: '헬스장', category: 'workout', enforcementMode: 'money', verificationRule: { method: 'gps' } } },
      // SOCIAL (no stake)
      { id: 'c', commitmentId: 'c3', sequenceNo: 1, status: 'active',
        windowStartAt: kstAt('2026-09-07', '20:00'), deadlineAt: today,
        stakeAmount: null,
        commitment: { id: 'c3', title: '독서', category: 'read', enforcementMode: 'social', verificationRule: { method: 'photo' } } },
    ];
    const svc = makeService(rows, now);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(3);
    expect(s.moneyCount).toBe(1);
    expect(s.atRiskKrw).toBe('5000');
    // Verify per-item stakes preserve NULL for SELF/SOCIAL.
    const byId = Object.fromEntries(s.items.map((i) => [i.id, i]));
    expect(byId['a'].stakeAmountKrw).toBeNull();
    expect(byId['b'].stakeAmountKrw).toBe('5000');
    expect(byId['c'].stakeAmountKrw).toBeNull();
  });

  it('excludes signature_pending (and payment_pending) MONEY commitments from Today', async () => {
    const now = new Date(Date.UTC(2026, 8, 7, 3, 0, 0));
    const today = kstAt('2026-09-07', '21:00');
    const rows: StubOccurrence[] = [
      { id: 'pending', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '18:00'), deadlineAt: today,
        stakeAmount: 5000n,
        commitment: { id: 'c1', title: '헬스장', category: 'workout', enforcementMode: 'money', status: 'signature_pending', verificationRule: { method: 'gps' } } },
      { id: 'live', commitmentId: 'c2', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '19:00'), deadlineAt: today,
        stakeAmount: 3000n,
        commitment: { id: 'c2', title: '명상', category: 'meditate', enforcementMode: 'money', status: 'active', verificationRule: { method: 'timer' } } },
    ];
    const svc = makeService(rows, now);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(1);
    expect(s.items[0].id).toBe('live');
    expect(s.atRiskKrw).toBe('3000');
  });

  it('exposes moneyCount = 0 when only SELF/SOCIAL commitments are scheduled today', async () => {
    const now = new Date(Date.UTC(2026, 8, 7, 3, 0, 0));
    const today = kstAt('2026-09-07', '21:00');
    const rows: StubOccurrence[] = [
      { id: 'a', commitmentId: 'c1', sequenceNo: 1, status: 'scheduled',
        windowStartAt: kstAt('2026-09-07', '18:00'), deadlineAt: today,
        stakeAmount: null,
        commitment: { id: 'c1', title: '공부', category: 'study', enforcementMode: 'self', verificationRule: { method: 'timer' } } },
    ];
    const svc = makeService(rows, now);
    const s = await svc.forUser('u1', 'Asia/Seoul');
    expect(s.count).toBe(1);
    expect(s.moneyCount).toBe(0);
    expect(s.atRiskKrw).toBe('0');
  });
});
