import Foundation

/// Typed calls for `POST /v1/auth/*`. Full Apple/Google verification will be
/// wired via `ASAuthorizationController` later; for now the mock endpoints
/// accept `mock:<subject>:<email>:<name>` tokens.
public struct AuthAPI {
    private let api: APIClient

    public init(api: APIClient) { self.api = api }

    private struct AppleBody: Encodable { let idToken: String }
    private struct GoogleBody: Encodable { let idToken: String }
    private struct EmailDevBody: Encodable { let email: String; let displayName: String }

    public struct SessionResponse: Decodable {
        public let userId: String
        public let accessToken: String
        public let refreshToken: String
        public let expiresIn: Int
    }

    public func signInApple(idToken: String) async throws -> SessionResponse {
        try await api.post("auth/apple", body: AppleBody(idToken: idToken))
    }

    public func signInGoogle(idToken: String) async throws -> SessionResponse {
        try await api.post("auth/google", body: GoogleBody(idToken: idToken))
    }

    public func signInEmailDev(email: String, displayName: String) async throws -> SessionResponse {
        try await api.post("auth/email/dev", body: EmailDevBody(email: email, displayName: displayName))
    }
}
