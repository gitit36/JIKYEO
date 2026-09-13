import SwiftUI

enum OnboardingStep: Int {
    case hero = 0
    case goalPick
    case howItWorks
    case notify
    case signIn
}

@MainActor
final class OnboardingModel: ObservableObject {
    @Published var step: OnboardingStep = .hero
    @Published var pickedGoal: CommitmentTemplate = CommitmentTemplates.all[0]
    @Published var name: String = ""
    @Published var email: String = ""
    @Published var isSigningIn = false
    @Published var errorMessage: String?

    func requestNotifications() async -> Bool {
        await PushRegistrar.shared.requestAndRegister()
    }
}

struct OnboardingRootView: View {
    let debugStage: String?
    init(debugStage: String? = nil) { self.debugStage = debugStage }
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var auth: AuthStore
    @StateObject private var model = OnboardingModel()

    var body: some View {
        NavigationStack {
            Group {
                switch model.step {
                case .hero:        HeroView(model: model)
                case .goalPick:    GoalPickView(model: model)
                case .howItWorks:  HowView(model: model)
                case .notify:      NotifyView(model: model)
                case .signIn:      SignInView(model: model, onDone: signIn)
                }
            }
            .onAppear {
                #if DEBUG
                switch debugStage {
                case "goal":   model.step = .goalPick
                case "how":    model.step = .howItWorks
                case "notify": model.step = .notify
                case "signin":
                    model.step = .signIn
                    model.name = "김지켜"
                    model.email = "jikyeo@example.com"
                default: break
                }
                #endif
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .toolbar {
                if model.step != .hero {
                    ToolbarItem(placement: .topBarLeading) {
                        Button {
                            model.step = OnboardingStep(rawValue: model.step.rawValue - 1) ?? .hero
                        } label: {
                            Image(systemName: "chevron.left").foregroundStyle(DS.Color.text)
                        }
                        .accessibilityLabel(Copy.Wizard.back)
                    }
                }
            }
        }
    }

    private func signIn() {
        Task {
            model.errorMessage = nil
            model.isSigningIn = true
            defer { model.isSigningIn = false }
            do {
                let session = try await container.authAPI.signInEmailDev(email: model.email, displayName: model.name)
                auth.setSession(.init(
                    userId: session.userId,
                    accessToken: session.accessToken,
                    refreshToken: session.refreshToken,
                    expiresAt: AppClock.shared.now().addingTimeInterval(TimeInterval(session.expiresIn))
                ))
                Analytics.track(.onboarding_completed)
            } catch {
                model.errorMessage = UserFacingError.message(error)
            }
        }
    }
}

// MARK: - Hero
private struct HeroView: View {
    @ObservedObject var model: OnboardingModel
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Spacer()
            Text(Copy.Onboarding.hero1)
                .font(Typo.display)
                .foregroundStyle(DS.Color.text)
            Text(Copy.Onboarding.hero2)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
            Spacer()
            PrimaryButton(Copy.Onboarding.heroCTA) { model.step = .goalPick }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.bottom, DS.Space.xl)
    }
}

// MARK: - Goal pick
private struct GoalPickView: View {
    @ObservedObject var model: OnboardingModel
    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    VStack(alignment: .leading, spacing: DS.Space.xs) {
                        Text(Copy.Onboarding.goalTitle)
                            .font(Typo.title).foregroundStyle(DS.Color.text)
                        Text(Copy.Onboarding.goalHint)
                            .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    }
                    LazyVGrid(columns: [GridItem(.flexible(), spacing: DS.Space.sm),
                                        GridItem(.flexible(), spacing: DS.Space.sm)],
                              spacing: DS.Space.sm) {
                        ForEach(CommitmentTemplates.all) { t in
                            Button {
                                model.pickedGoal = t
                            } label: {
                                VStack(alignment: .leading, spacing: DS.Space.sm) {
                                    Image(systemName: t.symbol)
                                        .font(.system(size: 24, weight: .semibold))
                                        .foregroundStyle(DS.Color.primary)
                                        .accessibilityHidden(true)
                                    Text(t.title).font(Typo.bodyStrong).foregroundStyle(DS.Color.text)
                                }
                                .padding(DS.Space.md)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(
                                    RoundedRectangle(cornerRadius: DS.Radius.md)
                                        .stroke(model.pickedGoal.id == t.id ? DS.Color.primary : DS.Color.divider,
                                                lineWidth: model.pickedGoal.id == t.id ? 2 : 1)
                                        .background(RoundedRectangle(cornerRadius: DS.Radius.md).fill(DS.Color.surface))
                                )
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(t.title)
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.md)
            }
            PrimaryButton(Copy.Onboarding.goalNext) { model.step = .howItWorks }
                .padding(.horizontal, DS.Space.lg)
                .padding(.bottom, DS.Space.md)
        }
    }
}

// MARK: - How it works
private struct HowView: View {
    @ObservedObject var model: OnboardingModel
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Text(Copy.Onboarding.howTitle)
                .font(Typo.title).foregroundStyle(DS.Color.text)
            VStack(alignment: .leading, spacing: DS.Space.md) {
                HowRow(index: 1, text: Copy.Onboarding.how1)
                HowRow(index: 2, text: Copy.Onboarding.how2)
                HowRow(index: 3, text: Copy.Onboarding.how3)
            }
            Spacer()
            PrimaryButton(Copy.Onboarding.howNext) { model.step = .notify }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.md)
    }
}

private struct HowRow: View {
    let index: Int
    let text: String
    var body: some View {
        HStack(alignment: .top, spacing: DS.Space.md) {
            Text("\(index)")
                .font(Typo.moneyBody)
                .foregroundStyle(.white)
                .frame(width: 32, height: 32)
                .background(Circle().fill(DS.Color.primary))
            Text(text)
                .font(Typo.heading)
                .foregroundStyle(DS.Color.text)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Notify
private struct NotifyView: View {
    @ObservedObject var model: OnboardingModel
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Text(Copy.Onboarding.notifyTitle)
                .font(Typo.title).foregroundStyle(DS.Color.text)
            Text(Copy.Onboarding.notifySub)
                .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            Spacer()
            PrimaryButton(Copy.Onboarding.notifyYes) {
                Task { _ = await model.requestNotifications(); model.step = .signIn }
            }
            SecondaryButton(Copy.Onboarding.notifyLater) { model.step = .signIn }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.md)
    }
}

// MARK: - SignIn
private struct SignInView: View {
    @ObservedObject var model: OnboardingModel
    let onDone: () -> Void

    var canSubmit: Bool {
        !model.name.isEmpty && model.email.contains("@")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.lg) {
            Text(Copy.Onboarding.signInTitle)
                .font(Typo.title).foregroundStyle(DS.Color.text)
            Text(Copy.Onboarding.signInSub)
                .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            VStack(spacing: DS.Space.sm) {
                InputField(Copy.Onboarding.nameField, text: $model.name)
                InputField(Copy.Onboarding.emailField, text: $model.email, keyboard: .emailAddress)
            }
            if let e = model.errorMessage {
                Text(e).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
            Spacer()
            PrimaryButton(Copy.Onboarding.signInCTA,
                          isLoading: model.isSigningIn,
                          isDisabled: !canSubmit,
                          action: onDone)
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.md)
    }
}
