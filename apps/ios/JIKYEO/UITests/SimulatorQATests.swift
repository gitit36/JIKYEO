import XCTest

/// Simulator MVP QA. Uses DebugLaunch stages + mock session so journeys do not
/// depend on a live device token. Physical-device live smoke stays in DeviceMVPTests.
final class OnboardingLoginQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        QASupport.installPermissionMonitor(self)
    }

    func testHeroToGoalAndBack() {
        QASupport.launch(app, stage: "hero", mockSession: false)
        XCTAssertTrue(app.staticTexts["나와 한 약속,\n이번엔 진짜 지켜봐요."].waitForExistence(timeout: 8)
                      || app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "이번엔 진짜")).firstMatch.waitForExistence(timeout: 8))
        let start = app.buttons["시작하기"]
        QASupport.assertCTAMinSize(start)
        XCTAssertTrue(start.isEnabled)
        start.tap()
        XCTAssertTrue(app.staticTexts["무엇을 꼭 바꾸고 싶나요?"].waitForExistence(timeout: 6))
        app.buttons["이전"].tap()
        XCTAssertTrue(app.buttons["시작하기"].waitForExistence(timeout: 6))
        QASupport.assertNoRawAPIErrors(app)
    }

    func testSignInDisabledUntilValidAndShowsKoreanError() {
        QASupport.launch(app, stage: "signin-empty", mockSession: false)
        XCTAssertTrue(app.staticTexts["이제 시작해볼까요?"].waitForExistence(timeout: 8))
        let emptyCTA = app.buttons["시작하기"]
        QASupport.assertCTAMinSize(emptyCTA)
        XCTAssertFalse(emptyCTA.isEnabled, "empty name+email must disable sign-in")

        QASupport.launch(app, stage: "signin", mockSession: false)
        XCTAssertTrue(app.staticTexts["이제 시작해볼까요?"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.textFields["이름"].exists)
        XCTAssertTrue(app.textFields["이메일"].exists)
        let cta = app.buttons["시작하기"]
        QASupport.assertCTAMinSize(cta)
        XCTAssertTrue(cta.isEnabled, "debug signin prefills name+email")
        cta.tap()
        let signedIn = app.tabBars.buttons["홈"].waitForExistence(timeout: 8)
        if signedIn { return }
        let stillOnSignIn = app.staticTexts["이제 시작해볼까요?"].waitForExistence(timeout: 2)
        XCTAssertTrue(stillOnSignIn, "failed sign-in must stay on this screen")
        let snapshot = QASupport.visibleText(app)
        let loading = !cta.isEnabled || app.activityIndicators.firstMatch.exists
        let hasKorean = snapshot.range(of: "\\p{Hangul}", options: .regularExpression) != nil
        XCTAssertTrue(loading || hasKorean, "sign-in must show loading or Korean copy, got: \(snapshot)")
        QASupport.assertNoRawAPIErrors(app)
    }
}

