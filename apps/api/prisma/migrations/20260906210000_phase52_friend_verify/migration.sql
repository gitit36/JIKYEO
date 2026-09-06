-- Phase 5.2: Friend Verify request lifecycle. No money ownership.

ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_verify_request';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_verify_approved';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_verify_rejected';
ALTER TYPE "NotificationCategory" ADD VALUE IF NOT EXISTS 'friend_verify_expired';

CREATE TYPE "FriendVerifyStatus" AS ENUM ('pending', 'approved', 'rejected', 'expired');

CREATE TABLE "friend_verify_requests" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "owner_user_id" UUID NOT NULL,
    "verifier_user_id" UUID NOT NULL,
    "status" "FriendVerifyStatus" NOT NULL DEFAULT 'pending',
    "requested_at" TIMESTAMPTZ NOT NULL,
    "review_deadline_at" TIMESTAMPTZ NOT NULL,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "friend_verify_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "friend_verify_requests_occurrence_id_key" ON "friend_verify_requests"("occurrence_id");
CREATE INDEX "friend_verify_requests_verifier_user_id_status_idx" ON "friend_verify_requests"("verifier_user_id", "status");
CREATE INDEX "friend_verify_requests_status_review_deadline_at_idx" ON "friend_verify_requests"("status", "review_deadline_at");

ALTER TABLE "friend_verify_requests" ADD CONSTRAINT "friend_verify_requests_occurrence_id_fkey"
  FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "friend_verify_requests" ADD CONSTRAINT "friend_verify_requests_owner_user_id_fkey"
  FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "friend_verify_requests" ADD CONSTRAINT "friend_verify_requests_verifier_user_id_fkey"
  FOREIGN KEY ("verifier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
