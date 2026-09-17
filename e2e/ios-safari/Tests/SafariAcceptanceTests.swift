import XCTest

/// A standalone test runner. It never installs or launches app.riftsys.ios,
/// logs into an account, sends an agent task, or inspects other Safari tabs.
final class SafariAcceptanceTests: XCTestCase {
    private func fixtureURL(_ key: String) throws -> URL {
        let value = ProcessInfo.processInfo.environment[key] ?? ""
        guard let url = URL(string: value), url.scheme == "http",
              let host = url.host,
              host == "127.0.0.1" || host.hasPrefix("192.168.") || host.hasPrefix("10.") || (16...31).contains(Int(host.split(separator: ".").dropFirst().first ?? "") ?? -1) && host.hasPrefix("172.") else {
            throw XCTSkip("Provide the isolated local fixture URL in \(key)")
        }
        return url
    }

    @MainActor private func record(_ safari: XCUIApplication, _ name: String) {
        let attachment = XCTAttachment(screenshot: safari.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    @MainActor func testBuildKeyboardActivityAndInteractivePreview() throws {
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.open(try fixtureURL("RIFT_SAFARI_BUILD_URL"))
        let draft = safari.textViews["Message RIFT"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        draft.tap()
        draft.typeText("Preserve this physical Safari draft")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(draft.isHittable)
        XCTAssertLessThanOrEqual(draft.frame.maxX, safari.frame.maxX + 1)
        let activity = safari.buttons["Open mobile activity"]
        XCTAssertTrue(activity.isHittable)
        record(safari, "Build keyboard and reachable controls")
        activity.tap()
        let close = safari.buttons["Close RIFT computer"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        XCTAssertTrue(close.isHittable)
        record(safari, "Build full-screen Activity")
        close.tap()
        XCTAssertTrue((draft.value as? String ?? "").contains("Preserve this physical Safari draft"))
        safari.buttons["Open mobile preview"].tap()
        let previewButton = safari.buttons["Try preview"]
        XCTAssertTrue(previewButton.waitForExistence(timeout: 15))
        previewButton.tap()
        XCTAssertTrue(safari.buttons["Interacted"].waitForExistence(timeout: 5))
        record(safari, "Interactive embedded preview")
        safari.buttons["Close Live Preview"].tap()
        XCTAssertTrue((draft.value as? String ?? "").contains("Preserve this physical Safari draft"))
    }

    @MainActor func testHackKeyboardAndTaskNavigation() throws {
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.open(try fixtureURL("RIFT_SAFARI_HACK_URL"))
        let draft = safari.textViews["Security agent command"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 30))
        draft.tap()
        draft.typeText("Preserve the Hack report draft")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(draft.isHittable)
        let tasks = safari.buttons["Show security tasks"]
        XCTAssertTrue(tasks.isHittable)
        record(safari, "Hack keyboard and task navigation")
        tasks.tap()
        let close = safari.buttons["Close security tasks"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        XCTAssertTrue(close.isHittable)
        close.tap()
        XCTAssertTrue((draft.value as? String ?? "").contains("Preserve the Hack report draft"))
        record(safari, "Hack draft restored after tasks")
    }
}
