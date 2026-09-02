# SRD — System Requirements Document
> 버전: v0.9  
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

### SR-FR-003 약속금
- 회차당 금액과 전체 최대손실을 분리 저장해야 한다.
- 결제 전 최대손실을 클라이언트와 서버 모두 검증해야 한다.
- 서버가 금액 상한 정책을 강제해야 한다.

### SR-FR-004 결제
- 약속 활성화 전 선결제가 성공해야 한다.
- 중복 결제를 막기 위해 idempotency key를 사용해야 한다.
- PG webhook을 검증해야 한다.
- 환불/취소 실패 시 재시도해야 한다.

### SR-FR-005 Occurrence 생성
- 반복 약속은 서버가 실행 회차를 생성해야 한다.
- 회차 window/deadline은 생성 당시 timezone 규칙을 따르며 UTC로 저장해야 한다.

### SR-FR-006 Evidence
- 사진, GPS, Timer, Self, Friend 증거를 저장할 수 있어야 한다.
- 원본 촬영시각과 서버수신시각을 모두 저장해야 한다.
- 업로드 장애 시 재전송을 지원해야 한다.

### SR-FR-007 Verification
- 결과는 PASS/UNCERTAIN/FAIL 3단계여야 한다.
- UNCERTAIN은 자동으로 금전 실패를 확정해서는 안 된다.
- verifier/model/version/reason을 기록해야 한다.

### SR-FR-008 Friend Verify
- 친구 검증자는 해당 실패금의 경제적 수익자가 될 수 없다.
- 승인/거절 이력을 감사로그에 저장해야 한다.

### SR-FR-009 Appeal
- FAIL 회차에 대해 Appeal을 생성할 수 있어야 한다.
- Appeal 승인 시 settlement를 reversal할 수 있어야 한다.
- 환불/재정산까지 원자적 상태 전이를 보장해야 한다.

### SR-FR-010 Notification
- 24h/1h/10m/deadline/result/refund 이벤트 기반 알림
- 전송 실패 retry
- 사용자의 알림 설정 준수

### SR-FR-011 Weekly Recap
- 주간 성공률
- 지킨 금액
- 놓친 금액
- 약속별 통계
- 다음 주 추천

### SR-FR-012 Goal Safety
- 위험 목표 입력 시 stake 비활성/차단
- 정책 위반 분류 결과 저장
- 사용자에게 일반적인 안전 문구 표시

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

### 실패 판정
다음 조건을 모두 만족해야 금전 FAIL 확정 가능:
1. occurrence가 active 또는 reviewing 상태였음
2. deadline 경과
3. 서비스 장애 아님
4. verification 결과가 FAIL
5. 추가증거/appeal grace 정책 종료
6. settlement lock 획득

---

## 5. Payment/Settlement 요구사항

### 시나리오
- 약속 생성 → 전체 최대금액 charge
- occurrence PASS → refundable amount 누적
- occurrence FAIL → forfeited amount 누적
- 기간 종료 → refundable total 환불
- appeal 승인 → 환불액 재계산 및 추가 refund

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
