import SwiftUI

/// Entry point for the commitment-creation wizard (fleshed out in Phase 2).
/// For Phase 1 this shows the wizard chrome only, so navigation and design
/// system integration are already correct.
struct CreateCommitmentEntry: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.lg) {
                    Text(Copy.wizardGoalQ)
                        .font(Typo.title)
                        .foregroundStyle(DS.Color.text)
                    Text("템플릿에서 고르거나, 직접 만들 수 있어요.")
                        .font(Typo.body)
                        .foregroundStyle(DS.Color.textSecondary)

                    Card {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            Text("다음 단계에서 이어져요")
                                .font(Typo.bodyStrong)
                                .foregroundStyle(DS.Color.text)
                            Text("규칙 → 증명 → 약속금 → 지켜볼 사람 → 결제 → 서명")
                                .font(Typo.caption)
                                .foregroundStyle(DS.Color.textSecondary)
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("새 약속")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
