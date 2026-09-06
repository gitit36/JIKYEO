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
                    Text(err).font(Typo.caption).foregroundStyle(DS.Color.moneyLost)
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
        let bind = p.bindingOccurrenceCount ?? 0
        let voids = p.voidOccurrenceCount ?? 0
        let amt = p.futureRefundableAmountKrw ?? "0"
        return "\(Copy.Cancel.moneyNotice)\n\(Copy.Cancel.moneyBinding(bind))\n\(Copy.Cancel.moneyRefund(voids, Self.formatKrw(amt)))"
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
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "불러오지 못했어요. 다시 시도해주세요."
        }
    }

    private func confirmCancel() async {
        cancelling = true
        defer { cancelling = false }
        do {
            cancelResult = try await container.commitmentAPI.cancel(commitmentId: commitmentId)
            await load()
            await refreshCancelBanner()
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "불러오지 못했어요. 다시 시도해주세요."
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
            for occ in detail?.occurrences ?? [] {
                let items = (try? await container.evidenceAPI.list(occurrenceId: occ.id)) ?? []
                if items.contains(where: { $0.status == "deleted" }) {
                    deleted.insert(occ.id)
                }
            }
            deletedEvidence = deleted
            errorMessage = nil
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "불러오지 못했어요. 다시 시도해주세요."
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

private struct AppealSubmitSheet: View {
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
        }
    }

    private func submit() async {
        busy = true
        defer { busy = false }
        do {
            _ = try await container.appealAPI.submit(
                occurrenceId: occurrenceId,
                category: category,
                explanation: explanation.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            onDone()
        } catch let e as APIError {
            errorMessage = e.message
        } catch {
            errorMessage = "제출하지 못했어요. 다시 시도해주세요."
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
            if let reason = appeal.rejectReason, !reason.isEmpty {
                return "\(Copy.Appeal.rejectedPrefix) · \(reason)"
            }
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
                    } else {
                        Text(Copy.Cancel.moneyNotice).font(Typo.title)
                        Text(Copy.Cancel.moneyBinding(1)).font(Typo.body)
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
                        Text(Copy.Cancel.scheduled).font(Typo.title)
                        Text(Copy.Cancel.moneyNotice).font(Typo.body)
                        Text(Copy.Cancel.moneyBinding(1)).font(Typo.body)
                        Text(Copy.Cancel.moneyRefund(4, "20,000")).font(Typo.body)
                        Text(Copy.Cancel.effective("2026-09-15 21:00")).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                        Text(Copy.Cancel.futureRefund("20000")).font(Typo.caption)
                    } else {
                        Text(Copy.Cancel.scheduled).font(Typo.title)
                        Text("VOID 4 · FAIL 1").font(Typo.body)
                        Text(Copy.Cancel.futureRefund("20000")).font(Typo.body)
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
