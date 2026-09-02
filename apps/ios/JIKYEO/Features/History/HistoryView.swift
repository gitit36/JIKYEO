import SwiftUI

struct HistoryView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    Text("지금까지 지킨 약속이 여기 모여요.")
                        .font(Typo.body)
                        .foregroundStyle(DS.Color.textSecondary)
                    Card {
                        VStack(alignment: .leading, spacing: DS.Space.xs) {
                            Text("아직 완료된 약속이 없어요.")
                                .font(Typo.bodyStrong)
                            Text("첫 약속이 끝나면 여기에서 볼 수 있어요.")
                                .font(Typo.caption)
                                .foregroundStyle(DS.Color.textSecondary)
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("히스토리")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