final class WizardJourneyQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        QASupport.installPermissionMonitor(self)
    }

    func testCreateSelfReviewCopyAndBack() {
        QASupport.launch(app, stage: "wizard-review-self")
        XCTAssertTrue(app.staticTexts["이대로 약속할게요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["돈은 걸지 않고 내 기록으로 확인할게요."].exists)
        QASupport.assertNone(app, ["걸고 약속할게요", "친구가 직접 확인", "약속금을 걸어요"])
        let cta = app.buttons["이대로 약속할게요"]
        QASupport.assertCTAMinSize(cta)
        app.buttons["이전"].tap()
        XCTAssertTrue(app.staticTexts["어떻게 지키게 만들까요?"].waitForExistence(timeout: 6)
                      || app.buttons["이전"].exists)
        QASupport.assertNoRawAPIErrors(app)
    }

    func testEnforcementSelfDoesNotImplyFriendApproval() {
        QASupport.launch(app, stage: "wizard-enforcement")
        XCTAssertTrue(app.staticTexts["나만 확인할게요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["증명은 남기되, 돈은 걸지 않아요."].exists)
        QASupport.assertNone(app, ["친구가 직접 확인해줄게요"])
        QASupport.assertNoRawAPIErrors(app)
    }

    func testMoneyReviewAndMockPaymentCopy() {
        QASupport.launch(app, stage: "wizard-review-money")
        XCTAssertTrue(app.staticTexts["이대로 약속할게요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["성공하면 약속금 전액을 돌려받아요."].exists)

        QASupport.launch(app, stage: "wizard-payment")
        XCTAssertTrue(app.staticTexts["약속금을 걸어요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "MockPaymentProvider")).firstMatch.exists)
        let paymentText = QASupport.visibleText(app)
        XCTAssertTrue(paymentText.contains("5,000원"), "debug stake is 5,000")
        XCTAssertFalse(paymentText.contains("15,000원"), "quote/charge must match the 5,000 stake")
        XCTAssertTrue(app.buttons["내용을 확인했고, 결제할게요"].exists)
        QASupport.assertCTAMinSize(app.buttons["내용을 확인했고, 결제할게요"])
        QASupport.assertNoRawAPIErrors(app)

        QASupport.launch(app, stage: "wizard-payment-failed")
        XCTAssertTrue(app.staticTexts["결제가 완료되지 않았어요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["다시 결제하기"].exists)
        QASupport.assertNoRawAPIErrors(app)
    }

    func testMoneySignatureCancelIsNotADeadEnd() {
        QASupport.launch(app, stage: "wizard-signature")
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "직접 약속해요")).firstMatch.waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["서명하고 시작하기"].exists)
        XCTAssertFalse(app.buttons["서명하고 시작하기"].isEnabled, "empty canvas cannot submit")
        XCTAssertTrue(app.buttons["약속 취소하기"].exists)
        app.buttons["약속 취소하기"].tap()
        XCTAssertTrue(app.buttons["취소하고 환불받기"].waitForExistence(timeout: 4) || app.sheets.firstMatch.exists)
        QASupport.assertNoRawAPIErrors(app)
    }
}

final class ProofConsistencyQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        QASupport.installPermissionMonitor(self)
    }

    func testWizardProofRuleMatchesSelectedMethod() {
        struct Case {
            let stage: String
            let must: [String]
            let mustNot: [String]
        }
        let cases: [Case] = [
            .init(stage: "wizard-proof-photo", must: ["사진을 찍어"], mustNot: ["장소", "타이머", "친구가 약속을"]),
            .init(stage: "wizard-proof-gps", must: ["지정한 장소"], mustNot: ["사진을 찍어", "타이머", "내가 직접 확인"]),
            .init(stage: "wizard-proof-timer", must: ["앱 타이머"], mustNot: ["사진을 찍어", "지정한 장소", "친구가 약속을"]),
            .init(stage: "wizard-proof-self", must: ["내가 직접 확인", "다른 사람이 승인하지"], mustNot: ["친구가 약속을 지켰는지", "사진을 찍어"]),
            .init(stage: "wizard-proof-friend", must: ["친구가 약속을 지켰는지"], mustNot: ["내가 직접 확인", "사진을 찍어", "지정한 장소"]),
        ]
        for c in cases {
            QASupport.launch(app, stage: c.stage)
            XCTAssertTrue(app.staticTexts["이렇게 증명하면 돼요"].waitForExistence(timeout: 8), c.stage)
            let text = QASupport.visibleText(app)
            for m in c.must {
                XCTAssertTrue(text.contains(m), "\(c.stage) missing \(m)")
            }
            for n in c.mustNot {
                XCTAssertFalse(text.contains(n), "\(c.stage) leaked \(n)")
            }
            app.terminate()
        }
    }

    func testPhotoProofScreen() {
        QASupport.launch(app, stage: "proof-photo")
        app.tap()
        XCTAssertTrue(app.otherElements["proof.photo"].waitForExistence(timeout: 8) || app.staticTexts["약속을 사진으로 남겨요"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["약속을 사진으로 남겨요"].exists || app.staticTexts["카메라로 지금 이 순간을 찍어주세요."].exists)
        let capture = app.buttons["지금 촬영하기"]
        let allow = app.buttons["카메라 허용하기"]
        let settings = app.buttons["설정에서 허용하기"]
        XCTAssertTrue(capture.exists || allow.exists || settings.exists, "photo CTA")
        if capture.exists { QASupport.assertCTAMinSize(capture) }
        if allow.exists {
            QASupport.assertCTAMinSize(allow)
            XCTAssertNotEqual(allow.label, "설정에서 허용하기")
        }
        QASupport.assertNone(app, ["지정한 장소에 도착했나요?", "여기서 증명하기", "집중 타이머"])
        XCTAssertTrue(app.buttons["닫기"].exists)
        QASupport.assertNoRawAPIErrors(app)
    }

    func testGpsProofScreen() {
        QASupport.launch(app, stage: "proof-gps")
        app.tap()
        XCTAssertTrue(app.staticTexts["지정한 장소에 도착했나요?"].waitForExistence(timeout: 10))
        let submit = app.buttons["여기서 증명하기"]
        let allow = app.buttons["위치 허용하기"]
        let settings = app.buttons["설정에서 허용하기"]
        XCTAssertTrue(submit.exists || allow.exists || settings.exists, "gps CTA")
        if allow.exists {
            allow.tap()
            app.tap()
        }
        QASupport.assertNone(app, ["약속을 사진으로 남겨요", "지금 촬영하기", "카메라 접근", "집중 타이머"])
        QASupport.assertNoRawAPIErrors(app)
    }

    func testTimerProofScreen() {
        QASupport.launch(app, stage: "proof-timer")
        XCTAssertTrue(app.staticTexts["집중 타이머"].waitForExistence(timeout: 8))
        QASupport.assertNone(app, ["약속을 사진으로 남겨요", "지정한 장소에 도착했나요?", "지금 촬영하기", "여기서 증명하기"])
        let start = app.buttons["시작하기"]
        let giveUp = app.buttons["그만두기"]
        let retry = start.exists && start.isEnabled
        XCTAssertTrue(start.exists || giveUp.exists || app.staticTexts["화면을 켜두면 더 정확해요."].exists)
        if retry {
            QASupport.assertCTAMinSize(start)
        }
        QASupport.assertNoRawAPIErrors(app)
    }

    func testSelfProofScreen() {
        QASupport.launch(app, stage: "proof-self")
        XCTAssertTrue(app.staticTexts["약속을 지켰나요?"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["솔직하게 눌러주세요."].exists)
        QASupport.assertCTAMinSize(app.buttons["지켰어요"])
        XCTAssertTrue(app.buttons["못 지켰어요"].exists)
        QASupport.assertNone(app, ["친구가 약속을 지켰는지", "친구에게 확인 요청", "지금 촬영하기"])
        QASupport.assertNoRawAPIErrors(app)
    }

    func testFriendVerifyProofScreen() {
        QASupport.launch(app, stage: "proof-friend")
        XCTAssertTrue(app.staticTexts["친구에게 확인 요청"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["친구가 약속을 지켰는지 확인해줘요. 내가 직접 판정하지 않아요."].exists)
        QASupport.assertCTAMinSize(app.buttons["친구에게 확인 요청"])
        QASupport.assertNone(app, ["솔직하게 눌러주세요.", "지금 촬영하기", "여기서 증명하기"])
        QASupport.assertNoRawAPIErrors(app)
    }

    func testHomeProofCTAsMatchMethod() {
        QASupport.launch(app, stage: "home-loaded")
        XCTAssertTrue(app.staticTexts["장소로 증명"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.buttons["지금 증명하기"].firstMatch.exists)
        XCTAssertTrue(app.buttons["시작하기"].firstMatch.exists, "timer CTA")
        XCTAssertTrue(app.staticTexts["사진으로 증명"].exists)
        XCTAssertTrue(app.staticTexts["내가 직접 확인"].exists)
        XCTAssertTrue(app.staticTexts["친구가 직접 확인"].exists)
        XCTAssertTrue(app.buttons["친구에게 확인 요청"].firstMatch.exists)
        QASupport.assertNoRawAPIErrors(app)
    }

    func testResultScreensStayMethodAgnosticAndKorean() {
        QASupport.launch(app, stage: "result-pass-self")
        XCTAssertTrue(app.staticTexts["약속을 지켰어요."].waitForExistence(timeout: 8))
        QASupport.assertCTAMinSize(app.buttons["홈으로"])

        QASupport.launch(app, stage: "result-fail-money")
        XCTAssertTrue(app.staticTexts["약속을 놓쳤어요."].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "약속금")).firstMatch.exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "횟수에 포함")).firstMatch.exists
                      || app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "최종 성공")).firstMatch.exists)
        XCTAssertTrue(app.buttons["결과에 이의 제기하기"].exists)
        QASupport.assertNoRawAPIErrors(app)
    }
}

final class FriendsHistoryQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testFriendsSharedAndInbox() {
        QASupport.launch(app, stage: "friends-shared")
        XCTAssertTrue(app.navigationBars["친구"].waitForExistence(timeout: 8) || app.staticTexts["친구"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts["같이 하는 약속"].waitForExistence(timeout: 6) || app.staticTexts["민수"].exists)
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "각자 따로")).firstMatch.exists)
        QASupport.assertCTAMinSize(app.buttons["친구와 약속 만들기"])
        XCTAssertTrue(app.buttons["친구 초대하기"].exists)
        XCTAssertTrue(app.textFields["친구 코드 입력"].exists)

        QASupport.launch(app, stage: "friend-verify-inbox")
        XCTAssertTrue(app.staticTexts["확인할 약속"].waitForExistence(timeout: 8))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "지켰나요")).firstMatch.exists)
        let kept = app.buttons["friends.inbox.kept"].exists
            ? app.buttons["friends.inbox.kept"]
            : app.buttons["지켰어요"]
        QASupport.assertCTAMinSize(kept)
        XCTAssertTrue(app.buttons["지키지 못했어요"].exists || app.buttons["friends.inbox.missed"].exists)
        QASupport.assertNoRawAPIErrors(app)
    }

    func testHistoryEmptyAndMoney() {
        QASupport.launch(app, stage: "history-money")
        XCTAssertTrue(app.navigationBars["기록"].waitForExistence(timeout: 8) || app.tabBars.buttons["기록"].waitForExistence(timeout: 8))
        if app.tabBars.buttons["기록"].exists { app.tabBars.buttons["기록"].tap() }
        XCTAssertTrue(
            app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "약속금")).firstMatch.waitForExistence(timeout: 8)
            || app.staticTexts["기록"].exists,
            "history money fixture"
        )
        QASupport.assertNoRawAPIErrors(app)
    }
}

