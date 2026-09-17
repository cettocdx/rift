import XCTest
@testable import RIFT

final class NativeActivityHistoryTests: XCTestCase {
    func testNewTurnKeepsPreviousActivityBeforeItsAnswer() {
        let activity = AgentActivity(steps: [.init(id: "read", title: "Reading files", state: .completed)], title: "Activity")
        var messages = [NativeMessage(id: "u1", role: "user", text: "Inspect"), NativeMessage(id: "a1", role: "assistant", text: "Done")]
        NativeMessageHistory.preserveActivity(activity, at: 1, in: &messages)
        messages.append(NativeMessage(id: "u2", role: "user", text: "Continue"))
        XCTAssertEqual(messages, [
            NativeMessage(id: "u1", role: "user", text: "Inspect"),
            NativeMessage(id: "live-activity:read", role: "assistant", text: "", savedActivity: activity),
            NativeMessage(id: "a1", role: "assistant", text: "Done"),
            NativeMessage(id: "u2", role: "user", text: "Continue")
        ])
    }

    func testReplayedToolsAreNotDuplicatedWhenFreezingNextTurn() {
        let saved = AgentActivity(steps: [.init(id: "read", title: "Read", state: .completed)], title: "Previous activity")
        let live = AgentActivity(steps: [saved.steps[0], .init(id: "edit", title: "Edit", state: .interrupted)], title: "Activity paused")
        let original = NativeMessage(id: "saved:activity", role: "assistant", text: "", savedActivity: saved)
        var messages = [original]
        NativeMessageHistory.preserveActivity(live, at: 1, in: &messages)
        NativeMessageHistory.preserveActivity(live, at: 1, in: &messages)
        XCTAssertEqual(messages, [original, NativeMessage(id: "live-activity:edit", role: "assistant", text: "", savedActivity: AgentActivity(steps: [live.steps[1]], title: "Activity paused"))])
    }

    func testEmptyActivityDoesNotCreateAnEmptyChatRow() {
        var messages = [NativeMessage(id: "a", role: "assistant", text: "Hello")]
        let original = messages
        NativeMessageHistory.preserveActivity(AgentActivity(), at: 99, in: &messages)
        XCTAssertEqual(messages, original)
    }
}
