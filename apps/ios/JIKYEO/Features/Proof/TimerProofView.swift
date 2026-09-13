import SwiftUI
import UIKit

/// Focus Timer. Server-authoritative: the client sends `start`, ~15s
/// heartbeats and a `finish`. The server records gaps and background events
/// and hands the timing back to `VerificationOrchestrator`, which decides
/// PASS / UNCERTAIN / FAIL.
///
/// The user experience is honest about ambiguity: heartbeat gaps or app
/// terminations mean UNCERTAIN, not FAIL — we never punish a system failure.
struct TimerProofView: View {
    let occurrence: TodayOccurrenceModel
    let onResult: (VerificationResultResponse) -> Void
    let onError: (String) -> Void

    @EnvironmentObject private var container: AppContainer
    @StateObject private var vm = TimerProofVM()
    @State private var errorMessage: String?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(spacing: DS.Space.lg) {
            Spacer()
            VStack(spacing: DS.Space.sm) {
                Text(occurrence.commitmentTitle)
                    .font(Typo.title).foregroundStyle(DS.Color.text)
                    .multilineTextAlignment(.center)
                if vm.startedAt != nil, let planned = vm.plannedSeconds {
                    RingTimer(elapsed: vm.elapsedFor(now: vm.now), planned: planned)
                        .frame(width: 220, height: 220)
                        .accessibilityLabel(Text("남은 시간 \(formatRemaining(vm.remainingFor(now: vm.now)))"))
                    Text(formatRemaining(vm.remainingFor(now: vm.now)))
                        .font(Typo.display).foregroundStyle(DS.Color.text)
                    Text(Copy.Proof.timerGoalMinutes(planned / 60))
                        .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                } else {
                    ProgressView()
                }
                Text(Copy.Proof.timerKeepScreenOn)
                    .font(Typo.caption).foregroundStyle(DS.Color.textMuted)
            }
            Spacer()
            switch vm.state {
            case .starting:
                ProgressView()
            case .running:
                VStack(spacing: DS.Space.sm) {
                    if vm.canFinish {
                        PrimaryButton(Copy.Proof.timerFinish) { finish(terminated: false) }
                    } else {
                        SecondaryButton(Copy.Proof.timerGiveUp) { finish(terminated: true) }
                    }
                }
            case .finishing:
                HStack { ProgressView(); Text(Copy.Proof.photoReviewing) }
                    .font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            case .idle:
                PrimaryButton(Copy.Proof.timerStart) { Task { await start() } }
            case .failed(let msg):
                Text(msg).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
                PrimaryButton(Copy.Proof.timerStart) { Task { await start() } }
            }
            if let err = errorMessage {
                Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
            }
        }
        .padding(.horizontal, DS.Space.lg)
        .padding(.vertical, DS.Space.lg)
        .onAppear { UIApplication.shared.isIdleTimerDisabled = true; vm.container = container }
        .onDisappear { UIApplication.shared.isIdleTimerDisabled = false; vm.tick.invalidate(); vm.heartbeatTimer?.invalidate() }
        .onChange(of: scenePhase) { _, phase in
            vm.handleScenePhase(phase)
        }
        .task { await start() }
    }

    private func start() async {
        do {
            try await vm.start(occurrenceId: occurrence.id)
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }

    private func finish(terminated: Bool) {
        switch vm.state {
        case .running: break
        default: return
        }
        Task {
            do {
                let result = try await vm.finish(terminated: terminated)
                await MainActor.run {
                    Analytics.track(.verification_submitted, ["method": "timer"])
                    onResult(result)
                }
            } catch {
                await MainActor.run { errorMessage = UserFacingError.message(error) }
            }
        }
    }

    private func formatRemaining(_ seconds: Int) -> String {
        let s = max(0, seconds)
        let m = s / 60
        let r = s % 60
        return String(format: "%02d:%02d", m, r)
    }
}

// MARK: - Ring UI

private struct RingTimer: View {
    let elapsed: Int
    let planned: Int
    var body: some View {
        let progress = planned > 0 ? min(1.0, Double(elapsed) / Double(planned)) : 0
        ZStack {
            Circle().stroke(DS.Color.divider, lineWidth: 12)
            Circle()
                .trim(from: 0, to: progress)
                .stroke(DS.Color.primary, style: StrokeStyle(lineWidth: 12, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .animation(.linear(duration: 0.5), value: progress)
        }
    }
}

// MARK: - VM

@MainActor
final class TimerProofVM: ObservableObject {
    enum State { case idle, starting, running, finishing, failed(String) }

    @Published var state: State = .idle
    @Published var startedAt: Date?
    @Published var plannedSeconds: Int?
    @Published var now: Date = Date()
    var container: AppContainer?
    var tick: Timer = Timer()
    var heartbeatTimer: Timer?
    private var sessionId: String?
    private var backgroundEventCount: Int = 0

    func elapsedFor(now: Date) -> Int {
        guard let s = startedAt else { return 0 }
        return max(0, Int(now.timeIntervalSince(s)))
    }
    func remainingFor(now: Date) -> Int {
        guard let planned = plannedSeconds else { return 0 }
        return max(0, planned - elapsedFor(now: now))
    }
    var canFinish: Bool {
        remainingFor(now: now) == 0
    }

    func start(occurrenceId: String) async throws {
        guard let c = container else { return }
        if case .running = state { return }
        if case .starting = state { return }
        if case .finishing = state { return }
        state = .starting
        let started = try await c.timerAPI.start(occurrenceId: occurrenceId)
        self.sessionId = started.sessionId
        self.startedAt = started.serverStartedAt
        self.plannedSeconds = started.plannedDurationSeconds
        state = .running
        startTicker()
        startHeartbeats()
    }

    func finish(terminated: Bool) async throws -> VerificationResultResponse {
        guard let c = container, let sid = sessionId else {
            throw APIError(code: "TIMER_LOCAL", message: "세션이 없어요.", httpStatus: 0)
        }
        state = .finishing
        heartbeatTimer?.invalidate()
        tick.invalidate()
        let r = try await c.timerAPI.finish(sessionId: sid, terminated: terminated)
        return r
    }

    private func startTicker() {
        tick.invalidate()
        tick = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.now = Date() }
        }
    }

    private func startHeartbeats() {
        heartbeatTimer?.invalidate()
        // 15 second cadence — the server tolerates gaps up to a policy value
        // (see backend TimerVerifier). Long gaps map to UNCERTAIN, not FAIL.
        heartbeatTimer = Timer.scheduledTimer(withTimeInterval: 15, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self, let c = self.container, let sid = self.sessionId else { return }
                let bg = self.backgroundEventCount
                self.backgroundEventCount = 0
                _ = try? await c.timerAPI.heartbeat(sessionId: sid, backgroundEvents: bg > 0 ? bg : nil)
            }
        }
    }

    func handleScenePhase(_ phase: ScenePhase) {
        if phase != .active { backgroundEventCount += 1 }
    }
}
