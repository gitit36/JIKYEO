import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { DomainError, DomainErrorCode } from './domain-errors';

const CODE_TO_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  VALIDATION: HttpStatus.BAD_REQUEST,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  IDEMPOTENCY_MISMATCH: HttpStatus.CONFLICT,
  LOCK_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PAYMENT_FAILED: HttpStatus.PAYMENT_REQUIRED,
  PAYMENT_PROVIDER_ERROR: HttpStatus.BAD_GATEWAY,
  PAYMENT_NOT_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  PAYMENT_ALREADY_COMPLETED: HttpStatus.CONFLICT,
  WEBHOOK_INVALID: HttpStatus.BAD_REQUEST,
  SETTLEMENT_NOT_READY: HttpStatus.CONFLICT,
  QUOTE_EXPIRED: HttpStatus.GONE,
  STAKE_LIMIT_EXCEEDED: HttpStatus.BAD_REQUEST,
  STAKE_TIER_LIMIT_EXCEEDED: HttpStatus.UNPROCESSABLE_ENTITY,
  GOAL_UNSAFE: HttpStatus.UNPROCESSABLE_ENTITY,
  MINOR_STAKE_DISALLOWED: HttpStatus.UNPROCESSABLE_ENTITY,
  MONEY_DISABLED: HttpStatus.UNPROCESSABLE_ENTITY,
  AGE_UNVERIFIED: HttpStatus.UNPROCESSABLE_ENTITY,
  TERMS_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  TERMS_MISMATCH: HttpStatus.CONFLICT,
  GPS_TARGET_NOT_SELECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  FRIEND_NOT_SELECTED: HttpStatus.UNPROCESSABLE_ENTITY,
  QUOTE_ALREADY_CONSUMED: HttpStatus.CONFLICT,
  QUOTE_NOT_ALLOWED_FOR_MODE: HttpStatus.UNPROCESSABLE_ENTITY,
  QUOTE_REQUIRED_FOR_MODE: HttpStatus.UNPROCESSABLE_ENTITY,
  ENFORCEMENT_MODE_UNSUPPORTED: HttpStatus.UNPROCESSABLE_ENTITY,
  METHOD_UNAVAILABLE: HttpStatus.UNPROCESSABLE_ENTITY,
  PROOF_ALREADY_SUBMITTED: HttpStatus.CONFLICT,
  OCCURRENCE_NOT_ACTIVE: HttpStatus.CONFLICT,
  OCCURRENCE_PAST_DEADLINE: HttpStatus.GONE,
  TIMER_SESSION_INVALID: HttpStatus.CONFLICT,
  SYSTEM_HOLD: HttpStatus.SERVICE_UNAVAILABLE,
  APPEAL_NOT_ELIGIBLE: HttpStatus.UNPROCESSABLE_ENTITY,
  APPEAL_WINDOW_CLOSED: HttpStatus.GONE,
  APPEAL_ALREADY_EXISTS: HttpStatus.CONFLICT,
  APPEAL_ALREADY_DECIDED: HttpStatus.CONFLICT,
  INTERNAL: HttpStatus.INTERNAL_SERVER_ERROR,
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception instanceof DomainError) {
      const status = CODE_TO_STATUS[exception.code] ?? HttpStatus.BAD_REQUEST;
      res.status(status).json({
        error: {
          code: exception.code,
          message: exception.message,
          details: exception.details ?? null,
        },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const resp = exception.getResponse();
      res.status(status).json({
        error: {
          code: 'HTTP_' + status,
          message: typeof resp === 'string' ? resp : (resp as { message?: string }).message ?? 'Error',
          details: typeof resp === 'object' ? resp : null,
        },
      });
      return;
    }

    const err = exception as Error;
    this.logger.error(err?.message ?? 'Unknown error', err?.stack);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      error: {
        code: 'INTERNAL',
        message: 'Internal server error',
        details: null,
      },
    });
  }
}
