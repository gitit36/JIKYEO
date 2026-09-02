import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { DomainError } from '../common/errors/domain-errors';
import { AppJwtService } from './jwt.service';

export interface AuthedRequest extends Request {
  userId: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: AppJwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const raw = req.headers.authorization;
    if (!raw?.startsWith('Bearer ')) {
      throw new DomainError('UNAUTHENTICATED', 'Missing Bearer token');
    }
    const claims = await this.jwt.verifyAccess(raw.slice('Bearer '.length));
    req.userId = claims.sub;
    return true;
  }
}
