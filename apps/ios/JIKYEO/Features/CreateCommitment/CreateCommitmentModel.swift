import Foundation
import SwiftUI

/// State machine for the wizard. Each step maps to a distinct SwiftUI view.
/// Money and social steps are skipped based on `enforcementMode`.
public enum WizardStep: Int, CaseIterable {
    case goal = 0
    case schedule
    case verification
    case proofRule
    case enforcement       // "어떻게 지키게 만들까요?"
    case stake             // MONEY only
    case observer          // SOCIAL only
    case review
    case payment           // MONEY only (mock in Phase 3)
    case signature
    case done
}

@MainActor
public final class CreateCommitmentModel: ObservableObject {
    // MARK: - Step · goal
    @Published public var template: CommitmentTemplate = CommitmentTemplates.all[0]
    @Published public var customTitle: String = ""

    // MARK: - Step · schedule
    @Published public var scheduleType: ScheduleType = .daily
    @Published public var days: Set<Weekday> = []
    @Published public var timesPerWeek: Int = 3
    @Published public var startDate: Date = Date()
    @Published public var endDate: Date = Date().addingTimeInterval(60 * 60 * 24 * 6) // +6 days -> 7 days incl.
    @Published public var windowStartLocalTime: String = "09:00"
    @Published public var deadlineLocalTime: String = "21:00"

    // MARK: - Step · verification
    @Published public var verificationMethod: VerificationMethod = .photo

    // MARK: - Step · proof rule detail
    @Published public var timerMinutes: Int = 30
    @Published public var gpsRadiusM: Int = 150
    /// GPS coordinates are intentionally optional and default to `nil`.
    /// A real value is only set by the MapKit picker or the DEBUG-only mock.
    /// The server rejects activations without an explicit user selection.
    @Published public var gpsTarget: GpsTargetPayload?

    // MARK: - Step · enforcement (NEW)
    @Published public var enforcementMode: EnforcementMode = .money

    // MARK: - Step · stake (MONEY only)
    @Published public var stakePerOccurrenceKrw: Int = 5_000
    /// Server-authoritative policy fetched on entry to the enforcement step.
    /// The client never invents limits. See PRD §7 and SRD §SR-FR-003b.
    @Published public var stakePolicy: StakePolicyResponse?

    // MARK: - Step · observer (SOCIAL only)
    public enum ObserverMode: String, CaseIterable, Identifiable {
        case onlyMe, share, verify
        public var id: String { rawValue }
    }
    @Published public var observerMode: ObserverMode = .onlyMe

    // MARK: - Step · quote + safety
    @Published public var quote: QuoteResponse?
    @Published public var safety: SafetyResponse?
    @Published public var isLoadingQuote = false
    @Published public var errorMessage: String?

    // MARK: - Signature ritual
    //
    // We intentionally do NOT hold the raw drawing anywhere in this model.
    // The strokes live inside `SignatureCanvas` only and are discarded when
    // the view goes away. The server records `signedAt`, `signatureCompleted`
    // and `contractVersion` — that is all the signature ever produces.

    // MARK: - Step navigation
    @Published public var step: WizardStep = .goal
    @Published public var isSubmitting = false
    @Published public var createdCommitmentId: String?
    @Published public var createdEnforcementMode: EnforcementMode = .self
    @Published public var createdMaxLossKrw: Int64 = 0

    public let timezone = TimeZone.current.identifier

    public init() {}

    // MARK: - Derivations

    public var title: String {
        template.id == "custom"
            ? (customTitle.isEmpty ? template.title : customTitle)
            : template.title
    }

