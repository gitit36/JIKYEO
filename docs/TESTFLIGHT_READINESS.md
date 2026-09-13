# TestFlight readiness

Verified in Phase 7C code and local builds. Do not treat unchecked items as done.

## READY IN CODE

- [x] Release MVP path covers onboarding/auth, create Commitment, SELF, SOCIAL, Friends, Shared Commitment, GPS, Focus Timer, Self Verify, Friend Verify, Grace, Appeal, History, Weekly Recap, in-app notification state
- [x] MONEY real payment gated (`MONEY_DISABLED` / `준비 중` unless explicit review-demo)
- [x] Photo/AI verification Release-gated (`준비 중` / `METHOD_UNAVAILABLE`)
- [x] DEBUG fixtures, MockPayment toggle, mock GPS, debug menus compile out of Release
- [x] Core screens have loading / empty / retryable Korean error states (no raw backend codes)
- [x] Expired session / 401 returns to auth; logout clears session + unsigned MONEY cache
- [x] Tab UI remounts per user id so authenticated caches do not cross accounts
- [x] Unauthorized commitment/recap deep links fail safely
- [x] Submit CTAs ignore duplicate taps; retries reuse existing server idempotency
- [x] Dynamic Type on primary type scale; PASS/UNCERTAIN/FAIL and money chips keep text labels
- [x] History list capped at 80; Home no longer extra-lists commitments on every appear
- [x] Analytics no-op/debug abstraction; sensitive keys stripped; delivery cannot fail domain
- [x] Bundle ID `com.jikyeo.app`, version `0.1.0` / build `1`, display name `지켜`
- [x] Camera / Photo Library / Location When-In-Use usage strings exist and match GPS/photo usage
- [x] Notification permission path uses system prompt + `PushRegistrar` (no fake simulator token in Release)
- [x] Evidence delete and friend block/remove visibility remain server-enforced

## EXTERNAL / MANUAL BLOCKERS

- [ ] Apple `DEVELOPMENT_TEAM` / signing certificate / provisioning (project has empty team, `CODE_SIGNING_ALLOWED=NO`)
- [ ] Physical iPhone install
- [ ] APNs Auth Key (`.p8`) / Team ID / Key ID / topic
- [ ] Archive / TestFlight upload
- [ ] Deployed HTTPS legal/support URLs (public pages exist in code, not deployed)
- [ ] Production support/operator information
- [ ] External MONEY approvals (KCP, Apple External Purchase, lawyer/tax/telecom, LBS)

See `docs/LAUNCH_GATES.md` for production MONEY and live APNs gates.
