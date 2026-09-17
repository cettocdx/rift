import {
  hasAssessmentEvidence,
  isAssessmentReportAvailable,
} from "../assessment-report-state";

describe("assessment report state", () => {
  it("does not expose a report before evidence exists", () => {
    expect(hasAssessmentEvidence("   ")).toBe(false);
    expect(isAssessmentReportAvailable("", false)).toBe(false);
  });

  it("waits for an active assessment to finish before exposing its report", () => {
    const evidence = "443/tcp open https";

    expect(isAssessmentReportAvailable(evidence, true)).toBe(false);
    expect(isAssessmentReportAvailable(evidence, false)).toBe(true);
  });
});
