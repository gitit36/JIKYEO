import SwiftUI

@main
struct JIKYEOApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var container: AppContainer

    init() {
        let c = AppContainer()
        PushRegistrar.shared.attach(c)
        #if DEBUG
        if DebugLaunch.mockSession {
            c.auth.setSession(.init(
                userId: DebugLaunch.userId ?? "debug-user",
                accessToken: DebugLaunch.accessToken ?? "debug-token",
                refreshToken: "debug-refresh",
                expiresAt: Date().addingTimeInterval(3600)
            ))
        }
        #endif
        _container = StateObject(wrappedValue: c)
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environmentObject(container.auth)
                .tint(DS.Color.primary)
                .onOpenURL { url in
                    container.open(url)
                }
                .onAppear {
                    container.auth.pruneExpired()
                    PushRegistrar.shared.startIfSignedIn()
                    #if DEBUG
                    if let raw = DebugLaunch.deepLink, let url = URL(string: raw) {
                        container.open(url)
                    }
                    #endif
                }
        }
    }
}
