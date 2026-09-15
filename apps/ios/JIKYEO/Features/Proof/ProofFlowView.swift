import SwiftUI

/// Entry point for "지금 증명하기" — the CTA on each Home card.
/// Dispatches to the correct proof view based on the occurrence's
/// verification method and threads the mode-aware result back into
/// `ProofResultView` on completion.
///
/// The dispatcher itself is intentionally thin: each proof implementation
/// (Photo, GPS, Timer, Self) is its own view + view-model.
struct ProofFlowView: View {
    let occurrence: TodayOccurrenceModel
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var container: AppContainer
    @State private var result: VerificationResultResponse?
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            content
                .background(DS.Color.surfaceBackground.ignoresSafeArea())
                .tint(DS.Color.primary)
                .toolbarBackground(DS.Color.surfaceBackground, for: .navigationBar)
                .navigationBarBackButtonHidden(true)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        NavBarButton("xmark") { dismiss() }
                            .accessibilityLabel(Copy.Errors.close)
                    }
                }
        }
    }

    @ViewBuilder private var content: some View {
        if let result = result ?? decidedFriendResult {
            ProofResultView(
                occurrence: occurrence,
                result: result,
                onClose: { dismiss() },
                onRetry: {
                    self.result = nil
                }
            )
        } else {
            VStack(spacing: DS.Space.md) {
                proofScreen
                if let errorMessage {
                    ErrorRetryBanner(message: errorMessage) { self.errorMessage = nil }
                }
            }
        }
    }

    private var decidedFriendResult: VerificationResultResponse? {
        guard occurrence.verificationMethod == .friend else { return nil }
        let name = occurrence.friendVerifyName ?? "친구"
        if occurrence.friendVerifyStatus == "approved" || (occurrence.status == "pass" && occurrence.friendVerifyStatus != nil) {
            return VerificationResultResponse(
                occurrenceId: occurrence.id, resultId: "friend", result: .pass,
                reasonCode: "FRIEND_VERIFY_APPROVED", userMessage: Copy.Friends.approved(name),
                confidence: nil, isMoneyCommitment: occurrence.isMoneyCommitment
            )
        }
        if occurrence.friendVerifyStatus == "rejected" || (occurrence.status == "fail" && occurrence.friendVerifyStatus != nil) {
            return VerificationResultResponse(
                occurrenceId: occurrence.id, resultId: "friend", result: .fail,
                reasonCode: "FRIEND_VERIFY_REJECTED", userMessage: Copy.Friends.rejected(name),
                confidence: nil, isMoneyCommitment: occurrence.isMoneyCommitment
            )
        }
        if occurrence.friendVerifyStatus == "expired" {
            return VerificationResultResponse(
                occurrenceId: occurrence.id, resultId: "friend", result: .uncertain,
                reasonCode: "FRIEND_VERIFY_EXPIRED", userMessage: "친구 확인이 없어 아직 결과로 처리하지 않았어요.",
                confidence: nil, isMoneyCommitment: occurrence.isMoneyCommitment
            )
        }
        return nil
    }

    @ViewBuilder private var proofScreen: some View {
        switch occurrence.verificationMethod {
        case .photo:
            PhotoProofView(occurrence: occurrence, onResult: { result = $0 }, onError: { errorMessage = $0 })
        case .gps:
            GpsProofView(occurrence: occurrence, onResult: { result = $0 }, onError: { errorMessage = $0 })
        case .timer:
            TimerProofView(occurrence: occurrence, onResult: { result = $0 }, onError: { errorMessage = $0 })
        case .self:
            SelfVerifyView(occurrence: occurrence, onResult: { result = $0 }, onError: { errorMessage = $0 })
        case .friend:
            FriendVerifyView(occurrence: occurrence, onResult: { result = $0 }, onError: { errorMessage = $0 })
        default:
            UnsupportedMethodView(method: occurrence.verificationMethod)
        }
    }
}

private struct UnsupportedMethodView: View {
    let method: VerificationMethod
    var body: some View {
        VStack(spacing: DS.Space.md) {
            Spacer()
            Text("이 증명 방식은 아직 준비 중이에요.")
                .font(Typo.heading).foregroundStyle(DS.Color.text)
            Text(method.label).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Spacer()
        }
        .padding(DS.Space.lg)
    }
}
