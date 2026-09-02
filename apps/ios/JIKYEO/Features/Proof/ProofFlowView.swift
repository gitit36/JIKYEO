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
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            dismiss()
                        } label: {
                            Image(systemName: "xmark").foregroundStyle(DS.Color.text)
                        }
                    }
                }
        }
    }

    @ViewBuilder private var content: some View {
        if let result = result {
            ProofResultView(
                occurrence: occurrence,
                result: result,
                onClose: { dismiss() },
                onRetry: {
                    self.result = nil
                }
            )
        } else {
            proofScreen
        }
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
