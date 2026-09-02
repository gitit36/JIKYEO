import Foundation

/// Simple composition root. Owned by `JIKYEOApp` and injected via `.environmentObject`.
@MainActor
public final class AppContainer: ObservableObject {
    public let environment: AppEnvironment
    public let auth: AuthStore
    public let api: APIClient
    public let authAPI: AuthAPI

    public init(environment: AppEnvironment = .live) {
        self.environment = environment
        let auth = AuthStore()
        self.auth = auth
        let api = APIClient(env: environment, auth: auth)
        self.api = api
        self.authAPI = AuthAPI(api: api)
    }
}
