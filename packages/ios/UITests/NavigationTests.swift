import XCTest

final class NavigationTests: XCTestCase {
    @MainActor private func attach(_ app: XCUIApplication, _ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot()); shot.name = name; shot.lifetime = .keepAlways; add(shot)
    }
    @MainActor func testNativeDrawerSettingsAndComposer() throws {
        let app = XCUIApplication()
        continueAfterFailure = false
        app.launch()
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10))
        app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["open-settings"].waitForExistence(timeout: 3))
        XCTAssertFalse(app.staticTexts["Monthly usage"].exists)
        attach(app, "Native drawer")
        app.buttons["open-settings"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 3))
        XCTAssertTrue(app.buttons["usage-settings"].exists)
        attach(app, "Native settings")
        app.navigationBars["Settings"].buttons["Done"].tap()
        XCTAssertTrue(app.navigationBars["Settings"].waitForNonExistence(timeout: 5))
        app.buttons.matching(identifier: "New chat").firstMatch.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let field = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 3))
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 3))
        field.typeText("Native iOS draft")
        let typed = NSPredicate(format: "value == %@", "Native iOS draft")
        expectation(for: typed, evaluatedWith: field)
        waitForExpectations(timeout: 5)
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = "Native iOS composer and keyboard"
        attachment.lifetime = .keepAlways
        add(attachment)
    }
}
