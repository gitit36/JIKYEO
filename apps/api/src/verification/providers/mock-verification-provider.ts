import { Injectable } from '@nestjs/common';
import { AppConfig } from '../../config/app-config';
import {
  GpsInput,
  PhotoInput,
  TimerInput,
  VerificationDecision,
  VerificationProvider,
} from './verification-provider';

/**
 * Deterministic mock verifier used in dev/tests.
 * - Photo: PASS unless metadata.forceResult overrides.
 * - GPS: real math (Haversine + accuracy + timing) but no external service.
 * - Timer: real math with server-authoritative durations.
 */
@Injectable()
export class MockVerificationProvider extends VerificationProvider {
  readonly name = 'mock';

  constructor(private readonly cfg: AppConfig) {
    super();
  }

  async verifyPhoto(input: PhotoInput): Promise<VerificationDecision> {
    const forced = (input.metadata as { forceResult?: string })?.forceResult;
    if (forced === 'pass' || forced === 'uncertain' || forced === 'fail') {
      return {
        result: forced,
        confidence: forced === 'pass' ? 0.98 : forced === 'uncertain' ? 0.55 : 0.1,
        reasonCode: 'MOCK_FORCED',
        userMessage:
          forced === 'pass'
            ? '사진으로 확인됐어요.'
            : forced === 'uncertain'
              ? '사진만으로는 확실하지 않아요. 한 번 더 확인이 필요해요.'
              : '사진이 약속과 맞지 않아요.',
        modelVersion: 'mock-1',
      };
    }
    return {
      result: 'pass',
      confidence: 0.95,
      reasonCode: 'MOCK_DEFAULT_PASS',
      userMessage: '사진으로 확인됐어요.',
      modelVersion: 'mock-1',
    };
  }

  async verifyGps(input: GpsInput): Promise<VerificationDecision> {
    if (input.receivedAt.getTime() > input.deadlineAt.getTime() + this.cfg.networkGraceSeconds * 1000) {
      return this.decision('fail', 'GPS_LATE', '마감 시간이 지났어요.');
    }
    if (input.mockLocationSuspected) {
      return this.decision('uncertain', 'GPS_MOCK_SUSPECTED', '위치가 조작된 것 같아요. 한 번 더 확인해주세요.');
    }
    if (input.accuracyM > 100) {
      return this.decision('uncertain', 'GPS_LOW_ACCURACY', '위치 정확도가 낮아요. 다시 시도해주세요.');
    }
    const distance = haversineMeters(input.userLat, input.userLng, input.targetLat, input.targetLng);
    if (distance <= input.radiusM) {
      return this.decision('pass', 'GPS_INSIDE_RADIUS', '지정한 장소에 도착했어요.', 1);
    }
    if (distance <= input.radiusM * 1.5) {
      return this.decision('uncertain', 'GPS_NEAR_EDGE', '경계선에 있어요. 한 번 더 확인이 필요해요.', 0.5);
    }
    return this.decision('fail', 'GPS_OUTSIDE_RADIUS', '지정한 장소가 아닌 것 같아요.', 0);
  }

  async verifyTimer(input: TimerInput): Promise<VerificationDecision> {
    if (input.terminated) {
      return this.decision('fail', 'TIMER_TERMINATED', '중간에 타이머가 종료됐어요.', 0);
    }
    const elapsed = Math.floor((input.finishedAt.getTime() - input.startedAt.getTime()) / 1000);
    if (elapsed < input.requiredSeconds) {
      return this.decision('fail', 'TIMER_TOO_SHORT', '목표 시간을 채우지 못했어요.', 0);
    }
    if (input.heartbeatGaps.some((g) => g > 120)) {
      return this.decision('uncertain', 'TIMER_HEARTBEAT_GAP', '중간에 앱이 꺼진 것 같아요. 한 번 더 확인이 필요해요.', 0.5);
    }
    return this.decision('pass', 'TIMER_COMPLETED', '집중 시간을 채웠어요.', 1);
  }

  private decision(
    result: 'pass' | 'uncertain' | 'fail',
    reasonCode: string,
    userMessage: string,
    confidence: number | null = null,
  ): VerificationDecision {
    return { result, confidence, reasonCode, userMessage, modelVersion: 'mock-1' };
  }
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
