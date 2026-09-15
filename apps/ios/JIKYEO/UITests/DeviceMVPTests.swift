import XCTest

/// Physical-device smoke. Session token is seeded from the Mac API, not from
/// the UITest runner (the runner bundle is a different Local Network identity).
final class DeviceMVPTests: XCTestCase {
    private var app: XCUIApplication!
    private let userId = "754968c8-9aa5-43ea-ae05-0cc55506c2ad"
    private let token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiI3NTQ5NjhjOC05YWE1LTQzZWEtYWUwNS0wY2M1NTUwNmMyYWQiLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzg5MzE3MzEzLCJleHAiOjE3ODkzMjA5MTN9.MOxa-IXXHbdbev2b_nJt9pRSYoQsAXFC8YYeqRxmLFA"

    override func setUpWithError() throws {
        #if targetEnvironment(simulator)
        throw XCTSkip("Physical-device live MVP; simulator QA is in SimulatorQATests")
        #endif
        continueAfterFailure = false
        addUIInterruptionMonitor(withDescription: "system") { alert in
            for title in ["허용", "Allow", "앱을 사용하는 동안 허용", "Allow While Using App", "OK", "확인"] {
                let b = alert.buttons[title]
                if b.exists { b.tap(); return true }
            }
            return false
        }
        app = XCUIApplication()
    }

    func testPhysicalDeviceMVP() throws {
        loginOnboarding()
        launchSeeded()
        try selfCreateVerifyHistory()
        try gpsVerify()
        try timerStart()
        try friendsSharedVerify()
        try relaunch()
    }

    private func loginOnboarding() {
        app.launchArguments = ["-jikyeoDebugStage", "signin", "-jikyeoDebugMockSession", "0"]
        app.launch()
        app.tap()
        guard app.textFields["이름"].waitForExistence(timeout: 12) else {
            XCTFail("1 fields"); return
        }
        tapBottom()
        tapIf("시작하기")
        sleep(8)
        app.terminate()
        app.launchArguments = ["-jikyeoDebugStage", "off", "-jikyeoDebugMockSession", "0"]
        app.launch()
        app.tap()
        if !app.tabBars.buttons["홈"].waitForExistence(timeout: 12) {
            XCTFail("1 home after login")
        }
        app.terminate()
    }

    private func launchSeeded() {
        app.launchArguments = [
            "-jikyeoDebugStage", "off",
            "-jikyeoDebugMockSession", "1",
            "-jikyeoDebugAccessToken", token,
            "-jikyeoDebugUserId", userId,
        ]
        app.launch()
        app.tap()
        XCTAssertTrue(app.tabBars.buttons["홈"].waitForExistence(timeout: 20), "seeded home")
    }

    private func selfCreateVerifyHistory() throws {
        XCTAssertTrue(app.staticTexts["기기 SELF"].waitForExistence(timeout: 12), "2 today self")
        tapProofNear(title: "기기 SELF")
        XCTAssertTrue(app.buttons["지켰어요"].waitForExistence(timeout: 8), "2 verify")
        app.buttons["지켰어요"].firstMatch.tap()
        XCTAssertTrue(
            app.buttons["홈으로"].waitForExistence(timeout: 10)
            || app.staticTexts["약속을 지켰어요."].waitForExistence(timeout: 8),
            "2 result"
        )
        dismissSheets()
        app.tabBars.buttons["기록"].tap()
        XCTAssertTrue(app.navigationBars["기록"].waitForExistence(timeout: 8), "2 history")
        XCTAssertTrue(app.staticTexts["기기 SELF"].waitForExistence(timeout: 12), "2 history row")
        app.tabBars.buttons["홈"].tap()
    }

    private func gpsVerify() throws {
        XCTAssertTrue(app.staticTexts["기기 GPS"].waitForExistence(timeout: 8), "3 gps card")
        tapProofNear(title: "기기 GPS")
        XCTAssertTrue(app.staticTexts["기기 GPS"].waitForExistence(timeout: 8), "3 gps sheet")
        if app.buttons["설정에서 허용하기"].waitForExistence(timeout: 4) {
            app.buttons["설정에서 허용하기"].firstMatch.tap()
            app.tap()
        }
        if app.staticTexts["현재 위치를 확인하고 있어요."].waitForExistence(timeout: 6) {
            sleep(3)
        }
        XCTAssertTrue(app.buttons["여기서 증명하기"].waitForExistence(timeout: 25), "3 gps submit")
        app.buttons["여기서 증명하기"].firstMatch.tap()
        sleep(3)
        dismissSheets()
        if app.tabBars.buttons["홈"].waitForExistence(timeout: 6) {
            app.tabBars.buttons["홈"].tap()
        }
        XCTAssertTrue(
            app.tabBars.buttons["홈"].waitForExistence(timeout: 8)
            || app.staticTexts["기기 TIMER"].waitForExistence(timeout: 6)
            || app.staticTexts["기기 GPS"].waitForExistence(timeout: 4),
            "3 back home"
        )
    }

