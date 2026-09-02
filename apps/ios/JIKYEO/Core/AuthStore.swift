import Foundation

/// Very small credential store. Real Keychain wiring lives behind the same
/// interface later — MVP uses `UserDefaults` only for the dev environment.
@MainActor
public final class AuthStore: ObservableObject {
    public struct Session: Codable, Equatable {
        public let userId: String
        public let accessToken: String
        public let refreshToken: String
        public let expiresAt: Date
    }

    @Published public private(set) var session: Session?

    private let defaults: UserDefaults
    private let key = "jikyeo.auth.session"

    public init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.session = Self.load(from: defaults, key: key)
    }

    public var currentAccessToken: String? { session?.accessToken }
    public var isSignedIn: Bool { session != nil }

    public func setSession(_ session: Session) {
        self.session = session
        if let data = try? JSONEncoder.iso8601.encode(session) {
            defaults.set(data, forKey: key)
        }
    }

    public func signOut() {
        session = nil
        defaults.removeObject(forKey: key)
    }

    private static func load(from defaults: UserDefaults, key: String) -> Session? {
        guard let data = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder.iso8601.decode(Session.self, from: data)
    }
}

extension JSONEncoder {
    static var iso8601: JSONEncoder {
        let e = JSONEncoder(); e.dateEncodingStrategy = .iso8601; return e
    }
}
extension JSONDecoder {
    static var iso8601: JSONDecoder {
        let d = JSONDecoder(); d.dateDecodingStrategy = .iso8601; return d
    }
}
