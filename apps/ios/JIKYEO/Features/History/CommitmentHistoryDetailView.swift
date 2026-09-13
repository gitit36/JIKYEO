import SwiftUI

struct CommitmentHistoryDetailView: View {
    let commitmentId: String
    let preview: CommitmentAPI.MyCommitment
    @EnvironmentObject private var container: AppContainer
    @State private var detail: CommitmentAPI.CommitmentDetail?
    @State private var submitting: AppealSummary?
    @State private var errorMessage: String?
    @State private var deletedEvidence: Set<String> = []
    @State private var cancelPreview: CancelCommitmentResponse?
    @State private var cancelResult: CancelCommitmentResponse?
    @State private var confirming = false
    @State private var cancelling = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                if let m = (detail?.money ?? preview.money) {
                    MoneySummary(money: m)
                }
                if let scheduled = cancelBanner {
                    Card {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            Text(Copy.Cancel.scheduled).font(Typo.bodyStrong)
                            Text(Copy.Cancel.effective(scheduled.when)).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                            Text(Copy.Cancel.remaining(scheduled.binding)).font(Typo.caption)
                            if let amt = scheduled.refund {
                                Text(Copy.Cancel.futureRefund(amt)).font(Typo.caption)
                            }
                        }
                    }
                }
                if canCancel {
                    SecondaryButton(Copy.Cancel.cta) {
                        Task { await loadPreview() }
                    }
                }
                ForEach(occurrences) { occ in
                    OccurrenceAppealCard(
                        occurrence: occ,
                        mode: detail?.enforcementMode ?? preview.enforcementMode,
                        evidenceDeleted: deletedEvidence.contains(occ.id)
                    ) {
                        submitting = occ.appeal ?? AppealSummary(
                            occurrenceId: occ.id,
                            sequenceNo: occ.sequenceNo,
                            originalResult: occ.originalResult ?? occ.status,
                            effectiveResult: occ.effectiveResult ?? occ.status,
                            status: nil,
                            eligible: true,
                            rejectReason: nil,
                            supplementalRefundStatus: .none
                        )
                    }
                }
                if let err = errorMessage {
                    ErrorRetryBanner(message: err) { Task { await load() } }
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.lg)
        }
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
        .navigationTitle(preview.title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            await refreshCancelBanner()
        }
        .sheet(item: $submitting) { row in
            AppealSubmitSheet(occurrenceId: row.occurrenceId) {
                submitting = nil
                Task { await load() }
            }
        }
        .confirmationDialog(Copy.Cancel.cta, isPresented: $confirming, titleVisibility: .visible) {
            Button(Copy.Cancel.confirm) { Task { await confirmCancel() } }
            Button(Copy.Cancel.keep, role: .cancel) {}
        } message: {
            Text(confirmMessage)
        }
    }

    private var canCancel: Bool {
        let status = detail?.status ?? preview.status
        let effective = detail?.cancellationEffectiveAt ?? preview.cancellationEffectiveAt
        return status == "active" && effective == nil
    }

    private var cancelBanner: (when: String, binding: Int, refund: String?)? {
        let status = detail?.status ?? preview.status
        guard status == "active" else { return nil }
        if let r = cancelResult ?? cancelPreview, let at = r.effectiveAt {
            let refund = (detail?.enforcementMode ?? preview.enforcementMode) == .money
                ? r.futureRefundableAmountKrw.map(Self.formatKrw)
                : nil
            return (Self.formatWhen(at), r.bindingOccurrenceCount ?? 0, refund)
        }
        if let at = detail?.cancellationEffectiveAt ?? preview.cancellationEffectiveAt {
            return (Self.formatWhen(at), 0, nil)
        }
        return nil
    }

    private var confirmMessage: String {
        let mode = detail?.enforcementMode ?? preview.enforcementMode
        guard mode == .money, let p = cancelPreview else { return Copy.Cancel.selfConfirm }
        let refundable = Int64(p.futureRefundableAmountKrw ?? "0") ?? 0
        let stake = p.bindingAmountKrw ?? p.futureRefundableAmountKrw ?? "0"
        if refundable == 0 {
            return "\(Copy.Cancel.moneyStarted)\n\(Copy.Cancel.moneyAbandon(Self.formatKrw(stake)))"
        }
        return "\(Copy.Cancel.moneyPreStart)\n지금 그만두면 약속금 \(Self.formatKrw(p.futureRefundableAmountKrw ?? "0"))원은 전액 환불돼요."
    }

    private static func formatWhen(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 HH:mm"
        return f.string(from: date)
    }

    private static func formatKrw(_ raw: String) -> String {
        let formatted = MoneyText.format(Int64(raw) ?? 0)
        return formatted.hasSuffix("원") ? String(formatted.dropLast()) : formatted
    }

    private var occurrences: [CommitmentAPI.OccurrenceDetail] {
        detail?.occurrences ?? []
    }

    private func loadPreview() async {
        do {
            cancelPreview = try await container.commitmentAPI.cancelPreview(commitmentId: commitmentId)
            confirming = true
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }

    private func confirmCancel() async {
        cancelling = true
        defer { cancelling = false }
        do {
            cancelResult = try await container.commitmentAPI.cancel(commitmentId: commitmentId)
            await load()
            await refreshCancelBanner()
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }

    private func refreshCancelBanner() async {
        let status = detail?.status ?? preview.status
        let effective = detail?.cancellationEffectiveAt ?? preview.cancellationEffectiveAt
        guard status == "active", effective != nil || cancelResult != nil else { return }
        cancelPreview = try? await container.commitmentAPI.cancelPreview(commitmentId: commitmentId)
    }

    private func load() async {
        do {
            detail = try await container.commitmentAPI.getOne(id: commitmentId)
            var deleted = Set<String>()
            let candidates = (detail?.occurrences ?? []).filter { $0.status == "fail" || $0.appeal != nil }.prefix(8)
            for occ in candidates {
                let items = (try? await container.evidenceAPI.list(occurrenceId: occ.id)) ?? []
                if items.contains(where: { $0.status == "deleted" }) {
                    deleted.insert(occ.id)
                }
            }
            deletedEvidence = deleted
            errorMessage = nil
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }
}

private struct OccurrenceAppealCard: View {
    let occurrence: CommitmentAPI.OccurrenceDetail
    let mode: EnforcementMode
    var evidenceDeleted = false
    let onAppeal: () -> Void

    private static func formatDeadline(_ date: Date) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일 HH:mm"
        return f.string(from: date)
    }

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text("\(occurrence.sequenceNo)회차")
                    .font(Typo.bodyStrong)
                if mode == .money, occurrence.status == "fail", occurrence.appealDeadlineAt != nil, occurrence.appeal?.status == nil {
                    Text(Copy.Appeal.provisional)
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                    if let at = occurrence.appealDeadlineAt {
                        Text(Copy.Appeal.deadline(Self.formatDeadline(at)))
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textSecondary)
                    }
                }
                if mode == .money {
                    Text("원래 결과 · \(Copy.Appeal.resultLabel(occurrence.originalResult ?? occurrence.status))")
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                    if (occurrence.effectiveResult ?? occurrence.status) != (occurrence.originalResult ?? occurrence.status) {
                        Text("정정 결과 · \(Copy.Appeal.resultLabel(occurrence.effectiveResult ?? occurrence.status))")
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textSecondary)
                    }
                }
                if evidenceDeleted {
                    Text(Copy.Evidence.deleted)
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                }
                if let line = AppealCopy.stateLine(occurrence.appeal) {
                    Text(line)
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                }
                if mode == .money, occurrence.appeal?.eligible == true {
                    SecondaryButton(Copy.Appeal.cta, action: onAppeal)
                }
            }
        }
    }
}

