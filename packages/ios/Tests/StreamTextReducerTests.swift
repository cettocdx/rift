import XCTest
@testable import RIFT

final class StreamTextReducerTests: XCTestCase {
    func testReplayReplacesTextWithoutRemovingVisibleResponseOnStart() {
        var reducer = StreamTextReducer()
        var messages = [NativeMessage(id: "m:p", role: "assistant", text: "Hello")]
        reducer.apply(["type": "start", "messageId": "m"], to: &messages)
        XCTAssertEqual(messages[0].text, "Hello")
        reducer.apply(["type": "text-delta", "id": "p", "delta": "Hello"], to: &messages)
        reducer.apply(["type": "text-delta", "id": "p", "delta": " world"], to: &messages)
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].text, "Hello world")
    }
    func testPersistedHistoryIsReplacedByReplayInsteadOfDuplicated() {
        var reducer = StreamTextReducer()
        var messages = [NativeMessage(id: "m:persisted:0", role: "assistant", text: "Saved partial")]
        reducer.apply(["type": "start", "messageId": "m"], to: &messages)
        reducer.apply(["type": "text-delta", "id": "wire-part-id", "delta": "Saved partial"], to: &messages)
        XCTAssertEqual(messages.count, 1)
        XCTAssertEqual(messages[0].id, "m:wire-part-id")
    }
    func testChunkedReplayKeepsLongVisibleAnswerUntilCaughtUp() {
        var reducer = StreamTextReducer()
        var messages = [NativeMessage(id: "m:p", role: "assistant", text: "Hello world")]
        reducer.apply(["type": "start", "messageId": "m"], to: &messages)
        for chunk in ["Hel", "lo", " world"] {
            reducer.apply(["type": "text-delta", "id": "p", "delta": chunk], to: &messages)
            XCTAssertEqual(messages[0].text, "Hello world")
        }
        reducer.apply(["type": "text-delta", "id": "p", "delta": "!"], to: &messages)
        XCTAssertEqual(messages[0].text, "Hello world!")
        XCTAssertEqual(messages.count, 1)
    }
    func testCompletedReplayCanCorrectAStaleLongerSnapshot() {
        var reducer = StreamTextReducer()
        var messages = [NativeMessage(id: "m:p", role: "assistant", text: "Hello stale")]
        reducer.apply(["type": "start", "messageId": "m"], to: &messages)
        reducer.apply(["type": "text-delta", "id": "p", "delta": "Hello"], to: &messages)
        XCTAssertEqual(messages[0].text, "Hello stale")
        reducer.apply(["type": "text-end", "id": "p"], to: &messages)
        XCTAssertEqual(messages[0].text, "Hello")
    }
    func testSeparatePartsAndMessagesAreNotConcatenated() {
        var reducer = StreamTextReducer()
        var messages: [NativeMessage] = []
        for id in ["a", "b"] {
            reducer.apply(["type": "start", "messageId": id], to: &messages)
            reducer.apply(["type": "text-delta", "id": "p", "delta": id], to: &messages)
        }
        XCTAssertEqual(messages.map(\.text), ["a", "b"])
    }
}

private final class RecoveryProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, String))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let (status, body) = Self.handler!(request)
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "text/event-stream"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

extension StreamTextReducerTests {
    @MainActor func testDisconnectedSendResumesWithGetAndKeepsOneAnswer() async throws {
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [RecoveryProtocol.self]
        let store = RIFTStore(service: RIFTService(origin: URL(string: "https://recovery.invalid")!, configuration: config))
        var methods: [String] = []
        RecoveryProtocol.handler = { request in
            if request.url!.path.contains("approvals") { return (200, "{}") }
            methods.append(request.httpMethod ?? "GET")
            let prefix = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: {\"type\":\"text-delta\",\"id\":\"p\",\"delta\":\"Hello\"}\n\n"
            return (200, methods.count == 1 ? prefix : prefix + "data: {\"type\":\"text-delta\",\"id\":\"p\",\"delta\":\" world\"}\n\ndata: {\"type\":\"finish\"}\n\n")
        }
        defer { RecoveryProtocol.handler = nil }
        store.signedIn = true; store.models = [ModelChoice(id: "test", title: "Test")]; store.model = "test"; store.draft = "Hello"
        store.send()
        for _ in 0..<70 {
            try await Task.sleep(for: .milliseconds(100))
            if !store.working { break }
        }
        XCTAssertEqual(methods, ["POST", "GET"])
        XCTAssertEqual(store.messages.filter { $0.role == "assistant" }.map(\.text), ["Hello world"])
        XCTAssertNil(store.error)
        store.newChat()
    }
}
