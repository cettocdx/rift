import XCTest
/// Explicit opt-in: TEST_RUNNER_RIFT_LIVE_SMOKE=1 xcodebuild ... -only-testing:RIFTUITests/LiveMobileTests test
final class LiveMobileTests: XCTestCase {
    @MainActor func testSavedBuildActivitySurvivesReopen() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in authenticated saved activity") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let history = app.buttons["conversation-1F633A6D-698A-403D-B12D-44E547A9CCB0"]
        XCTAssertTrue(history.waitForExistence(timeout: 15)); history.tap()
        let activity = app.buttons.matching(identifier: "agent-activity").matching(NSPredicate(format: "enabled == true")).firstMatch
        XCTAssertTrue(activity.waitForExistence(timeout: 30))
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30))
        activity.tap()
        let step = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND value == %@", "RIFT_RECONNECT_WAIT", "Completed")).firstMatch
        XCTAssertTrue(step.waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Stop task"].exists)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Saved Build activity with completed command"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testBuildResponseThroughNativeUI() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in live model call") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        let menu = app.buttons["open-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10)); menu.tap()
        let build = app.buttons["workspace-app"]
        XCTAssertTrue(build.waitForExistence(timeout: 5)); build.tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap()
        input.typeText("This is a RIFT mobile acceptance check. Do not use tools or modify files. Reply with exactly RIFT_MOBILE_OK_915.")
        let started = Date()
        app.buttons["Send message"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label MATCHES %@", "RIFT_MOBILE_OK_915[.]?")).firstMatch.waitForExistence(timeout: 120))
        print("RIFT native visible-response seconds: \(Date().timeIntervalSince(started))")
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Live native Build response"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testStudioGeneratesDownloadableArtifact() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in live image generation") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["workspace-image"].waitForExistence(timeout: 5)); app.buttons["workspace-image"].tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap()
        input.typeText("Generate one square image: a single white ceramic sphere on a matte black surface, soft light, no text. This is a mobile Studio acceptance test.")
        app.buttons["Send message"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let download = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Download ")).firstMatch
        let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            download.exists || app.buttons["Allow"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [outcome], timeout: 240), .completed)
        XCTAssertFalse(app.buttons["Allow"].exists, "Mobile tasks must run without tool approval prompts")
        XCTAssertTrue(download.exists)
        download.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Save or share ")).firstMatch.waitForExistence(timeout: 60))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Native Studio downloaded artifact"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testSavedStudioArtifactDownloadsWithoutRegeneration() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in existing authenticated Studio result") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let search = app.descendants(matching: .any).matching(identifier: "history-search").firstMatch
        if !search.waitForExistence(timeout: 5) { print("RIFT DRAWER HIERARCHY: " + app.debugDescription) }
        XCTAssertTrue(search.waitForExistence(timeout: 5))
        search.tap()
        search.typeText("Ceramic Sphere Image Request")
        let history = app.buttons["conversation-50034D82-8DCE-4F34-BFCB-8E9EEFA8C935"]
        XCTAssertTrue(history.waitForExistence(timeout: 15)); history.tap()
        let download = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Download ")).firstMatch
        XCTAssertTrue(download.waitForExistence(timeout: 60))
        let visibleDownloads = app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Download ")).allElementsBoundByIndex.filter { $0.isHittable }
        let visibleDownload = try XCTUnwrap(visibleDownloads.first)
        app.buttons[visibleDownload.identifier].tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Save or share ")).firstMatch.waitForExistence(timeout: 60))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Persisted Studio file downloaded"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testHackReviewsFixtureAndOpensReport() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in live security review") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["workspace-security"].waitForExistence(timeout: 5)); app.buttons["workspace-security"].tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap()
        input.typeText("Review only this hypothetical configuration: production debug=true, session cookie HttpOnly=false. First run exactly one terminal command: printf RIFT_HACK_TOOL_OK. Use Native Hack tool check as the tool brief. Do not access networks or modify files. Give two concise findings and remediation. Finish with RIFT_HACK_CHECK_COMPLETE.")
        app.buttons["Send message"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let result = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH %@", "RIFT_HACK_CHECK_COMPLETE", "Review only this hypothetical")).firstMatch
        let outcome = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            result.exists || app.buttons["Allow"].exists
        }, object: nil)
        XCTAssertEqual(XCTWaiter.wait(for: [outcome], timeout: 180), .completed)
        XCTAssertFalse(app.buttons["Allow"].exists)
        XCTAssertTrue(result.exists)
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30))
        let activity = app.buttons.matching(identifier: "agent-activity").matching(NSPredicate(format: "enabled == true")).firstMatch
        for _ in 0..<4 where !activity.exists { app.scrollViews["chat-transcript"].swipeDown() }
        XCTAssertTrue(activity.waitForExistence(timeout: 10)); activity.tap()
        let command = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND value == %@", "Native Hack tool check", "Completed")).firstMatch
        XCTAssertTrue(command.waitForExistence(timeout: 10))
        activity.tap()
        app.buttons["hack-report"].tap()
        XCTAssertTrue(app.navigationBars["Assessment report"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons["Export report"].isEnabled)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Live Hack assessment report"; attachment.lifetime = .keepAlways; add(attachment)
    }
    @MainActor func testBuildContinuesAfterAppTermination() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in live recovery test") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 10)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons["workspace-app"].waitForExistence(timeout: 5)); app.buttons["workspace-app"].tap()
        let input = app.descendants(matching: .any).matching(identifier: "message-input").firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5)); input.tap()
        input.typeText("RIFT recovery acceptance test. Say RIFT_RECONNECT_STARTED, then run exactly one command: python3 -c 'import time; time.sleep(45); print(12345)'. This only waits and prints; do not access the network or edit files. Use RIFT_RECONNECT_WAIT as the tool brief. After it returns, reply exactly RIFT_RECONNECT_COMPLETE. Do not repeat the command.")
        app.buttons["Send message"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let started = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH %@", "RIFT_RECONNECT_STARTED", "RIFT recovery acceptance test")).firstMatch
        XCTAssertTrue(started.waitForExistence(timeout: 120))
        XCTAssertFalse(app.buttons["Allow"].exists, "Mobile Build must not ask for tool approval")
        XCTAssertTrue(app.buttons["Stop task"].exists)
        app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let current = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-")).firstMatch
        XCTAssertTrue(current.waitForExistence(timeout: 5))
        let conversationID = current.identifier
        print("RIFT recovery conversation: " + conversationID)
        app.terminate(); app.launch()
        XCTAssertTrue(app.buttons["open-menu"].waitForExistence(timeout: 15)); app.buttons["open-menu"].coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        XCTAssertTrue(app.buttons[conversationID].waitForExistence(timeout: 15)); app.buttons[conversationID].tap()
        let completed = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH %@", "RIFT_RECONNECT_COMPLETE", "RIFT recovery acceptance test")).firstMatch
        XCTAssertTrue(completed.waitForExistence(timeout: 180))
        XCTAssertTrue(app.buttons["Send message"].waitForExistence(timeout: 30))
        XCTAssertEqual(app.staticTexts.matching(NSPredicate(format: "label == %@", "RIFT_RECONNECT_COMPLETE")).count, 1)
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Build recovered after app termination"; attachment.lifetime = .keepAlways; add(attachment)
    }

    @MainActor func testSavedHackToolHistory() throws {
        guard ProcessInfo.processInfo.environment["RIFT_LIVE_SMOKE"] == "1" else { throw XCTSkip("Opt-in saved Hack evidence") }
        let app = XCUIApplication(); app.launch(); continueAfterFailure = false
        let menu = app.buttons["open-menu"]
        XCTAssertTrue(menu.waitForExistence(timeout: 10))
        menu.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let current = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "conversation-")).firstMatch
        if !current.waitForExistence(timeout: 10) {
            print("RIFT MENU SNAPSHOT: " + app.debugDescription)
            let snapshot = XCTAttachment(screenshot: app.screenshot()); snapshot.name = "Missing native history"; snapshot.lifetime = .keepAlways; add(snapshot)
        }
        XCTAssertTrue(current.waitForExistence(timeout: 10))
        print("RIFT saved Hack conversation: " + current.identifier)
        current.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
        let result = app.staticTexts.matching(NSPredicate(format: "label CONTAINS %@ AND NOT label BEGINSWITH %@", "RIFT_HACK_CHECK_COMPLETE", "Review only this hypothetical")).firstMatch
        XCTAssertTrue(result.waitForExistence(timeout: 30))
        let activity = app.buttons.matching(identifier: "agent-activity").matching(NSPredicate(format: "enabled == true")).firstMatch
        for _ in 0..<4 where !activity.exists { app.scrollViews["chat-transcript"].swipeDown() }
        XCTAssertTrue(activity.waitForExistence(timeout: 10)); activity.tap()
        let command = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ AND value == %@", "Native Hack tool check", "Completed")).firstMatch
        XCTAssertTrue(command.waitForExistence(timeout: 10))
        let attachment = XCTAttachment(screenshot: app.screenshot()); attachment.name = "Saved native Hack tool evidence"; attachment.lifetime = .keepAlways; add(attachment)
    }

}


