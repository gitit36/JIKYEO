# @jikyeo/api

NestJS backend for 지켜 / JIKYEO.

## Layout

```
src/
├─ main.ts
├─ app.module.ts
├─ config/                 # env + typed AppConfig
├─ common/                 # money, clock, errors, filters, guards, idempotency, locker, state machines
├─ prisma/                 # PrismaService
├─ audit/                  # append-only audit log
├─ auth/                   # apple / google / email + JWT (mock verifiers in MVP)
├─ users/
├─ commitments/            # draft, quote, activate, cancel
├─ occurrences/            # generator, scheduler-facing service
├─ verification/
│  ├─ providers/           # PaymentProvider abstraction + MockVerificationProvider
│  └─ verifiers/           # photo, gps, timer, self, friend
├─ evidence/
├─ payments/
│  ├─ providers/           # PaymentProvider abstraction + MockPaymentProvider
│  ├─ ledger.service.ts    # append-only ledger
│  └─ webhook.controller.ts
├─ settlements/
├─ appeals/
├─ friends/
├─ observers/
├─ notifications/
├─ safety/                 # goal-safety classifier (rule-based MVP)
├─ admin/
├─ queue/                  # BullMQ workers
└─ storage/                # S3 presigned upload
```

## Key invariants

1. **Money moves only through `LedgerService.append(...)`.**
2. **All FAIL decisions require the 5-condition gate** (see `src/common/state/occurrence.state.ts`).
3. **Server is authoritative** for time (`Clock`), quote (`CommitmentQuoteService`), state transitions, and money.
4. **Idempotency** required on all money-side and webhook endpoints via `IdempotencyGuard`.

## MVP mocks

| Concern            | Provider                       | Env value           |
|--------------------|--------------------------------|---------------------|
| Payment            | `MockPaymentProvider`          | `PAYMENT_PROVIDER=mock` |
| Photo verification | `MockVerificationProvider`     | `VERIFICATION_PROVIDER=mock` |
| Push               | `MockPushSender` → DB outbox   | `PUSH_PROVIDER=mock` |
