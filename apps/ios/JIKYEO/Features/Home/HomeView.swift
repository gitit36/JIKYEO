import SwiftUI

/// Home / Today. PRD §13. Adapts to whether today has any MONEY commitments.
/// When there are no MONEY items we deliberately do NOT show a "0원" hero —
/// the summary drops the financial line entirely.
struct HomeView: View {
    let debugStage: String?
    init(debugStage: String? = nil) { self.debugStage = debugStage }
    @EnvironmentObject private var container: AppContainer
    @StateObject private var model = HomeViewModel()
    @State private var isCreating = false
    @State private var proofFor: TodayOccurrenceModel?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Hero(count: model.todayCount, moneyCount: model.moneyCount, atRiskKrw: model.atRiskKrw)
                    if let err = model.errorMessage, !model.items.isEmpty {
                        ErrorRetryBanner(message: err) { Task { await model.load(container: container) } }
                    }
                    if model.isLoading && model.items.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, DS.Space.lg)
                    } else if let err = model.errorMessage, model.items.isEmpty {
                        ErrorRetryBanner(message: err) { Task { await model.load(container: container) } }
                    } else if model.items.isEmpty {
                        EmptyToday(onCreate: { isCreating = true })
                    } else {
                        ForEach(model.items) { item in
                            TodayCard(item: item) {
                                proofFor = item
                            }
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("지켜")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.load(container: container) }
            .task {
                #if DEBUG
                if debugStage == "home-loaded" { model.mockLoaded(); return }
                if debugStage == "home-empty" { return }
                #endif
                await model.load(container: container)
                if CreateCommitmentModel.pendingUnsignedId() != nil {
                    isCreating = true
                }
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isCreating = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Copy.Home.createCTA)
                    .tint(DS.Color.primary)
                }
            }
            .sheet(isPresented: $isCreating, onDismiss: { Task { await model.load(container: container) } }) {
                CreateCommitmentWizardView()
                    .environmentObject(container)
            }
            .sheet(item: $proofFor, onDismiss: { Task { await model.load(container: container) } }) { occ in
                ProofFlowView(occurrence: occ)
                    .environmentObject(container)
            }
        }
    }
}

/// Top summary. When today has zero money commitments we omit the money line
/// entirely — no "0원" line, no muted-primary hero. See PRD §13.
private struct Hero: View {
    let count: Int
    let moneyCount: Int
    let atRiskKrw: Int64
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(Copy.Home.greeting)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
            if count == 0 {
                // Empty today gets its own EmptyToday card below.
                Text(Copy.Home.noneToday)
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
            } else if moneyCount > 0 {
                Text(Copy.Home.todayCountAndMoney(count))
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
                HStack(alignment: .firstTextBaseline, spacing: DS.Space.sm) {
                    Text(Copy.Home.atRiskLabel)
                        .font(Typo.body)
                        .foregroundStyle(DS.Color.textSecondary)
                    Spacer()
                    MoneyText(atRiskKrw, intent: .atRisk, size: .hero)
                }
            } else {
                Text(Copy.Home.todayCountOnly(count))
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
            }
        }
    }
}

private struct EmptyToday: View {
    let onCreate: () -> Void
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.Home.noneToday)
                    .font(Typo.bodyStrong)
                    .foregroundStyle(DS.Color.text)
                Text(Copy.Home.noneMessage)
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.textSecondary)
                PrimaryButton(Copy.Home.createCTA, action: onCreate)
            }
        }
    }
}

private struct TodayCard: View {
    let item: TodayOccurrenceModel
    let onProof: () -> Void
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.sm) {
                HStack {
                    Text(item.commitmentTitle)
                        .font(Typo.heading)
                        .foregroundStyle(DS.Color.text)
                    Spacer()
                    StatusChip(item.chipKind)
                }
                HStack(spacing: DS.Space.sm) {
                    Text(item.methodLabel)
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                    Text("·")
                        .foregroundStyle(DS.Color.textMuted)
                    CountdownText(deadline: item.deadlineAt)
                }
                if item.isMoneyCommitment && item.stakeKrw > 0 {
                    HStack {
                        MoneyText(item.stakeKrw, intent: .atRisk, size: .body)
                        Text("걸림")
                            .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                        Spacer()
                    }
                }
                if let name = item.friendVerifyName {
                    if item.friendVerifyStatus == "pending" {
                        Text(Copy.Friends.waiting(name)).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    } else if item.friendVerifyStatus == "approved" {
                        Text(Copy.Friends.approved(name)).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    } else if item.friendVerifyStatus == "rejected" {
                        Text(Copy.Friends.rejected(name)).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    }
                }
                if item.showsProofCTA {
                    PrimaryButton(proofCtaLabel(for: item), action: onProof)
                } else if item.verificationMethod == .friend, item.friendVerifyStatus == "rejected", item.isMoneyCommitment {
                    PrimaryButton(Copy.Appeal.cta, action: onProof)
                }
            }
        }
    }
    private func proofCtaLabel(for item: TodayOccurrenceModel) -> String {
        if item.verificationMethod == .friend { return Copy.Friends.request }
        return item.verificationMethod == .timer ? Copy.Home.timerCTA : Copy.Home.proofCTA
    }
}
