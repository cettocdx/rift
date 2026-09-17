import XCTest
import SwiftUI
@testable import RIFT

final class ModelPickerLayoutTests: XCTestCase {
    @MainActor func testModelPickerHasOneStableSheetHeight() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first { $0.isKeyWindow }
        let store = RIFTStore()
        store.workspace = .studio
        store.mediaModels = [ModelChoice(id: "image-gemini", title: "Gemini"), ModelChoice(id: "video-veo", title: "Veo")]
        let host = UIHostingController(rootView: Text("Model picker layout test").sheet(isPresented: .constant(true)) { NativeModelPicker().environment(store) })
        let window = UIWindow(windowScene: scene)
        window.rootViewController = host; window.makeKeyAndVisible()
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        for _ in 0..<30 where host.presentedViewController == nil { try await Task.sleep(for: .milliseconds(100)) }
        let presented = try XCTUnwrap(host.presentedViewController)
        let sheet = try XCTUnwrap(presented.sheetPresentationController)
        XCTAssertEqual(sheet.detents.count, 1, "Scrolling the model list must not resize the sheet")
        try await Task.sleep(for: .milliseconds(500))
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
        let image = renderer.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let shot = XCTAttachment(image: image); shot.name = "Fixed model picker"; shot.lifetime = .keepAlways; add(shot)
    }
}


extension ModelPickerLayoutTests {
    @MainActor func testThinkingPresentationInLightAndDark() async throws {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.first as? UIWindowScene)
        let previous = scene.windows.first { $0.isKeyWindow }
        let store = RIFTStore()
        store.signedIn = true; store.working = true
        store.models = [ModelChoice(id: "build-gpt", title: "GPT")]; store.model = "build-gpt"
        store.efforts = ["build-gpt": ["low", "medium", "high"]]
        store.messages = [NativeMessage(id: "question", role: "user", text: "Compare the two approaches and check the documentation.")]
        store.activityAnchor = 1
        store.agentActivity.apply(["type": "reasoning-start"])
        store.agentActivity.apply(["type": "reasoning-delta", "delta": "I’m comparing the requirements and checking which approach fits the project. Next, I’ll verify the relevant documentation."])
        for scheme: ColorScheme in [.dark, .light] {
            let host = UIHostingController(rootView: WorkspaceView().environment(store).preferredColorScheme(scheme).tint(Color.primary))
            let window = UIWindow(windowScene: scene)
            window.rootViewController = host; window.makeKeyAndVisible()
            defer { window.isHidden = true; previous?.makeKeyAndVisible() }
            try await Task.sleep(for: .milliseconds(450))
            let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
            let image = renderer.image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
            let shot = XCTAttachment(image: image); shot.name = "Thinking preview \(scheme)"; shot.lifetime = .keepAlways; add(shot)
        }
        let details = UIHostingController(rootView: NavigationStack { ScrollView { AgentActivityDetails(activity: store.agentActivity, working: true).padding(20) }.navigationTitle("Activity").navigationBarTitleDisplayMode(.inline) }.preferredColorScheme(.dark).tint(Color.primary))
        let window = UIWindow(windowScene: scene); window.rootViewController = details; window.makeKeyAndVisible()
        defer { window.isHidden = true; previous?.makeKeyAndVisible() }
        try await Task.sleep(for: .milliseconds(450))
        let image = UIGraphicsImageRenderer(bounds: window.bounds).image { _ in window.drawHierarchy(in: window.bounds, afterScreenUpdates: true) }
        let shot = XCTAttachment(image: image); shot.name = "Thinking details open"; shot.lifetime = .keepAlways; add(shot)
    }
}
