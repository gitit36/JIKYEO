import Foundation
import SwiftUI

public struct TodayOccurrenceModel: Identifiable, Equatable {
    public let id: String
    public let commitmentId: String
    public let commitmentTitle: String
    public let verificationMethod: VerificationMethod
    public let methodLabel: String
    public let enforcementMode: EnforcementMode
    public let status: String
    public let deadlineAt: Date
    /// `0` for SELF/SOCIAL (no money). MONEY commitments carry >0.
    public let stakeKrw: Int64
    public let chipKind: StatusChip.Kind
    public let showsProofCTA: Bool
    public let friendVerifyStatus: String?
    public let friendVerifyName: String?

    public var isMoneyCommitment: Bool { enforcementMode == .money }

    public init(
        id: String,
        commitmentId: String,
        commitmentTitle: String,
        verificationMethod: VerificationMethod,
        methodLabel: String,
        enforcementMode: EnforcementMode,
        status: String,
        deadlineAt: Date,
        stakeKrw: Int64,
        chipKind: StatusChip.Kind,
        showsProofCTA: Bool,
        friendVerifyStatus: String? = nil,
        friendVerifyName: String? = nil
    ) {
        self.id = id
        self.commitmentId = commitmentId
        self.commitmentTitle = commitmentTitle
        self.verificationMethod = verificationMethod
        self.methodLabel = methodLabel
        self.enforcementMode = enforcementMode
        self.status = status
        self.deadlineAt = deadlineAt
        self.stakeKrw = stakeKrw
        self.chipKind = chipKind
        self.showsProofCTA = showsProofCTA
        self.friendVerifyStatus = friendVerifyStatus
        self.friendVerifyName = friendVerifyName
    }
}

@MainActor
public final class HomeViewModel: ObservableObject {
    /// Sum of at-risk KRW for **today** — MONEY commitments only.
    @Published public var atRiskKrw: Int64 = 0
    /// Total number of today's occurrences (SELF + SOCIAL + MONEY).
    @Published public var todayCount: Int = 0
    /// Number of today's occurrences that carry money.
    @Published public var moneyCount: Int = 0
    @Published public var items: [TodayOccurrenceModel] = []
    @Published public var errorMessage: String?

    /// True when Home should show a money hero row. False → we hide the
    /// financial hero completely (no "0원 걸림"). Non-money commitments still
    /// render normally in the list.
    public var showsMoneyHero: Bool { moneyCount > 0 }

    public init() {}

    public func load(container: AppContainer) async {
        do {
            let today = try await container.occurrenceAPI.today(timezone: TimeZone.current.identifier)
            self.atRiskKrw = Int64(today.atRiskKrw) ?? 0
            self.todayCount = today.count
            self.moneyCount = today.moneyCount
            self.items = today.items.map { i in
                let method = VerificationMethod(rawValue: i.verificationMethod) ?? .self
                return TodayOccurrenceModel(
                    id: i.id,
                    commitmentId: i.commitmentId,
                    commitmentTitle: i.commitmentTitle,
                    verificationMethod: method,
                    methodLabel: method.label,
                    enforcementMode: i.enforcementMode,
                    status: i.status,
                    deadlineAt: i.deadlineAt,
                    stakeKrw: Int64(i.stakeAmountKrw ?? "0") ?? 0,
                    chipKind: chip(for: i.status),
                    showsProofCTA: ["active", "scheduled", "uncertain"].contains(i.status)
                        && (method != .friend || i.friendVerifyStatus == nil),
                    friendVerifyStatus: i.friendVerifyStatus,
                    friendVerifyName: i.friendVerifyName
                )
            }
        } catch {
            errorMessage = (error as? APIError)?.message ?? "홈을 불러오지 못했어요."
        }
    }

    #if DEBUG
    /// Debug fixture that mirrors the mixed SELF + MONEY view we visually QA:
    /// only MONEY items contribute to `atRiskKrw`.
    public func mockLoaded() {
        atRiskKrw = 15_000
        todayCount = 3
        moneyCount = 2
        items = [
            TodayOccurrenceModel(
                id: "d1", commitmentId: "c1", commitmentTitle: "헬스장 가기",
                verificationMethod: .gps, methodLabel: Copy.Wizard.methodGps,
                enforcementMode: .money, status: "scheduled",
                deadlineAt: Date().addingTimeInterval(3600 * 3),
                stakeKrw: 5_000, chipKind: .scheduled, showsProofCTA: true,
                friendVerifyStatus: nil, friendVerifyName: nil
            ),
            TodayOccurrenceModel(
                id: "d2", commitmentId: "c2", commitmentTitle: "60분 공부하기",
                verificationMethod: .timer, methodLabel: Copy.Wizard.methodTimer,
                enforcementMode: .self, status: "active",
                deadlineAt: Date().addingTimeInterval(3600 * 6),
                stakeKrw: 0, chipKind: .inProgress, showsProofCTA: true,
                friendVerifyStatus: nil, friendVerifyName: nil
            ),
            TodayOccurrenceModel(
                id: "d3", commitmentId: "c3", commitmentTitle: "명상 20분",
                verificationMethod: .timer, methodLabel: Copy.Wizard.methodTimer,
                enforcementMode: .money, status: "scheduled",
                deadlineAt: Date().addingTimeInterval(3600 * 8),
                stakeKrw: 10_000, chipKind: .scheduled, showsProofCTA: true,
                friendVerifyStatus: nil, friendVerifyName: nil
            ),
        ]
    }
    #endif

    private func chip(for status: String) -> StatusChip.Kind {
        switch status {
        case "scheduled":         return .scheduled
        case "active":            return .inProgress
        case "evidence_submitted": return .reviewing
        case "reviewing":         return .reviewing
        case "pass":              return .pass
        case "uncertain":         return .uncertain
        case "fail":              return .fail
        case "void":              return .void
        case "system_hold":       return .reviewing
        default:                  return .scheduled
        }
    }
}
