# SRD — System Requirements Document
> 버전: v1.0 (Phase 3 개정)  
> 목적: 시스템 관점의 기능/비기능 요구사항을 정의한다.

---

## 1. 시스템 개요

### 구성
- iOS App
- API Backend
- Auth Service
- Commitment Engine
- Verification Engine
- AI Vision/LLM
- Payment Service
- Settlement/Refund Worker
- Notification Service
- Appeal/Admin Console
- Object Storage
- Relational DB
- Analytics/Event Pipeline

---

## 2. 기능 요구사항

### SR-FR-001 회원
- Apple/Google/Email 로그인을 지원해야 한다.
- 사용자 locale/timezone을 저장해야 한다.
- 미성년자 정책에 따라 금전 Stake를 제한할 수 있어야 한다.

### SR-FR-002 약속 생성
- one-time, daily, specific-days, x-per-week를 지원해야 한다.
- 사용자 지정 deadline과 timezone을 저장해야 한다.
- 약속 확정 후 과거/현재 회차 조건은 임의 수정할 수 없어야 한다.
- 사용자는 각 약속마다 강제력 모드(**SELF / SOCIAL / MONEY**) 중 하나를 지정한다.
- SOCIAL 모드는 실제 verifier 관계가 존재해야 활성화될 수 있다. Release 빌드에서 verifier가 없으면 서버는 활성화를 거부한다 (`FRIEND_NOT_SELECTED`).
- MONEY 모드는 서버 확인 만 19세+와 결제 전 약관 스냅샷 동의가 필요하다. 운영 환경 MONEY는 기본 비활성(fail-closed). SELF는 나이 확인 없이 가능하다.
- 활성 약속 취소의 컷오프는 `cancellationRequestedAt`이다. 요청 철회/재일정은 없다.

### SR-FR-003 약속금 (MONEY 모드 전용)
- MONEY V1은 약속 단위 약속금 1건이다. 회차 수와 곱하지 않으며 `maxLoss = Stake`.
- 결제 전 최대손실을 클라이언트와 서버 모두 검증해야 한다.
- 서버가 티어별 금액 상한 정책을 강제해야 한다 (SR-FR-003b 참조).
- SELF/SOCIAL 모드에서는 Stake row가 생성되지 않아야 한다. 0원 Stake row 형태로 우회 표현하는 것은 금지된다.

### SR-FR-003b StakePolicy (서버 authoritative)
- 시스템은 사용자에게 부여된 티어(TIER_1 / TIER_2 / TIER_3)에 따른 아래 값을 강제해야 한다:
  - `maxPerOccurrence`
  - `maxPerCommitment`
  - `rollingMonthlyLossCap`
  - `suggestedAmounts`
- 값은 설정 파일/DB로 구성 가능해야 하며, 코드에 하드코딩하지 않아야 한다.
- 신규 사용자는 자동으로 TIER_1으로 시작한다.
- 자동 티어 승격은 MVP에 포함되지 않는다. 승격은 admin fixture로만 수행한다.
- 클라이언트가 상한을 조작해도 서버가 최종 거부해야 한다.

### SR-FR-004 결제 (MONEY 모드 전용)
- 선결제 성공은 Stake funded + `signature_pending`까지만 만든다. `/sign`이 끝나야 `active`가 된다. 결제 성공만으로 활성화하지 않는다.
- 서명 전 취소/만료: `payment_pending`(미충전)은 PG/ledger 없이 취소. `signature_pending`(충전됨)은 원결제 수단으로 전액 환불 1회. 만료는 동일 환불 경로. forfeit/refund_earned를 만들지 않는다. 환불 실패는 기존 `refund_delayed` 재시도. 손실 한도 예약은 환불 성공 전까지 유지. 서명 vs 취소/만료는 원자적으로 하나만 성공한다.
- MONEY V1 활성 취소: 시작 전 사용자 취소와 시스템 취소는 전액 환불 1회. 시작 후 사용자 취소는 자진 포기로 환불 없이 전액 forfeit 1회. SELF 컷오프는 기존과 같다. FAIL은 재정적 최종성 전에 몰수하지 않는다. 허용 FAIL(Grace) 안의 최종 FAIL은 원장을 움직이지 않는다.
- 중복 결제를 막기 위해 idempotency key를 사용해야 한다.
- 서버 서명 quote를 사용해야 하며, 각 quote는 unique `jti`로 식별되고 한 번만 소비된다 (`consumed_quotes`).
- Quote 서명 시크릿(`QUOTE_SIGNING_SECRET`)은 JWT 시크릿과 분리되어야 한다.
- PG webhook을 검증해야 한다.
- 환불/취소 실패 시 재시도해야 한다.
- SELF/SOCIAL 모드에서는 결제 흐름이 실행되지 않아야 한다.

