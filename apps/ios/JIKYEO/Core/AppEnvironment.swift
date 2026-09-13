import Foundation

/// App-wide configuration. Debug may use localhost. Release must be HTTPS
/// and never a loopback/dev host — fail closed instead of talking to a local API.
public struct AppEnvironment {
    public let apiBaseURL: URL
    public let bundleId: String
    public let isUsable: Bool

    public static let live: AppEnvironment = resolve()

    /// Intended production host. Deploy separately; do not fall back to localhost.
    public static let intendedReleaseAPIBaseURL = "https://api.jikyeo.app/v1"

    static func resolve(
        raw: String? = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String,
        bundleId: String = Bundle.main.bundleIdentifier ?? "com.jikyeo.app"
    ) -> AppEnvironment {
        let trimmed = raw?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        #if DEBUG
        let candidate = debugCandidate(trimmed: trimmed)
        if let url = validatedURL(candidate, allowLocal: true) {
            return AppEnvironment(apiBaseURL: url, bundleId: bundleId, isUsable: true)
        }
        return AppEnvironment(
            apiBaseURL: URL(string: "http://localhost:3001/v1")!,
            bundleId: bundleId,
            isUsable: true
        )
        #else
        if let url = validatedURL(trimmed, allowLocal: false) {
            return AppEnvironment(apiBaseURL: url, bundleId: bundleId, isUsable: true)
        }
        return AppEnvironment(
            apiBaseURL: URL(string: intendedReleaseAPIBaseURL)!,
            bundleId: bundleId,
            isUsable: false
        )
        #endif
    }

    static func validatedURL(_ raw: String, allowLocal: Bool) -> URL? {
        guard let url = URL(string: raw), let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        let local = host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host.hasSuffix(".local")
        if local && !allowLocal { return nil }
        if allowLocal {
            return (url.scheme == "http" || url.scheme == "https") ? url : nil
        }
        return url.scheme == "https" ? url : nil
    }

    /// Simulator may use loopback. A physical device's localhost is the phone.
    static func debugCandidate(
        trimmed: String,
        deviceOverride: String? = Bundle.main.object(forInfoDictionaryKey: "DebugDeviceAPIBaseURL") as? String
    ) -> String {
        let fallback = "http://localhost:3001/v1"
        let base = trimmed.isEmpty ? fallback : trimmed
        #if targetEnvironment(simulator)
        return base
        #else
        let override = deviceOverride?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !override.isEmpty, let host = URL(string: base)?.host?.lowercased() else { return base }
        let loopback = host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0"
        return loopback ? override : base
        #endif
    }
}
