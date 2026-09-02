-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "attempt" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "commitment_id" UUID;

-- AlterTable (backfill-safe: existing rows get the canonical per-occurrence key)
ALTER TABLE "settlements" ADD COLUMN     "idempotency_key" TEXT;
UPDATE "settlements" SET "idempotency_key" = 'settle:' || "occurrence_id"::text WHERE "idempotency_key" IS NULL;
ALTER TABLE "settlements" ALTER COLUMN "idempotency_key" SET NOT NULL;

-- AlterTable
ALTER TABLE "stakes" ADD COLUMN     "funded_at" TIMESTAMPTZ,
ADD COLUMN     "refunded_at" TIMESTAMPTZ,
ADD COLUMN     "settled_at" TIMESTAMPTZ;

-- CreateTable
CREATE TABLE "payment_webhook_events" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "provider_payment_key" TEXT NOT NULL,
    "payment_id" UUID,
    "event_type" TEXT NOT NULL,
    "event_status" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,
    "outcome" TEXT,

    CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payment_webhook_events_provider_payment_key_idx" ON "payment_webhook_events"("provider_payment_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_webhook_events_provider_event_id_key" ON "payment_webhook_events"("provider", "event_id");

-- CreateIndex
CREATE INDEX "payments_commitment_id_type_status_idx" ON "payments"("commitment_id", "type", "status");

-- CreateIndex
CREATE INDEX "payments_provider_payment_key_idx" ON "payments"("provider_payment_key");

-- CreateIndex
CREATE UNIQUE INDEX "settlements_idempotency_key_key" ON "settlements"("idempotency_key");

-- AddForeignKey
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

