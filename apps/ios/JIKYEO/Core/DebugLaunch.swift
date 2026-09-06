import Foundation
import SwiftUI

#if DEBUG
/// Debug-only harness for driving the app from `xcrun simctl launch` args so
/// we can screenshot every state without an XCUITest target. Not compiled in
/// Release.
///
/// Supported stages:
///   Onboarding    — hero, goal, how, notify, signin
///   Home          — home-empty, home-loaded
///   Wizard        — wizard-goal, wizard-schedule, wizard-verification,
///                    wizard-proof, wizard-enforcement, wizard-stake,
///                    wizard-observer, wizard-review-money, wizard-review-self,
///                    wizard-payment, wizard-payment-failed, wizard-signature,
///                    wizard-resume-signature, wizard-done-money, wizard-done-self
///   Cancel        — cancel-self, cancel-money, cancel-settled
///   Compliance    — terms-accept, age-reject, fail-provisional, cancel-immediate,
///                    v1-grace-alive, v1-grace-exceeded, v1-cancel-pre, v1-cancel-post, v1-makeup
///   Money status  — history-money (기록 tab with every MoneyStatus)
///   Proof + Result — proof-photo, proof-gps, proof-timer, proof-self,
///                    result-pass-money, result-pass-self,
///                    result-uncertain, result-fail-money, result-fail-self
///
/// Args:
///   `-jikyeoDebugStage <stage>`
///   `-jikyeoDebugMockSession 1`: injects a mock signed-in session so
///     Home/wizard views render without a network sign-in.
public enum DebugLaunch {
    public static var stage: String? {
        UserDefaults.standard.string(forKey: "jikyeoDebugStage")
    }
    public static var mockSession: Bool {
        UserDefaults.standard.integer(forKey: "jikyeoDebugMockSession") == 1
    }
    public static var mockedAtRiskKrw: Int64 {
        Int64(UserDefaults.standard.integer(forKey: "jikyeoDebugAtRiskKrw"))
    }
    /// `-jikyeoDebugAccessToken <jwt>`: real server session for live QA runs
    /// (e.g. `wizard-payment-live`), instead of the offline mock token.
    public static var accessToken: String? {
        UserDefaults.standard.string(forKey: "jikyeoDebugAccessToken")
    }
    /// `-jikyeoDebugDeepLink jikyeo://today`
    public static var deepLink: String? {
        UserDefaults.standard.string(forKey: "jikyeoDebugDeepLink")
    }
}
#endif
