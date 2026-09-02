import SwiftUI

struct FriendsView: View {
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    Text("친구는 내 약속을 지켜봐주는 사람이에요.")
                        .font(Typo.body)
                        .foregroundStyle(DS.Color.textSecondary)
                    Text("실패한 약속금은 친구에게 가지 않아요.")
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                    Card {
                        VStack(alignment: .leading, spacing: DS.Space.xs) {
                            Text("친구 초대는 곧 열려요.")
                                .font(Typo.bodyStrong)
                        }
                    }
                }
                .padding(.horizontal, DS.Space.lg)
                .padding(.vertical, DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle("친구")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
