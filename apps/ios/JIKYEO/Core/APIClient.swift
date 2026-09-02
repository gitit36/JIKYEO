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
        let (data, response) = try await session.data(for: req)
        let elapsed = Date().timeIntervalSince(start)
        guard let http = response as? HTTPURLResponse else {
            throw APIError(code: "TRANSPORT", message: "Invalid response", httpStatus: -1)
        }
        if let dateHeader = http.value(forHTTPHeaderField: "Date"),
           let d = HTTPDateFormatter.shared.date(from: dateHeader) {
            AppClock.shared.syncWithServer(serverTime: d, roundTripSeconds: elapsed)
        }
        if !(200..<300).contains(http.statusCode) {
            if let env = try? decoder.decode(ErrorEnvelope.self, from: data) {
                throw APIError(code: env.error.code, message: env.error.message, httpStatus: http.statusCode)
            }
            throw APIError(code: "HTTP_\(http.statusCode)", message: "Unexpected response", httpStatus: http.statusCode)
        }
        if data.isEmpty, Response.self == APIClient.Empty.self {
            return APIClient.Empty() as! Response
        }
        return try decoder.decode(Response.self, from: data)
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