### SR-FR-005 Occurrence 생성
- 반복 약속은 서버가 실행 회차를 생성해야 한다.
- 회차 window/deadline은 생성 당시 timezone 규칙을 따르며 UTC로 저장해야 한다.

### SR-FR-006 Evidence
- 사진, GPS, Timer, Self, Friend 증거를 저장할 수 있어야 한다.
- 사진은 앱 카메라 캡처가 원칙이며, 갤러리 업로드는 엄격 검증 흐름에서 비활성이다.
- 사진 증거는 SHA-256 hash를 저장해 재사용을 탐지해야 한다.
- 원본 촬영시각(client)과 서버 수신시각을 모두 저장해야 한다.
- GPS 증거는 위·경도, 정확도, 대상 target의 좌표/반경, 서버 Haversine 거리 계산 결과를 함께 기록해야 한다.
- Timer 증거는 서버 발급 session id, heartbeat gap, background 전환 횟수를 포함해야 한다.
- 업로드 장애 시 재전송을 지원해야 한다.
- Object storage abstraction을 사용해야 하며, 개발 환경은 로컬 mock storage로 대체할 수 있다.

### SR-FR-007 Verification
- 결과는 **PASS / UNCERTAIN / FAIL** 3단계여야 한다. Boolean으로 축약 금지.
- 세 강제력 모드(SELF/SOCIAL/MONEY) 모두 동일한 판정 결과 스키마를 사용해야 한다.
- Verification 모듈은 결과만 결정한다. **금전 정산은 절대 Verification 모듈에서 실행되지 않는다.** 정산은 별도 워커/Phase에서 결과를 소비한다.
- UNCERTAIN은 자동으로 금전 실패를 확정해서는 안 된다.
- 시스템 장애 상황에서는 UNCERTAIN 또는 `system_hold`로 처리해야 하며 monetary FAIL을 만들지 않아야 한다.
- verifier / model / version / reason_code / user_message / confidence(적용 가능 시)를 기록해야 한다.

### SR-FR-008 Friend Verify
- 친구 검증자는 해당 실패금의 경제적 수익자가 될 수 없다.
- 승인/거절 이력을 감사로그에 저장해야 한다.

### SR-FR-009 Appeal
- MONEY 최종 FAIL에 한해 소유자가 Appeal을 1회 생성할 수 있다 (7일, 서버 설정).
- UNCERTAIN / system_hold / PASS / VOID / SELF / SOCIAL은 대상이 아니다.
- 제출은 원장·결제·원판정을 바꾸지 않는다. 기간 내 제출분은 만료 후에도 검토 가능하다.
- 관리자는 기각(사용자 문구) 또는 승인(`correctedResult` = PASS|VOID)한다. 원 VerificationResult / Settlement / Ledger는 불변이며 originalResult와 effectiveResult를 분리한다.
- 대기 중 Appeal은 해당 회차 정산과 약속 재정 완료를 막는다.
- 정산 전 승인: 정산이 correctedResult를 소비하고 reversal을 만들지 않는다.
- 몰수 후 승인: 원래 forfeit을 참조하는 reversal 1건 + 회차 금액 추가 환불 1건. 누적 환불은 선결제액을 넘지 않는다.
- 추가 환불 실패는 `refund_delayed`와 기존 retry/reconcile을 따른다. 손실한도 크레딧은 추가 환불 성공 후에만 복구된다.

### SR-FR-010 Notification
- 트랜잭션 outbox. 도메인 상태는 푸시 성공에 의존하지 않는다.
- 이벤트: 증명 마감 리마인더, 서명 만료, 환불 완료/지연, 항소 승인/기각, Weekly Recap 준비.
- 기기 토큰(해시+암호화, sandbox/production), 카테고리 옵트인, pending/sent/failed, backoff retry, invalid-token 비활성, 논리 이벤트당 안정 dedupe key.
- 전송은 at-least-once. 중복 enqueue만 방지한다. lock-screen은 일반 문구 + 인증 딥링크. 목표/증거/금액 금지.
- OS 권한·토큰 등록·카테고리 옵트인 전에는 푸시하지 않는다. 푸시 off가 앱 안 상태를 가리지 않는다.

