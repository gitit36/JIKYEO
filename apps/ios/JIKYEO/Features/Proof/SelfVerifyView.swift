import SwiftUI

/// Self-verify (지켰어요 / 못 지켰어요). SR-FR-013 requires this to be a
/// first-class flow, especially for SELF enforcement. For MONEY commitments
/// it is still allowed today; higher stake tiers may later restrict it.
struct SelfVerifyView: View {
    let occurrence: TodayOccurrenceModel
    let onResult: (VerificationResultResponse) -> Void
    let onError: (String) -> Void
    @EnvironmentObject private var container: AppContainer
    @State private var isSubmitting = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            VStack(spacing: DS.Space.sm) {
                Text(occurrence.commitmentTitle)
                    .font(Typo.title)
                    .foregroundStyle(DS.Color.text)
                    .multilineTextAlignment(.center)
                Text(Copy.Proof.selfTitle)
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
                    .multilineTextAlignment(.center)
                Text(Copy.Proof.selfSub)
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.textSecondary)
            }
            Spacer()
            VStack(spacing: DS.Space.sm) {
                PrimaryButton(
                    Copy.Proof.selfKept,
                    isLoading: isSubmitting,
                    isDisabled: isSubmitting
                ) {
                    submit(answer: .kept)
                }
                SecondaryButton(Copy.Proof.selfMissed) {
                    submit(answer: .missed)
                }
                .disabled(isSubmitting)
            }
            if let err = errorMessage {
                Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.lg)
    }

    private func submit(answer: SelfEvidencePayload.Answer) {
        guard !isSubmitting else { return }
        isSubmitting = true
        errorMessage = nil
        Task {
            do {
                let result = try await container.evidenceAPI.submit(
                    occurrenceId: occurrence.id,
                    .selfAnswer(answer)
                )
                await MainActor.run {
                    isSubmitting = false
                    onResult(result)
                }
            } catch let e as APIError {
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = e.message
                }
            } catch {
                await MainActor.run {
                    isSubmitting = false
                    errorMessage = "다시 시도해주세요."
                }
            }
        }
    }
}
