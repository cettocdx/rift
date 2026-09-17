import XCTest
@testable import RIFT

final class AgentActivityTests: XCTestCase {
    func testTerminalStreamAndFinalReceiptRemainVisibleWithoutReplayDuplicates() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "cmd", "toolName": "run_terminal_cmd", "input": ["command": "pwd"]])
        let chunk: [String: Any] = ["type": "data-terminal", "id": "chunk-1", "data": ["toolCallId": "cmd", "terminal": "/home/user\n"]]
        activity.apply(chunk); activity.apply(chunk)
        XCTAssertEqual(activity.steps[0].command, "pwd")
        XCTAssertEqual(activity.steps[0].output, "/home/user\n")
        activity.apply(["type": "tool-output-available", "toolCallId": "cmd", "output": ["result": ["output": "/home/user\n", "exitCode": 0]]])
        XCTAssertEqual(activity.steps[0].output, "/home/user\n")
        XCTAssertEqual(activity.steps[0].exitCode, 0)
        XCTAssertEqual(activity.steps[0].state, .completed)
    }
    func testSavedTerminalRetainsFailedExitAndProviderThinking() {
        var activity = AgentActivity()
        activity.restore(parts: [
            ["type": "reasoning", "text": "Checking the supplied target"],
            ["type": "tool-run_terminal_cmd", "toolCallId": "cmd", "state": "output-available", "input": ["command": "test -f missing"], "output": ["result": ["exitCode": 1, "output": "not found"]]]
        ])
        XCTAssertEqual(activity.reasoning, "Checking the supplied target")
        XCTAssertEqual(activity.steps[0].output, "not found")
        XCTAssertEqual(activity.steps[0].state, .failed)
    }
    func testReplayHidesOnlyMatchingHistoricalCalls() {
        var history = AgentActivity()
        history.restore(parts: [
            ["type": "tool-file", "toolCallId": "old", "state": "output-available"],
            ["type": "tool-file", "toolCallId": "replaying", "state": "input-available"]
        ])
        let visible = history.excluding(["replaying"])
        XCTAssertEqual(visible.steps.map(\.id), ["old"])
        XCTAssertEqual(history.steps.count, 2)
    }
    func testReplayDoesNotDuplicateOrRestartCompletedTools() {
        var activity = AgentActivity()
        let input: [String: Any] = ["type": "tool-input-available", "toolCallId": "read-1", "toolName": "file", "input": ["brief": "Reading the project brief"]]
        activity.apply(input)
        activity.apply(["type": "tool-output-available", "toolCallId": "read-1", "output": ["ok": true]])
        activity.apply(input)
        XCTAssertEqual(activity.steps.count, 1)
        XCTAssertEqual(activity.steps[0].state, .completed)
        XCTAssertEqual(activity.steps[0].title, "Reading the project brief")
    }
    func testClosureNeverInventsToolSuccess() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "cmd", "toolName": "run_terminal_cmd"])
        activity.settle(completed: false)
        XCTAssertEqual(activity.steps[0].state, .interrupted)
        XCTAssertEqual(activity.title, "Activity paused")
    }
    func testFailedResultIsNotShownAsSuccessful() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "read", "toolName": "file"])
        activity.apply(["type": "tool-output-available", "toolCallId": "read", "output": ["ok": false]])
        XCTAssertEqual(activity.steps[0].state, .failed)
    }
    func testProviderThinkingIsSeparateFromToolSteps() {
        var activity = AgentActivity()
        activity.apply(["type": "reasoning-start"])
        activity.apply(["type": "reasoning-delta", "delta": "internal model text"])
        XCTAssertEqual(activity.title, "Thinking")
        XCTAssertTrue(activity.steps.isEmpty)
        XCTAssertEqual(activity.reasoning, "internal model text")
    }
    func testSavedActivityPreservesEvidenceWithoutReasoningOrFalseRunning() {
        var activity = AgentActivity()
        activity.restore(parts: [
            ["type": "reasoning", "text": "private reasoning"],
            ["type": "tool-run_terminal_cmd", "toolCallId": "done", "state": "output-available", "input": ["brief": "Ran checks"], "output": ["ok": true]],
            ["type": "dynamic-tool", "toolName": "file", "toolCallId": "failed", "state": "output-error"],
            ["type": "tool-web_search", "toolCallId": "pending", "state": "input-available"]
        ])
        XCTAssertEqual(activity.steps.map(\.state), [.completed, .failed, .interrupted])
        XCTAssertEqual(activity.steps[0].title, "Ran checks")
        XCTAssertEqual(activity.title, "Previous activity")
        activity.apply(["type": "tool-input-available", "toolCallId": "done", "toolName": "run_terminal_cmd"])
        XCTAssertEqual(activity.steps.count, 3)
        XCTAssertEqual(activity.steps[0].state, .completed)
    }

}

