import { AuthProvider } from '@prisma/client';

/**
 * External token verifier abstraction.
 * MVP ships with `MockAppleVerifier` / `MockGoogleVerifier` that accept any
 * signed test token. Real Apple/Google verification wires the same interface.
 */
export interface VerifiedIdentity {
  authProvider: AuthProvider;
  authSubject: string;
  email?: string | null;
  displayName?: string | null;
}

export abstract class AuthTokenVerifier {
  abstract readonly provider: AuthProvider;
  abstract verify(idToken: string): Promise<VerifiedIdentity>;
}
