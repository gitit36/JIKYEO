import { Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { UsersService } from '../users/users.service';
import { MockAppleVerifier } from './auth-providers/mock-apple-verifier';
import { MockGoogleVerifier } from './auth-providers/mock-google-verifier';
import { AppJwtService } from './jwt.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: AppJwtService,
    private readonly apple: MockAppleVerifier,
    private readonly google: MockGoogleVerifier,
  ) {}

  async signInApple(idToken: string): Promise<SessionTokens> {
    return this.signInWithVerifier('apple', idToken);
  }

  async signInGoogle(idToken: string): Promise<SessionTokens> {
    return this.signInWithVerifier('google', idToken);
  }

  /** MVP-only email path: dev shortcut, real OTP flow is deferred. */
  async signInEmailDev(email: string, displayName: string): Promise<SessionTokens> {
    const user = await this.users.upsertFromAuth({
      authProvider: 'email',
      authSubject: email,
      email,
      displayName,
    });
    const tokens = await this.jwt.issue(user.id);
    return { ...tokens, userId: user.id };
  }

  private async signInWithVerifier(provider: AuthProvider, idToken: string): Promise<SessionTokens> {
    const verifier = provider === 'apple' ? this.apple : this.google;
    const identity = await verifier.verify(idToken);
    const user = await this.users.upsertFromAuth({
      authProvider: identity.authProvider,
      authSubject: identity.authSubject,
      email: identity.email ?? null,
      displayName: identity.displayName ?? '지켜 사용자',
    });
    const tokens = await this.jwt.issue(user.id);
    return { ...tokens, userId: user.id };
  }
}