    public var scheduleDates: (startISO: String, endISO: String) {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: timezone)
        return (f.string(from: startDate), f.string(from: endDate))
    }

    public var occurrenceCount: Int? { quote?.occurrenceCount }
    public var maxLossKrw: Int64 { Int64(quote?.maxLoss ?? "0") ?? 0 }

    /// Client-side estimate purely for UI feedback while a fresh quote loads.
    /// Never used to activate — the server quote is authoritative.
    public var estimatedOccurrences: Int {
        switch scheduleType {
        case .one_time: return 1
        case .daily:
            let cal = Calendar(identifier: .gregorian)
            let comps = cal.dateComponents([.day], from: startDate, to: endDate)
            return max(1, (comps.day ?? 0) + 1)
        case .specific_days:
            let cal = Calendar(identifier: .gregorian)
            let comps = cal.dateComponents([.day], from: startDate, to: endDate)
            let totalDays = max(1, (comps.day ?? 0) + 1)
            let weeks = Double(totalDays) / 7.0
            return max(1, Int((weeks * Double(days.count)).rounded()))
        case .x_per_week:
            let cal = Calendar(identifier: .gregorian)
            let comps = cal.dateComponents([.day], from: startDate, to: endDate)
            let totalDays = max(1, (comps.day ?? 0) + 1)
            let weeks = max(1.0, Double(totalDays) / 7.0)
            return max(1, Int((weeks * Double(timesPerWeek)).rounded()))
        case .custom:
            return 1
        }
    }

    /// Whether the currently selected stake per-occurrence * estimated count
    /// approaches the tier's per-commitment loss cap. Drives an extra "이게 맞아요?"
    /// confirmation before spending money the user might regret.
    public var isLargeMoneyCommitment: Bool {
        guard let p = stakePolicy else { return false }
        let est = Int64(stakePerOccurrenceKrw * estimatedOccurrences)
        return est >= Int64(Double(p.maxPerCommitmentKrw) * 0.8)
    }

    // MARK: - Actions

    public func adoptTemplate(_ t: CommitmentTemplate) {
        template = t
        scheduleType = t.defaultScheduleType
        days = Set(t.defaultDays)
        verificationMethod = t.defaultVerification
        timerMinutes = t.defaultTimerMinutes > 0 ? t.defaultTimerMinutes : 30
        gpsRadiusM = t.defaultGpsRadiusM > 0 ? t.defaultGpsRadiusM : 150
        gpsTarget = nil
        stakePerOccurrenceKrw = t.defaultStakeKrw
        windowStartLocalTime = t.defaultWindowStartLocalTime
        deadlineLocalTime = t.defaultDeadlineLocalTime
    }

    public func buildSchedulePayload() -> SchedulePayload {
        let dates = scheduleDates
        return SchedulePayload(
            type: scheduleType,
            startDate: dates.startISO,
            endDate: dates.endISO,
            windowStartLocalTime: windowStartLocalTime,
            deadlineLocalTime: deadlineLocalTime,
            days: scheduleType == .specific_days ? Array(days).sorted { $0.rawValue < $1.rawValue } : nil,
            timesPerWeek: scheduleType == .x_per_week ? timesPerWeek : nil,
            allowedDays: nil,
            dates: nil
        )
    }

    public func buildVerificationPayload() -> VerificationPayload {
        VerificationPayload(
            method: verificationMethod,
            gps: verificationMethod == .gps ? gpsTarget : nil,
            timerRequiredSeconds: verificationMethod == .timer ? timerMinutes * 60 : nil,
            hint: nil
        )
    }

    /// True only when the current wizard state is safe to submit to the server.
    /// - GPS activations require an explicitly user-selected location.
    /// - SOCIAL requires a real observer relation, which does not exist yet in
    ///   Release. In DEBUG we allow a mock friend so the whole flow can be
    ///   exercised.
    public var isSubmittable: Bool {
        if verificationMethod == .gps && (gpsTarget == nil || gpsTarget?.userSelected != true) {
            return false
        }
        if enforcementMode == .social {
            #if DEBUG
            return true
            #else
            return false
            #endif
        }
        return true
    }

    #if DEBUG
    /// Debug-only mock GPS location so we can exercise the flow without
    /// MapKit. It is stamped as user-selected but every call site clearly
    /// documents it as a DEBUG mock — never used in Release.
    public func applyDebugMockGps() {
        gpsTarget = GpsTargetPayload(
            lat: 37.5665,        // 서울 시청
            lng: 126.9780,
            radiusM: gpsRadiusM,
            userSelected: true,
            label: "DEBUG mock — 서울 시청"
        )
    }
    #endif

    public func loadStakePolicyIfNeeded(container: AppContainer) async {
        guard stakePolicy == nil else { return }
        do {
            stakePolicy = try await container.stakePolicyAPI.current()
            if let p = stakePolicy, !p.suggestedAmountsKrw.contains(stakePerOccurrenceKrw) {
                stakePerOccurrenceKrw = p.suggestedAmountsKrw.first ?? stakePerOccurrenceKrw
            }
        } catch {
            // Non-fatal — we can still surface the money screen with template defaults.
        }
    }

    public func refreshQuote(container: AppContainer) async {
        errorMessage = nil
        guard enforcementMode == .money else {
            // SELF/SOCIAL don't require a quote. Still run safety.
            self.safety = try? await container.safetyAPI.check(title: title)
            return
        }
        isLoadingQuote = true
        defer { isLoadingQuote = false }
        do {
            self.safety = try await container.safetyAPI.check(title: title)
            if safety?.decision == "blocked" {
                errorMessage = safety?.userMessage
                return
            }
            let req = QuoteRequest(
                schedule: buildSchedulePayload(),
                stakePerOccurrenceKrw: stakePerOccurrenceKrw,
                timezone: timezone
            )
            self.quote = try await container.commitmentAPI.quote(req)
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "다시 시도해주세요."
        }
    }

    public func submit(container: AppContainer) async {
        errorMessage = nil
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let req = buildCreateRequest()
            let result: CreateCommitmentResponse = try await container.commitmentAPI.create(req)
            createdCommitmentId = result.commitmentId
            createdEnforcementMode = result.enforcementMode
            createdMaxLossKrw = Int64(result.maxLossKrw ?? "0") ?? 0
            step = .done
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "다시 시도해주세요."
        }
    }

    private func buildCreateRequest() -> CreateCommitmentRequest {
        let stakeKrw: Int? = enforcementMode == .money ? stakePerOccurrenceKrw : nil
        let quoteId: String? = enforcementMode == .money ? quote?.quoteId : nil
        let observer: ObserverPayload? = {
            guard enforcementMode == .social else { return nil }
            #if DEBUG
            return ObserverPayload(observerUserId: "debug-friend", isVerifier: observerMode == .verify)
            #else
            return nil
            #endif
        }()
        return CreateCommitmentRequest(
            templateId: template.id,
            title: title,
            category: template.category,
            enforcementMode: enforcementMode,
            timezone: timezone,
            schedule: buildSchedulePayload(),
            verification: buildVerificationPayload(),
            stakePerOccurrenceKrw: stakeKrw,
            quoteId: quoteId,
            observer: observer
        )
    }
}
