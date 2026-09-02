import { InvalidStateTransitionError } from '../errors/domain-errors';
import { commitmentSM } from './commitment.state';
import { canConfirmFail, occurrenceSM } from './occurrence.state';
import { stakeSM } from './stake.state';

describe('commitmentSM', () => {
  it('allows the happy path', () => {
    expect(() => commitmentSM.assert('draft', 'payment_pending')).not.toThrow();
    expect(() => commitmentSM.assert('payment_pending', 'active')).not.toThrow();
    expect(() => commitmentSM.assert('active', 'completed')).not.toThrow();
  });

  it('rejects impossible transitions', () => {
    expect(() => commitmentSM.assert('draft', 'completed')).toThrow(InvalidStateTransitionError);
    expect(() => commitmentSM.assert('completed', 'active')).toThrow(InvalidStateTransitionError);
  });
});

describe('occurrenceSM', () => {
  it('supports the reviewing → {pass|uncertain|fail} fan-out', () => {
    for (const to of ['pass', 'uncertain', 'fail'] as const) {
      expect(() => occurrenceSM.assert('reviewing', to)).not.toThrow();
    }
  });

  it('allows appeal reversal from fail to pass/void', () => {
    expect(() => occurrenceSM.assert('fail', 'pass')).not.toThrow();
    expect(() => occurrenceSM.assert('fail', 'void')).not.toThrow();
  });
});

describe('stakeSM', () => {
  it('follows funding → settling → settled/refunded', () => {
    expect(() => stakeSM.assert('pending', 'funded')).not.toThrow();
    expect(() => stakeSM.assert('funded', 'settling')).not.toThrow();
    expect(() => stakeSM.assert('settling', 'refunded')).not.toThrow();
  });
});

describe('canConfirmFail 5-condition gate', () => {
  it('requires all 5 conditions', () => {
    expect(
      canConfirmFail({
        wasActiveOrReviewing: true,
        deadlinePassed: true,
        noSystemOutage: true,
        verificationResultIsFail: true,
        additionalEvidenceOrAppealGraceEnded: true,
      }),
    ).toBe(true);
    expect(
      canConfirmFail({
        wasActiveOrReviewing: true,
        deadlinePassed: true,
        noSystemOutage: false, // outage
        verificationResultIsFail: true,
        additionalEvidenceOrAppealGraceEnded: true,
      }),
    ).toBe(false);
  });
});
