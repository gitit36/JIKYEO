import Foundation

/// Simple composition root. Owned by `JIKYEOApp` and injected via `.environmentObject`.
@MainActor
public final class AppContainer: ObservableObject {
    public let environment: AppEnvironment
    public let auth: AuthStore
    public let api: APIClient
    public let authAPI: AuthAPI
    public let commitmentAPI: CommitmentAPI
    public let occurrenceAPI: OccurrenceAPI
    public let safetyAPI: SafetyAPI
    public let stakePolicyAPI: StakePolicyAPI
    public let evidenceAPI: EvidenceAPI
    public let paymentAPI: PaymentAPI
    public let timerAPI: TimerAPI
    public let appealAPI: AppealAPI
    public let notificationAPI: NotificationAPI
    public let recapAPI: RecapAPI
    public let friendsAPI: FriendsAPI
    @Published var pendingLink: DeepLink?

    public init(environment: AppEnvironment = .live) {
        self.environment = environment
        let auth = AuthStore()
        self.auth = auth
        let api = APIClient(env: environment, auth: auth)
        self.api = api
        self.authAPI = AuthAPI(api: api)
        self.commitmentAPI = CommitmentAPI(api: api)
        self.occurrenceAPI = OccurrenceAPI(api: api)
        self.safetyAPI = SafetyAPI(api: api)
        self.stakePolicyAPI = StakePolicyAPI(api: api)
        self.evidenceAPI = EvidenceAPI(api: api)
        self.paymentAPI = PaymentAPI(api: api)
        self.timerAPI = TimerAPI(api: api)
        self.appealAPI = AppealAPI(api: api)
        self.notificationAPI = NotificationAPI(api: api)
        self.recapAPI = RecapAPI(api: api)
        self.friendsAPI = FriendsAPI(api: api)
    }

    func open(_ url: URL) {
        if let link = DeepLink.parse(url) {
            pendingLink = link
        }
    }
}
