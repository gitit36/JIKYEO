# TestFlight readiness

Phase 7E. Local working MVP is `00a4f10` and parents. This file separates what is ready in code from what only Apple/ops can finish.

## READY

### Code / domain

- [x] Bundle ID `com.jikyeo.app`, display name `지켜`, version `0.1.0`, build `1`, iOS 17.0
- [x] Camera / Photo Library / Location When-In-Use usage strings
- [x] Push entitlements: Debug `aps-environment=development`, Release `production`
- [x] `ITSAppUsesNonExemptEncryption=false` (HTTPS only)
- [x] Release API base is `https://api.jikyeo.app/v1` (not localhost). Loopback/http in Release fails closed with Korean copy
- [x] Release never treats development/review-demo/mock MONEY as live (`moneyMode == production` required)
- [x] iOS Release Photo is compile-time `준비 중`
- [x] DEBUG fixtures / mock GPS / mock payment toggle / debug menus compile out of Release
- [x] Production API default `MONEY_ENABLED=false` (see `apps/api/.env.production.example`)
- [x] Ordinary production + MockPayment remains fail-closed even if `MONEY_ENABLED=true`
- [x] Review/demo MONEY is a separate `REVIEW_DEMO_MONEY=true` path, not ordinary TestFlight
- [x] Simulator E2E recorded in `docs/MVP_E2E_QA.md` (Phase 7D)

### Builds

- [x] iOS Debug simulator build
- [x] iOS Release simulator build
- [x] Unsigned Release archive (no Apple team on this Mac)

## BLOCKED / MANUAL

### Signing (blocks signed device + TestFlight upload)

- [ ] Sign in to Xcode with the Apple Developer account
- [ ] Select the Development Team on target `JIKYEO` (Automatic signing). `DEVELOPMENT_TEAM` is empty on purpose — do not invent a Team ID
- [ ] Enable Automatic signing (`CODE_SIGNING_ALLOWED=YES`) after a team exists
- [ ] Create/download the App ID + provisioning profile for `com.jikyeo.app` with Push Notifications
- [ ] Signed Release archive + Organizer validate/upload

### Physical device

- [ ] Connect a signed iPhone (none was attached during Phase 7E)
- [ ] Install the signed build and run the device smoke list below

### APNs (does not block a basic TestFlight binary)

- [ ] APNs Auth Key (`.p8`) / Team ID / Key ID / topic — configure **outside the repo**
- [ ] Production API `PUSH_PROVIDER=apns` with those env vars
- Live push is **unverified**. The app still registers; missing credentials must not be reported as delivered

### Hosted backend / legal (does not block signing; blocks a usable TestFlight session)

- [ ] Deploy HTTPS API at the Release host (`https://api.jikyeo.app/v1` or change `API_BASE_URL`)
- [ ] Deploy public legal/support pages to HTTPS URLs
- [ ] Production support/operator information

### App Store Connect

- [ ] App record, screenshots, privacy nutrition labels, review notes
- [ ] Export compliance confirmation (plist already declares non-exempt encryption unused)

### Production MONEY (separate from basic TestFlight)

Do not treat these as TestFlight blockers. They remain launch gates:

- Real KCP + `MONEY_ENABLED` only after `docs/LAUNCH_GATES.md`
- StoreKit External Purchase
- Lawyer / tax / telecom / LBS

## Physical-device QA

Simulator results do not count. Signed iPhone 14 (`Susususupernova`, iOS 26.6.1) was attached. Debug device builds sign. Live API calls were blocked by iOS Local Network TCC (`Local network prohibited`) until the user taps Allow for 지켜.

| # | Flow | Result |
|---|---|---|
| 1 | login/onboarding | FAIL (Local Network TCC) |
| 2 | SELF create → Today → verify → History | FAIL (blocked by 1) |
| 3 | GPS verification | FAIL (blocked by 1) |
| 4 | Focus Timer | FAIL (blocked by 1) |
| 5 | Friends | FAIL (blocked by 1) |
| 6 | Shared Commitment | FAIL (blocked by 1) |
| 7 | Friend Verify approve/reject | FAIL (blocked by 1) |
| 8 | relaunch/session restore | FAIL (blocked by 1) |
| 9 | MONEY remains non-live | FAIL (blocked by 1; Debug+development still MockPayment only) |
| 10 | Photo remains gated | FAIL (blocked by 1; Debug+development matrix still allows photo, Release compile-gates) |

Manual unblock: first launch → Allow Local Network (설정 → 지켜 → 로컬 네트워크). Debug device API is `http://192.168.35.139:3001/v1`.

## Manual signing steps (when a team exists)

1. Xcode → Settings → Accounts → add the Apple ID
2. Target JIKYEO → Signing & Capabilities → Team
3. Confirm Push Notifications capability (Release entitlements already set `aps-environment=production`)
4. Product → Archive (Release)
5. Organizer → Validate / Distribute → TestFlight
