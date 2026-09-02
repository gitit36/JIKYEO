import { StateMachine } from './state-machine';

// Must mirror Prisma enum `OccurrenceStatus`.
export type OccurrenceState =
  | 'scheduled'
  | 'active'
  | 'evidence_submitted'
  | 'reviewing'
  | 'pass'
  | 'uncertain'
  | 'fail'
  | 'void'
  | 'system_hold';

// ERD §4 + SRD §4:
//   scheduled -> active -> evidence_submitted -> reviewing -> {pass|uncertain|fail}
//   uncertain -> evidence_submitted | appeal-path (fail after grace) | pass (recheck)
//   fail -> appeal-path -> {pass|void|fail}
//   any active-ish state can go to system_hold and back
export const occurrenceSM = new StateMachine<OccurrenceState>('occurrence', [
  ['scheduled', 'active'],
  ['scheduled', 'system_hold'],
  ['active', 'evidence_submitted'],
  ['active', 'fail'], // deadline passed with no evidence (via deadline worker + gate)
  ['active', 'system_hold'],
  ['evidence_submitted', 'reviewing'],
  ['evidence_submitted', 'system_hold'],
  ['reviewing', 'pass'],
  ['reviewing', 'uncertain'],
  ['reviewing', 'fail'],
  ['reviewing', 'system_hold'],
  ['uncertain', 'evidence_submitted'],
  ['uncertain', 'fail'],
  ['uncertain', 'pass'],
  ['uncertain', 'void'],
  ['fail', 'void'], // via appeal approved
  ['fail', 'pass'], // via appeal approved
  ['system_hold', 'active'],
  ['system_hold', 'evidence_submitted'],
  ['system_hold', 'reviewing'],
]);

/**
 * SRD §4.3 — 5-condition gate to confirm a monetary FAIL on an occurrence.
 * All 5 must be true. If any is false, do NOT settle as forfeit.
 */
export interface FailGateInput {
  wasActiveOrReviewing: boolean;
  deadlinePassed: boolean;
  noSystemOutage: boolean;
  verificationResultIsFail: boolean;
  additionalEvidenceOrAppealGraceEnded: boolean;
}

export function canConfirmFail(input: FailGateInput): boolean {
  return (
    input.wasActiveOrReviewing &&
    input.deadlinePassed &&
    input.noSystemOutage &&
    input.verificationResultIsFail &&
    input.additionalEvidenceOrAppealGraceEnded
  );
}
