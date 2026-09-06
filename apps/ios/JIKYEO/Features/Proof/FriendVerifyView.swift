import SwiftUI

struct FriendVerifyView: View {
    let occurrence: TodayOccurrenceModel
    let onResult: (VerificationResultResponse) -> Void
    let onError: (String) -> Void
    @EnvironmentObject private var container: AppContainer
    @State private var waitingName: String?
    @State private var isSubmitting = false

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            Text(occurrence.commitmentTitle).font(Typo.title).multilineTextAlignment(.center)
            if let name = waitingName ?? occurrence.friendVerifyName, occurrence.friendVerifyStatus == "pending" || waitingName != nil {
                Text(Copy.Friends.waiting(name)).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            } else {
                Text(Copy.Friends.request).font(Typo.heading)
            }
            Spacer()
            if waitingName == nil && occurrence.friendVerifyStatus != "pending" {
                PrimaryButton(Copy.Friends.request, isLoading: isSubmitting, isDisabled: isSubmitting) {
                    Task {
                        isSubmitting = true
                        do {
                            let card = try await container.friendsAPI.requestFriendVerify(occurrenceId: occurrence.id)
                            await MainActor.run {
                                waitingName = card.verifierDisplayName ?? occurrence.friendVerifyName ?? "친구"
                                isSubmitting = false
                            }
                        } catch let e as APIError {
                            await MainActor.run { isSubmitting = false; onError(e.message) }
                        } catch {
                            await MainActor.run { isSubmitting = false; onError("다시 시도해주세요.") }
                        }
                    }
                }
            }
        }
        .padding(DS.Space.lg)
    }
}