### SR-FR-011 Weekly Recap
- 사용자 타임존 직전 Mon–Sun, 기본 월요일 로컬 09:00, `(userId, localWeekStart)` 1회.
- 유효 결과 due/PASS/FAIL/VOID/unresolved, completionRate = PASS/(PASS+FAIL) 또는 null.
- MONEY 회차가 있을 때만 금액 섹션. 빈 recap 생성·푸시 금지. owner-only API.

### SR-FR-012 Goal Safety
- 위험 목표 입력 시 MONEY stake 비활성화 (`stake_disallowed`) 또는 목표 자체 차단(`unsafe`).
- SELF/SOCIAL 모드로도 만들 수 없는 명백히 위험한 목표(자해, 약 복용 중단 등)는 완전 차단한다.
- 정책 위반 분류 결과 저장
- 사용자에게 일반적인 안전 문구 표시 (공포 조장 금지)

### SR-FR-013 Enforcement Mode
- 각 Commitment는 `enforcement_mode`를 갖는다: SELF / SOCIAL / MONEY.
- SELF: quote 없음, Stake row 없음, PaymentModule 미실행.
- SOCIAL: quote 없음, Stake row 없음, 활성화 시 CommitmentObserver 관계 필수.
- MONEY: quote 필수, Stake row 필수, `consumed_quotes` 소비 필수.
- Verification 결과의 스키마는 세 모드 모두 동일하다.
- 홈/오늘 UI는 오늘 회차 중 MONEY 회차만 at-risk 합산에 포함해야 한다. SELF/SOCIAL 회차는 at-risk 합계에 포함되지 않는다.

### SR-FR-014 Deadline Processing
- 서버는 주기적으로 `deadline_at`이 지난 active occurrence를 스캔한다.
- 각 후보에 대해:
  - Evidence가 이미 존재하거나 검증 중이면 → `reviewing`.
  - Evidence가 없으면 → **candidate FAIL**.
- Candidate FAIL을 최종 FAIL로 확정하기 전에 아래를 확인한다:
  - 알려진 시스템 장애 없음
  - Verification 인프라 정상
  - 유예(grace) 조건 없음
- 시스템 장애/인프라 장애일 경우 상태는 `system_hold` 또는 `uncertain`이 되어야 하며, 절대 monetary FAIL을 만들지 않아야 한다.
- Deadline 이전에 제출된 evidence의 서버 처리 지연은 성공/실패 판정을 뒤집지 않아야 한다.

---

## 3. 비기능 요구사항

### 성능
- 주요 API p95 < 500ms
- 홈 조회 p95 < 700ms
- 결제 요청 응답 < 3s 목표
- 사진 업로드는 presigned URL 사용 가능

### 가용성
- 핵심 API 월 99.9% 목표
- 장애 중 자동 FAIL 금지
- verification outage 발생 시 해당 occurrence를 `system_hold`로 둘 수 있어야 함

### 정합성
- 결제/환불/실패 판정은 strong consistency 필요
- money ledger append-only
- 상태 전이는 transaction으로 보호

### 보안
- TLS
- DB encryption at rest
- Object storage encryption
- payment token 직접 저장 금지
- 최소권한 IAM
- admin MFA
- audit logging

### 개인정보
- Evidence는 최소 기간 보존
- 친구에게 기본적으로 결과만 공유
- 증거사진 공유는 opt-in
- 위치정보는 목적과 기간을 명확히 고지

### 관찰성
- API error rate
- payment success/failure
- refund success/failure
- verification uncertain rate
- appeal rate
- wrong-fail incident
- queue lag
- notification failure

---

## 4. 핵심 도메인 규칙

### 시간
- 모든 서버 저장은 UTC
- 사용자 화면은 commitment.timezone
- Device time만으로 deadline 판정 금지
- 서버 수신시간을 authoritative time으로 사용

### 금액
- 통화는 MVP KRW
- 금액은 정수 원 단위
- float 금지
- max_loss 서버 검증
- 월 최대 손실 제한 지원

### 실패 판정 (behavioral)
Verification 결과가 FAIL로 확정되려면 아래를 만족해야 한다:
1. occurrence가 active 또는 reviewing 상태였음
2. deadline 경과 또는 명시적 FAIL evidence 제출
3. 서비스 장애 아님 (그렇지 않으면 `system_hold` 또는 UNCERTAIN)
4. 사용된 verifier가 FAIL을 산출
5. 추가증거/grace 정책 종료

