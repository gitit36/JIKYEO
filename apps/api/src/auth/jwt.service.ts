import { Injectable } from '@nestjs/common';
import { JwtService as NestJwtService } from '@nestjs/jwt';
import { AppConfig } from '../config/app-config';
import { DomainError } from '../common/errors/domain-errors';

export interface JwtClaims {
  sub: string; // user id
  type: 'access' | 'refresh';
  iat?: number;
  exp?: number;
}

@Injectable()
export class AppJwtService {
  constructor(
    private readonly jwt: NestJwtService,
    private readonly cfg: AppConfig,
  ) {}

  async issue(userId: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const accessToken = await this.jwt.signAsync(
      { sub: userId, type: 'access' } satisfies JwtClaims,
      { secret: this.cfg.jwtSecret, expiresIn: this.cfg.jwtAccessTtlSeconds },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, type: 'refresh' } satisfies JwtClaims,
      { secret: this.cfg.jwtSecret, expiresIn: this.cfg.jwtRefreshTtlSeconds },
    );
    return { accessToken, refreshToken, expiresIn: this.cfg.jwtAccessTtlSeconds };
  }

  async verifyAccess(token: string): Promise<JwtClaims> {
    try {
      const claims = await this.jwt.verifyAsync<JwtClaims>(token, { secret: this.cfg.jwtSecret });
      if (claims.type !== 'access') throw new Error('wrong token type');
      return claims;
    } catch {
      throw new DomainError('UNAUTHENTICATED', 'Invalid or expired access token');
    }
  }
}
