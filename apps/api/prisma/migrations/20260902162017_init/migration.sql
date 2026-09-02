-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('apple', 'google', 'email');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'deleted');

-- CreateEnum
CREATE TYPE "CommitmentCategory" AS ENUM ('wakeup', 'workout', 'study', 'read', 'meditate', 'screen', 'custom');

-- CreateEnum
CREATE TYPE "CommitmentDirection" AS ENUM ('do', 'avoid');

-- CreateEnum
CREATE TYPE "ScheduleType" AS ENUM ('one_time', 'daily', 'specific_days', 'x_per_week', 'custom');

-- CreateEnum
CREATE TYPE "Strictness" AS ENUM ('normal', 'hard');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('draft', 'payment_pending', 'active', 'completed', 'cancelled');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('scheduled', 'active', 'evidence_submitted', 'reviewing', 'pass', 'uncertain', 'fail', 'void', 'system_hold');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('photo', 'gps', 'timer', 'self', 'friend', 'health', 'screen_time', 'timelapse');

-- CreateEnum
CREATE TYPE "FallbackType" AS ENUM ('appeal', 'manual', 'additional_evidence');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('photo', 'video', 'location', 'timer', 'self', 'friend');

-- CreateEnum
CREATE TYPE "VerifierType" AS ENUM ('rule', 'ai', 'friend', 'human');

-- CreateEnum
CREATE TYPE "VerificationOutcome" AS ENUM ('pass', 'uncertain', 'fail');

-- CreateEnum
CREATE TYPE "SettlementMode" AS ENUM ('end_of_commitment', 'per_occurrence');

-- CreateEnum
CREATE TYPE "StakeRecipientType" AS ENUM ('platform');

-- CreateEnum
CREATE TYPE "StakeStatus" AS ENUM ('pending', 'funded', 'settling', 'settled', 'refunded');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('charge', 'refund', 'cancel');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('requested', 'succeeded', 'failed', 'partial');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('deposit', 'refund_earned', 'refund_paid', 'forfeit', 'reversal');

-- CreateEnum
CREATE TYPE "SettlementResult" AS ENUM ('refundable', 'forfeited', 'void');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('pending', 'processed', 'failed');

-- CreateEnum
CREATE TYPE "AppealStatus" AS ENUM ('submitted', 'reviewing', 'approved', 'rejected');

-- CreateEnum
CREATE TYPE "ObserverRole" AS ENUM ('viewer', 'verifier');

