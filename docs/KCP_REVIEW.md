# KCP review — JIKYEO MONEY V1

Product: 지켜(JIKYEO) is a personal commitment app. MONEY is optional. A user may lock one total Stake on one Commitment. There is no prize, betting, pool, or payout to friends.

## Flow

```
Commitment
  → one total Stake charge (one upfront payment)
  → perform / verify (occurrence PASS / provisional FAIL / UNCERTAIN)
  → Appeal window + server Grace
  → final ContractOutcome
     SUCCESS → one full cancel/refund to the original method
     FAIL    → no cancel
```

Shared Commitment and SOCIAL never pool money. Friends never receive money. No winner. Partial / pro-rata refund is not required for V1.

## Provider functions required for V1

1. charge
2. full cancel / refund
3. payment / refund status lookup
4. stable transaction identity
5. retry / reconciliation safety

## OPEN (not claimed)

- [ ] business-model acceptance
- [ ] card / KakaoPay availability behind KCP
- [ ] refund timing / limits
- [ ] native iOS integration path
- [ ] test credentials / site code / certificate

No KCP network calls are implemented in this phase.
