import SwiftUI

/// PASS / UNCERTAIN / FAIL render. Copy and imagery differ by enforcement
/// mode. Money is only mentioned for MONEY commitments — SELF/SOCIAL never
/// see "돈", "환불", or "0원" here.
struct ProofResultView: View {
    let occurrence: TodayOccurrenceModel
    let result: VerificationResultResponse
    let onClose: () -> Void
    let onRetry: () -> Void
    @EnvironmentObject private var container: AppContainer
    @State private var showAppeal = false

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            Image(systemName: symbol)
                .font(.system(size: 56, weight: .semibold))
                .foregroundStyle(tint)
                .accessibilityHidden(true)
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
            if result.isMoneyCommitment && amount > 0 && result.result == .pass {
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
                if result.isMoneyCommitment {
                    Text(Copy.Appeal.provisional).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    PrimaryButton(Copy.Appeal.cta) { showAppeal = true }
                    TertiaryButton(Copy.Result.backHome, action: onClose)
                } else {
                    PrimaryButton(Copy.Result.backHome, action: onClose)
                }
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.xl)
        .onAppear {
            switch result.result {
            case .pass: Analytics.track(.verification_pass, ["method": occurrence.verificationMethod.rawValue])
            case .uncertain: Analytics.track(.verification_uncertain, ["method": occurrence.verificationMethod.rawValue])
            case .fail: Analytics.track(.verification_fail, ["method": occurrence.verificationMethod.rawValue])
            }
        }
        .sheet(isPresented: $showAppeal) {
            AppealSubmitSheet(occurrenceId: occurrence.id) {
                showAppeal = false
            }
            .environmentObject(container)
        }
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
            if result.reasonCode.hasPrefix("FRIEND_VERIFY") {
                return Copy.Friends.approved(occurrence.friendVerifyName ?? "친구")
            }
            if result.isMoneyCommitment && amount > 0 {
                return Copy.Result.passMoneyBody(amount)
            }
            return Copy.Result.passSelfBody("오늘")
        case .uncertain:
            return Copy.Result.uncertainBody
        case .fail:
            if result.reasonCode.hasPrefix("FRIEND_VERIFY") {
                return Copy.Friends.rejected(occurrence.friendVerifyName ?? "친구")
            }
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