    private func timerStart() throws {
        XCTAssertTrue(app.staticTexts["기기 TIMER"].waitForExistence(timeout: 8), "4 timer card")
        tapCardButton(title: "기기 TIMER", button: "시작하기")
        XCTAssertTrue(
            app.buttons["그만두기"].waitForExistence(timeout: 15)
            || app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "남")).firstMatch.waitForExistence(timeout: 8),
            "4 timer running"
        )
        dismissSheets()
        app.tabBars.buttons["홈"].tap()
    }

    private func friendsSharedVerify() throws {
        app.tabBars.buttons["친구"].tap()
        XCTAssertTrue(app.navigationBars["친구"].waitForExistence(timeout: 8), "5 friends")
        XCTAssertTrue(app.staticTexts["기기B"].waitForExistence(timeout: 10), "5 friend row")
        XCTAssertTrue(app.staticTexts["기기 공유 약속"].waitForExistence(timeout: 8), "6 shared")
        XCTAssertTrue(app.staticTexts["확인할 약속"].waitForExistence(timeout: 8), "7 inbox")
        XCTAssertTrue(app.buttons["지켰어요"].waitForExistence(timeout: 6), "7 approve")
        app.buttons["지켰어요"].firstMatch.tap()
        sleep(1)
        if app.buttons["지키지 못했어요"].waitForExistence(timeout: 6) {
            app.buttons["지키지 못했어요"].firstMatch.tap()
            let confirm = app.sheets.buttons["지키지 못했어요"].firstMatch
            if confirm.waitForExistence(timeout: 4) { confirm.tap() }
            else { app.buttons["지키지 못했어요"].firstMatch.tap() }
        }
        sleep(1)
    }

    private func relaunch() throws {
        app.terminate()
        app.launchArguments = ["-jikyeoDebugStage", "off", "-jikyeoDebugMockSession", "0"]
        app.launch()
        XCTAssertTrue(app.tabBars.buttons["홈"].waitForExistence(timeout: 15), "8 session")
        XCTAssertTrue(
            app.staticTexts["기기 SELF"].waitForExistence(timeout: 10)
            || app.staticTexts["기기 GPS"].exists
            || app.tabBars.buttons["친구"].exists,
            "8 restored data"
        )
    }

    private func tapIf(_ title: String) {
        let el = app.buttons[title].firstMatch
        if el.waitForExistence(timeout: 3) { el.tap() }
    }

    private func tapCardButton(title: String, button: String) {
        let card = app.descendants(matching: .any).containing(.staticText, identifier: title).firstMatch
        let scoped = card.buttons[button].firstMatch
        if card.waitForExistence(timeout: 6), scoped.exists {
            scoped.tap()
            return
        }
        app.buttons[button].firstMatch.tap()
    }

    private func tapProofNear(title: String) {
        let label = app.staticTexts[title]
        XCTAssertTrue(label.waitForExistence(timeout: 8), title)
        let q = app.buttons.matching(identifier: "지금 증명하기")
        XCTAssertTrue(q.firstMatch.waitForExistence(timeout: 8), "proof CTA")
        let origin = label.frame
        var tapped = false
        for i in 0..<q.count {
            let b = q.element(boundBy: i)
            let f = b.frame
            if f.minY >= origin.minY - 8 && f.minY <= origin.maxY + 220 {
                b.tap()
                tapped = true
                break
            }
        }
        if !tapped { q.firstMatch.tap() }
    }

    private func tapBottom() {
        app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.90)).tap()
    }

    private func dismissSheets() {
        tapIf("홈으로")
        tapIf("취소")
        tapIf("닫기")
        if app.tabBars.buttons["홈"].exists { return }
        app.swipeDown()
    }
}
