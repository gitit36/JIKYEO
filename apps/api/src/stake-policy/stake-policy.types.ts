import { StakeTier } from '@prisma/client';

/**
 * A single tier's fully-resolved product limits. All amounts are KRW.
 *
 * These are PRODUCT limits — not regulatory claims. They exist so that a
 * brand-new user cannot immediately expose themselves to a very large loss
 * before we have any behavioral signal about them. They must be
 * configurable so legal / PG review can change them without touching
 * domain code.
 */
export interface StakeTierConfig {
  tier: StakeTier;
  maxPerOccurrenceKrw: number;
  maxPerCommitmentKrw: number;
  rollingMonthlyLossCapKrw: number;
  suggestedAmountsKrw: number[];
}

/**
 * The shape exposed to the client by `GET /v1/stake-policy`.
 *
 * `currentTier` is the tier that applies to the caller; `maxPerOccurrence`,
 * `maxPerCommitment`, `rollingMonthlyLossCap`, and `suggestedAmounts` are
 * pre-resolved for that tier. `rollingMonthlyLossRemaining` is the amount
 * still available under the monthly cap after subtracting the running total
 * of confirmed forfeits this month. In Phase 3 there is no real settlement
 * yet, so this equals the cap.
 */
export interface StakePolicyResponse {
  currentTier: StakeTier;
  maxPerOccurrenceKrw: number;
  maxPerCommitmentKrw: number;
  rollingMonthlyLossCapKrw: number;
  rollingMonthlyLossRemainingKrw: number;
  suggestedAmountsKrw: number[];
}