struct AppealSubmitSheet: View {
    let occurrenceId: String
    let onDone: () -> Void
    @EnvironmentObject private var container: AppContainer
    @State private var category: AppealReasonCategory = .verification_error
    @State private var explanation = ""
    @State private var busy = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.Appeal.body)
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.textSecondary)
                Text(Copy.Appeal.reasonLabel).font(Typo.bodyStrong)
                ForEach(AppealReasonCategory.allCases) { item in
                    Button {
                        category = item
                    } label: {
                        HStack {
                            Text(item.label).font(Typo.body).foregroundStyle(DS.Color.text)
                            Spacer()
                            if category == item {
                                Image(systemName: "checkmark").foregroundStyle(DS.Color.primary)
                            }
                        }
                    }
                }
                Text(Copy.Appeal.explanationLabel).font(Typo.bodyStrong)
                TextField(Copy.Appeal.explanationHint, text: $explanation, axis: .vertical)
                    .lineLimit(3...6)
                    .textFieldStyle(.roundedBorder)
                if let err = errorMessage {
                    Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
                }
                PrimaryButton(
                    Copy.Appeal.submit,
                    isLoading: busy,
                    isDisabled: explanation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                ) {
                    Task { await submit() }
                }
                Spacer()
            }
            .padding(DS.Space.lg)
            .navigationTitle(Copy.Appeal.title)
            .navigationBarTitleDisplayMode(.inline)
            .onAppear { Analytics.track(.appeal_opened) }
        }
    }

    private func submit() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            _ = try await container.appealAPI.submit(
                occurrenceId: occurrenceId,
                category: category,
                explanation: explanation.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onDone()
        } catch {
            errorMessage = UserFacingError.message(error)
        }
    }
}

