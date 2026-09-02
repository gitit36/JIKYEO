# 지켜 / JIKYEO

한국형 **약속 계약 앱 (Commitment Contract App)**.

> 해야 할 일을 기록하는 앱이 아니라,
> 못 지키면 실제 대가가 걸리는 **자기계약 앱**.

- 사용자는 약속을 만들고 **약속금**을 선결제한다.
- **PASS / UNCERTAIN / FAIL** 3단계 판정으로 각 회차를 결산한다.
- 성공한 회차는 환불, 실패한 회차는 미환불된다.
- 친구는 약속을 **지켜보는 사람**이지 실패금을 받는 사람이 아니다.
- 시스템 장애로는 절대 사용자가 돈을 잃지 않는다.

전체 제품 문서는 [`docs/`](./docs) 참고.

- [MRD](./docs/MRD.md) — 시장/포지셔닝
- [PRD](./docs/PRD.md) — 제품 요구사항 / UX
- [ERD](./docs/ERD.md) — 데이터 모델
- [SRD](./docs/SRD.md) — 시스템 요구사항
- [TRD](./docs/TRD.md) — 기술 요구사항

---

## Monorepo layout

```
JIKYEO/
├─ apps/
│  ├─ api/     # NestJS + Prisma + BullMQ backend
│  └─ ios/     # SwiftUI iOS app
├─ packages/
│  └─ contracts/  # shared API/DTO contracts (later)
├─ infra/         # docker-compose (postgres, redis, localstack)
└─ docs/          # source-of-truth product docs
```

## Development quickstart

Prereqs: Node 20+, pnpm 9+, Docker, Xcode 16+.

```bash
# 1. Bring up infra (Postgres, Redis, LocalStack S3)
cd infra && docker compose up -d

# 2. Install and migrate
pnpm install
cd apps/api
cp .env.example .env
pnpm prisma migrate dev
pnpm start:dev
```

The API defaults to `http://localhost:3000` and uses:

- **MockPaymentProvider** — real Korean PG is not wired in MVP.
- **MockVerificationProvider** — real vision model is not wired in MVP.
- **MockPushSender** — writes to `notifications_outbox` instead of APNs.

See [`apps/api/README.md`](./apps/api/README.md) and [`apps/ios/JIKYEO/README.md`](./apps/ios/JIKYEO/README.md).