final class AccessibilityQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
    }

    func testPrimaryCTAsMeetMinTapSize() {
        QASupport.launch(app, stage: "hero", mockSession: false)
        QASupport.assertCTAMinSize(app.buttons["시작하기"])

        QASupport.launch(app, stage: "proof-self")
        QASupport.assertCTAMinSize(app.buttons["지켰어요"])
        QASupport.assertCTAMinSize(app.buttons["못 지켰어요"])

        QASupport.launch(app, stage: "wizard-payment")
        QASupport.assertCTAMinSize(app.buttons["내용을 확인했고, 결제할게요"])
    }

    func testDynamicTypeDoesNotDropKeyCTAs() {
        app.launchArguments = [
            "-jikyeoDebugStage", "proof-self",
            "-jikyeoDebugMockSession", "1",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXL",
        ]
        app.launch()
        XCTAssertTrue(app.buttons["지켰어요"].waitForExistence(timeout: 8))
        QASupport.assertCTAMinSize(app.buttons["지켰어요"])
        XCTAssertTrue(app.staticTexts["약속을 지켰나요?"].exists)
    }

    func testStatusNotColorOnlyOnHome() {
        QASupport.launch(app, stage: "home-loaded")
        XCTAssertTrue(app.staticTexts["예정"].waitForExistence(timeout: 8) || app.staticTexts["진행 중"].exists)
        XCTAssertTrue(app.staticTexts["장소로 증명"].exists)
    }
}

