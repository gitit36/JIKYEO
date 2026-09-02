import SwiftUI

struct RootView: View {
    @EnvironmentObject private var container: AppContainer
    @EnvironmentObject private var auth: AuthStore

    var body: some View {
        Group {
            if auth.isSignedIn {
                MainTabs()
            } else {
                OnboardingRootView()
            }
        }
        .animation(.easeInOut(duration: 0.2), value: auth.isSignedIn)
    }
}

/// App IA per PRD §5 and product brief.
private struct MainTabs: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("홈", systemImage: "house.fill") }

            CreateCommitmentEntry()
                .tabItem { Label("만들기", systemImage: "plus.circle.fill") }

            HistoryView()
                .tabItem { Label("히스토리", systemImage: "list.bullet.rectangle") }

            FriendsView()
                .tabItem { Label("친구", systemImage: "person.2.fill") }

            SettingsView()
                .tabItem { Label("설정", systemImage: "gearshape") }
        }
    }
}
