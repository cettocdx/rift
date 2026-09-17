// This is worker-reported exit proof, not a replacement for resource/claim audits.
function cleanupEvidence(run) {
  const metadata = run?.metadata ?? {};
  const failure = metadata.cleanupFailure;
  const stages = new Set(["remote_exit", "integration_close", "claim_receipt"]);
  const errors = new Set([
    "TimeoutError",
    "AbortError",
    "Error",
    "UnknownError",
  ]);
  return {
    confirmed: metadata.cleanupConfirmed === true,
    verified:
      run?.status === "COMPLETED" &&
      metadata.cleanupConfirmed === true &&
      metadata.cleanupStatus !== "unconfirmed" &&
      !failure,
    ...(failure
      ? {
          failure: {
            stage: stages.has(failure.stage) ? failure.stage : "unknown",
            errorName: errors.has(failure.errorName)
              ? failure.errorName
              : "OtherError",
          },
        }
      : {}),
  };
}
module.exports = { cleanupEvidence };
