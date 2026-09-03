import Foundation

/// Wire types shared between iOS and backend. Bigint money is transported as
/// String so we don't lose precision through JSON's Number.

public enum Weekday: String, Codable, CaseIterable, Identifiable {
    case MON, TUE, WED, THU, FRI, SAT, SUN
    public var id: String { rawValue }
    public var short: String { Copy.weekdayShort[rawValue] ?? rawValue }
}

public enum ScheduleType: String, Codable {
    case one_time, daily, specific_days, x_per_week, custom
}

public enum VerificationMethod: String, Codable, CaseIterable, Identifiable {
    case photo, gps, timer, `self`, friend, health, screen_time, timelapse
    public var id: String { rawValue }
    public var label: String {
        switch self {
        case .photo:  return Copy.Wizard.methodPhoto
        case .gps:    return Copy.Wizard.methodGps
        case .timer:  return Copy.Wizard.methodTimer
        case .self:   return Copy.Wizard.methodSelf
        case .friend: return Copy.Wizard.methodFriend
        case .health, .screen_time, .timelapse: return rawValue
        }
    }
}

public enum CommitmentCategory: String, Codable {
    case wakeup, workout, study, read, meditate, screen, custom
}

/// Enforcement strength chosen by the user. Governs whether the commitment
/// creates a Stake row and requires a server quote.
///
///   - `self`   → no Stake, no payment. User proves for themselves.
///   - `social` → no Stake, notifies an observer. (준비 중 in Release)
///   - `money`  → Stake required, server-authoritative quote required.
public enum EnforcementMode: String, Codable, CaseIterable, Identifiable {
    case `self`, social, money
    public var id: String { rawValue }
}

public struct SchedulePayload: Codable {
    public var type: ScheduleType
    public var startDate: String
    public var endDate: String
    public var windowStartLocalTime: String
    public var deadlineLocalTime: String
    public var days: [Weekday]?
    public var timesPerWeek: Int?
    public var allowedDays: [Weekday]?
    public var dates: [String]?
}

public struct QuoteRequest: Codable {
    public let schedule: SchedulePayload
    public let stakePerOccurrenceKrw: Int
    public let timezone: String
}

public struct QuoteResponse: Codable {
    public let quoteId: String
    public let occurrenceCount: Int
    public let stakePerOccurrence: String
    public let maxLoss: String
    public let currency: String
    public let quoteExpiresAt: Date
}

public struct GpsTargetPayload: Codable {
    public var lat: Double
    public var lng: Double
    public var radiusM: Int
    /// The client must set this to `true` only when the user explicitly picked
    /// a location. Server rejects the activation otherwise. There is no client
    /// default: the MapKit picker or a DEBUG-only mock is the only way to
    /// produce a truthy value.
    public var userSelected: Bool
    public var label: String?
}

public struct VerificationPayload: Codable {
    public var method: VerificationMethod
    public var gps: GpsTargetPayload?
    public var timerRequiredSeconds: Int?
    public var hint: String?
}

public struct ObserverPayload: Codable {
    public var observerUserId: String?
    public var isVerifier: Bool
}

public struct CreateCommitmentRequest: Codable {
    public let templateId: String?
    public let title: String
    public let category: CommitmentCategory
    public let enforcementMode: EnforcementMode
    public let timezone: String
    public let schedule: SchedulePayload
    public let verification: VerificationPayload
    /// MONEY-only. Never send for SELF/SOCIAL — the server rejects strays.
    public let stakePerOccurrenceKrw: Int?
    /// MONEY-only. Never send for SELF/SOCIAL.
    public let quoteId: String?
    public let observer: ObserverPayload?
}

public struct CreateCommitmentResponse: Codable {
    public let commitmentId: String
    /// `active` for SELF/SOCIAL. MONEY: `payment_pending` until charge, then `signature_pending` until `/sign`.
    public let status: String
    public let enforcementMode: EnforcementMode
    public let occurrenceCount: Int
    /// `null` for SELF/SOCIAL, numeric string for MONEY.
    public let maxLossKrw: String?
    /// True iff `POST /commitments/:id/pay` must succeed before the commitment is live.
    public let paymentRequired: Bool?
}

// MARK: - Payment / money status (Phase 4, MONEY only)

/// Derived money state of a MONEY commitment. Always computed server-side from
/// Stake + Payment + ledger — never from behavioral PASS/FAIL — so the UI can
/// never claim money was lost before settlement actually ran.
public enum MoneyStatus: String, Codable {
    case payment_pending      // 결제 중
    case payment_failed       // 결제 실패
    case funded               // 약속금 걸림
    case refund_scheduled     // 환불 예정
    case refund_in_progress   // 환불 중
    case refund_delayed       // 환불 지연
    case refunded             // 환불 완료
    case settled_no_refund    // 정산 완료

    public var label: String {
        switch self {
        case .payment_pending:    return "결제 중"
        case .payment_failed:     return "결제 실패"
        case .funded:             return "약속금 걸림"
        case .refund_scheduled:   return "환불 예정"
        case .refund_in_progress: return "환불 중"
        case .refund_delayed:     return "환불 지연"
        case .refunded:           return "환불 완료"
        case .settled_no_refund:  return "정산 완료"
        }
    }
}

