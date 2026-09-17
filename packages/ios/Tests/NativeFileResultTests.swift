import XCTest
@testable import RIFT
final class NativeFileResultTests: XCTestCase {
    func testMediaToolAndMetadataResolveSameIdentity() {
        let file: [String: Any] = ["ok": true, "fileId": "saved", "name": "image.png", "mediaType": "image/png"]
        let tool = NativeFileResult.files(from: ["type": "tool-output-available", "output": file])
        let metadata = NativeFileResult.files(from: ["type": "data-file-metadata", "data": ["fileDetails": [file]]])
        XCTAssertEqual(tool, metadata); XCTAssertEqual(tool.count, 1)
    }
    func testDoesNotExposeFailedOrTemporaryResults() {
        XCTAssertTrue(NativeFileResult.files(from: ["type": "tool-output-available", "output": ["ok": false, "fileId": "x"]]).isEmpty)
        XCTAssertTrue(NativeFileResult.files(from: ["type": "tool-output-available", "output": ["url": "https://example.com/temp"]]).isEmpty)
    }
}
