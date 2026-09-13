import SwiftUI

struct SettingsView: View {
    @EnvironmentObject private var auth: AuthStore
    @EnvironmentObject private var container: AppContainer
    @State private var prefs = NotificationPreferences(
        deadlineReminder: true, signatureExpiry: true, refund: true, appeal: true, weeklyRecap: true
    )
    @State private var recap: WeeklyRecapResponse?
    @State private var recapError: String?
    @State private var authorized = false

    var body: some View {
        NavigationStack {
            List {
                Section("계정") {
                    if auth.isSignedIn {
                        Text(Copy.Errors.signedIn)
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textSecondary)
                    }
                    Button(role: .destructive) {
                        Task {
                            await PushRegistrar.shared.unregisterOnSignOut()
                            auth.signOut()
                        }
                    } label: {
                        Text("로그아웃")
                    }
                }
                Section(Copy.Notify.section) {
                    Button(Copy.Notify.enable) {
                        Task { await enablePush() }
                    }
                    Toggle(Copy.Notify.deadlinePref, isOn: pref(\.deadlineReminder, set: { $0.deadlineReminder = $1 }))
                    Toggle(Copy.Notify.signaturePref, isOn: pref(\.signatureExpiry, set: { $0.signatureExpiry = $1 }))
                    Toggle(Copy.Notify.refundPref, isOn: pref(\.refund, set: { $0.refund = $1 }))
                    Toggle(Copy.Notify.appealPref, isOn: pref(\.appeal, set: { $0.appeal = $1 }))
                    Toggle(Copy.Notify.recapPref, isOn: pref(\.weeklyRecap, set: { $0.weeklyRecap = $1 }))
                    if authorized {
                        Text("알림이 켜져 있어요")
                            .font(Typo.caption)
                            .foregroundStyle(DS.Color.textSecondary)
                    }
                }
                Section(Copy.Recap.nav) {
                    Button(Copy.Notify.recapCta) {
                        Task { await loadRecap() }
                    }
                    if let recapError {
                        Text(recapError).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
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
            .task { await loadPrefs() }
            .sheet(item: $recap) { row in
                NavigationStack { WeeklyRecapView(recap: row) }
            }
        }
    }

    private func pref(_ keyPath: WritableKeyPath<NotificationPreferences, Bool>, set: @escaping (inout NotificationPreferences, Bool) -> Void) -> Binding<Bool> {
        Binding(
            get: { prefs[keyPath: keyPath] },
            set: { next in
                set(&prefs, next)
                Task { prefs = (try? await container.notificationAPI.setPreferences(prefs)) ?? prefs }
            }
        )
    }

    private func loadPrefs() async {
        if let loaded = try? await container.notificationAPI.preferences() {
            prefs = loaded
        }
    }

    private func loadRecap() async {
        recapError = nil
        do {
            if let row = try await container.recapAPI.latest() {
                recap = row
            } else {
                recapError = Copy.Errors.recapEmpty
            }
        } catch {
            recapError = UserFacingError.message(error)
        }
    }

    private func enablePush() async {
        authorized = await PushRegistrar.shared.requestAndRegister()
        await loadPrefs()
    }
}
