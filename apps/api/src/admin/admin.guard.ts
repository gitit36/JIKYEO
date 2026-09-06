import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain-errors';
import { AppConfig } from '../config/app-config';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly cfg: AppConfig) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const raw = req.headers['x-admin-secret'];
    const secret = Array.isArray(raw) ? raw[0] : raw;
    if (!secret || secret !== this.cfg.adminApiSecret) {
      throw new DomainError('FORBIDDEN', 'Admin access denied');
    }
    return true;
  }
}
