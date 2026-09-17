import XCTest
@testable import RIFT

private final class NavigationResponseProtocol: URLProtocol {
    static var handler: ((NavigationResponseProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() {}
    func respond(_ body: String, status: Int = 200) {
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
}

final class NavigationRaceTests: XCTestCase {
    @MainActor private func makeStore() -> RIFTStore {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [NavigationResponseProtocol.self]
        return RIFTStore(service: RIFTService(origin: URL(string: "https://navigation.invalid")!, configuration: configuration))
    }

    @MainActor func testLateCancellationCannotStopAnotherConversation() async throws {
        let store = makeStore()
        let requested = expectation(description: "Cancellation request reached server")
        var pending: NavigationResponseProtocol?
        NavigationResponseProtocol.handler = { response in
            Task { @MainActor in pending = response; requested.fulfill() }
        }
        defer { NavigationResponseProtocol.handler = nil; store.newChat() }
        store.working = true
        let cancellation = Task { await store.stop() }
        await fulfillment(of: [requested], timeout: 3)
        store.newChat()
        store.working = true
        store.activity = "New conversation is working"
        pending?.respond("{\"canceled\":true}")
        await cancellation.value
        XCTAssertTrue(store.working, "An older conversation's cancellation must not stop the current task")
        XCTAssertEqual(store.activity, "New conversation is working")
    }

    @MainActor func testLateCancellationErrorCannotAppearInAnotherConversation() async throws {
        let store = makeStore()
        let requested = expectation(description: "Cancellation request reached server")
        var pending: NavigationResponseProtocol?
        NavigationResponseProtocol.handler = { response in
            Task { @MainActor in pending = response; requested.fulfill() }
        }
        defer { NavigationResponseProtocol.handler = nil; store.newChat() }
        let cancellation = Task { await store.stop() }
        await fulfillment(of: [requested], timeout: 3)
        store.newChat()
        pending?.respond("{\"canceled\":false}")
        await cancellation.value
        XCTAssertNil(store.error, "A late stop error belongs to its originating conversation")
    }

    @MainActor func testOlderOpenCannotReplaceNewerOpenOfTheSameConversation() async throws {
        let store = makeStore()
        let firstRequested = expectation(description: "First history request")
        let secondRequested = expectation(description: "Second history request")
        var first: NavigationResponseProtocol?
        var second: NavigationResponseProtocol?
        NavigationResponseProtocol.handler = { response in
            Task { @MainActor in
                if response.request.url!.path == "/api/mobile/session" {
                    if first == nil { first = response; firstRequested.fulfill() }
                    else { second = response; secondRequested.fulfill() }
                } else { response.respond("{\"error\":\"fixture stream unavailable\"}", status: 403) }
            }
        }
        defer { NavigationResponseProtocol.handler = nil; store.newChat() }
        let chat = Conversation(id: "same-chat", title: "Same chat")
        let oldOpen = Task { await store.open(chat) }
        await fulfillment(of: [firstRequested], timeout: 3)
        store.newChat()
        let currentOpen = Task { await store.open(chat) }
        await fulfillment(of: [secondRequested], timeout: 3)
        second?.respond("{\"page\":[{\"id\":\"new\",\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"text\":\"Current answer\"}]}]}")
        await currentOpen.value
        first?.respond("{\"page\":[{\"id\":\"old\",\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"text\":\"Old answer\"}]}]}")
        await oldOpen.value
        XCTAssertEqual(store.messages.map(\.text), ["Current answer"])
    }
}


extension NavigationRaceTests {
    @MainActor func testCompletedReconnectKeepsLoadedOlderHistoryAndPagination() async throws {
        let store = makeStore()
        NavigationResponseProtocol.handler = { response in
            if response.request.url!.path == "/api/mobile/stream" { response.respond("", status: 204) }
            else if response.request.url!.path == "/api/mobile/session" {
                response.respond("{\"page\":[{\"id\":\"latest\",\"role\":\"assistant\",\"parts\":[{\"type\":\"text\",\"text\":\"Complete answer\"}]}],\"continueCursor\":\"new-page-cursor\",\"isDone\":false}")
            } else { response.respond("[]") }
        }
        defer { NavigationResponseProtocol.handler = nil; store.newChat() }
        store.messages = [NativeMessage(id: "older:persisted:0", role: "assistant", text: "Previously loaded history"), NativeMessage(id: "latest:wire-text", role: "assistant", text: "Complete")]
        store.messageCursor = "older-page-cursor"; store.messagesDone = false
        store.resume()
        for _ in 0..<30 {
            if !store.working { break }
            try await Task.sleep(for: .milliseconds(100))
        }
        XCTAssertFalse(store.working)
        XCTAssertEqual(store.messages.map(\.text), ["Previously loaded history", "Complete answer"])
        XCTAssertEqual(store.messageCursor, "older-page-cursor")
        XCTAssertFalse(store.messagesDone)
        XCTAssertNil(store.error)
    }
}


extension NavigationRaceTests {
    @MainActor func testToggleReasoningModelDoesNotSilentlyDisableThinking() async throws {
        try await verifySentEffort(requested: "medium", expected: "on")
    }
    @MainActor func testExplicitReasoningOffIsRespected() async throws {
        try await verifySentEffort(requested: "off", expected: "off")
    }
    @MainActor private func verifySentEffort(requested: String, expected: String) async throws {
        let store = makeStore()
        let received = expectation(description: "Stream request")
        var sentEffort: String?
        NavigationResponseProtocol.handler = { response in
            var data = response.request.httpBody ?? Data()
            if let input = response.request.httpBodyStream {
                input.open(); defer { input.close() }
                var buffer = [UInt8](repeating: 0, count: 4096)
                while true {
                    let count = input.read(&buffer, maxLength: buffer.count)
                    if count <= 0 { break }
                    data.append(contentsOf: buffer.prefix(count))
                }
            }
            let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            sentEffort = body?["reasoningEffort"] as? String
            response.respond("data: {\"type\":\"finish\"}\n\n")
            received.fulfill()
        }
        defer { NavigationResponseProtocol.handler = nil; store.newChat() }
        store.signedIn = true; store.model = "toggle"
        store.models = [ModelChoice(id: "toggle", title: "Toggle model")]
        store.efforts = ["toggle": ["off", "on"]]
        store.effort = requested; store.draft = "Compare the two approaches"
        store.send()
        await fulfillment(of: [received], timeout: 3)
        XCTAssertEqual(sentEffort, expected)
    }
}
