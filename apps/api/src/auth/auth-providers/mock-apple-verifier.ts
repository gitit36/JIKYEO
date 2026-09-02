import { Injectable } from '@nestjs/common';
import { AuthProvider } from '@prisma/client';
import { DomainError } from '../../common/errors/domain-errors';
import { AuthTokenVerifier, VerifiedIdentity } from './auth-token-verifier';

/**
 * MVP mock. Accepts `mock:<subject>:<email>:<name>`.
 * Real Apple verification (JWKS + audience/issuer check) plugs into this
 * same interface.
 */
@Injectable()
export class MockAppleVerifier extends AuthTokenVerifier {
  readonly provider: AuthProvider = 'apple';

  async verify(idToken: string): Promise<VerifiedIdentity> {
    if (!idToken.startsWith('mock:')) {
      throw new DomainError('UNAUTHENTICATED', 'Invalid Apple token');
    }
    const [, subject, email, displayName] = idToken.split(':');
    if (!subject) throw new DomainError('UNAUTHENTICATED', 'Invalid Apple token');
    return {
      authProvider: 'apple',
      authSubject: subject,
      email: email ?? null,
      displayName: displayName ?? null,
    };
  }
}