/// Mobile web regression using iOS Safari's real software keyboard.
/// Requires the isolated mobile fixture on port 3059; never signs in or sends a task.
final class MobileWebKeyboardTests: XCTestCase {
    @MainActor func testSafariKeyboardAndActivity() throws {
        guard ProcessInfo.processInfo.environment["RIFT_MOBILE_WEB_FIXTURE"] == "1" else {
            throw XCTSkip("Opt-in Safari fixture on 3059")
        }
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let closeTip = safari.buttons["Close"].firstMatch
        if closeTip.exists && closeTip.isHittable { closeTip.tap() }
        let draft = safari.textViews["Message RIFT"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 15), safari.debugDescription)
        draft.tap()
        draft.typeText("Mobile keyboard keeps this draft")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 5))
        let typing = XCTAttachment(screenshot: safari.screenshot())
        typing.name = "Safari keyboard open"; typing.lifetime = .keepAlways; add(typing)
        XCTAssertTrue(draft.isHittable)
        XCTAssertLessThan(draft.frame.maxX, safari.frame.maxX + 1)
        let activity = safari.buttons["Open mobile activity"]
        print(safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewport ")).firstMatch.label)
        XCTAssertTrue(activity.isHittable)
        activity.tap()
        let close = safari.buttons["Close RIFT computer"]
        XCTAssertTrue(close.waitForExistence(timeout: 10))
        XCTAssertTrue(close.isHittable)
        let panel = XCTAttachment(screenshot: safari.screenshot())
        panel.name = "Safari activity after keyboard"; panel.lifetime = .keepAlways; add(panel)
        close.tap()
        XCTAssertTrue(draft.waitForExistence(timeout: 5))
        XCTAssertTrue((draft.value as? String ?? "").contains("Mobile keyboard keeps this draft"))
        let preview = safari.buttons["Open mobile preview"]
        XCTAssertTrue(preview.isHittable)
        preview.tap()
        let closePreview = safari.buttons["Close Live Preview"]
        XCTAssertTrue(closePreview.waitForExistence(timeout: 10))
        XCTAssertTrue(closePreview.isHittable)
        let previewImage = XCTAttachment(screenshot: safari.screenshot())
        previewImage.name = "Safari live preview"; previewImage.lifetime = .keepAlways; add(previewImage)
        closePreview.tap()
        XCTAssertTrue((draft.value as? String ?? "").contains("Mobile keyboard keeps this draft"))
    }
}