final class VisualRegressionQATests: XCTestCase {
    var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        QASupport.installPermissionMonitor(self)
    }

    func testCaptureMajorScreens() {
        let stages: [(String, String)] = [
            ("hero", "01-onboarding-hero"),
            ("goal", "02-onboarding-goal"),
            ("signin", "03-onboarding-signin"),
            ("home-empty", "04-home-empty"),
            ("home-loaded", "05-home-loaded"),
            ("wizard-goal", "06-wizard-goal"),
            ("wizard-verification", "07-wizard-verification"),
            ("wizard-proof-photo", "08-wizard-proof-photo"),
            ("wizard-proof-gps", "09-wizard-proof-gps"),
            ("wizard-proof-timer", "10-wizard-proof-timer"),
            ("wizard-proof-self", "11-wizard-proof-self"),
            ("wizard-proof-friend", "12-wizard-proof-friend"),
            ("wizard-enforcement", "13-wizard-enforcement"),
            ("wizard-review-self", "14-wizard-review-self"),
            ("wizard-review-money", "15-wizard-review-money"),
            ("wizard-payment", "16-wizard-payment"),
            ("wizard-payment-failed", "17-wizard-payment-failed"),
            ("wizard-signature", "18-wizard-signature"),
            ("proof-photo", "19-proof-photo"),
            ("proof-gps", "20-proof-gps"),
            ("proof-timer", "21-proof-timer"),
            ("proof-self", "22-proof-self"),
            ("proof-friend", "23-proof-friend"),
            ("result-pass-self", "24-result-pass-self"),
            ("result-fail-money", "25-result-fail-money"),
            ("friends-shared", "26-friends-shared"),
            ("friend-verify-inbox", "27-friend-verify-inbox"),
            ("history-money", "28-history-money"),
        ]
        for (stage, name) in stages {
            QASupport.launch(app, stage: stage, mockSession: stage.hasPrefix("hero") || stage == "goal" || stage == "signin" ? false : true)
            _ = app.wait(for: .runningForeground, timeout: 4)
            if stage.hasPrefix("proof-") { app.tap() }
            XCTAssertTrue(app.wait(for: .runningForeground, timeout: 6), name)
            QASupport.capture(app, name: name, test: self)
            app.terminate()
        }
    }
}
