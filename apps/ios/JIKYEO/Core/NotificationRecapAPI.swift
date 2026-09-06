import Foundation
import UserNotifications

public struct DeviceTokenResponse: Decodable {
    public let tokenHash: String
    public let environment: String
    public let active: Bool
}

public struct NotificationPreferences: Codable, Equatable {
    public var deadlineReminder: Bool
    public var signatureExpiry: Bool
    public var refund: Bool
    public var appeal: Bool
    public var weeklyRecap: Bool
}

public struct RecapMoney: Decodable {
    public let keptKrw: String
    public let netForfeitedKrw: String
    public let refundPendingOrDelayedKrw: String
}

public struct WeeklyRecapResponse: Decodable, Identifiable {
    public var id: String { recapId }
    public let recapId: String
    public let localWeekStart: String
    public let timezone: String
    public let due: Int
    public let pass: Int
    public let fail: Int
    public let void: Int
    public let unresolved: Int
    public let completionRate: Double?
    public let money: RecapMoney?
}

public struct EvidenceItem: Decodable, Identifiable {
    public var id: String { evidenceId }
    public let evidenceId: String
    public let status: String
    public let hash: String?
    public let deletedAt: Date?
    public let assetAvailable: Bool
}

public struct NotificationAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func register(token: String, environment: String = "sandbox") async throws -> DeviceTokenResponse {
        try await api.post("devices/tokens", body: ["token": token, "environment": environment])
    }

    public func unregister(token: String) async throws -> DeviceTokenResponse {
        try await api.post("devices/tokens/unregister", body: ["token": token])
    }

    public func preferences() async throws -> NotificationPreferences {
        try await api.get("notifications/preferences")
    }

    public func setPreferences(_ prefs: NotificationPreferences) async throws -> NotificationPreferences {
        try await api.post("notifications/preferences", body: prefs)
    }
}

public struct RecapAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func latest() async throws -> WeeklyRecapResponse? {
        try await api.get("recaps/latest")
    }

    public func get(weekStart: String) async throws -> WeeklyRecapResponse {
        try await api.get("recaps/\(weekStart)")
    }
}

enum NotificationPermission {
    static func request() async -> Bool {
        let center = UNUserNotificationCenter.current()
        let granted = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        return granted == true
    }
}