final class MobileHackWebKeyboardTests: XCTestCase {
    @MainActor func testSafariHackKeyboardAndTasks() throws {
        guard ProcessInfo.processInfo.environment["RIFT_MOBILE_WEB_FIXTURE"] == "1" else {
            throw XCTSkip("Opt-in Safari Hack fixture on 3061")
        }
        continueAfterFailure = false
        let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
        safari.activate()
        let draft = safari.textViews["Security agent command"].firstMatch
        XCTAssertTrue(draft.waitForExistence(timeout: 15), safari.debugDescription)
        draft.tap()
        draft.typeText("Keep this report draft")
        XCTAssertTrue(safari.keyboards.firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(draft.isHittable)
        let tasks = safari.buttons["Show task sidebar"]
        XCTAssertTrue(tasks.isHittable)
        let typing = XCTAttachment(screenshot: safari.screenshot())
        typing.name = "Safari Hack keyboard open"; typing.lifetime = .keepAlways; add(typing)
        print(safari.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "Viewport ")).firstMatch.label)
        tasks.tap()
        let close = safari.buttons["Hide task sidebar"]
        XCTAssertTrue(close.waitForExistence(timeout: 5))
        XCTAssertTrue(close.isHittable)
        close.tap()
        XCTAssertTrue((draft.value as? String ?? "").contains("Keep this report draft"))
    }
}
