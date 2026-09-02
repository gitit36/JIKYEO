import SwiftUI

@main
struct JIKYEOApp: App {
    @StateObject private var container = AppContainer()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(container)
                .environmentObject(container.auth)
                .tint(DS.Color.primary)
        }
    }
}
