import XCTest
@testable import RIFT
final class ModelCatalogTests: XCTestCase {
    @MainActor func testHackModelSelectionSurvivesWorkspaceSwitchWithoutChangingOtherModels() {
        let store = RIFTStore()
        store.model = "build-choice"
        store.mediaModel = "studio-choice"
        store.securityModels = [ModelChoice(id: "first", title: "First"), ModelChoice(id: "second", title: "Second")]
        store.workspace = .hack
        XCTAssertEqual(store.selectedModel, "first")
        store.selectedModel = "second"
        XCTAssertEqual(store.selectedModel, "second")
        store.workspace = .build
        XCTAssertEqual(store.selectedModel, "build-choice")
        store.workspace = .studio
        XCTAssertEqual(store.selectedModel, "studio-choice")
        store.workspace = .hack
        XCTAssertEqual(store.selectedModel, "second")
    }
    @MainActor func testComposerReadinessPreservesDraftUntilAccountAndModelAreReady() {
        let store = RIFTStore()
        store.draft = "Keep this draft"
        store.send()
        XCTAssertEqual(store.draft, "Keep this draft")
        store.signedIn = true
        store.model = "missing-model"
        XCTAssertFalse(store.canSend)
        store.send()
        XCTAssertEqual(store.draft, "Keep this draft")
        store.models = [ModelChoice(id: "test-model", title: "Test model")]
        store.model = "test-model"
        XCTAssertTrue(store.canSend)
        store.loading = true
        XCTAssertFalse(store.canSend)
        store.loading = false; store.uploading = true
        XCTAssertFalse(store.canSend)
        store.uploading = false; store.working = true
        XCTAssertFalse(store.canSend)
        store.working = false; store.draft = " \n "
        XCTAssertFalse(store.canSend)
    }
    func testEveryMobileProviderHasAnAsset() {
        let ids = ["gpt", "claude", "gemini", "grok", "kimi", "hy4", "qwen", "glm", "image-lite", "image-seedream", "image-flux", "video-veo", "video-kling", "video-seedance", "video-sora", "video-runway", "video-wan", "video-hailuo"]
        for id in ids {
            let choice = ModelChoice(id: id, title: id)
            XCTAssertNotNil(choice.logo, id)
            if let logo = choice.logo { XCTAssertNotNil(UIImage(named: logo), logo) }
        }
    }
    func testCompiledProviderArtwork() {
        for name in ["provider-gemini", "provider-openai", "provider-claude"] {
            guard let image = UIImage(named: name) else { XCTFail(name); continue }
            print("RIFT provider size \(name): \(image.size)")
            let renderer = UIGraphicsImageRenderer(size: CGSize(width: 240, height: 240))
            let rendered = renderer.image { context in
                UIColor.darkGray.setFill(); context.fill(CGRect(x: 0, y: 0, width: 240, height: 240))
                image.draw(in: CGRect(x: 20, y: 20, width: 200, height: 200))
            }
            let attachment = XCTAttachment(image: rendered); attachment.name = name; attachment.lifetime = .keepAlways; add(attachment)
        }
    }
    func testAssessmentCatalogIsCompleteAndUnique() {
        XCTAssertEqual(hackTaskCatalog.count, 50)
        XCTAssertEqual(Set(hackTaskCatalog.map(\.id)).count, hackTaskCatalog.count)
        XCTAssertTrue(hackTaskCatalog.allSatisfy { !$0.prompt.isEmpty && !$0.title.isEmpty })
    }
}
