import XCTest
import UIKit

enum QASupport {
    static let forbiddenPhotoOnGps = ["사진으로", "카메라", "촬영"]
    static let forbiddenGpsOnPhoto = ["장소에 도착", "위치 접근", "여기서 증명"]
    static let forbiddenTimerOnOthers = ["집중 타이머", "몇 분 동안 집중"]
    static let forbiddenFriendOnSelf = ["친구가 확인", "친구가 약속을 지켰는지"]
    static let rawApiFragments = ["DomainError", "HTTP_", "stack", "ECONNREFUSED", "prisma"]

    static func launch(
        _ app: XCUIApplication,
        stage: String,
        mockSession: Bool = true,
        extraArgs: [String] = []
    ) {
        app.launchArguments = [
            "-jikyeoDebugStage", stage,
            "-jikyeoDebugMockSession", mockSession ? "1" : "0",
        ] + extraArgs
        app.launch()
    }

    static func installPermissionMonitor(_ test: XCTestCase) {
        test.addUIInterruptionMonitor(withDescription: "system-permission") { alert in
            for title in ["허용", "Allow", "앱을 사용하는 동안 허용", "Allow While Using App", "OK", "확인"] {
                let b = alert.buttons[title]
                if b.exists { b.tap(); return true }
            }
            return false
        }
    }

    static func assertNoRawAPIErrors(_ app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
        let snapshot = visibleText(app)
        for frag in rawApiFragments {
            XCTAssertFalse(snapshot.contains(frag), "raw API fragment \(frag)", file: file, line: line)
        }
    }

    static func assertNone(_ app: XCUIApplication, _ needles: [String], file: StaticString = #filePath, line: UInt = #line) {
        let snapshot = visibleText(app)
        for n in needles where !n.isEmpty {
            XCTAssertFalse(snapshot.contains(n), "unexpected copy: \(n)", file: file, line: line)
        }
    }

    static func visibleText(_ app: XCUIApplication) -> String {
        app.staticTexts.allElementsBoundByIndex.map(\.label).joined(separator: "\n")
            + "\n"
            + app.buttons.allElementsBoundByIndex.map(\.label).joined(separator: "\n")
    }

    static func assertCTAMinSize(_ el: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(el.exists, "missing CTA", file: file, line: line)
        XCTAssertGreaterThanOrEqual(el.frame.height, 44, "CTA height \(el.frame.height)", file: file, line: line)
        XCTAssertGreaterThanOrEqual(el.frame.width, 44, "CTA width \(el.frame.width)", file: file, line: line)
    }

    @discardableResult
    static func capture(_ app: XCUIApplication, name: String, test: XCTestCase) -> URL? {
        let shot = app.screenshot()
        let attachment = XCTAttachment(screenshot: shot)
        attachment.name = name
        attachment.lifetime = .keepAlways
        test.add(attachment)

        let root = screenshotRoot()
        let current = root.appendingPathComponent("Current", isDirectory: true)
        let baseline = root.appendingPathComponent("Baseline", isDirectory: true)
        try? FileManager.default.createDirectory(at: current, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: baseline, withIntermediateDirectories: true)
        let currentURL = current.appendingPathComponent("\(name).png")
        try? shot.pngRepresentation.write(to: currentURL)
        let baselineURL = baseline.appendingPathComponent("\(name).png")
        if !FileManager.default.fileExists(atPath: baselineURL.path) {
            try? shot.pngRepresentation.write(to: baselineURL)
        } else if let base = UIImage(contentsOfFile: baselineURL.path),
                  let now = UIImage(data: shot.pngRepresentation) {
            XCTAssertEqual(Int(base.size.width), Int(now.size.width), "\(name) width")
            XCTAssertEqual(Int(base.size.height), Int(now.size.height), "\(name) height")
        }
        return currentURL
    }

    static func screenshotRoot() -> URL {
        if let env = ProcessInfo.processInfo.environment["JIKYEO_SCREENSHOT_DIR"], !env.isEmpty {
            return URL(fileURLWithPath: env, isDirectory: true)
        }
        return URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .appendingPathComponent("Screenshots", isDirectory: true)
    }
}