### 금전 FAIL 확정 (MONEY 모드 전용, Settlement)
behavioral FAIL에 더해:
6. Commitment가 MONEY 모드
7. Stake row가 funded 상태
8. Settlement row `(occurrence_id)` unique + `idempotency_key` 획득 (중복 정산 차단)

Verification은 behavioral 결과만 기록한다. MONEY V1 Settlement는 계약 결과만 소비한다:
- 계약 SUCCESS / 시작 전·시스템 취소 → 전액 `refund_paid` 1회
- 계약 FAIL / 시작 후 자진 포기 → 전액 `forfeit` 1회, 환불 호출 없음
- 회차 PASS/FAIL/VOID는 `refund_earned`나 회차별 forfeit을 만들지 않는다
- UNCERTAIN / `system_hold` / 잠정 FAIL은 정산하지 않음
- 레거시 회차 비례(`end_of_commitment` + `refund_earned`)는 신규 생성 경로에서 사용하지 않는다 (비출시)
- 환불 실패 → `refund_delayed`, 재시도는 idempotent.

사용자 화면의 금전 상태(결제 중·약속금 걸림·환불 예정·환불 중·환불 완료·결제 실패·환불 지연·정산 완료)는 항상 정산/ledger에서 파생하며, behavioral FAIL 시점에 "돈을 잃었다"고 표현하지 않는다. 전액 몰수는 `정산 완료`이며 “환불 완료 0원”을 쓰지 않는다.

---

## 5. Payment/Settlement 요구사항 (MONEY 모드 전용)

이 절은 MONEY 모드 Commitment에만 적용된다. SELF/SOCIAL Commitment는 결제/정산 로직을 갖지 않으며, `payment_ledger`, `settlement`, `payment` row가 생성되지 않는다.

### 시나리오
- MONEY 약속 생성 → quote 소비 → 약속금 1회 charge
- 계약 성공 → 전액 환불 1회
- 계약 실패 → 환불 없음, 전액 forfeit 1회
- 회차 비례/부분 환불은 V1 경로에 없다
- appeal 승인 → 정산 전이면 correctedResult로 정산(reversal 없음). 몰수 후면 reversal 1 + 추가 refund 1

### 요구
- webhook signature verification
- idempotency
- reconciliation batch
- manual admin reprocess
- payment/ledger mismatch alert

---

## 6. Verification 요구사항

### Photo AI
Input:
- goal text
- proof rule
- image
- metadata

Output:
```json
{
  "result": "PASS|UNCERTAIN|FAIL",
  "confidence": 0.93,
  "reason_code": "MATCHED_GYM_CONTEXT",
  "user_message": "헬스장 안에서 찍은 사진으로 확인됐어요."
}
```

### GPS
- 정확도 threshold
- mock location heuristic
- radius check
- timestamp check

### Timer
- server-issued session id
- heartbeat
- background policy
- tamper detection

---

## 7. Admin/Operations 요구사항

관리자는 다음을 수행할 수 있어야 한다.
- 사용자 조회
- Commitment 조회
- Occurrence 상태 확인
- Evidence 확인
- Verification result 확인
- Appeal 승인/거절
- Settlement 재처리
- Refund 재시도
- 잘못된 FAIL void
- 사용자 제재
- 위험 목표 로그 확인

모든 admin action은 Audit Log 필수.

---

## 8. 이벤트 정의

- user_signed_up
- onboarding_completed
- commitment_started
- stake_paid
- occurrence_started
- evidence_submitted
- verification_passed
- verification_uncertain
- verification_failed
- appeal_submitted
- appeal_approved
- appeal_rejected
- settlement_completed
- refund_completed
- friend_invited
- friend_verified
- weekly_recap_viewed

---

## 9. 장애 정책

### Verification 장애
- 해당 occurrence 자동 FAIL 금지
- status = system_hold
- 복구 후 재검증
- 사용자에게 알림

### PG 장애
- 결제 미확정 시 commitment 활성화 금지
- 환불 장애 시 계속 retry
- 환불 지연 사용자 안내

### Push 장애
- push 실패가 실패 판정 근거가 되어서는 안 됨

---

## 10. 보안/안전 요구

- jailbroken/rooted device risk signal 수집 가능
- camera-only mode 지원
- duplicate image hash
- rate limiting
- friend verify collusion 탐지용 로그
- 위험 목표 분류
- 미성년 금전 stake 차단
