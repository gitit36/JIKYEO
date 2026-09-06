import Foundation

public enum DeepLink: Equatable {
    case today
    case history
    case sign(commitmentId: String)
    case commitment(id: String)
    case appeal(id: String)
    case recap(weekStart: String)

    public static func parse(_ url: URL) -> DeepLink? {
        guard url.scheme == "jikyeo" else { return nil }
        let parts = url.pathComponents.filter { $0 != "/" }
        let host = url.host ?? ""
        if host == "today" || (host.isEmpty && parts.first == "today") { return .today }
        if host == "history" || (host.isEmpty && parts.first == "history") { return .history }
        if host == "recap" { return parts.first.map { .recap(weekStart: $0) } }
        if host == "appeals" { return parts.first.map { .appeal(id: $0) } }
        if host == "commitments", let id = parts.first {
            if parts.dropFirst().first == "sign" { return .sign(commitmentId: id) }
            return .commitment(id: id)
        }
        return nil
    }
}
