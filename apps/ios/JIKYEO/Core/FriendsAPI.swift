import Foundation

public struct InviteCodeResponse: Codable {
    public let inviteCode: String
}

public struct FriendRow: Codable, Identifiable {
    public var id: String { friendshipId }
    public let friendshipId: String
    public let friendUserId: String
    public let displayName: String
    public let status: String
}

public struct FriendRequestRow: Codable, Identifiable {
    public var id: String { friendshipId ?? sharedCommitmentId ?? UUID().uuidString }
    public let friendshipId: String?
    public let fromUserId: String?
    public let displayName: String?
    public let kind: String
    public let sharedCommitmentId: String?
    public let title: String?
}

public struct SocialProgress: Codable {
    public let commitmentId: String
    public let title: String
    public let startAt: Date
    public let endAt: Date
    public let status: String
    public let progress: ProgressCount
    public let latestSignal: String
    public struct ProgressCount: Codable {
        public let pass: Int
        public let due: Int
    }
}

public struct SharedMember: Codable, Identifiable {
    public var id: String { userId }
    public let userId: String
    public let displayName: String
    public let participantStatus: String
    public let progress: SocialProgress?
}

public struct SharedCommitmentView: Codable, Identifiable {
    public var id: String { sharedCommitmentId }
    public let sharedCommitmentId: String
    public let title: String
    public let startAt: Date
    public let endAt: Date
    public let status: String
    public let independentContracts: Bool
    public let moneyIndependent: Bool
    public let members: [SharedMember]
}

public struct FriendVerifyCard: Codable, Identifiable {
    public var id: String { requestId }
    public let requestId: String
    public let occurrenceId: String
    public let status: String
    public let ownerDisplayName: String
    public let verifierDisplayName: String?
    public let title: String
    public let windowStartAt: Date?
    public let deadlineAt: Date?
    public let reviewDeadlineAt: Date
    public let question: String
}

public struct FriendsHomeResponse: Codable {
    public let shared: [SharedCommitmentView]
    public let watching: [SocialProgress]
    public let friends: [FriendRow]
    public let requests: [FriendRequestRow]
    public let invite: InviteCodeResponse
    public let reviewQueue: [FriendVerifyCard]
}

public struct FriendshipActionResponse: Codable {
    public let friendshipId: String
    public let status: String
    public let friendUserId: String
    public let idempotent: Bool
}

public final class FriendsAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func inviteCode() async throws -> InviteCodeResponse {
        try await api.get("me/invite-code")
    }
    public func home() async throws -> FriendsHomeResponse {
        try await api.get("friends/home")
    }
    public func invite(code: String) async throws -> FriendshipActionResponse {
        try await api.post("friends/invite", body: ["inviteCode": code])
    }
    public func accept(friendshipId: String) async throws -> FriendshipActionResponse {
        try await api.post("friends/\(friendshipId)/accept", body: APIClient.Empty())
    }
    public func decline(friendshipId: String) async throws -> FriendshipActionResponse {
        try await api.post("friends/\(friendshipId)/decline", body: APIClient.Empty())
    }
    public func createShared(title: String, inviteeUserIds: [String], schedule: SchedulePayload) async throws -> SharedCommitmentView {
        struct Body: Encodable {
            let title: String
            let category: String
            let timezone: String
            let schedule: SchedulePayload
            let inviteeUserIds: [String]
        }
        return try await api.post("shared-commitments", body: Body(
            title: title, category: "workout", timezone: TimeZone.current.identifier,
            schedule: schedule, inviteeUserIds: inviteeUserIds
        ))
    }
    public func acceptShared(id: String) async throws -> SharedCommitmentView {
        try await api.post("shared-commitments/\(id)/accept", body: APIClient.Empty())
    }
    public func requestFriendVerify(occurrenceId: String) async throws -> FriendVerifyCard {
        try await api.post("occurrences/\(occurrenceId)/friend-verification", body: ["action": "request"])
    }
    public func decideFriendVerify(occurrenceId: String, approve: Bool) async throws -> FriendVerifyCard {
        try await api.post("occurrences/\(occurrenceId)/friend-verification", body: ["action": approve ? "approve" : "reject"])
    }
}
