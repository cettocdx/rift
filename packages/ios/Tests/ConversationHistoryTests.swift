import XCTest
@testable import RIFT
final class ConversationHistoryTests: XCTestCase {
    func testMessagePagesKeepOrderFilesAndLiveText() {
        let page: [[String: Any]] = [
            ["id": "a", "role": "assistant", "parts": [["type": "text", "text": "saved"]], "fileDetails": [["fileId": "image", "name": "image.png", "mediaType": "image/png"]]],
            ["id": "u", "role": "user", "parts": [["type": "text", "text": "prompt"], ["type": "reasoning", "text": "private"]]]
        ]
        let older = NativeMessageHistory.decode(page)
        XCTAssertEqual(older.map(\.id), ["u:persisted:0", "a:persisted:0", "a:file:image"])
        let live = NativeMessage(id: "a:persisted:0", role: "assistant", text: "new live text")
        let merged = NativeMessageHistory.prepend(older + older, to: [live])
        XCTAssertEqual(merged.count, 3)
        XCTAssertEqual(merged.last?.text, "new live text")
        XCTAssertEqual(merged[1].fileID, "image")
    }
    func testEveryAssistantKeepsItsOwnActivityIncludingToolOnlyTurns() {
        let tool: [String: Any] = ["type": "tool-file", "toolCallId": "read-1", "state": "output-available", "output": ["ok": true]]
        let page: [[String: Any]] = [
            ["id": "new", "role": "assistant", "parts": [["type": "text", "text": "Done"]]],
            ["id": "old", "role": "assistant", "parts": [tool]],
            ["id": "user", "role": "user", "parts": [tool, ["type": "text", "text": "Question"]]]
        ]
        let decoded = NativeMessageHistory.decode(page)
        XCTAssertEqual(decoded.map(\.id), ["user:persisted:1", "old:activity", "new:persisted:0"])
        XCTAssertEqual(decoded[1].savedActivity?.steps.first?.state, .completed)
        XCTAssertNil(decoded[0].savedActivity)
        XCTAssertEqual(NativeMessageHistory.prepend(decoded, to: decoded).count, decoded.count)
    }
    func testSavedImageStaysBetweenTextAndFollowingCommentary() {
        let parts: [[String: Any]] = [
            ["type": "text", "text": "Before"],
            ["type": "tool-generate_image", "toolCallId": "image-tool", "state": "output-available", "output": ["ok": true, "fileId": "img"]],
            ["type": "text", "text": "After"],
            ["type": "file", "fileId": "img"]
        ]
        let decoded = NativeMessageHistory.decode([["id": "answer", "role": "assistant", "parts": parts,
            "fileDetails": [["fileId": "img", "name": "result.png", "mediaType": "image/png"]]]])
        let content = decoded.filter { $0.savedActivity == nil }
        XCTAssertEqual(content.map(\.text), ["Before", "result.png", "After"])
        XCTAssertEqual(content.filter { $0.fileID == "img" }.count, 1)
        XCTAssertEqual(content[1].mediaType, "image/png")
    }
    func testGroupsByLocalDayAndSortsNewestFirst() {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 10800)!
        let now = ISO8601DateFormatter().date(from: "2026-09-15T00:10:00+03:00")!
        let today = Conversation(id: "new", title: "Today", updatedAt: now)
        let older = Conversation(id: "old", title: "Earlier", updatedAt: now.addingTimeInterval(-1200))
        let groups = ConversationHistory.groups([older, today], now: now, calendar: calendar)
        XCTAssertEqual(groups.map(\.title), ["Today", "Earlier"])
        XCTAssertEqual(groups[0].chats.map(\.id), ["new"])
        XCTAssertEqual(groups[1].chats.map(\.id), ["old"])
    }
    func testMissingDatesAreEarlierAndEmptyGroupsAreHidden() {
        let groups = ConversationHistory.groups([Conversation(id: "legacy", title: "Legacy")])
        XCTAssertEqual(groups.map(\.title), ["Earlier"])
        XCTAssertTrue(ConversationHistory.groups([]).isEmpty)
    }
}
