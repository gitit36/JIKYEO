/**
 * Shared financial-finality guard. Settlement, sweep, admin, and concurrent
 * jobs must all use this — FAIL is provisional until the persisted appeal
 * window expires with no appeal, or an appeal is rejected.
 */

export type FinalMoneyStatus = 'pending' | 'pass' | 'fail' | 'void';

export interface FinalityOccurrence {
  status: string;
  appealOpenedAt?: Date | null;
  appealDeadlineAt?: Date | null;
}

export interface FinalityAppeal {
  status: string;
  correctedResult?: string | null;
}

export function appealWindowFields(
  now: Date,
  windowSeconds: number,
  existing?: { appealOpenedAt?: Date | null; appealDeadlineAt?: Date | null },
): { appealOpenedAt: Date; appealDeadlineAt: Date } {
  if (existing?.appealOpenedAt && existing?.appealDeadlineAt) {
    return { appealOpenedAt: existing.appealOpenedAt, appealDeadlineAt: existing.appealDeadlineAt };
  }
  return {
    appealOpenedAt: now,
    appealDeadlineAt: new Date(now.getTime() + windowSeconds * 1000),
  };
}

export function isAppealOpen(occ: FinalityOccurrence, now: Date): boolean {
  if (occ.status !== 'fail' || !occ.appealDeadlineAt) return false;
  return now.getTime() < occ.appealDeadlineAt.getTime();
}

export function financialStatus(
  occ: FinalityOccurrence,
  appeal: FinalityAppeal | null | undefined,
  now: Date,
): FinalMoneyStatus {
  if (appeal && (appeal.status === 'submitted' || appeal.status === 'reviewing')) return 'pending';
  if (appeal?.status === 'approved' && (appeal.correctedResult === 'pass' || appeal.correctedResult === 'void')) {
    return appeal.correctedResult;
  }
  if (occ.status === 'pass' || occ.status === 'void') return occ.status;
  if (occ.status === 'fail') {
    if (appeal?.status === 'rejected') return 'fail';
    if (!occ.appealDeadlineAt) return 'pending';
    if (now.getTime() < occ.appealDeadlineAt.getTime()) return 'pending';
    return 'fail';
  }
  return 'pending';
}

export function isFinanciallyFinal(
  occ: FinalityOccurrence,
  appeal: FinalityAppeal | null | undefined,
  now: Date,
): boolean {
  return financialStatus(occ, appeal, now) !== 'pending';
}
