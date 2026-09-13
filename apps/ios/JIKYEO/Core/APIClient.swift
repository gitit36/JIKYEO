import Foundation

public struct APIError: Error, Equatable {
    public let code: String
    public let message: String
    public let httpStatus: Int
}

/// Minimal typed HTTP client. Uses async/await, injects `Authorization` header
/// from `AuthStore`, and parses backend error envelopes.
public final class APIClient {
    public struct Empty: Codable {}

    private struct ErrorEnvelope: Decodable {
        struct Body: Decodable { let code: String; let message: String }
        let error: Body
    }

    private let env: AppEnvironment
    private let session: URLSession
    private let auth: AuthStore
    private let decoder: JSONDecoder
    private let encoder: JSONEncoder

    public init(env: AppEnvironment, auth: AuthStore, session: URLSession = .shared) {
        self.env = env
        self.auth = auth
        self.session = session
        let d = JSONDecoder()
        // Server emits `toISOString()` (with fractional seconds). Foundation's
        // plain `.iso8601` strategy rejects fractions, so accept both.
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        d.dateDecodingStrategy = .custom { decoder in
            let raw = try decoder.singleValueContainer().decode(String.self)
            if let date = withFraction.date(from: raw) ?? plain.date(from: raw) { return date }
            throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad ISO8601 date: \(raw)"))
        }
        self.decoder = d
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        self.encoder = e
    }

    public func get<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(method: "GET", path: path, body: nil as APIClient.Empty?)
    }

    public func post<Body: Encodable, Response: Decodable>(_ path: String, body: Body) async throws -> Response {
        try await send(method: "POST", path: path, body: body)
    }

    public func post<Response: Decodable>(_ path: String) async throws -> Response {
        try await send(method: "POST", path: path, body: nil as APIClient.Empty?)
    }

    private func send<Body: Encodable, Response: Decodable>(
        method: String,
        path: String,
        body: Body?
    ) async throws -> Response {
        let url = env.apiBaseURL.appendingPathComponent(path)
        var req = URLRequest(url: url)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let token = await MainActor.run(body: { auth.currentAccessToken }) {
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body = body {
            req.httpBody = try encoder.encode(body)
        }

        let start = Date()
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch is URLError {
            throw APIError(code: "NETWORK", message: Copy.Errors.network, httpStatus: 0)
        }
        let elapsed = Date().timeIntervalSince(start)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(code: "TRANSPORT", message: Copy.Errors.network, httpStatus: -1)
        }
        if let dateHeader = http.value(forHTTPHeaderField: "Date"),
           let d = HTTPDateFormatter.shared.date(from: dateHeader) {
            AppClock.shared.syncWithServer(serverTime: d, roundTripSeconds: elapsed)
        }
        if http.statusCode == 401 {
            await MainActor.run { auth.signOut() }
        }
        if !(200..<300).contains(http.statusCode) {
            if let env = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(code: env.error.code, message: env.error.message, httpStatus: http.statusCode)
            }
            throw APIError(code: "HTTP_\(http.statusCode)", message: Copy.Errors.retry, httpStatus: http.statusCode)
        }
        if data.isEmpty, Response.self == APIClient.Empty.self {
            return APIClient.Empty() as! Response
        }
        return try decoder.decode(Response.self, from: data)
    }
}

enum UserFacingError {
    static func message(_ error: Error) -> String {
        if let url = error as? URLError {
            return url.code == .cancelled ? Copy.Errors.retry : Copy.Errors.network
        }
        guard let e = error as? APIError else { return Copy.Errors.retry }
        switch e.code {
        case "UNAUTHENTICATED": return Copy.Errors.session
        case "FORBIDDEN": return Copy.Errors.unavailable
        case "NOT_FOUND": return Copy.Errors.gone
        case "NETWORK", "TRANSPORT": return Copy.Errors.network
        case "METHOD_UNAVAILABLE": return Copy.Wizard.comingSoon
        case "MONEY_DISABLED": return Copy.Wizard.moneyGated
        case "AGE_UNVERIFIED": return Copy.Age.rejected
        case "GOAL_UNSAFE": return Copy.Wizard.unsafeTitle
        case "PROOF_ALREADY_SUBMITTED": return Copy.Errors.alreadyProof
        case "APPEAL_ALREADY_EXISTS": return Copy.Errors.alreadyAppeal
        case "GPS_TARGET_NOT_SELECTED": return Copy.Wizard.gpsPickPlaceholder
        case "FRIEND_NOT_SELECTED": return Copy.Friends.pickFriend
        default:
            if e.httpStatus == 401 { return Copy.Errors.session }
            if e.httpStatus == 403 { return Copy.Errors.unavailable }
            if e.httpStatus == 404 { return Copy.Errors.gone }
            if e.httpStatus <= 0 { return Copy.Errors.network }
            return Copy.Errors.retry
        }
    }
}

enum AnalyticsEvent: String {
    case onboarding_completed
    case commitment_created
    case commitment_activated
    case verification_submitted
    case verification_pass
    case verification_uncertain
    case verification_fail
    case appeal_opened
    case friend_added
    case shared_commitment_joined
    case friend_verify_requested
    case commitment_success
    case commitment_fail
    case money_review_started
    case money_demo_contract_created
}

enum Analytics {
    static func track(_ event: AnalyticsEvent, _ props: [String: String] = [:]) {
        _ = AnalyticsSanitizer.sanitize(props)
        #if DEBUG
        _ = event.rawValue
        #endif
    }
}

enum AnalyticsSanitizer {
    private static let banned = [
        "lat", "lng", "latitude", "longitude", "gps", "coord",
        "evidence", "photo", "storage", "appeal", "reason", "explanation",
        "payment", "token", "friendid", "frienduserid", "email", "note",
    ]

    static func sanitize(_ props: [String: String]) -> [String: String] {
        var out: [String: String] = [:]
        for (key, value) in props {
            let folded = key.lowercased()
            if banned.contains(where: { folded.contains($0) }) { continue }
            if value.contains("."), Double(value) != nil { continue }
            out[key] = String(value.prefix(32))
        }
        return out
    }
}

private enum HTTPDateFormatter {
    static let shared: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(secondsFromGMT: 0)
        f.dateFormat = "EEE, dd MMM yyyy HH:mm:ss zzz"
        return f
    }()
}
