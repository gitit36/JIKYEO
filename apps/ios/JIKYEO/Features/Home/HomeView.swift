import SwiftUI

/// Home / Today. PRD §5. Phase 1 shows the hero + empty state. Phase 3 wires
/// today's occurrences + proof CTAs.
struct HomeView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Hero(atRiskKrw: 0)
                    EmptyToday()
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("지켜")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private struct Hero: View {
    let atRiskKrw: Int64
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.xs) {
            Text(Copy.homeGreeting)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
            HStack(alignment: .firstTextBaseline, spacing: DS.Space.xs) {
                Text(Copy.homeAtRiskPrefix)
                    .font(Typo.heading)
                    .foregroundStyle(DS.Color.text)
            }
            MoneyText(atRiskKrw, intent: atRiskKrw > 0 ? .atRisk : .neutral, size: .hero)
        }
    }
}

private struct EmptyToday: View {
    var body: some View {
        Card {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.homeNoCommitments)
                    .font(Typo.bodyStrong)
                    .foregroundStyle(DS.Color.text)
                Text("작은 약속부터 시작해봐요.")
                    .font(Typo.body)
                    .foregroundStyle(DS.Color.textSecondary)
                NavigationLink {
                    CreateCommitmentEntry()
                } label: {
                    Text(Copy.homeCreateCTA)
                        .font(Typo.button)
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(
                            RoundedRectangle(cornerRadius: DS.Radius.md)
                                .fill(DS.Color.primary)
                        )
                }
            }
        }
    }
}
