# MVP E2E QA

Live simulator QA against the current local API. Jest/API-only checks are not counted as UI E2E.

| | |
|---|---|
| Simulator | iPhone 17 (iOS 26.5), UDID `37D39D4E-6E19-49CC-835C-37B3A3AA81DD` |
| Baseline | `da778c6` (Phase 7C) |
| QA commit | this Phase 7D commit (E2E blockers only) |
| Backend | fresh `nest start` from current tree; Postgres `jikyeo` @ `127.0.0.1:5432`; Redis `6379` |
| Schema | 12 Prisma migrations, up to date |
| `GET /v1/public/mvp` | 200 — `moneyMode: development`, `moneyEnabled: true`, `reviewDemo: false`, methods self/friend/gps/timer true; photo true in development only |

## Required flows

| Flow | Result | Notes |
|---|---|---|
| 1 SELF basic | **PASS** | Create → activate → Today Self Verify PASS → History `1회차 지켰어요`. Relaunch kept session. |
| 2 Repeating + grace | **PASS** | Repeating SELF, one FAIL (commitment stayed `active`), remaining occurrence PASS. No MONEY. Grace/strictness is MONEY-only; SELF repeating stays alive after one miss. |
| 3 Friendship + SOCIAL | **PASS** | A invite code → B request → A accept. B Friends shows SOCIAL progress (`1/1`) only. Social view keys: title/progress/status — no evidence/payment/appeal. |
| 4 Shared commitment | **PASS** | Shared create + B accept + independent links. Friends: UserA `1/7 · 지킴`, UserB `0/7 · 놓침`. Other member unchanged. |
| 5 Friend Verify PASS | **PASS** | B inbox `확인할 약속` rendered. Approve → A result `pass` / `친구가 약속 완료를 확인했어요.` |
| 6 Friend Verify reject + Appeal | **PASS** | MONEY Friend Verify reject → History `놓쳤어요` + `결과 확정 대기` + Appeal CTA. After submit: `검토 중`. Appeal is MONEY-FAIL only (existing rule). |
| 7 Network / session | **PASS** | Backend down → `연결이 불안정해요. 다시 시도해주세요.` Restore + retry → empty Today, no duplicate submit. Invalid session → onboarding, no prior-user Today. |
| 8 Gated features (Release) | **PASS** | Photo = `준비 중`, not selectable. No debug GPS / mock-friend / forced-result / mock-payment toggle. MONEY selectable only because this **development** API has `moneyEnabled: true` (mock PG, not live KCP). |

Deep-link fixtures (Debug, no APNs): `jikyeo://today` → Home + deadline banner; `friends` / `friend-verify` → Friends; `history` / `appeals/:id` → History; stale `commitments/:id` → Home + `이미 없거나 끝난 내용이에요.`

## Fixes from this run

- iOS `APIClient.url`: keep `?query` (Today was 404 via `%3F`).
- Debug launch forwards real `-jikyeoDebugUserId`.
- History occurrence rows show result chips (SELF PASS was invisible).
- Shared create invites accepted friends and uses a still-joinable evening window.
- Create wizard can attach `sharedCommitmentId` from Friends.

## Not verified

**Physical device:** signing, TestFlight, on-device push permission, real GPS hardware.

**External integration:** live KCP / StoreKit External Purchase, real APNs, Real Vision, production `NODE_ENV` fail-closed MONEY (matrix unit-tested; this API is development).
