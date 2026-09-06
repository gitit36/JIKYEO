-- Phase 5A: unsigned-payment recovery (signature expiry + cancel reason + job lease)

CREATE TYPE "CancellationReason" AS ENUM ('user_cancelled', 'signature_expired');

ALTER TABLE "commitments"
  ADD COLUMN "signature_expires_at" TIMESTAMPTZ,
  ADD COLUMN "cancelled_at" TIMESTAMPTZ,
  ADD COLUMN "cancellation_reason" "CancellationReason";

CREATE INDEX "commitments_status_signature_expires_at_idx"
  ON "commitments" ("status", "signature_expires_at");

CREATE TABLE "job_leases" (
  "name" TEXT NOT NULL,
  "holder" TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "job_leases_pkey" PRIMARY KEY ("name")
);
