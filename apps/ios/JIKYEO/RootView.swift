import SwiftUI

struct RootView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if !container.environment.isUsable {
                ConfigBlockedView()
            } else {
                appRoot
            }
        }
    }

    @ViewBuilder
    private var appRoot: some View {
        #if DEBUG
        if let stage = DebugLaunch.stage, stage.hasPrefix("wizard-") {
                CreateCommitmentWizardView(debugStage: stage).environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("friends-") || stage.hasPrefix("friend-verify-inbox") {
                FriendsView(debugStage: stage).environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("friend-verify-") {
                FriendVerifyDebugView(stage: stage).environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("home-") || stage.hasPrefix("history-") {
                MainTabView(debugStage: DebugLaunch.stage)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("proof-") {
                ProofDebugView(stage: stage).environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("result-") {
                ResultDebugView(stage: stage).environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage == "recap-mixed" {
                NavigationStack { WeeklyRecapView(recap: WeeklyRecapView.fixtureMixed()) }
            } else if let stage = DebugLaunch.stage, stage == "evidence-deleted" {
                NavigationStack { DeletedEvidencePlaceholder() }
            } else if let stage = DebugLaunch.stage, stage == "notify-deeplink-friend-verify" {
                FriendsView(debugStage: "friend-verify-inbox").environmentObject(container)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("notify-deeplink") {
                MainTabView(debugStage: stage)
            } else if let stage = DebugLaunch.stage, ["terms-accept", "age-reject", "fail-provisional", "cancel-immediate", "v1-grace-alive", "v1-grace-exceeded", "v1-cancel-pre", "v1-cancel-post", "v1-makeup"].contains(stage) {
                ComplianceDebugView(stage: stage)
            } else if let stage = DebugLaunch.stage, stage.hasPrefix("cancel-") {
                CancelDebugView(stage: stage)
            } else if let stage = DebugLaunch.stage, stage == "maintenance-retry" {
                MaintenanceRetryDebugView()
            } else if let stage = DebugLaunch.stage, ["hero","goal","how","notify","signin"].contains(stage) {
                OnboardingRootView(debugStage: stage)
            } else if auth.isSignedIn {
                MainTabView(debugStage: nil)
                    .id(auth.session?.userId ?? "signed-in")
            } else {
                OnboardingRootView(debugStage: nil)
            }
            #else
            if auth.isSignedIn {
                MainTabView(debugStage: nil)
                    .id(auth.session?.userId ?? "signed-in")
            } else {
                OnboardingRootView(debugStage: nil)
            }
        #endif
    }
}

private struct ConfigBlockedView: View {
    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            Text(Copy.Errors.misconfigured)
                .font(Typo.body)
                .foregroundStyle(DS.Color.text)
                .multilineTextAlignment(.center)
                .padding(.horizontal, DS.Space.lg)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
    }
}

struct MainTabView: View {
    enum Tab: Hashable { case home, history, friends, settings }
    let debugStage: String?
    @EnvironmentObject private var container: AppContainer
    @State private var selected: Tab
    @State private var recap: WeeklyRecapResponse?
    @State private var banner: String?
    init(debugStage: String? = nil) {
        self.debugStage = debugStage
        let friends = (debugStage?.hasPrefix("friends-") ?? false)
            || (debugStage?.contains("deeplink-friend") ?? false)
        let history = debugStage?.hasPrefix("history-") ?? false
        _selected = State(initialValue: friends ? .friends : history ? .history : .home)
    }
    var body: some View {
        TabView(selection: $selected) {
            HomeView(debugStage: debugStage)
                .tabItem { Label("홈", systemImage: "house.fill") }
                .tag(Tab.home)
            HistoryView(debugStage: debugStage)
                .tabItem { Label("기록", systemImage: "clock.arrow.circlepath") }
                .tag(Tab.history)
            FriendsView(debugStage: debugStage)
                .tabItem { Label("친구", systemImage: "person.2.fill") }
                .tag(Tab.friends)
            SettingsView()
                .tabItem { Label("설정", systemImage: "gearshape.fill") }
                .tag(Tab.settings)
        }
        .tint(DS.Color.primary)
        .overlay(alignment: .top) {
            if let banner {
                Text(banner)
                    .font(Typo.bodyStrong)
                    .padding(DS.Space.md)
                    .frame(maxWidth: .infinity)
                    .background(DS.Color.surfaceBackground)
            }
        }
        .sheet(item: $recap) { row in
            NavigationStack { WeeklyRecapView(recap: row) }
        }
        .onAppear {
            PushRegistrar.shared.startIfSignedIn()
            if debugStage == "notify-deeplink" {
                banner = Copy.Notify.deadline
                selected = .home
            }
            if debugStage == "notify-deeplink-friends" || debugStage == "notify-deeplink-friend-verify" {
                selected = .friends
            }
        }
        .onChange(of: container.pendingLink) { _, link in
            guard let link else { return }
            apply(link)
            container.pendingLink = nil
        }
    }

    private func apply(_ link: DeepLink) {
        switch link {
        case .today:
            banner = Copy.Notify.deadline
            selected = .home
        case .history:
            selected = .history
        case .recap(let week):
            Task {
                do {
                    recap = try await container.recapAPI.get(weekStart: week)
                } catch {
                    banner = UserFacingError.message(error)
                    selected = .home
                }
            }
        case .friends, .friendVerify:
            selected = .friends
        case .sign(let id), .commitment(let id):
            Task {
                do {
                    _ = try await container.commitmentAPI.getOne(id: id)
                    selected = .history
                } catch {
                    banner = UserFacingError.message(error)
                    selected = .home
                }
            }
        case .appeal:
            selected = .history
        }
    }
}

#if DEBUG
/// Debug harness that pushes a specific proof screen into ProofFlowView
/// without needing a live occurrence in the database.
struct ProofDebugView: View {
    let stage: String
    @EnvironmentObject private var container: AppContainer
    var body: some View {
        ProofFlowView(occurrence: fixture)
            .environmentObject(container)
    }
    private var fixture: TodayOccurrenceModel {
        let method: VerificationMethod = {
            switch stage {
            case "proof-photo": return .photo
            case "proof-gps":   return .gps
            case "proof-timer": return .timer
            case "proof-self":  return .self
            default: return .photo
            }
        }()
        let mode: EnforcementMode = (method == .timer || method == .self) ? .self : .money
        return TodayOccurrenceModel(
            id: "debug-occ",
            commitmentId: "debug-c",
            commitmentTitle: method == .timer ? "60분 공부하기" : "헬스장 가기",
            verificationMethod: method,
            methodLabel: method.label,
            enforcementMode: mode,
            status: "scheduled",
            deadlineAt: Date().addingTimeInterval(3600 * 2),
            stakeKrw: mode == .money ? 10_000 : 0,
            chipKind: .scheduled,
            showsProofCTA: true
        )
    }
}

struct ResultDebugView: View {
    let stage: String
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        let pack = fixture()
        NavigationStack {
            ProofResultView(
                occurrence: pack.occ,
                result: pack.result,
                onClose: { dismiss() },
                onRetry: { }
            )
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
        }
    }
    private struct FixturePack { let result: VerificationResultResponse; let occ: TodayOccurrenceModel }
    private func fixture() -> FixturePack {
        let (r, _, o) = _fixture()
        return FixturePack(result: r, occ: o)
    }
    private func _fixture() -> (VerificationResultResponse, Bool, TodayOccurrenceModel) {
        switch stage {
        case "result-pass-money":
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .pass,
                                           reasonCode: "GPS_INSIDE_RADIUS", userMessage: "지정한 장소에 도착했어요.",
                                           confidence: 0.98, isMoneyCommitment: true),
                true,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "헬스장 가기",
                                     verificationMethod: .gps, methodLabel: Copy.Wizard.methodGps,
                                     enforcementMode: .money, status: "pass",
                                     deadlineAt: Date(), stakeKrw: 10_000, chipKind: .pass, showsProofCTA: false)
            )
        case "result-pass-self":
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .pass,
                                           reasonCode: "SELF_KEPT", userMessage: "약속을 지켰어요.",
                                           confidence: 1.0, isMoneyCommitment: false),
                false,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "60분 공부하기",
                                     verificationMethod: .timer, methodLabel: Copy.Wizard.methodTimer,
                                     enforcementMode: .self, status: "pass",
                                     deadlineAt: Date(), stakeKrw: 0, chipKind: .pass, showsProofCTA: false)
            )
        case "result-uncertain":
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .uncertain,
                                           reasonCode: "PHOTO_LOW_CONFIDENCE",
                                           userMessage: "사진만으로는 확실하게 확인하기 어려워요.",
                                           confidence: 0.4, isMoneyCommitment: true),
                true,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "헬스장 가기",
                                     verificationMethod: .photo, methodLabel: Copy.Wizard.methodPhoto,
                                     enforcementMode: .money, status: "uncertain",
                                     deadlineAt: Date(), stakeKrw: 5_000, chipKind: .uncertain, showsProofCTA: false)
            )
        case "result-fail-self":
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .fail,
                                           reasonCode: "SELF_MISSED", userMessage: "약속을 놓쳤어요.",
                                           confidence: 1.0, isMoneyCommitment: false),
                false,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "명상 20분",
                                     verificationMethod: .self, methodLabel: Copy.Wizard.methodSelf,
                                     enforcementMode: .self, status: "fail",
                                     deadlineAt: Date(), stakeKrw: 0, chipKind: .fail, showsProofCTA: false)
            )
        case "result-fail-money":
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .fail,
                                           reasonCode: "GPS_OUTSIDE_RADIUS", userMessage: "지정한 장소에 도착하지 않았어요.",
                                           confidence: 1.0, isMoneyCommitment: true),
                true,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "헬스장 가기",
                                     verificationMethod: .gps, methodLabel: Copy.Wizard.methodGps,
                                     enforcementMode: .money, status: "fail",
                                     deadlineAt: Date(), stakeKrw: 10_000, chipKind: .fail, showsProofCTA: false)
            )
        default:
            return (
                VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .pass,
                                           reasonCode: "OK", userMessage: "약속을 지켰어요.",
                                           confidence: 1.0, isMoneyCommitment: false),
                false,
                TodayOccurrenceModel(id: "o", commitmentId: "c", commitmentTitle: "약속",
                                     verificationMethod: .self, methodLabel: Copy.Wizard.methodSelf,
                                     enforcementMode: .self, status: "pass",
                                     deadlineAt: Date(), stakeKrw: 0, chipKind: .pass, showsProofCTA: false)
            )
        }
    }
}

