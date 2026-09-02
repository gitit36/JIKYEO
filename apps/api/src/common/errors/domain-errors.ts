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
  | 'GOAL_UNSAFE'
  | 'MINOR_STAKE_DISALLOWED'
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
