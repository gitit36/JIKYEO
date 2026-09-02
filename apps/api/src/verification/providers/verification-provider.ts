/**
 * VerificationProvider abstraction.
 *
 * TRD §6: photo verification returns structured `{result, confidence, reason_code,
 * user_message}`. This interface intentionally exposes the *same shape* for photo,
 * GPS, and timer so callers can treat verification uniformly.
 *
 * Real implementations must NEVER return `pass` on model failure. On any
 * internal / API / timeout error, return `uncertain` so the platform does not
 * settle the occurrence as `fail` (SRD §9).
 */
export type VerificationOutcome = 'pass' | 'uncertain' | 'fail';

export interface VerificationDecision {
  result: VerificationOutcome;
  confidence: number | null; // 0..1 or null when not applicable
  reasonCode: string;
  userMessage: string; // Korean, user-visible
  modelVersion?: string | null;
}

export interface PhotoInput {
  occurrenceId: string;
  goalText: string;
  proofRule: Record<string, unknown>;
  storageKey: string;
  metadata: Record<string, unknown>;
}

export interface GpsInput {
  occurrenceId: string;
  targetLat: number;
  targetLng: number;
  radiusM: number;
  userLat: number;
  userLng: number;
  accuracyM: number;
  capturedAt: Date;
  receivedAt: Date;
  deadlineAt: Date;
  mockLocationSuspected: boolean;
}

export interface TimerInput {
  occurrenceId: string;
  requiredSeconds: number;
  startedAt: Date;
  finishedAt: Date;
  heartbeatGaps: number[]; // gaps in seconds
  backgroundEvents: number;
  terminated: boolean;
}

export abstract class VerificationProvider {
  abstract readonly name: string;
  abstract verifyPhoto(input: PhotoInput): Promise<VerificationDecision>;
  abstract verifyGps(input: GpsInput): Promise<VerificationDecision>;
  abstract verifyTimer(input: TimerInput): Promise<VerificationDecision>;
}
