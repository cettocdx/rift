export function hasAssessmentEvidence(evidence: string): boolean {
  return evidence.trim().length > 0;
}

export function isAssessmentReportAvailable(
  evidence: string,
  running: boolean,
): boolean {
  return !running && hasAssessmentEvidence(evidence);
}