-- CreateEnum
CREATE TYPE "FriendshipStatus" AS ENUM ('pending', 'accepted', 'blocked');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('before_24h', 'before_1h', 'before_10m', 'deadline', 'result', 'refund');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('pending', 'sent', 'cancelled', 'failed');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT,
    "auth_provider" "AuthProvider" NOT NULL,
    "auth_subject" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "birth_date" DATE,
    "locale" TEXT NOT NULL DEFAULT 'ko-KR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Seoul',
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "category" "CommitmentCategory" NOT NULL,
    "direction" "CommitmentDirection" NOT NULL DEFAULT 'do',
    "schedule_type" "ScheduleType" NOT NULL,
    "schedule_json" JSONB NOT NULL,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "timezone" TEXT NOT NULL,
    "strictness" "Strictness" NOT NULL DEFAULT 'normal',
    "extension_allowed" BOOLEAN NOT NULL DEFAULT false,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'draft',
    "max_loss_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "signed_at" TIMESTAMPTZ,
    "signature_completed" BOOLEAN NOT NULL DEFAULT false,
    "contract_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occurrences" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "sequence_no" INTEGER NOT NULL,
    "window_start_at" TIMESTAMPTZ NOT NULL,
    "deadline_at" TIMESTAMPTZ NOT NULL,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'scheduled',
    "stake_amount" BIGINT NOT NULL,
    "failure_reason_code" TEXT,
    "decided_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_rules" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "rule_json" JSONB NOT NULL,
    "ai_threshold" DECIMAL(4,3),
    "fallback_type" "FallbackType",
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "submitted_by_user_id" UUID NOT NULL,
    "evidence_type" "EvidenceType" NOT NULL,
    "storage_key" TEXT,
    "captured_at" TIMESTAMPTZ,
    "received_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "hash" TEXT,
    "retention_until" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_results" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "verifier_type" "VerifierType" NOT NULL,
    "result" "VerificationOutcome" NOT NULL,
    "confidence" DECIMAL(4,3),
    "reason_code" TEXT NOT NULL,
    "reason_text" TEXT NOT NULL,
    "model_version" TEXT,
    "reviewer_user_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stakes" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "per_occurrence_amount" BIGINT NOT NULL,
    "max_total_amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "settlement_mode" "SettlementMode" NOT NULL DEFAULT 'end_of_commitment',
    "recipient_type" "StakeRecipientType" NOT NULL DEFAULT 'platform',
    "status" "StakeStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stakes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "stake_id" UUID,
    "provider" TEXT NOT NULL,
    "provider_payment_key" TEXT,
    "type" "PaymentType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'KRW',
    "status" "PaymentStatus" NOT NULL DEFAULT 'requested',
    "failure_code" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_ledger" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "occurrence_id" UUID,
    "payment_id" UUID,
    "entry_type" "LedgerEntryType" NOT NULL,
    "amount" BIGINT NOT NULL,
    "balance_after" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settlements" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "result" "SettlementResult" NOT NULL,
    "amount" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'pending',
    "processed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appeals" (
    "id" UUID NOT NULL,
    "occurrence_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason_text" TEXT NOT NULL,
    "status" "AppealStatus" NOT NULL DEFAULT 'submitted',
    "reviewer_type" "VerifierType" NOT NULL DEFAULT 'human',
    "reviewer_id" UUID,
    "decision_reason" TEXT,
    "submitted_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ,

    CONSTRAINT "appeals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitment_observers" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "observer_user_id" UUID,
    "external_contact" TEXT,
    "role" "ObserverRole" NOT NULL DEFAULT 'viewer',
    "notify_on_success" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_fail" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_observers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "friendships" (
    "id" UUID NOT NULL,
    "requester_id" UUID NOT NULL,
    "addressee_id" UUID NOT NULL,
    "status" "FriendshipStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friendships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_schedules" (
    "id" UUID NOT NULL,
    "commitment_id" UUID NOT NULL,
    "occurrence_id" UUID,
    "type" "NotificationType" NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_json" JSONB,
    "after_json" JSONB,
    "ip" TEXT,
    "device_id" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_json" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "consumed_quotes" (
    "jti" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "commitment_id" UUID,
    "consumed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumed_quotes_pkey" PRIMARY KEY ("jti")
);

-- CreateTable
CREATE TABLE "event_outbox" (
    "id" UUID NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "published_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_auth_provider_auth_subject_key" ON "users"("auth_provider", "auth_subject");

-- CreateIndex
CREATE INDEX "commitments_user_id_status_idx" ON "commitments"("user_id", "status");

-- CreateIndex
CREATE INDEX "occurrences_status_deadline_at_idx" ON "occurrences"("status", "deadline_at");

-- CreateIndex
CREATE UNIQUE INDEX "occurrences_commitment_id_sequence_no_key" ON "occurrences"("commitment_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "verification_rules_commitment_id_key" ON "verification_rules"("commitment_id");

-- CreateIndex
CREATE INDEX "evidence_occurrence_id_idx" ON "evidence"("occurrence_id");

-- CreateIndex
CREATE INDEX "evidence_hash_idx" ON "evidence"("hash");

-- CreateIndex
CREATE INDEX "verification_results_occurrence_id_idx" ON "verification_results"("occurrence_id");

-- CreateIndex
CREATE UNIQUE INDEX "stakes_commitment_id_key" ON "stakes"("commitment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- CreateIndex
CREATE INDEX "payments_user_id_type_status_idx" ON "payments"("user_id", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_ledger_idempotency_key_key" ON "payment_ledger"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_ledger_commitment_id_entry_type_idx" ON "payment_ledger"("commitment_id", "entry_type");

-- CreateIndex
CREATE INDEX "payment_ledger_occurrence_id_idx" ON "payment_ledger"("occurrence_id");

-- CreateIndex
CREATE INDEX "settlements_occurrence_id_status_idx" ON "settlements"("occurrence_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "appeals_occurrence_id_key" ON "appeals"("occurrence_id");

-- CreateIndex
CREATE UNIQUE INDEX "friendships_requester_id_addressee_id_key" ON "friendships"("requester_id", "addressee_id");

-- CreateIndex
CREATE INDEX "notification_schedules_status_scheduled_at_idx" ON "notification_schedules"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "idempotency_keys_scope_expires_at_idx" ON "idempotency_keys"("scope", "expires_at");

-- CreateIndex
CREATE INDEX "consumed_quotes_user_id_consumed_at_idx" ON "consumed_quotes"("user_id", "consumed_at");

-- CreateIndex
CREATE INDEX "event_outbox_published_at_created_at_idx" ON "event_outbox"("published_at", "created_at");

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "occurrences" ADD CONSTRAINT "occurrences_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_rules" ADD CONSTRAINT "verification_rules_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_submitted_by_user_id_fkey" FOREIGN KEY ("submitted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_results" ADD CONSTRAINT "verification_results_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stakes" ADD CONSTRAINT "stakes_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_stake_id_fkey" FOREIGN KEY ("stake_id") REFERENCES "stakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger" ADD CONSTRAINT "payment_ledger_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_ledger" ADD CONSTRAINT "payment_ledger_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "settlements" ADD CONSTRAINT "settlements_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appeals" ADD CONSTRAINT "appeals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_observers" ADD CONSTRAINT "commitment_observers_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitment_observers" ADD CONSTRAINT "commitment_observers_observer_user_id_fkey" FOREIGN KEY ("observer_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_addressee_id_fkey" FOREIGN KEY ("addressee_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_occurrence_id_fkey" FOREIGN KEY ("occurrence_id") REFERENCES "occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_fk" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
