import SwiftUI

/// The single component that displays money in JIKYEO.
///
/// Every screen that shows KRW MUST use `MoneyText` — never format money inline
/// or with `NumberFormatter` scattered through features.
///
/// `intent` maps to semantic color:
/// - `.protected` — money kept / refunded
/// - `.atRisk`    — money currently at risk
/// - `.lost`      — money forfeited
/// - `.neutral`   — general amounts (e.g., in the wizard)
public struct MoneyText: View {
    public enum Intent { case protected, atRisk, lost, neutral }
    public enum Size   { case hero, large, body, small }

    private let amount: Int64
    private let intent: Intent
    private let size: Size

    public init(_ amountKrw: Int64, intent: Intent = .neutral, size: Size = .body) {
        self.amount = amountKrw
        self.intent = intent
        self.size = size
    }

    public var body: some View {
        Text(Self.format(amount))
            .font(font)
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            .accessibilityLabel(Self.accessibilityLabel(amount))
    }

    private var font: Font {
        switch size {
        case .hero:  return Typo.moneyHero
        case .large: return Typo.moneyLarge
        case .body:  return Typo.moneyBody
        case .small: return Typo.moneySmall
        }
    }

    private var color: Color {
        switch intent {
        case .protected: return DS.Color.moneyPositive
        case .atRisk:    return DS.Color.moneyAtRisk
        case .lost:      return DS.Color.moneyLost
        case .neutral:   return DS.Color.text
        }
    }

    /// `15,000원` — always with the `원` suffix, always with commas.
    public static func format(_ amountKrw: Int64) -> String {
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.groupingSeparator = ","
        let n = f.string(from: NSNumber(value: amountKrw)) ?? "\(amountKrw)"
        return "\(n)원"
    }

    private static func accessibilityLabel(_ amountKrw: Int64) -> String {
        "\(amountKrw)원"
    }
}