extension AgentActivityTests {
    func testReasoningReplayDoesNotDuplicateVisibleThinking() {
        var activity = AgentActivity()
        let start: [String: Any] = ["type": "start", "messageId": "answer"]
        activity.apply(start)
        activity.apply(["type": "reasoning-delta", "id": "thought", "delta": "Checking the project"])
        activity.apply(start)
        activity.apply(["type": "reasoning-delta", "id": "thought", "delta": "Checking"])
        XCTAssertEqual(activity.reasoning, "Checking the project")
        activity.apply(["type": "reasoning-delta", "id": "thought", "delta": " the project"])
        XCTAssertEqual(activity.reasoning, "Checking the project")
        activity.apply(["type": "reasoning-delta", "id": "thought", "delta": " files"])
        XCTAssertEqual(activity.reasoning, "Checking the project files")
    }
}

extension AgentActivityTests {
    func testMediaProgressSurvivesReplayAndEndsWithReceipt() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "video", "toolName": "generate_video"])
        activity.apply(["type": "data-media-progress", "data": ["toolCallId": "video", "stage": "saving"]])
        XCTAssertEqual(activity.title, "Saving video")
        XCTAssertEqual(activity.steps[0].title, "Saving video")
        activity.apply(["type": "tool-output-available", "toolCallId": "video", "output": ["ok": true, "fileId": "saved"]])
        activity.apply(["type": "data-media-progress", "data": ["toolCallId": "video", "stage": "generating"]])
        XCTAssertEqual(activity.steps[0].state, .completed)
        XCTAssertEqual(activity.title, "Working")
    }
    func testStructuredSearchEvidenceIsNotDiscarded() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "search", "toolName": "web_search"])
        activity.apply(["type": "tool-output-available", "toolCallId": "search", "output": ["results": [["title": "Public documentation", "url": "https://example.com"]]]])
        XCTAssertTrue(activity.steps[0].output.contains("Public documentation"))
    }
    func testReasoningOnlyTurnSurvivesNextMessage() {
        var activity = AgentActivity()
        activity.apply(["type": "reasoning-delta", "delta": "Checking the request"])
        var messages = [NativeMessage(id: "answer", role: "assistant", text: "Done")]
        NativeMessageHistory.preserveActivity(activity, at: 0, in: &messages)
        XCTAssertEqual(messages.count, 2)
        XCTAssertEqual(messages.first?.savedActivity?.reasoning, "Checking the request")
    }
}

extension AgentActivityTests {
    func testPreviewRestoresFromPersistedToolAndRejectsUnsafeLinks() {
        var activity = AgentActivity()
        activity.restore(parts: [["type": "tool-expose_preview", "toolCallId": "p", "state": "output-available", "output": ["ok": true, "url": "https://preview.example.com"]]])
        XCTAssertEqual(activity.steps.first?.previewURL?.host, "preview.example.com")
        for invalid in ["javascript:alert(1)", "file:///etc/passwd", "https://user:pass@example.com", "http://example.com"] {
            XCTAssertNil(NativePreviewURL.parse(invalid))
        }
        activity.restore(parts: [["type": "tool-expose_preview", "toolCallId": "p", "state": "output-available", "output": ["ok": false, "url": "https://preview.example.com"]]])
        XCTAssertNil(activity.steps.first?.previewURL)
    }
}

extension AgentActivityTests {
    func testHackScopeReachesTheMessageReadByTheServer() {
        XCTAssertEqual(NativeHackPrompt.text("Collect passive OSINT for {target}.", scope: " example.com "), "Selected assessment scope: example.com\n\nCollect passive OSINT for example.com.")
        XCTAssertEqual(NativeHackPrompt.text("Review this configuration", scope: " "), "Review this configuration")
    }
    func testStringToolErrorIsNotMarkedCompleted() {
        var activity = AgentActivity()
        activity.apply(["type": "tool-input-available", "toolCallId": "p", "toolName": "expose_preview"])
        activity.apply(["type": "tool-output-available", "toolCallId": "p", "output": "Error: the server is not running"])
        XCTAssertEqual(activity.steps.first?.state, .failed)
    }
}
