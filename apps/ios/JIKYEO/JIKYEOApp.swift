import SwiftUI

@main
struct JIKYEOApp: App {
    @StateObject private var container: AppContainer

    init() {
        let c = AppContainer()
        #if DEBUG
        if DebugLaunch.mockSession {
            c.auth.setSession(.init(
                userId: "debug-user",
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
                #if DEBUG
                .onAppear {
                    if let raw = DebugLaunch.deepLink, let url = URL(string: raw) {
                        container.open(url)
                    }
                }
                #endif
        }
    }
}
