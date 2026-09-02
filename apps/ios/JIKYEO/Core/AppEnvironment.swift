import Foundation

/// App-wide configuration. Reads from `Info.plist` first, falls back to dev defaults.
public struct AppEnvironment {
    public let apiBaseURL: URL
    public let bundleId: String

    public static let live: AppEnvironment = {
        let base = Bundle.main.object(forInfoDictionaryKey: "APIBaseURL") as? String
            ?? "http://localhost:3001/v1"
        return AppEnvironment(
            apiBaseURL: URL(string: base)!,
            bundleId: Bundle.main.bundleIdentifier ?? "com.jikyeo.app"
        )
    }()
}