public struct MoneyView: Codable {
    public let status: MoneyStatus
    public let label: String
    public let perOccurrenceKrw: String
    public let upfrontKrw: String
    public let refundableKrw: String
    public let forfeitedKrw: String
    public let refundPaidKrw: String
    public let depositKrw: String
}

public struct PaymentView: Codable {
    public let paymentId: String
    public let commitmentId: String?
    public let type: String        // charge | refund | cancel
    public let status: String      // requested | succeeded | failed | partial
    public let amountKrw: String
    public let provider: String
    public let failureCode: String?
    public let attempt: Int
}

public struct PayCommitmentRequest: Encodable {
    /// Dev/test only. Forces the mock PG to decline.
    public let simulate: String?
}

public struct PayCommitmentResponse: Codable {
    public let payment: PaymentView
    public let money: MoneyView?
}

public struct MoneyStatusResponse: Codable {
    public let money: MoneyView?
}

public struct SignCommitmentResponse: Codable {
    public let commitmentId: String
    public let status: String
    public let signedAt: Date
}

public struct SafetyResponse: Codable {
    public let decision: String  // "safe" | "stake_disallowed" | "blocked"
    public let reasonCode: String
    public let userMessage: String
}

public struct TodayOccurrenceDTO: Codable, Identifiable {
    public let id: String
    public let commitmentId: String
    public let commitmentTitle: String
    public let category: String
    public let verificationMethod: String
    public let enforcementMode: EnforcementMode
    public let sequenceNo: Int
    public let status: String
    public let windowStartAt: Date
    public let deadlineAt: Date
    /// `null` for SELF/SOCIAL, numeric string for MONEY.
    public let stakeAmountKrw: String?
}

public struct TodayResponse: Codable {
    /// Sum of MONEY-commitment stakes for today only. `"0"` when today has no MONEY.
    public let atRiskKrw: String
    /// How many of today's items are MONEY commitments.
    public let moneyCount: Int
    /// Total today count (SELF + SOCIAL + MONEY).
    public let count: Int
    public let items: [TodayOccurrenceDTO]
}

// MARK: - StakePolicy

public enum StakeTier: String, Codable {
    case tier_1, tier_2, tier_3
}

public struct StakePolicyResponse: Codable {
    public let currentTier: StakeTier
    public let maxPerOccurrenceKrw: Int
    public let maxPerCommitmentKrw: Int
    public let rollingMonthlyLossCapKrw: Int
    public let rollingMonthlyLossRemainingKrw: Int
    public let suggestedAmountsKrw: [Int]
}

// MARK: - Evidence / Verification

/// PASS / UNCERTAIN / FAIL — never a Boolean. Mirrors backend `VerificationResult.result`.
public enum VerificationOutcome: String, Codable {
    case pass, uncertain, fail
}

public struct SelfEvidencePayload: Codable {
    public enum Answer: String, Codable { case kept, missed }
    public let answer: Answer
}

public struct PhotoEvidencePayload: Codable {
    public let storageKey: String
    /// SHA-256 hex, lowercase.
    public let hash: String
    public let contentType: String?
    public let sizeBytes: Int?
    public let capturedAt: Date
}

public struct GpsEvidencePayload: Codable {
    public let lat: Double
    public let lng: Double
    public let accuracyM: Double
    public let capturedAt: Date
    public let mockLocationSuspected: Bool?
}

public struct SubmitEvidenceRequest: Codable {
    public enum Kind: String, Codable { case photo, gps, `self` }
    public let kind: Kind
    public let photo: PhotoEvidencePayload?
    public let gps: GpsEvidencePayload?
    public let `self`: SelfEvidencePayload?

    public static func photo(_ p: PhotoEvidencePayload) -> Self {
        Self(kind: .photo, photo: p, gps: nil, self: nil)
    }
    public static func gps(_ g: GpsEvidencePayload) -> Self {
        Self(kind: .gps, photo: nil, gps: g, self: nil)
    }
    public static func selfAnswer(_ answer: SelfEvidencePayload.Answer) -> Self {
        Self(kind: .self, photo: nil, gps: nil, self: SelfEvidencePayload(answer: answer))
    }
}

/// Response from `POST /occurrences/:id/evidence` and `POST /timer/sessions/:id/finish`.
/// Structured so screens can render mode-aware UX (see PRD §14 Result UX).
public struct VerificationResultResponse: Codable {
    public let occurrenceId: String
    public let resultId: String
    public let result: VerificationOutcome
    public let reasonCode: String
    public let userMessage: String
    public let confidence: Double?
    public let isMoneyCommitment: Bool
}

/// Response from `GET /occurrences/:id/result`.
public struct OccurrenceResultResponse: Codable {
    public let occurrenceId: String
    public let status: String
    public let enforcementMode: EnforcementMode
    public let commitmentTitle: String
    public let stakeKrw: String?
    public let result: VerificationOutcome?
    public let reasonCode: String?
    public let userMessage: String?
    public let decidedAt: Date?
}

public struct UploadTicketResponse: Codable {
    public let uploadUrl: String
    public let storageKey: String
    public let expiresAt: Date
}

// MARK: - Focus Timer

public struct TimerStartResponse: Codable {
    public let sessionId: String
    public let serverStartedAt: Date
    public let plannedDurationSeconds: Int
}

public struct TimerHeartbeatResponse: Codable {
    public let sessionId: String
    public let serverNow: Date
    public let heartbeatCount: Int
    public let maxGapSeconds: Int
}
