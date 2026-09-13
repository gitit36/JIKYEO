import SwiftUI

/// "기록" tab — every commitment the user has made, with the server-derived
/// money state for MONEY commitments (결제 중 · 약속금 걸림 · 환불 예정 ·
/// 환불 중 · 환불 완료 · 결제 실패 · 환불 지연 · 정산 완료). SELF/SOCIAL
/// rows never show money UI.
struct HistoryView: View {
    @EnvironmentObject private var container: AppContainer
    @StateObject private var model = HistoryViewModel()
    let debugStage: String?
    init(debugStage: String? = nil) { self.debugStage = debugStage }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    if model.items.isEmpty && !model.isLoading {
                        Text("지금까지 지킨 약속이 여기 모여요.")
                            .font(Typo.body)
                            .foregroundStyle(DS.Color.textSecondary)
                        Card {
                            VStack(alignment: .leading, spacing: DS.Space.xs) {
                                Text("아직 만든 약속이 없어요.")
                                    .font(Typo.bodyStrong)
                                Text("첫 약속을 만들면 여기에서 볼 수 있어요.")
                                    .font(Typo.caption)
                                    .foregroundStyle(DS.Color.textSecondary)
                            }
                        }
                    }
                    ForEach(model.items) { item in
                        NavigationLink {
                            CommitmentHistoryDetailView(commitmentId: item.id, preview: item)
                        } label: {
                            CommitmentHistoryCard(item: item, onRetryRefund: {
                                Task { await model.retryRefund(item.id, container: container) }
                            })
                        }
                        .buttonStyle(.plain)
                    }
                    if model.isLoading { ProgressView().frame(maxWidth: .infinity) }
                    if let err = model.errorMessage {
                        ErrorRetryBanner(message: err) { Task { await model.load(container: container) } }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("기록")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.load(container: container) }
            .task {
                #if DEBUG
                if debugStage == "history-money" { model.mockLoaded(); return }
                #endif
                await model.load(container: container)
            }
        }
    }
}

@MainActor
final class HistoryViewModel: ObservableObject {
    @Published var items: [CommitmentAPI.MyCommitment] = []
    @Published var isLoading = false
    @Published var errorMessage: String?

    func load(container: AppContainer) async {
        isLoading = true
        defer { isLoading = false }
        do {
            items = try await container.commitmentAPI.listMine()
            errorMessage = nil
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }

    /// 환불 지연 → 다시 시도. Server-side settlement is idempotent.
    func retryRefund(_ commitmentId: String, container: AppContainer) async {
        _ = try? await container.paymentAPI.settle(commitmentId: commitmentId)
        await load(container: container)
    }

    #if DEBUG
    func mockLoaded() {
        func money(_ s: MoneyStatus, refundable: String, forfeited: String, paid: String) -> MoneyView {
            MoneyView(status: s, label: s.label, perOccurrenceKrw: "5000", upfrontKrw: "15000",
                      refundableKrw: refundable, forfeitedKrw: forfeited, refundPaidKrw: paid, depositKrw: s == .payment_failed || s == .payment_pending ? "0" : "15000")
        }
        func row(_ id: String, _ title: String, _ status: String, _ mode: EnforcementMode, _ m: MoneyView?) -> CommitmentAPI.MyCommitment {
            CommitmentAPI.MyCommitment(id: id, title: title, category: "workout", status: status, enforcementMode: mode,
                                       timezone: "Asia/Seoul", maxLossKrw: m?.upfrontKrw, verificationMethod: "gps",
                                       perOccurrenceKrw: m?.perOccurrenceKrw, occurrenceCount: 3, money: m,
                                       signatureExpiresAt: nil, cancellationReason: nil,
                                       cancellationRequestedAt: nil, cancellationEffectiveAt: nil, appeals: nil)
        }
        items = [
            row("c1", "헬스장 가기",        "active",          .money, money(.funded, refundable: "5000", forfeited: "0", paid: "0")),
            row("c2", "매일 60분 공부하기", "active",          .self,  nil),
            row("c3", "물 2L 마시기",       "completed",       .money, money(.refunded, refundable: "10000", forfeited: "5000", paid: "10000")),
            row("c4", "아침 7시 기상",      "completed",       .money, money(.refund_delayed, refundable: "10000", forfeited: "5000", paid: "0")),
            row("c5", "독서 30분",          "payment_pending", .money, money(.payment_failed, refundable: "0", forfeited: "0", paid: "0")),
            row("c6", "러닝 3km",           "completed",       .money, money(.refund_in_progress, refundable: "15000", forfeited: "0", paid: "0")),
            row("c7", "영양제 챙기기",      "completed",       .money, money(.settled_no_refund, refundable: "0", forfeited: "15000", paid: "0")),
        ]
    }
    #endif
}

private struct CommitmentHistoryCard: View {
    let item: CommitmentAPI.MyCommitment
    let onRetryRefund: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                HStack(alignment: .firstTextBaseline) {
                    Text(item.title).font(Typo.heading).foregroundStyle(DS.Color.text)
                    Spacer()
                    if let m = item.money {
                        MoneyStatusChip(m.status)
                    } else {
                        Text(modeLabel).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                    }
                }
                HStack(spacing: DS.Space.xs) {
                    Text(statusLabel).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                    Text("·").foregroundStyle(DS.Color.textMuted)
                    Text("\(item.occurrenceCount)회").font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                }
                if let m = item.money {
                    MoneySummary(money: m)
                    if m.status == .refund_delayed {
                        Text("환불이 조금 늦어지고 있어요. 자동으로 다시 시도하고 있어요.")
                            .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                        SecondaryButton("환불 다시 시도", action: onRetryRefund)
                    }
                }
                if let line = AppealCopy.listLine(item.appeals) {
                    Text(line)
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                }
            }
        }
    }

    private var modeLabel: String {
        switch item.enforcementMode {
        case .self:   return "나만 확인"
        case .social: return "친구와 함께"
        case .money:  return "약속금"
        }
    }

    private var statusLabel: String {
        switch item.status {
        case "payment_pending":    return "결제 대기"
        case "signature_pending":  return "서명 대기"
        case "active":
            return item.cancellationEffectiveAt == nil ? "진행 중" : Copy.Cancel.scheduled
        case "completed":       return "끝난 약속"
        case "cancelled":       return "취소됨"
        default:                return "진행 중"
        }
    }
}

