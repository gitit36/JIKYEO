import SwiftUI

struct FriendsView: View {
    @EnvironmentObject private var container: AppContainer
    let debugStage: String?
    @State private var home: FriendsHomeResponse?
    @State private var code: String = ""
    @State private var error: String?
    @State private var showShared = false

    init(debugStage: String? = nil) { self.debugStage = debugStage }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DS.Space.md) {
                    if let home, !home.shared.isEmpty || !home.watching.isEmpty || !home.friends.isEmpty || !home.requests.isEmpty || !home.reviewQueue.isEmpty {
                        if !home.reviewQueue.isEmpty {
                            Text(Copy.Friends.reviewInbox).font(Typo.bodyStrong)
                            ForEach(home.reviewQueue) { card in
                                FriendVerifyInboxCard(card: card) { await load() }
                            }
                        }
                        if !home.shared.isEmpty || !home.watching.isEmpty {
                            Text(Copy.Friends.together).font(Typo.bodyStrong)
                            ForEach(home.watching, id: \.commitmentId) { p in
                                Card {
                                    Text(p.title).font(Typo.bodyStrong)
                                    Text("\(p.progress.pass)/\(p.progress.due) · \(p.status)")
                                        .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                                }
                            }
                            ForEach(home.shared) { row in
                                Card {
                                    Text(row.title).font(Typo.bodyStrong)
                                    ForEach(row.members) { m in
                                        if let p = m.progress {
                                            Text("\(m.displayName) · \(p.progress.pass)/\(p.progress.due) · \(p.status)")
                                                .font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                                        } else {
                                            Text(m.displayName).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                                        }
                                    }
                                }
                            }
                        }
                        if !home.friends.isEmpty {
                            Text(Copy.Friends.list).font(Typo.bodyStrong)
                            ForEach(home.friends) { f in
                                Text(f.displayName).font(Typo.body)
                            }
                        }
                        if !home.requests.isEmpty {
                            Text(Copy.Friends.requests).font(Typo.bodyStrong)
                            ForEach(home.requests) { r in
                                HStack {
                                    Text(r.displayName ?? r.title ?? "요청").font(Typo.body)
                                    Spacer()
                                    if let id = r.friendshipId {
                                        Button(Copy.Friends.accept) {
                                            Task { _ = try? await container.friendsAPI.accept(friendshipId: id); await load() }
                                        }
                                    }
                                    if let sid = r.sharedCommitmentId {
                                        Button(Copy.Friends.accept) {
                                            Task { _ = try? await container.friendsAPI.acceptShared(id: sid); await load() }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        Text(Copy.Friends.empty).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
                    }
                    Text(Copy.Friends.independent).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                    if let code = home?.invite.inviteCode {
                        Text("\(Copy.Friends.codeHint)  \(code)").font(Typo.bodyStrong)
                    }
                    HStack {
                        TextField(Copy.Friends.enterCode, text: $code)
                            .textInputAutocapitalization(.characters)
                        Button(Copy.Friends.inviteCTA) {
                            Task {
                                do { _ = try await container.friendsAPI.invite(code: code); await load() }
                                catch let e as APIError { error = e.message }
                            }
                        }
                    }
                    Button(Copy.Friends.createShared) { showShared = true }
                        .font(Typo.bodyStrong)
                    if let error { Text(error).font(Typo.caption).foregroundStyle(DS.Color.moneyLost) }
                }
                .padding(DS.Space.lg)
            }
            .background(DS.Color.surfaceBackground.ignoresSafeArea())
            .navigationTitle(Copy.Friends.title)
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .sheet(isPresented: $showShared) {
                SharedCreateSheet { showShared = false; Task { await load() } }
                    .environmentObject(container)
            }
        }
    }

    private func load() async {
        #if DEBUG
        if let debugStage {
            home = FriendsView.fixture(debugStage)
            return
        }
        #endif
        home = try? await container.friendsAPI.home()
    }

    #if DEBUG
    static func fixture(_ stage: String) -> FriendsHomeResponse {
        let friend = FriendRow(friendshipId: "f1", friendUserId: "u2", displayName: "민수", status: "accepted")
        let progress = SocialProgress(
            commitmentId: "c1", title: "4주 주 3회 운동",
            startAt: Date(), endAt: Date().addingTimeInterval(86400 * 28),
            status: stage == "friends-diverge" ? "끝남" : "진행 중",
            progress: .init(pass: stage == "friends-diverge" ? 2 : 3, due: 10),
            latestSignal: stage == "friends-diverge" ? "놓침" : "지킴"
        )
        let shared = SharedCommitmentView(
            sharedCommitmentId: "s1", title: "4주 주 3회 운동",
            startAt: Date(), endAt: Date().addingTimeInterval(86400 * 28),
            status: "open", independentContracts: true, moneyIndependent: true,
            members: [
                SharedMember(userId: "u1", displayName: "나", participantStatus: "accepted",
                             progress: SocialProgress(commitmentId: "c-self", title: "4주 주 3회 운동", startAt: Date(), endAt: Date(), status: "진행 중", progress: .init(pass: 4, due: 10), latestSignal: "지킴")),
                SharedMember(userId: "u2", displayName: "민수", participantStatus: "accepted", progress: progress),
            ]
        )
        let review = FriendVerifyCard(
            requestId: "fv1", occurrenceId: "o1", status: "pending",
            ownerDisplayName: "상혁", verifierDisplayName: "민수", title: "야식 먹지 않기",
            windowStartAt: Date(), deadlineAt: Date().addingTimeInterval(3600),
            reviewDeadlineAt: Date().addingTimeInterval(86400),
            question: Copy.Friends.question("상혁", "야식 먹지 않기")
        )
        if stage == "friends-request" {
            return FriendsHomeResponse(
                shared: [], watching: [], friends: [],
                requests: [FriendRequestRow(friendshipId: "f-in", fromUserId: "u2", displayName: "민수", kind: "friend_request", sharedCommitmentId: nil, title: nil)],
                invite: InviteCodeResponse(inviteCode: "ABC12345"), reviewQueue: []
            )
        }
        if stage == "friends-accepted" {
            return FriendsHomeResponse(shared: [], watching: [], friends: [friend], requests: [], invite: InviteCodeResponse(inviteCode: "ABC12345"), reviewQueue: [])
        }
        if stage == "friends-social" {
            return FriendsHomeResponse(shared: [], watching: [progress], friends: [friend], requests: [], invite: InviteCodeResponse(inviteCode: "ABC12345"), reviewQueue: [])
        }
        if stage == "friend-verify-inbox" {
            return FriendsHomeResponse(shared: [], watching: [], friends: [friend], requests: [], invite: InviteCodeResponse(inviteCode: "ABC12345"), reviewQueue: [review])
        }
        return FriendsHomeResponse(shared: [shared], watching: [], friends: [friend], requests: [], invite: InviteCodeResponse(inviteCode: "ABC12345"), reviewQueue: [])
    }
    #endif
}

private struct FriendVerifyInboxCard: View {
    @EnvironmentObject private var container: AppContainer
    let card: FriendVerifyCard
    let onDone: () async -> Void
    @State private var confirmReject = false
    var body: some View {
        Card {
            Text(card.title).font(Typo.bodyStrong)
            Text(card.ownerDisplayName).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
            Text(Self.dateLine(card.windowStartAt ?? card.deadlineAt)).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
            Text("확인 마감 \(Self.dateLine(card.reviewDeadlineAt))").font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
            Text(card.question).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
            HStack {
                Button(Copy.Friends.kept) {
                    Task { _ = try? await container.friendsAPI.decideFriendVerify(occurrenceId: card.occurrenceId, approve: true); await onDone() }
                }
                Button(Copy.Friends.missed) { confirmReject = true }
            }
            .font(Typo.bodyStrong)
        }
        .confirmationDialog(Copy.Friends.confirmReject, isPresented: $confirmReject, titleVisibility: .visible) {
            Button(Copy.Friends.missed, role: .destructive) {
                Task { _ = try? await container.friendsAPI.decideFriendVerify(occurrenceId: card.occurrenceId, approve: false); await onDone() }
            }
        }
    }
    private static func dateLine(_ date: Date?) -> String {
        guard let date else { return "—" }
        let f = DateFormatter()
        f.locale = Locale(identifier: "ko_KR")
        f.dateFormat = "M월 d일"
        return f.string(from: date)
    }
}

struct SharedCreateSheet: View {
    @EnvironmentObject private var container: AppContainer
    let onDone: () -> Void
    @State private var title = "4주 동안 주 3회 운동"
    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.Friends.independent).font(Typo.body)
                Text(Copy.Friends.moneyIndependent).font(Typo.caption).foregroundStyle(DS.Color.textSecondary)
                Text(title).font(Typo.bodyStrong)
                Button(Copy.Wizard.step7CTA) {
                    Task {
                        let cal = Calendar.current
                        let start = Date()
                        let end = cal.date(byAdding: .day, value: 27, to: start) ?? start
                        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
                        let schedule = SchedulePayload(
                            type: .x_per_week, startDate: f.string(from: start), endDate: f.string(from: end),
                            windowStartLocalTime: "07:00", deadlineLocalTime: "21:00",
                            days: nil, timesPerWeek: 3, allowedDays: nil, dates: nil
                        )
                        _ = try? await container.friendsAPI.createShared(title: title, inviteeUserIds: [], schedule: schedule)
                        onDone()
                    }
                }
            }
            .padding(DS.Space.lg)
            .navigationTitle(Copy.Friends.createShared)
        }
    }
}
