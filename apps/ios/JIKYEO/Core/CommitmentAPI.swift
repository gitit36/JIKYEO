import Foundation

public struct CommitmentAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func quote(_ req: QuoteRequest) async throws -> QuoteResponse {
        try await api.post("commitments/quote", body: req)
    }

    public func create(_ req: CreateCommitmentRequest) async throws -> CreateCommitmentResponse {
        try await api.post("commitments", body: req)
    }

    public struct MyCommitment: Decodable, Identifiable {
        public let id: String
        public let title: String
        public let category: String
        public let status: String
        public let enforcementMode: EnforcementMode
        public let timezone: String
        /// `null` for SELF/SOCIAL.
        public let maxLossKrw: String?
        public let verificationMethod: String?
        /// `null` for SELF/SOCIAL.
        public let perOccurrenceKrw: String?
        public let occurrenceCount: Int
        /// MONEY-only derived money state (결제 중 / 약속금 걸림 / 환불 예정 …). `nil` otherwise.
        public let money: MoneyView?
        public let signatureExpiresAt: Date?
        public let cancellationReason: String?
        public let appeals: [AppealSummary]?
    }

    public struct OccurrenceDetail: Decodable, Identifiable {
        public let id: String
        public let sequenceNo: Int
        public let status: String
        public let stakeKrw: String?
        public let originalResult: String?
        public let effectiveResult: String?
        public let appeal: AppealSummary?
    }

    public struct CommitmentDetail: Decodable, Identifiable {
        public let id: String
        public let title: String
        public let status: String
        public let enforcementMode: EnforcementMode
        public let money: MoneyView?
        public let appeals: [AppealSummary]?
        public let occurrences: [OccurrenceDetail]
    }

    public func listMine() async throws -> [MyCommitment] {
        try await api.get("commitments")
    }

    public func getOne(id: String) async throws -> CommitmentDetail {
        try await api.get("commitments/\(id)")
    }

    /// Signature ritual for a MONEY commitment after payment. Idempotent.
    public func sign(commitmentId: String) async throws -> SignCommitmentResponse {
        try await api.post("commitments/\(commitmentId)/sign")
    }

    public func cancel(commitmentId: String, simulateRefundFail: Bool = false) async throws -> CancelCommitmentResponse {
        try await api.post(
            "commitments/\(commitmentId)/cancel",
            body: simulateRefundFail ? PayCommitmentRequest(simulate: "refund_fail") : PayCommitmentRequest(simulate: nil)
        )
    }
}

/// MONEY-only payment lifecycle (`POST /commitments/:id/pay`, `GET /commitments/:id/money`,
/// `POST /commitments/:id/settle`). Backed by the server's configured PaymentProvider
/// (MockPaymentProvider in dev). Never called for SELF/SOCIAL commitments.
public struct PaymentAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func pay(commitmentId: String, simulateFailure: Bool = false) async throws -> PayCommitmentResponse {
        try await api.post(
            "commitments/\(commitmentId)/pay",
            body: PayCommitmentRequest(simulate: simulateFailure ? "charge_fail" : nil)
        )
    }

    public func moneyStatus(commitmentId: String) async throws -> MoneyStatusResponse {
        try await api.get("commitments/\(commitmentId)/money")
    }

    /// Owner-triggered settlement pass / refund retry. Idempotent.
    public func settle(commitmentId: String) async throws -> APIClient.Empty {
        try await api.post("commitments/\(commitmentId)/settle")
    }
}

public struct OccurrenceAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func today(timezone: String) async throws -> TodayResponse {
        try await api.get("occurrences/today?timezone=\(timezone)")
    }
}

public struct SafetyAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public struct SafetyRequest: Encodable {
        public let title: String
        public let description: String?
    }

    public func check(title: String, description: String? = nil) async throws -> SafetyResponse {
        try await api.post("safety/check", body: SafetyRequest(title: title, description: description))
    }
}

/// Server-authoritative stake policy (`GET /stake-policy`).
/// The client MUST NOT invent limits — every money screen should read
/// max/suggested amounts from this response.
public struct StakePolicyAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }
    public func current() async throws -> StakePolicyResponse {
        try await api.get("stake-policy")
    }
}

/// Evidence submission (`POST /occurrences/:id/evidence`) and the mode-aware
/// result GET. Photo/GPS/Self all route through `submit`. Timer uses `TimerAPI`.
public struct EvidenceAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func uploadTicket(occurrenceId: String, contentType: String) async throws -> UploadTicketResponse {
        try await api.get("occurrences/\(occurrenceId)/evidence/upload-url?contentType=\(contentType)")
    }

    public func submit(occurrenceId: String, _ req: SubmitEvidenceRequest) async throws -> VerificationResultResponse {
        try await api.post("occurrences/\(occurrenceId)/evidence", body: req)
    }

    public func result(occurrenceId: String) async throws -> OccurrenceResultResponse {
        try await api.get("occurrences/\(occurrenceId)/result")
    }

    public func list(occurrenceId: String) async throws -> [EvidenceItem] {
        try await api.get("occurrences/\(occurrenceId)/evidence")
    }
}

/// Focus Timer (`POST /occurrences/:id/timer/start`, heartbeat, finish).
/// The server issues the session ID; the client must forward it back verbatim.
public struct TimerAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func start(occurrenceId: String) async throws -> TimerStartResponse {
        try await api.post("occurrences/\(occurrenceId)/timer/start")
    }

    public struct HeartbeatBody: Encodable {
        public let backgroundEvents: Int?
    }

    public func heartbeat(sessionId: String, backgroundEvents: Int? = nil) async throws -> TimerHeartbeatResponse {
        try await api.post("timer/sessions/\(sessionId)/heartbeat", body: HeartbeatBody(backgroundEvents: backgroundEvents))
    }

    public struct FinishBody: Encodable {
        public let terminated: Bool?
    }

    public func finish(sessionId: String, terminated: Bool = false) async throws -> VerificationResultResponse {
        try await api.post("timer/sessions/\(sessionId)/finish", body: FinishBody(terminated: terminated))
    }
}

public struct AppealAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func submit(occurrenceId: String, category: AppealReasonCategory, explanation: String) async throws -> AppealView {
        try await api.post(
            "occurrences/\(occurrenceId)/appeals",
            body: SubmitAppealRequest(reasonCategory: category, explanation: explanation)
        )
    }

    public func status(occurrenceId: String) async throws -> AppealView {
        try await api.get("occurrences/\(occurrenceId)/appeal")
    }
}
