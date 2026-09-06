-- Phase 5.1: friends, SOCIAL partner, shared commitments. No group money.

ALTER TYPE "FriendshipStatus" ADD VALUE IF NOT EXISTS 'declined';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_request';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_accepted';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'shared_invite';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'shared_accepted';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'accountability_partner';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'shared_progress';

CREATE TYPE "SharedCommitmentStatus" AS ENUM ('open', 'locked', 'completed');
CREATE TYPE "SharedParticipantStatus" AS ENUM ('invited', 'accepted', 'declined', 'left');

ALTER TABLE "users" ADD COLUMN "invite_code" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "users_invite_code_key" ON "users"("invite_code");

ALTER TABLE "friendships" ADD COLUMN IF NOT EXISTS "pair_key" TEXT;
ALTER TABLE "friendships" ADD COLUMN IF NOT EXISTS "blocked_by_id" UUID;
ALTER TABLE "friendships" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMPTZ NOT NULL DEFAULT NOW();

UPDATE "friendships"
SET "pair_key" = CASE
  WHEN "requester_id" < "addressee_id" THEN "requester_id" || ':' || "addressee_id"
  ELSE "addressee_id" || ':' || "requester_id"
END
WHERE "pair_key" IS NULL;

ALTER TABLE "friendships" ALTER COLUMN "pair_key" SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "friendships_pair_key_key" ON "friendships"("pair_key");
CREATE INDEX IF NOT EXISTS "friendships_addressee_id_status_idx" ON "friendships"("addressee_id", "status");
CREATE INDEX IF NOT EXISTS "friendships_requester_id_status_idx" ON "friendships"("requester_id", "status");

ALTER TABLE "friendships" ADD CONSTRAINT "friendships_blocked_by_id_fkey"
  FOREIGN KEY ("blocked_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "notification_preferences" ADD COLUMN "social" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "shared_commitments" (
    "id" UUID NOT NULL,
    "creator_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "CommitmentCategory" NOT NULL,
    "schedule_type" "ScheduleType" NOT NULL,
    "schedule_json" JSONB NOT NULL,
    "timezone" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "status" "SharedCommitmentStatus" NOT NULL DEFAULT 'open',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shared_commitments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "shared_participants" (
    "id" UUID NOT NULL,
    "shared_commitment_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "SharedParticipantStatus" NOT NULL DEFAULT 'invited',
    "commitment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "shared_participants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shared_participants_shared_commitment_id_user_id_key" ON "shared_participants"("shared_commitment_id", "user_id");
CREATE UNIQUE INDEX "shared_participants_commitment_id_key" ON "shared_participants"("commitment_id");
CREATE INDEX "shared_commitments_creator_id_status_idx" ON "shared_commitments"("creator_id", "status");

ALTER TABLE "shared_commitments" ADD CONSTRAINT "shared_commitments_creator_id_fkey"
  FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shared_participants" ADD CONSTRAINT "shared_participants_shared_commitment_id_fkey"
  FOREIGN KEY ("shared_commitment_id") REFERENCES "shared_commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "shared_participants" ADD CONSTRAINT "shared_participants_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "commitments" ADD COLUMN "shared_commitment_id" UUID;
CREATE INDEX "commitments_shared_commitment_id_idx" ON "commitments"("shared_commitment_id");
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_shared_commitment_id_fkey"
  FOREIGN KEY ("shared_commitment_id") REFERENCES "shared_commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
