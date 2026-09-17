const { test } = require("node:test");
const assert = require("node:assert/strict");
const { cleanupEvidence } = require("../cleanup-evidence.cjs");
test("accepts only completed worker with explicit cleanup confirmation", () => {
  assert.equal(
    cleanupEvidence({
      status: "COMPLETED",
      metadata: { cleanupConfirmed: true },
    }).verified,
    true,
  );
});
test("completed output without exit proof does not pass lifecycle verification", () => {
  for (const metadata of [
    {},
    { cleanupConfirmed: false },
    { cleanupConfirmed: "true" },
    { cleanupDrained: true },
  ])
    assert.equal(
      cleanupEvidence({ status: "COMPLETED", metadata }).verified,
      false,
    );
});
test("failed or contradictory cleanup never passes", () => {
  for (const run of [
    { status: "FAILED", metadata: { cleanupConfirmed: true } },
    {
      status: "COMPLETED",
      metadata: { cleanupConfirmed: true, cleanupStatus: "unconfirmed" },
    },
    {
      status: "COMPLETED",
      metadata: {
        cleanupConfirmed: true,
        cleanupFailure: { stage: "remote_exit", errorName: "TimeoutError" },
      },
    },
  ])
    assert.equal(cleanupEvidence(run).verified, false);
});
test("omits arbitrary metadata and error text", () => {
  const result = cleanupEvidence({
    status: "COMPLETED",
    metadata: {
      secret: "private",
      cleanupFailure: {
        stage: "remote_exit",
        errorName: "TimeoutError",
        message: "private",
      },
    },
  });
  assert.equal(JSON.stringify(result).includes("private"), false);
});
