-- MONEY activation is now:
--   payment_pending → (charge success) signature_pending → (sign) active
-- Payment success alone must not activate the commitment.
ALTER TYPE "CommitmentStatus" ADD VALUE 'signature_pending';
