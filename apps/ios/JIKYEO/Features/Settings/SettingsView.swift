import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        NavigationStack {
            List {
                Section("계정") {
                    if let session = auth.session {
                        Text(session.userId)
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textSecondary)
                    }
                    Button(role: .destructive) {
                        auth.signOut()
                    } label: {
                        Text("로그아웃")
                    }
                }
                Section("정보") {
                    Text("지켜 / JIKYEO")
                        .font(Typo.bodyStrong)
                    Text("v0.1 (MVP)")
                        .font(Typo.caption)
                        .foregroundStyle(DS.Color.textSecondary)
                }
            }
            .navigationTitle("설정")
        }
    }
}
