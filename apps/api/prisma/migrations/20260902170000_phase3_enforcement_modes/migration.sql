-- CreateEnum
CREATE TYPE "EnforcementMode" AS ENUM ('self', 'social', 'money');

-- CreateEnum
CREATE TYPE "StakeTier" AS ENUM ('tier_1', 'tier_2', 'tier_3');

-- CreateEnum
CREATE TYPE "FocusTimerStatus" AS ENUM ('active', 'finished', 'aborted', 'expired');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "VerifierType" ADD VALUE 'self';
ALTER TYPE "VerifierType" ADD VALUE 'timer';
ALTER TYPE "VerifierType" ADD VALUE 'gps';
ALTER TYPE "VerifierType" ADD VALUE 'photo';

-- AlterTable
ALTER TABLE "commitments" ADD COLUMN     "enforcement_mode" "EnforcementMode" NOT NULL DEFAULT 'self',
ALTER COLUMN "max_loss_amount" DROP NOT NULL,
ALTER COLUMN "currency" DROP NOT NULL,
ALTER COLUMN "currency" DROP DEFAULT;

-- AlterTable
ALTER TABLE "occurrences" ALTER COLUMN "stake_amount" DROP NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "stake_tier" "StakeTier" NOT NULL DEFAULT 'tier_1';

-- AlterTable
ALTER TABLE "verification_results" ADD COLUMN     "evidence_id" UUID,
ADD COLUMN     "user_message" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "focus_timer_sessions" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "planned_duration_seconds" INTEGER NOT NULL,
    "server_started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat_at" TIMESTAMPTZ,
    "heartbeat_count" INTEGER NOT NULL DEFAULT 0,
    "max_gap_seconds" INTEGER NOT NULL DEFAULT 0,
    "background_transitions" INTEGER NOT NULL DEFAULT 0,
    "status" "FocusTimerStatus" NOT NULL DEFAULT 'active',
    "finished_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "focus_timer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "focus_timer_sessions_occurrence_id_status_idx" ON "focus_timer_sessions"("occurrence_id", "status");

-- AddForeignKey
ALTER TABLE "focus_timer_sessions" ADD CONSTRAINT "focus_timer_sessions_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "focus_timer_sessions" ADD CONSTRAINT "focus_timer_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

