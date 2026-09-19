import XCTest
@testable import RIFT

private final class AdmissionScriptProtocol: URLProtocol {
    static var handler: ((URLRequest) -> (Int, String, [String: String]))?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard let handler = Self.handler else { return }
        let (status, body, headers) = handler(request)
        var fields = headers
        if fields["Content-Type"] == nil { fields["Content-Type"] = "application/json" }
        client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: fields)!, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: Data(body.utf8))
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}

final class StreamAdmissionTests: XCTestCase {
    @MainActor private func makeStore() -> RIFTStore {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [AdmissionScriptProtocol.self]
        let store = RIFTStore(service: RIFTService(origin: URL(string: "https://admission.invalid")!, configuration: configuration))
        store.signedIn = true
        store.models = [ModelChoice(id: "build-test", title: "Test")]
        return store
    }

    @MainActor private func awaitQuiescence(_ store: RIFTStore, timeout: UInt64 = 5_000_000_000) async throws {
        let deadline = DispatchTime.now().uptimeNanoseconds + timeout
        while store.working {
            if DispatchTime.now().uptimeNanoseconds > deadline {
                XCTFail("The store kept working past the script")
                return
            }
            try await Task.sleep(nanoseconds: 20_000_000)
        }
    }

    @MainActor func testEmptyAdmissionResponseNeverSilencesAFreshSend() async throws {
        let store = makeStore()
        store.draft = "Investigate the worker"
        AdmissionScriptProtocol.handler = { request in
            if request.url!.path == "/api/mobile/stream" { return (204, "", [:]) }
            XCTFail("A dead admission must not fetch saved history: \(request.url!)")
            return (500, "{}", [:])
        }
        defer { AdmissionScriptProtocol.handler = nil }
        store.send()
        // Bounded: the reconnect backoff sleeps at most a few seconds here.
        try await Task.sleep(nanoseconds: 2_500_000_000)
        XCTAssertTrue(store.working, "An unconfirmed send must stay reconnectable, not look finished")
        XCTAssertTrue(store.reconnectAvailable, "The user must see that the task needs reconnecting")
        store.streamTaskCancelForTest()
    }

    @MainActor func testAdmissionRejectionStaysVisibleAndRetryable() async throws {
        let store = makeStore()
        store.draft = "Investigate the worker"
        AdmissionScriptProtocol.handler = { request in
            if request.url!.path == "/api/mobile/stream" && request.httpMethod == "POST" {
                return (400, "Invalid chat id", ["Content-Type": "text/plain"])
            }
            XCTFail("A rejected admission must not reconnect: \(request.url!)")
            return (500, "{}", [:])
        }
        defer { AdmissionScriptProtocol.handler = nil }
        store.send()
        try await awaitQuiescence(store)
        XCTAssertFalse(store.working)
        XCTAssertEqual(store.error, "Invalid chat id")
        XCTAssertFalse(store.reconnectAvailable)
    }
}
