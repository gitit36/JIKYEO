import { Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-errors';
import { AuthTokenVerifier, VerifiedIdentity } from './auth-token-verifier';

@Injectable()
export class MockGoogleVerifier extends AuthTokenVerifier {
  readonly provider: AuthProvider = 'google';

  async verify(idToken: string): Promise<VerifiedIdentity> {
    if (!idToken.startsWith('mock:')) {
      throw new DomainError('UNAUTHENTICATED', 'Invalid Google token');
    }
    const [, subject, email, displayName] = idToken.split(':');
    if (!subject) throw new DomainError('UNAUTHENTICATED', 'Invalid Google token');
    return {
      authProvider: 'google',
      authSubject: subject,
      email: email ?? null,
      displayName: displayName ?? null,
    };
  }
}
