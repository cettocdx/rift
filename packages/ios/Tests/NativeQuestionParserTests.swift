import XCTest
import SwiftUI
@testable import RIFT
final class NativeQuestionParserTests: XCTestCase {
    @MainActor func testFormattedResponseRendersInBothAppearances() throws {
        let message = "**Build complete**\n\nReview the [project](https://riftsys.app) and run `swift test`.\n\n```swift\nlet title = \"RIFT\"\nprint(title)\n```\n\nThe code stays selectable."
        for scheme in [ColorScheme.dark, .light] {
            let view = NativeMarkdownText(text: message).padding(20).frame(width: 390)
                .foregroundStyle(scheme == .dark ? Color.white : .black)
                .background(scheme == .dark ? Color.black : .white)
                .environment(\.colorScheme, scheme)
                .tint(.primary)
            // ImageRenderer does not capture the UIKit-backed scroll content.
            // Render the actual hosting hierarchy so fenced-code pixels count.
            let controller = UIHostingController(rootView: view)
            let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 400))
            window.overrideUserInterfaceStyle = scheme == .dark ? .dark : .light
            window.rootViewController = controller
            window.makeKeyAndVisible()
            controller.view.backgroundColor = scheme == .dark ? .black : .white
            controller.view.frame = window.bounds
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in
                controller.view.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
            }
            window.isHidden = true
            XCTAssertGreaterThan(image.size.height, 100)
            let attachment = XCTAttachment(image: image)
            attachment.name = "Native response formatting \(scheme)"
            attachment.lifetime = .keepAlways
            add(attachment)
        }
    }
    func testSameLineBacktickSpanIsNotDiscardedAsAnOpeningFence() {
        let blocks = NativeMarkdown.blocks("```inline code```")
        XCTAssertEqual(blocks.count, 1)
        XCTAssertFalse(blocks[0].isCode)
        XCTAssertEqual(String(NativeMarkdown.inline(blocks[0].text).characters), "inline code")
    }
    func testNativeInlineMarkdownRetainsFormattingAndNewlines() {
        let text = NativeMarkdown.inline("**Ready**\n\n[Open RIFT](https://riftsys.app)")
        XCTAssertEqual(String(text.characters), "Ready\n\nOpen RIFT")
        XCTAssertTrue(text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
        XCTAssertTrue(text.runs.contains { $0.link?.absoluteString == "https://riftsys.app" })
    }
    func testFencedCodeKeepsLiteralContentAndStreamingRemainder() {
        let blocks = NativeMarkdown.blocks("Before\n```swift\n  let value = \"**literal**\"\n```\nAfter")
        XCTAssertEqual(blocks.map(\.isCode), [false, true, false])
        XCTAssertEqual(blocks[1].text, "  let value = \"**literal**\"")
        XCTAssertEqual(blocks[2].text, "After")
        let streaming = NativeMarkdown.blocks("```swift\nlet value =")
        XCTAssertEqual(streaming.last?.text, "let value =")
        XCTAssertEqual(streaming.last?.isCode, true)
    }
    func testShorterFenceDoesNotCloseLongerCodeFence() {
        let blocks = NativeMarkdown.blocks("````text\n```\nexample\n````")
        XCTAssertEqual(blocks.count, 1)
        XCTAssertEqual(blocks[0].text, "```\nexample")
    }
    func testBareQuestionPayloadBecomesACard() {
        XCTAssertEqual(NativeQuestionParser.parse(payload).first?.questions.count, 1)
    }
    func testStreamingDedicatedFenceNeverShowsProtocolLabel() {
        for prefix in ["```r", "```rift-", "```rift-questions"] {
            XCTAssertEqual(NativeQuestionParser.parse("Before\n" + prefix).map(\.text).joined(), "Before\n")
        }
    }
    func testStreamingBareQuestionPayloadDoesNotLeakJSON() {
        XCTAssertTrue(NativeQuestionParser.parse(#"{"questions":[{"question":"Choose"#).map(\.text).joined().isEmpty)
    }
    private let payload = #"{"questions":[{"id":"kind","question":"What should we build?","multi":false,"options":[{"label":"App","detail":"Native app"},{"label":"Website"}]}]}"#
    func testQuestionsBecomeCardsAndSurroundingTextKeepsItsOrder() {
        let parts = NativeQuestionParser.parse("Before\n```rift-questions\n" + payload + "\n```\nAfter")
        XCTAssertEqual(parts.count, 3)
        XCTAssertEqual(parts[0].text, "Before\n")
        XCTAssertEqual(parts[1].questions[0].options.map(\.label), ["App", "Website"])
        XCTAssertEqual(parts[2].text, "\nAfter")
        XCTAssertFalse(parts.map(\.text).joined().contains("rift-questions"))
    }
    func testIncompleteQuestionJSONIsHiddenWhileStreaming() {
        let parts = NativeQuestionParser.parse("Let's clarify.\n```rift-questions\n{\"questions\":[{")
        XCTAssertEqual(parts.map(\.text).joined(), "Let's clarify.\n")
    }
    func testNormalCodeIsNotMistakenForQuestions() {
        let code = "```json\n{\"color\":\"white\"}\n```"
        XCTAssertEqual(NativeQuestionParser.parse(code).map(\.text).joined(), code)
    }
    func testJSONLabelAlsoRecognizesRealQuestions() {
        XCTAssertEqual(NativeQuestionParser.parse("```json\n" + payload + "\n```")[0].questions.count, 1)
    }
    func testMalformedDedicatedPayloadDoesNotLeakRawJSON() {
        let text = NativeQuestionParser.parse("```rift-questions\n{not valid}\n```").map(\.text).joined()
        XCTAssertFalse(text.contains("{not valid}"))
        XCTAssertTrue(text.contains("could not be displayed"))
    }
}
