-- Phase 5F: MONEY V1 contract-level stake, grace, binary cancel.

CREATE TYPE "ContractStrictness" AS ENUM ('perfect', 'realistic', 'flexible');
CREATE TYPE "ContractOutcome" AS ENUM ('pending', 'success', 'failed', 'voided');

ALTER TYPE "CancellationReason" ADD VALUE IF NOT EXISTS 'system_cancelled';
ALTER TYPE "SettlementMode" ADD VALUE IF NOT EXISTS 'contract_v1';

ALTER TABLE "commitments" ADD COLUMN "contract_strictness" "ContractStrictness";
ALTER TABLE "commitments" ADD COLUMN "allowed_fail_count" INTEGER;
ALTER TABLE "commitments" ADD COLUMN "contract_outcome" "ContractOutcome" NOT NULL DEFAULT 'pending';

ALTER TABLE "occurrences" ADD COLUMN "period_key" TEXT;
