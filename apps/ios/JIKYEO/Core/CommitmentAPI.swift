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
    }

    public func listMine() async throws -> [MyCommitment] {
        try await api.get("commitments")
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
