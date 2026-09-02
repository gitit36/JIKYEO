import SwiftUI

/// Onboarding shell — PRD §3. Full flow is fleshed out in Phase 2. Phase 1
/// provides the entry hero and a dev sign-in path so the rest of the app is
/// reachable.
struct OnboardingRootView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var auth: AuthStore

    @State private var email: String = ""
    @State private var name: String = ""
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Spacer()

            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.onboardingHeadline)
                    .font(Typo.display)
                    .foregroundStyle(DS.Color.text)
                Text(Copy.onboardingSubhead)
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.textSecondary)
            }

            Spacer()

            VStack(spacing: DS.Space.sm) {
                InputField("이름", text: $name)
                InputField("이메일", text: $email, keyboard: .emailAddress)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(Typo.caption)
                    .foregroundStyle(DS.Color.moneyLost)
            }

            PrimaryButton(Copy.onboardingCTA, isLoading: isLoading, isDisabled: !canSubmit) {
                Task { await signIn() }
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.bottom, DS.Space.xl)
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
    }

    private var canSubmit: Bool {
        !email.isEmpty && !name.isEmpty
    }

    @MainActor
    private func signIn() async {
        errorMessage = nil
        isLoading = true
        defer { isLoading = false }
        do {
            let session = try await container.authAPI.signInEmailDev(email: email, displayName: name)
            auth.setSession(.init(
                userId: session.userId,
                accessToken: session.accessToken,
                refreshToken: session.refreshToken,
                expiresAt: AppClock.shared.now().addingTimeInterval(TimeInterval(session.expiresIn))
            ))
        } catch let apiError as APIError {
            errorMessage = apiError.message
        } catch {
            errorMessage = "다시 시도해주세요."
        }
    }
}
