import Foundation
import UIKit
import UserNotifications

/// Registers for APNs and forwards the latest token to the backend.
/// Token bytes are never written to logs or UI.
@MainActor
final class PushRegistrar: NSObject, UNUserNotificationCenterDelegate {
    static let shared = PushRegistrar()
    weak var container: AppContainer?
    private var lastToken: String?

    var environment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    func attach(_ container: AppContainer) {
        self.container = container
        UNUserNotificationCenter.current().delegate = self
    }

    func startIfSignedIn() {
        guard container?.auth.isSignedIn == true else { return }
        Task {
            let settings = await UNUserNotificationCenter.current().notificationSettings()
            guard settings.authorizationStatus == .authorized
                    || settings.authorizationStatus == .provisional
                    || settings.authorizationStatus == .ephemeral else { return }
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func requestAndRegister() async -> Bool {
        let granted = await NotificationPermission.request()
        if granted {
            UIApplication.shared.registerForRemoteNotifications()
        }
        return granted
    }

    func didRegister(deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        lastToken = token
        guard container?.auth.isSignedIn == true else { return }
        Task {
            _ = try? await container?.notificationAPI.register(token: token, environment: environment)
        }
    }

    func didFailRegistration() {
        // App continues without push. No token/debug surface.
    }

    func unregisterOnSignOut() async {
        guard let token = lastToken else { return }
        lastToken = nil
        _ = try? await container?.notificationAPI.unregister(token: token)
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        guard let raw = response.notification.request.content.userInfo["deeplink"] as? String,
              let url = URL(string: raw) else { return }
        container?.open(url)
    }
}

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushRegistrar.shared
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        Task { @MainActor in
            PushRegistrar.shared.didRegister(deviceToken: deviceToken)
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        Task { @MainActor in
            PushRegistrar.shared.didFailRegistration()
        }
    }
}
