# MVP Feature Matrix

Authoritative Release scope. External gates stay open until written evidence exists. Code never marks an external gate complete.

## Enabled

- SELF commitments
- SOCIAL accountability
- Friends
- Shared Commitments
- Friend Verify
- Appeal
- History
- Weekly Recap
- GPS verification
- Focus Timer
- Self Verify
- existing local / in-app notification behavior
- MONEY domain and UI for authorized review/demo only

## Not production-enabled

- real MONEY transactions
- AI Photo / real Vision
- any proof method that is mock-only
- real APNs (Phase 7B)

## Deferred

- public feed, chat/comments, followers, leaderboards
- pooled / group money
- Admin Web UI
- additional integrations
- subscription / other monetization

## Release rules

- Ordinary production MONEY is fail-closed. `MONEY_ENABLED=true` plus MockPayment is not live payment.
- Review/demo MONEY requires explicit `REVIEW_DEMO_MONEY=true` and mock provider only. The client must label it as not a real payment.
- Production live MONEY requires a live PG selection (`PAYMENT_PROVIDER=kcp|kr_pg`) and is still blocked until launch gates pass.
- Photo is `준비 중` in ordinary Release. Implementation remains for Debug/tests.
- Debug toggles are Debug-only.

See `docs/LAUNCH_GATES.md` for the single external checklist.
