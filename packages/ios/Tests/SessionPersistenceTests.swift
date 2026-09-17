import XCTest
@testable import RIFT

final class SessionPersistenceTests: XCTestCase {
    func testSessionSurvivesServiceRecreation() throws {
        let origin = URL(string: "https://session-test-\(UUID().uuidString.lowercased()).invalid")!
        let service = RIFTService(origin: origin)
        defer { service.clearCookies() }
        let cookie = HTTPCookie(properties: [.domain: origin.host!, .path: "/", .name: "__convexAuthJWT", .value: "test-only-session", .secure: "TRUE"])!
        service.session.configuration.httpCookieStorage?.setCookie(cookie)
        try service.saveCookies()
        let restored = RIFTService(origin: origin)
        XCTAssertEqual(restored.session.configuration.httpCookieStorage?.cookies?.first?.value, "test-only-session")
    }
}

final class NativeRequestErrorTests: XCTestCase {
    func testRejectedRequestsDoNotOfferReconnectToAnUnstartedTask() {
        for status in [400, 401, 402, 403, 404, 422, 429] {
            XCTAssertFalse(NativeRequestError.canReconnect(status: status), "status \(status)")
        }
        for status in [408, 409, 500, 502, 503, 504] {
            XCTAssertTrue(NativeRequestError.canReconnect(status: status), "status \(status)")
        }
    }
    func testShowsPublicRejectionReason() {
        let data = Data(#"{"message":"Request rejected","cause":"Durable assessments are not enabled.","metadata":{"secret":"hidden"}}"#.utf8)
        XCTAssertEqual(NativeRequestError.message(status: 400, data: data), "Durable assessments are not enabled.")
    }
    func testDoesNotDisplayProxyHTML() {
        XCTAssertFalse(NativeRequestError.message(status: 502, data: Data("<html>proxy internals</html>".utf8)).contains("proxy internals"))
        XCTAssertEqual(NativeRequestError.message(status: 401, data: Data()), "Sign in to RIFT to continue.")
    }
}