/// Money numbers straight from the ledger. Refundable/forfeited only grow as
/// settlement runs; a behavioral FAIL alone changes nothing here.
struct MoneySummary: View {
    let money: MoneyView
    var body: some View {
        VStack(spacing: DS.Space.xxs) {
            switch money.status {
            case .payment_pending, .payment_failed:
                CardRow("결제 예정 금액", value: MoneyText.format(krw(money.upfrontKrw)))
            case .funded:
                CardRow("걸린 약속금", value: MoneyText.format(krw(money.upfrontKrw)))
                if krw(money.refundableKrw) > 0 {
                    CardRow("지금까지 지킨 금액", value: MoneyText.format(krw(money.refundableKrw)))
                }
            case .refund_scheduled, .refund_in_progress, .refund_delayed:
                CardRow("환불 예정 금액", value: MoneyText.format(refundDue))
                if krw(money.forfeitedKrw) > 0 {
                    CardRow("돌려받지 못한 금액", value: MoneyText.format(krw(money.forfeitedKrw)))
                }
            case .refunded where krw(money.refundPaidKrw) == 0:
                Text("환불 0원 · 돌려받지 못한 약속금 \(MoneyText.format(krw(money.forfeitedKrw)))")
                    .font(Typo.caption)
                    .foregroundStyle(DS.Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            case .refunded:
                CardRow("환불된 금액", value: MoneyText.format(krw(money.refundPaidKrw)))
                if krw(money.forfeitedKrw) > 0 {
                    CardRow("돌려받지 못한 금액", value: MoneyText.format(krw(money.forfeitedKrw)))
                }
            case .settled_no_refund:
                Text("환불 0원 · 돌려받지 못한 약속금 \(MoneyText.format(krw(money.forfeitedKrw)))")
                    .font(Typo.caption)
                    .foregroundStyle(DS.Color.textSecondary)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
    private var refundDue: Int64 {
        let earned = krw(money.refundableKrw)
        if earned > 0 { return earned }
        return max(0, krw(money.depositKrw) - krw(money.forfeitedKrw) - krw(money.refundPaidKrw))
    }
    private func krw(_ s: String) -> Int64 { Int64(s) ?? 0 }
}
