import { financialStatus, FinalityAppeal, FinalityOccurrence } from './financial-finality';

export type ContractV1Outcome = 'pending' | 'success' | 'failed';

export function isContractV1(mode: string | null | undefined): boolean {
  return mode === 'contract_v1' || mode == null || mode === undefined;
}

export function tallyContract(
  occurrences: Array<FinalityOccurrence & { id: string }>,
  appealByOcc: Map<string, FinalityAppeal | null | undefined>,
  now: Date,
): {
  finalFail: number;
  pass: number;
  voided: number;
  pendingBehavioral: number;
  provisionalFail: number;
  blocked: number;
} {
  let finalFail = 0;
  let pass = 0;
  let voided = 0;
  let pendingBehavioral = 0;
  let provisionalFail = 0;
  let blocked = 0;
  for (const occ of occurrences) {
    const st = occ.status;
    if (st === 'uncertain' || st === 'system_hold' || st === 'reviewing' || st === 'evidence_submitted') {
      blocked += 1;
      pendingBehavioral += 1;
      continue;
    }
    const effective = financialStatus(occ, appealByOcc.get(occ.id), now);
    if (effective === 'pending') {
      pendingBehavioral += 1;
      if (st === 'fail') provisionalFail += 1;
      continue;
    }
    if (effective === 'fail') finalFail += 1;
    else if (effective === 'pass') pass += 1;
    else if (effective === 'void') voided += 1;
    else pendingBehavioral += 1;
  }
  return { finalFail, pass, voided, pendingBehavioral, provisionalFail, blocked };
}

export function resolveContractV1(input: {
  allowedFailCount: number;
  finalFail: number;
  pendingBehavioral: number;
  blocked: number;
  provisionalFail: number;
  allWorkDone: boolean;
  alreadyFailed: boolean;
  alreadyVoided: boolean;
  abandonedAfterStart: boolean;
}): ContractV1Outcome {
  if (input.alreadyFailed || input.abandonedAfterStart) return 'failed';
  if (input.alreadyVoided) return 'success';
  if (input.finalFail > input.allowedFailCount) return 'failed';
  if (input.blocked > 0 || input.provisionalFail > 0 || input.pendingBehavioral > 0) return 'pending';
  if (input.allWorkDone) return 'success';
  return 'pending';
}
