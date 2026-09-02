import SwiftUI

/// Live countdown to a UTC `Date`.
/// Uses the app's `Clock` (injected via env) — never the device clock alone,
/// so tests and previews can freeze time.
///
/// Copy style:
///   "2시간 18분 남았어요"
///   "10분 남았어요"
///   "지금이에요"
///   "마감이 지났어요"
public struct CountdownText: View {
    private let deadline: Date

    public init(deadline: Date) {
        self.deadline = deadline
    }

    public var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            Text(Self.copy(remaining: deadline.timeIntervalSince(context.date)))
                .font(Typo.bodyStrong)
                .foregroundStyle(color(for: deadline.timeIntervalSince(context.date)))
        }
    }

    public static func copy(remaining seconds: TimeInterval) -> String {
        if seconds <= 0 { return "마감이 지났어요" }
        if seconds < 60 { return "곧 마감이에요" }
        let minutes = Int(seconds / 60)
        if minutes < 60 { return "\(minutes)분 남았어요" }
        let hours = minutes / 60
        let mins = minutes % 60
        if hours < 24 { return mins == 0 ? "\(hours)시간 남았어요" : "\(hours)시간 \(mins)분 남았어요" }
        let days = hours / 24
        let hrs = hours % 24
        return hrs == 0 ? "\(days)일 남았어요" : "\(days)일 \(hrs)시간 남았어요"
    }

    private func color(for remaining: TimeInterval) -> Color {
        if remaining <= 0 { return DS.Color.moneyLost }
        if remaining <= 60 * 60 { return DS.Color.moneyAtRisk }
        return DS.Color.textSecondary
    }
}
