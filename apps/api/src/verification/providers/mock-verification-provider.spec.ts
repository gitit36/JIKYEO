import { AppConfig } from '../../config/app-config';
import { MockVerificationProvider } from './mock-verification-provider';

function makeProvider(): MockVerificationProvider {
  const cfg = { networkGraceSeconds: 180 } as unknown as AppConfig;
  return new MockVerificationProvider(cfg);
}

describe('MockVerificationProvider — photo', () => {
  const provider = makeProvider();

  it('PASS by default', async () => {
    const d = await provider.verifyPhoto({
      occurrenceId: 'o1', goalText: '헬스장 가기', proofRule: {},
      storageKey: 'k1', metadata: {},
    });
    expect(d.result).toBe('pass');
    expect(d.reasonCode).toBe('MOCK_DEFAULT_PASS');
    expect(d.userMessage).toContain('사진');
  });

  it('honours forceResult=uncertain', async () => {
    const d = await provider.verifyPhoto({
      occurrenceId: 'o1', goalText: '헬스장 가기', proofRule: {},
      storageKey: 'k1', metadata: { forceResult: 'uncertain' },
    });
    expect(d.result).toBe('uncertain');
    expect(d.userMessage).toContain('확실하지');
  });

  it('honours forceResult=fail', async () => {
    const d = await provider.verifyPhoto({
      occurrenceId: 'o1', goalText: '헬스장 가기', proofRule: {},
      storageKey: 'k1', metadata: { forceResult: 'fail' },
    });
    expect(d.result).toBe('fail');
  });
});

describe('MockVerificationProvider — GPS', () => {
  const provider = makeProvider();
  const deadline = new Date('2026-09-07T12:00:00Z'); // 21:00 KST
  const target = { lat: 37.5665, lng: 126.978, radiusM: 150 };

  it('PASS inside radius, good accuracy, on-time', async () => {
    const d = await provider.verifyGps({
      occurrenceId: 'o1',
      targetLat: target.lat, targetLng: target.lng, radiusM: target.radiusM,
      userLat: target.lat, userLng: target.lng,
      accuracyM: 20,
      capturedAt: new Date('2026-09-07T11:30:00Z'),
      receivedAt: new Date('2026-09-07T11:30:05Z'),
      deadlineAt: deadline,
      mockLocationSuspected: false,
    });
    expect(d.result).toBe('pass');
    expect(d.reasonCode).toBe('GPS_INSIDE_RADIUS');
  });

  it('FAIL clearly outside radius', async () => {
    // ~2 km north of target
    const d = await provider.verifyGps({
      occurrenceId: 'o1',
      targetLat: target.lat, targetLng: target.lng, radiusM: target.radiusM,
      userLat: target.lat + 0.02, userLng: target.lng,
      accuracyM: 20,
      capturedAt: new Date('2026-09-07T11:30:00Z'),
      receivedAt: new Date('2026-09-07T11:30:05Z'),
      deadlineAt: deadline,
      mockLocationSuspected: false,
    });
    expect(d.result).toBe('fail');
    expect(d.reasonCode).toBe('GPS_OUTSIDE_RADIUS');
  });

  it('UNCERTAIN when accuracy is poor', async () => {
    const d = await provider.verifyGps({
      occurrenceId: 'o1',
      targetLat: target.lat, targetLng: target.lng, radiusM: target.radiusM,
      userLat: target.lat, userLng: target.lng,
      accuracyM: 250,
      capturedAt: new Date('2026-09-07T11:30:00Z'),
      receivedAt: new Date('2026-09-07T11:30:05Z'),
      deadlineAt: deadline,
      mockLocationSuspected: false,
    });
    expect(d.result).toBe('uncertain');
    expect(d.reasonCode).toBe('GPS_LOW_ACCURACY');
  });

  it('UNCERTAIN when mock location is suspected (no monetary FAIL)', async () => {
    const d = await provider.verifyGps({
      occurrenceId: 'o1',
      targetLat: target.lat, targetLng: target.lng, radiusM: target.radiusM,
      userLat: target.lat, userLng: target.lng,
      accuracyM: 20,
      capturedAt: new Date('2026-09-07T11:30:00Z'),
      receivedAt: new Date('2026-09-07T11:30:05Z'),
      deadlineAt: deadline,
      mockLocationSuspected: true,
    });
    expect(d.result).toBe('uncertain');
    expect(d.reasonCode).toBe('GPS_MOCK_SUSPECTED');
  });
});

describe('MockVerificationProvider — Timer', () => {
  const provider = makeProvider();

  it('PASS when elapsed >= required and heartbeat gaps clean', async () => {
    const start = new Date('2026-09-07T10:00:00Z');
    const end = new Date(start.getTime() + 3_601_000);
    const d = await provider.verifyTimer({
      occurrenceId: 'o1',
      requiredSeconds: 3600,
      startedAt: start,
      finishedAt: end,
      heartbeatGaps: [30, 45, 40],
      backgroundEvents: 0,
      terminated: false,
    });
    expect(d.result).toBe('pass');
    expect(d.reasonCode).toBe('TIMER_COMPLETED');
  });

  it('FAIL when session was terminated early', async () => {
    const start = new Date('2026-09-07T10:00:00Z');
    const end = new Date(start.getTime() + 600_000);
    const d = await provider.verifyTimer({
      occurrenceId: 'o1',
      requiredSeconds: 3600,
      startedAt: start,
      finishedAt: end,
      heartbeatGaps: [30, 30],
      backgroundEvents: 0,
      terminated: true,
    });
    expect(d.result).toBe('fail');
    expect(d.reasonCode).toBe('TIMER_TERMINATED');
  });

  it('FAIL when elapsed is too short (no termination)', async () => {
    const start = new Date('2026-09-07T10:00:00Z');
    const end = new Date(start.getTime() + 1000 * 60 * 30);
    const d = await provider.verifyTimer({
      occurrenceId: 'o1',
      requiredSeconds: 3600,
      startedAt: start,
      finishedAt: end,
      heartbeatGaps: [30, 30],
      backgroundEvents: 0,
      terminated: false,
    });
    expect(d.result).toBe('fail');
    expect(d.reasonCode).toBe('TIMER_TOO_SHORT');
  });

  it('UNCERTAIN when heartbeat gap is huge (ambiguous background)', async () => {
    const start = new Date('2026-09-07T10:00:00Z');
    const end = new Date(start.getTime() + 3_601_000);
    const d = await provider.verifyTimer({
      occurrenceId: 'o1',
      requiredSeconds: 3600,
      startedAt: start,
      finishedAt: end,
      heartbeatGaps: [200],
      backgroundEvents: 3,
      terminated: false,
    });
    expect(d.result).toBe('uncertain');
    expect(d.reasonCode).toBe('TIMER_HEARTBEAT_GAP');
  });
});
