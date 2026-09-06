-- Phase 5C: device tokens, outbox, weekly recap, evidence deletion.

CREATE TYPE "EvidenceStatus" AS ENUM ('active', 'deleted');
CREATE TYPE "PushEnvironment" AS ENUM ('sandbox', 'production');
CREATE TYPE "NotificationCategory" AS ENUM ('deadline_reminder', 'signature_expiry', 'refund', 'appeal', 'weekly_recap');
CREATE TYPE "NotificationOutboxStatus" AS ENUM ('pending', 'sent', 'failed');

ALTER TABLE "evidence" ADD COLUMN "status" "EvidenceStatus" NOT NULL DEFAULT 'active';
ALTER TABLE "evidence" ADD COLUMN "deleted_at" TIMESTAMPTZ;
CREATE INDEX "evidence_status_retention_until_idx" ON "evidence"("status", "retention_until");

CREATE TABLE "device_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "environment" "PushEnvironment" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "device_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "device_tokens_token_hash_key" ON "device_tokens"("token_hash");
CREATE INDEX "device_tokens_user_id_active_idx" ON "device_tokens"("user_id", "active");
ALTER TABLE "device_tokens" ADD CONSTRAINT "device_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "deadline_reminder" BOOLEAN NOT NULL DEFAULT true,
    "signature_expiry" BOOLEAN NOT NULL DEFAULT true,
    "refund" BOOLEAN NOT NULL DEFAULT true,
    "appeal" BOOLEAN NOT NULL DEFAULT true,
    "weekly_recap" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id")
);
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "deep_link" TEXT NOT NULL,
    "status" "NotificationOutboxStatus" NOT NULL DEFAULT 'pending',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMPTZ,
    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "notification_outbox_dedupe_key_key" ON "notification_outbox"("dedupe_key");
CREATE INDEX "notification_outbox_status_next_attempt_at_idx" ON "notification_outbox"("status", "next_attempt_at");
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "weekly_recaps" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "local_week_start" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "due" INTEGER NOT NULL,
    "pass_count" INTEGER NOT NULL,
    "fail_count" INTEGER NOT NULL,
    "void_count" INTEGER NOT NULL,
    "unresolved_count" INTEGER NOT NULL,
    "completion_rate" DECIMAL(5,4),
    "has_money_section" BOOLEAN NOT NULL,
    "kept_krw" BIGINT,
    "net_forfeited_krw" BIGINT,
    "refund_pending_or_delayed_krw" BIGINT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "weekly_recaps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "weekly_recaps_user_id_local_week_start_key" ON "weekly_recaps"("user_id", "local_week_start");
ALTER TABLE "weekly_recaps" ADD CONSTRAINT "weekly_recaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
