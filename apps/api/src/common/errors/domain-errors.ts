/**
 * Domain errors. Each has a stable machine code that the iOS client can act on.
 * HTTP mapping is done by AllExceptionsFilter.
 */

export type DomainErrorCode =
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'UNAUTHENTICATED'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_MISMATCH'
  | 'LOCK_UNAVAILABLE'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_PROVIDER_ERROR'
  | 'QUOTE_EXPIRED'
  | 'STAKE_LIMIT_EXCEEDED'
  | 'STAKE_TIER_LIMIT_EXCEEDED'
  | 'GOAL_UNSAFE'
  | 'MINOR_STAKE_DISALLOWED'
  | 'GPS_TARGET_NOT_SELECTED'
  | 'FRIEND_NOT_SELECTED'
  | 'QUOTE_ALREADY_CONSUMED'
  | 'QUOTE_NOT_ALLOWED_FOR_MODE'
  | 'QUOTE_REQUIRED_FOR_MODE'
  | 'ENFORCEMENT_MODE_UNSUPPORTED'
  | 'PROOF_ALREADY_SUBMITTED'
  | 'OCCURRENCE_NOT_ACTIVE'
  | 'OCCURRENCE_PAST_DEADLINE'
  | 'TIMER_SESSION_INVALID'
  | 'SYSTEM_HOLD'
  | 'INTERNAL';

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(message = 'Not found') {
    super('NOT_FOUND', message);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super('FORBIDDEN', message);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('VALIDATION', message, details);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, details);
  }
}

export class InvalidStateTransitionError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super(
      'INVALID_STATE_TRANSITION',
      `Cannot transition ${entity} from ${from} to ${to}`,
      { entity, from, to },
    );
  }
}
