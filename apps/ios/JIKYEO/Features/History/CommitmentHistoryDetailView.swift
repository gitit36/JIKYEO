import SwiftUI

struct CommitmentHistoryDetailView: View {
    let commitmentId: String
    let preview: CommitmentAPI.MyCommitment
    @EnvironmentObject private var container: AppContainer
    @State private var detail: CommitmentAPI.CommitmentDetail?
    @State private var submitting: AppealSummary?
    @State private var errorMessage: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                if let m = (detail?.money ?? preview.money) {
                    MoneySummary(money: m)
                }
                ForEach(occurrences) { occ in
                    OccurrenceAppealCard(occurrence: occ, mode: detail?.enforcementMode ?? preview.enforcementMode) {
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
        .task { await load() }
        .sheet(item: $submitting) { row in
            AppealSubmitSheet(occurrenceId: row.occurrenceId) {
                submitting = nil
                Task { await load() }
            }
        }
    }

    private var occurrences: [CommitmentAPI.OccurrenceDetail] {
        detail?.occurrences ?? []
    }

    private func load() async {
        do {
            detail = try await container.commitmentAPI.getOne(id: commitmentId)
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
    let onAppeal: () -> Void

    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                Text("\(occurrence.sequenceNo)회차")
                    .font(Typo.bodyStrong)
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
