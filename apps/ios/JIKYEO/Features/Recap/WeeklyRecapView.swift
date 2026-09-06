import SwiftUI

struct WeeklyRecapView: View {
    let recap: WeeklyRecapResponse

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DS.Space.md) {
                Text(Copy.Recap.title)
                    .font(Typo.title)
                Text(Copy.Recap.weekLine(recap.localWeekStart))
                    .font(Typo.caption)
                    .foregroundStyle(DS.Color.textSecondary)
                Card {
                    VStack(alignment: .leading, spacing: DS.Space.sm) {
                        Text(Copy.Recap.counts(due: recap.due, pass: recap.pass, fail: recap.fail, void: recap.void, unresolved: recap.unresolved))
                            .font(Typo.body)
                        Text(Copy.Recap.rate(recap.completionRate))
                            .font(Typo.bodyStrong)
                    }
                }
                if let money = recap.money {
                    Card {
                        VStack(alignment: .leading, spacing: DS.Space.sm) {
                            Text(Copy.Recap.kept(money.keptKrw))
                            Text(Copy.Recap.forfeited(money.netForfeitedKrw))
                            if money.refundPendingOrDelayedKrw != "0" {
                                Text(Copy.Recap.refundPending(money.refundPendingOrDelayedKrw))
                                    .foregroundStyle(DS.Color.textSecondary)
                            }
                        }
                        .font(Typo.body)
                    }
                }
            }
            .padding(.horizontal, DS.Space.lg)
            .padding(.vertical, DS.Space.lg)
        }
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
        .navigationTitle(Copy.Recap.nav)
        .navigationBarTitleDisplayMode(.inline)
    }

    static func fixtureMixed() -> WeeklyRecapResponse {
        WeeklyRecapResponse(
            recapId: "debug-recap",
            localWeekStart: "2026-09-07",
            timezone: "Asia/Seoul",
            due: 4, pass: 2, fail: 1, void: 1, unresolved: 0,
            completionRate: 2.0 / 3.0,
            money: RecapMoney(keptKrw: "5000", netForfeitedKrw: "5000", refundPendingOrDelayedKrw: "0")
        )
    }
}

struct DeletedEvidencePlaceholder: View {
    var body: some View {
        Card {
            Text(Copy.Evidence.deleted)
                .font(Typo.body)
                .foregroundStyle(DS.Color.textSecondary)
        }
        .padding(DS.Space.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
        .navigationTitle(Copy.Evidence.title)
    }
}

struct MaintenanceRetryDebugView: View {
    var body: some View {
        VStack(alignment: .leading, spacing: DS.Space.md) {
            Text(Copy.Notify.retryTitle).font(Typo.title)
            Text(Copy.Notify.retryBody).font(Typo.body).foregroundStyle(DS.Color.textSecondary)
        }
        .padding(DS.Space.lg)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(DS.Color.surfaceBackground.ignoresSafeArea())
    }
}
