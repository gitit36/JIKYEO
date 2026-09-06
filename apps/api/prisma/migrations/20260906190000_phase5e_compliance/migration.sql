-- Phase 5E: financial finality, terms acceptance, adult gate, provider vs method.

CREATE TYPE "AgeVerificationStatus" AS ENUM ('unknown', 'verified_adult', 'underage');

ALTER TABLE "users" ADD COLUMN "age_verification_status" "AgeVerificationStatus" NOT NULL DEFAULT 'unknown';
ALTER TABLE "users" ADD COLUMN "age_verified_at" TIMESTAMPTZ;

ALTER TABLE "occurrences" ADD COLUMN "appeal_opened_at" TIMESTAMPTZ;
ALTER TABLE "occurrences" ADD COLUMN "appeal_deadline_at" TIMESTAMPTZ;

ALTER TABLE "payments" ADD COLUMN "payment_method" TEXT;

CREATE INDEX "commitments_status_cancellation_requested_at_idx" ON "commitments"("status", "cancellation_requested_at");

CREATE TABLE "terms_documents" (
    "version" TEXT NOT NULL,
    "body_hash" TEXT NOT NULL,
    "body_json" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "terms_documents_pkey" PRIMARY KEY ("version")
);

CREATE TABLE "commitment_contracts" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "document_version" TEXT NOT NULL,
    "snapshot_json" JSONB NOT NULL,
    "snapshot_hash" TEXT NOT NULL,
    "accepted_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "commitment_contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "commitment_contracts_commitment_id_key" ON "commitment_contracts"("commitment_id");
CREATE INDEX "commitment_contracts_user_id_idx" ON "commitment_contracts"("user_id");

ALTER TABLE "commitment_contracts" ADD CONSTRAINT "commitment_contracts_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commitment_contracts" ADD CONSTRAINT "commitment_contracts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
