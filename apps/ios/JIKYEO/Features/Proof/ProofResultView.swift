import SwiftUI

/// PASS / UNCERTAIN / FAIL render. Copy and imagery differ by enforcement
/// mode. Money is only mentioned for MONEY commitments — SELF/SOCIAL never
/// see "돈", "환불", or "0원" here.
struct ProofResultView: View {
    let occurrence: TodayOccurrenceModel
    let result: VerificationResultResponse
    let onClose: () -> Void
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            Image(systemName: symbol)
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(tint)
            Text(headline)
                .font(Typo.display)
                .foregroundStyle(DS.Color.text)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text(subline)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            if result.isMoneyCommitment && amount > 0 && result.result != .uncertain {
                MoneyText(amount, intent: moneyIntent, size: .hero)
            }
            Spacer()
            switch result.result {
            case .pass:
                PrimaryButton(Copy.Result.backHome, action: onClose)
            case .uncertain:
                PrimaryButton(Copy.Result.uncertainCTA, action: onRetry)
                TertiaryButton(Copy.Result.checkAgainLater, action: onClose)
            case .fail:
                PrimaryButton(Copy.Result.backHome, action: onClose)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.xl)
    }

    private var amount: Int64 { occurrence.stakeKrw }

    private var headline: String {
        switch result.result {
        case .pass: return Copy.Result.passTitle
        case .uncertain: return Copy.Result.uncertainTitle
        case .fail: return Copy.Result.failTitle
        }
    }

    private var subline: String {
        switch result.result {
        case .pass:
            if result.isMoneyCommitment && amount > 0 {
                return Copy.Result.passMoneyBody(amount)
            }
            return Copy.Result.passSelfBody("오늘")
        case .uncertain:
            return "\(Copy.Result.uncertainBody)\n\(result.userMessage)"
        case .fail:
            if result.isMoneyCommitment && amount > 0 {
                return Copy.Result.failMoneyBody(amount)
            }
            return Copy.Result.failSelfBody
        }
    }

    private var symbol: String {
        switch result.result {
        case .pass: return "checkmark.seal.fill"
        case .uncertain: return "questionmark.circle.fill"
        case .fail: return "xmark.seal.fill"
        }
    }
    private var tint: Color {
        switch result.result {
        case .pass: return DS.Color.primary
        case .uncertain: return DS.Color.statusUncertain
        case .fail: return DS.Color.moneyLost
        }
    }
    private var moneyIntent: MoneyText.Intent {
        switch result.result {
        case .pass: return .protected
        case .fail: return .lost
        case .uncertain: return .atRisk
        }
    }
}
