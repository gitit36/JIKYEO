import Foundation

/// Server-authoritative clock. `now()` returns device time by default but the
/// app resyncs with server responses so deadline countdowns don't drift when
/// the user's device clock is skewed. Never use `Date()` in domain code.
public final class AppClock {
    public static let shared = AppClock()

    private var serverOffset: TimeInterval = 0
    private let queue = DispatchQueue(label: "com.jikyeo.appclock")

    public func now() -> Date {
        queue.sync { Date().addingTimeInterval(serverOffset) }
    }

    /// Adjust based on the server's timestamp from any API response.
    public func syncWithServer(serverTime: Date, roundTripSeconds: TimeInterval = 0) {
        let estimatedServerNow = serverTime.addingTimeInterval(roundTripSeconds / 2)
        queue.sync {
            serverOffset = estimatedServerNow.timeIntervalSince(Date())
        }
    }
}
