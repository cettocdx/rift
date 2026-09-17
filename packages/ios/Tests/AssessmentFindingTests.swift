import XCTest
@testable import RIFT
final class AssessmentFindingTests: XCTestCase {
    func testPreservesEvidenceAndDeduplicates() {
        let findings = AssessmentFinding.extract("[HIGH] Exposed endpoint\nEvidence: HTTP 200\nRemediation: Require authentication\n[high] Exposed endpoint")
        XCTAssertEqual(findings.count, 1)
        XCTAssertTrue(findings[0].evidence.contains("HTTP 200"))
        XCTAssertTrue(findings[0].evidence.contains("Require authentication"))
    }
    func testDoesNotInventFindingsFromGeneralProse() {
        XCTAssertTrue(AssessmentFinding.extract("No results yet. A high level review is pending.").isEmpty)
    }
}
