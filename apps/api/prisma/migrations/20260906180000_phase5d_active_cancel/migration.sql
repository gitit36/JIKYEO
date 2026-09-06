-- Phase 5D: active-commitment cancellation cutoff timestamps.

ALTER TABLE "commitments" ADD COLUMN "cancellation_requested_at" TIMESTAMPTZ;
ALTER TABLE "commitments" ADD COLUMN "cancellation_effective_at" TIMESTAMPTZ;
CREATE INDEX "commitments_status_cancellation_effective_at_idx" ON "commitments"("status", "cancellation_effective_at");
