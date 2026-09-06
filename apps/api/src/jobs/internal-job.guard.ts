import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';

@Injectable()
export class InternalJobGuard implements CanActivate {
  constructor(private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const raw = req.headers['x-internal-job-secret'];
    const secret = Array.isArray(raw) ? raw[0] : raw;
    if (!secret || secret !== this.cfg.internalJobSecret) {
      throw new DomainError('FORBIDDEN', 'Job access denied');
    }
    return true;
  }
}