struct FriendVerifyDebugView: View {
    let stage: String
    @EnvironmentObject private var container: AppContainer
    var body: some View {
        if stage == "friend-verify-inbox" {
            FriendsView(debugStage: stage).environmentObject(container)
        } else {
            ProofResultView(occurrence: occ, result: result, onClose: {}, onRetry: {})
                .environmentObject(container)
        }
    }
    private var occ: TodayOccurrenceModel {
        TodayOccurrenceModel(
            id: "o", commitmentId: "c", commitmentTitle: "야식 먹지 않기",
            verificationMethod: .friend, methodLabel: Copy.Wizard.methodFriend,
            enforcementMode: stage.contains("money") ? .money : .self,
            status: stage.contains("pass") ? "pass" : (stage.contains("timeout") || stage.contains("revoked") ? "uncertain" : "fail"),
            deadlineAt: Date(), stakeKrw: stage.contains("money") ? 15_000 : 0,
            chipKind: stage.contains("pass") ? .pass : (stage.contains("timeout") || stage.contains("revoked") ? .uncertain : .fail),
            showsProofCTA: false,
            friendVerifyStatus: stage.contains("pass") ? "approved" : (stage.contains("timeout") || stage.contains("revoked") ? "expired" : "rejected"),
            friendVerifyName: "민수"
        )
    }
    private var result: VerificationResultResponse {
        if stage.contains("pass") {
            return VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .pass,
                                             reasonCode: "FRIEND_VERIFY_APPROVED", userMessage: Copy.Friends.approved("민수"),
                                             confidence: nil, isMoneyCommitment: false)
        }
        if stage.contains("timeout") || stage.contains("revoked") {
            return VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .uncertain,
                                             reasonCode: stage.contains("revoked") ? "FRIEND_VERIFY_REVOKED" : "FRIEND_VERIFY_EXPIRED",
                                             userMessage: "친구 확인이 없어 아직 결과로 처리하지 않았어요.",
                                             confidence: nil, isMoneyCommitment: stage.contains("money"))
        }
        return VerificationResultResponse(occurrenceId: "o", resultId: "r", result: .fail,
                                         reasonCode: "FRIEND_VERIFY_REJECTED", userMessage: Copy.Friends.rejected("민수"),
                                         confidence: nil, isMoneyCommitment: true)
    }
}
#endif
