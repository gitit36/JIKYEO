import Foundation

public struct MvpMatrix: Codable {
    public let moneyMode: String
    public let moneyEnabled: Bool
    public let reviewDemo: Bool
    public let methods: Methods
    public let policyVersions: PolicyVersions

    public struct Methods: Codable {
        public let photo: Bool
        public let gps: Bool
        public let timer: Bool
        public let `self`: Bool
        public let friend: Bool
    }

    public struct PolicyVersions: Codable {
        public let terms: String
        public let privacy: String
        public let moneyPolicy: String
    }

    #if DEBUG
    public static func reviewDemoFixture() -> MvpMatrix {
        MvpMatrix(
            moneyMode: "review_demo",
            moneyEnabled: true,
            reviewDemo: true,
            methods: Methods(photo: false, gps: true, timer: true, self: true, friend: true),
            policyVersions: PolicyVersions(terms: "terms-v2", privacy: "privacy-v1", moneyPolicy: "money-policy-v1")
        )
    }
    #endif
}

public final class PublicAPI {
    private let api: APIClient
    public init(api: APIClient) { self.api = api }

    public func mvp() async throws -> MvpMatrix {
        try await api.get("public/mvp")
    }
}
