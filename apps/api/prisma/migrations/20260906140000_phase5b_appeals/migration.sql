-- Phase 5B: MONEY appeal reason category + original/corrected results.
-- Existing Appeal rows are none in production yet; columns are required with defaults
-- only so a stray row cannot block migrate.

ALTER TABLE "appeals" ADD COLUMN "reason_category" TEXT NOT NULL DEFAULT 'other';
ALTER TABLE "appeals" ADD COLUMN "original_result" TEXT NOT NULL DEFAULT 'fail';
ALTER TABLE "appeals" ADD COLUMN "corrected_result" TEXT;

ALTER TABLE "appeals" ALTER COLUMN "reason_category" DROP DEFAULT;
ALTER TABLE "appeals" ALTER COLUMN "original_result" DROP DEFAULT;

CREATE INDEX "appeals_status_submitted_at_idx" ON "appeals"("status", "submitted_at");