enum AppealCopy {
    static func listLine(_ appeals: [AppealSummary]?) -> String? {
        guard let appeals, let first = appeals.first(where: { $0.status != nil }) else { return nil }
        return stateLine(first)
    }

    static func stateLine(_ appeal: AppealSummary?) -> String? {
        guard let appeal, let status = appeal.status else { return nil }
        switch status {
        case .submitted, .reviewing:
            return Copy.Appeal.reviewing
        case .approved:
            return Copy.Appeal.approved(appeal.supplementalRefundStatus)
        case .rejected:
            return Copy.Appeal.rejectedPrefix
        }
    }
}

#if DEBUG
struct ComplianceDebugView: View {
    let stage: String
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    if stage == "terms-accept" {
                        Text(Copy.Terms.title).font(Typo.title)
                        Text(Copy.Terms.body).font(Typo.body)
                        Text(Copy.Terms.accept).font(Typo.bodyStrong)
                    } else if stage == "age-reject" {
                        Text(Copy.Age.rejected).font(Typo.body)
                    } else if stage == "fail-provisional" {
                        Text(Copy.Appeal.provisional).font(Typo.title)
                        Text(Copy.Appeal.deadline("9월 21일 21:00")).font(Typo.body)
                    } else if stage == "v1-grace-alive" {
                        Text(Copy.Wizard.graceUsed(1)).font(Typo.title)
                        Text(Copy.Wizard.stillKeep("30,000")).font(Typo.body)
                        Text(Copy.Wizard.reviewRefund("30,000")).font(Typo.body)
                    } else if stage == "v1-grace-exceeded" {
                        Text(Copy.Appeal.provisional).font(Typo.title)
                        Text("아직 환불하거나 몰수하지 않았어요.").font(Typo.body)
                        Text(Copy.Wizard.reviewFail).font(Typo.body)
                    } else if stage == "v1-cancel-pre" {
                        Text(Copy.Cancel.moneyPreStart).font(Typo.title)
                        Text("지금 그만두면 약속금 30,000원은 전액 환불돼요.").font(Typo.body)
                    } else if stage == "v1-cancel-post" {
                        Text(Copy.Cancel.moneyStarted).font(Typo.title)
                        Text(Copy.Cancel.moneyAbandon("30,000")).font(Typo.body)
                    } else if stage == "v1-makeup" {
                        Text("이번 주 헬스장 3회").font(Typo.title)
                        Text("월요일은 놓쳤지만 화·목·토에 지켰어요.").font(Typo.body)
                        Text("주 3회 조건은 충족됐고, 여유는 쓰지 않았어요.").font(Typo.body)
                    } else {
                        Text(Copy.Cancel.moneyNotice).font(Typo.title)
                    }
                }
                .padding(DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
        }
    }
}

struct CancelDebugView: View {
    let stage: String
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    if stage == "cancel-self" {
                        Text(Copy.Cancel.cta).font(Typo.title)
                        Text(Copy.Cancel.selfConfirm).font(Typo.body)
                        Text(Copy.Cancel.remaining(1)).font(Typo.caption)
                    } else if stage == "cancel-money" {
                        Text(Copy.Cancel.moneyStarted).font(Typo.title)
                        Text(Copy.Cancel.moneyAbandon("30,000")).font(Typo.body)
                    } else {
                        Text(Copy.Cancel.moneyPreStart).font(Typo.title)
                        Text("지금 그만두면 약속금 30,000원은 전액 환불돼요.").font(Typo.body)
                    }
                }
                .padding(DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle(Copy.Cancel.cta)
        }
    }
}
#endif
