import XCTest
final class WorkbenchNavigationTests: XCTestCase {
    @MainActor func testStudioTemplatePreparesDraftWithoutSending() {
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        let menu = app.buttons["open-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10)); menu.tap()
        let studio = app.buttons["workspace-image"]
        XCTAssertTrue(studio.waitForExistence(timeout: 3)); studio.tap()
        let template = app.buttons["studio-template-film"]
        XCTAssertTrue(template.waitForExistence(timeout: 5))
        let gallery = XCTAttachment(screenshot: app.screenshot()); gallery.name = "Studio gallery"; gallery.lifetime = .keepAlways; add(gallery)
        template.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let use = app.buttons["Use template"]
        XCTAssertTrue(use.waitForExistence(timeout: 3))
        let detail = XCTAttachment(screenshot: app.screenshot()); detail.name = "Studio template detail"; detail.lifetime = .keepAlways; add(detail)
        use.tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue((input.value as? String ?? "").contains("cinematic film"))
        XCTAssertFalse(app.buttons["Stop task"].exists)
    }
    @MainActor func testRepeatedWorkspaceNavigationAndTaskDraft() {
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        for _ in 0..<3 {
            for section in ["image", "security", "app"] {
                let menu = app.buttons["open-menu"]
                XCTAssertTrue(menu.waitForExistence(timeout: 10))
                menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                let workspace = app.buttons["workspace-" + section]
                XCTAssertTrue(workspace.waitForExistence(timeout: 3))
                workspace.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                if section == "security" {
                    let tasks = app.buttons["hack-tasks"]
                    XCTAssertTrue(tasks.waitForExistence(timeout: 3))
                    tasks.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    let preset = app.buttons.containing(.staticText, identifier: "Passive OSINT").firstMatch
                    XCTAssertTrue(preset.waitForExistence(timeout: 3))
                    preset.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
                    let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
                    XCTAssertTrue((input.value as? String ?? "").contains("passive OSINT"))
                }
            }
        }
    }
}

extension WorkbenchNavigationTests {
    @MainActor func testActivityAndPreviewAreReachableWithoutLosingDraft() {
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-activity"].waitForExistence(timeout: 10))
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap(); input.typeText("Preserve this mobile draft")
        app.buttons["open-activity"].tap()
        XCTAssertTrue(app.navigationBars["Activity"].waitForExistence(timeout: 5))
        app.segmentedControls.buttons["Preview"].tap()
        XCTAssertTrue(app.staticTexts["No preview yet"].waitForExistence(timeout: 5))
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Native Activity and Preview panel"; shot.lifetime = .keepAlways; add(shot)
        app.navigationBars["Preview"].buttons["Done"].tap()
        XCTAssertTrue((input.value as? String ?? "").contains("Preserve this mobile draft"))
        app.buttons["open-preview"].tap()
        XCTAssertTrue(app.navigationBars["Preview"].waitForExistence(timeout: 5))
        app.navigationBars["Preview"].buttons["Done"].tap()
        XCTAssertTrue(app.buttons["open-menu"].isHittable)
    }
}

extension WorkbenchNavigationTests {
    @MainActor func testTappingTranscriptDismissesKeyboardAndKeepsDraft() {
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10))
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        input.tap(); input.typeText("Keep my draft after dismissing")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5))
        app.scrollViews["chat-transcript"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.35)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5))
        XCTAssertTrue((input.value as? String ?? "").contains("Keep my draft after dismissing"))
        app.buttons["open-activity"].tap()
        XCTAssertTrue(app.navigationBars["Activity"].waitForExistence(timeout: 3))
        app.navigationBars["Activity"].buttons["Done"].tap()
        XCTAssertTrue(app.buttons["open-menu"].isHittable)
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = "Compact toolbar with dismissed keyboard"; shot.lifetime = .keepAlways; add(shot)
    }
}
