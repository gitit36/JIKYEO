import SwiftUI

/// Chip for the MONEY-only financial state of a commitment. Reflects the
/// server-derived `MoneyStatus` — never the behavioral PASS/FAIL of an
/// occurrence — so a missed occurrence is never shown as "money lost" before
/// settlement actually ran.
public struct MoneyStatusChip: View {
    private let status: MoneyStatus

    public init(_ status: MoneyStatus) { self.status = status }

    public var body: some View {
        Text(status.label)
            .font(Typo.caption)
            .padding(.horizontal, DS.Space.sm)
            .padding(.vertical, DS.Space.xxs)
            .foregroundStyle(color)
            .background(Capsule().fill(color.opacity(0.12)))
    }

    private var color: Color {
        switch status {
        case .payment_pending, .refund_in_progress: return DS.Color.statusReviewing
        case .payment_failed, .refund_delayed:      return DS.Color.moneyLost
        case .funded:                               return DS.Color.moneyAtRisk
        case .refund_scheduled:                     return DS.Color.statusScheduled
        case .refunded:                             return DS.Color.moneyPositive
        case .settled_no_refund:                    return DS.Color.textMuted
        }
    }
}
