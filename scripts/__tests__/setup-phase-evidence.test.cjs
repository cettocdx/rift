const test = require("node:test");
const assert = require("node:assert/strict");
const { setupPhaseTimingEvidence } = require("../startup-timing-evidence.cjs");

test("retains overlapping phases without copying payloads or unknown phase names", () => {
  const evidence = setupPhaseTimingEvidence({
    setupSpansMs: {
      moderation: {
        startedMs: 10,
        endedMs: 110,
        durationMs: 100,
        outcome: "completed",
        input: "private-input",
      },
      checkpoint: {
        startedMs: 20,
        endedMs: 30,
        durationMs: 10,
        outcome: "failed",
        error: "private-error",
      },
      "private-phase": {
        startedMs: 0,
        endedMs: 1,
        durationMs: 1,
        outcome: "completed",
      },
    },
  });
  assert.deepEqual(evidence.spans, {
    moderation: {
      startedMs: 10,
      endedMs: 110,
      durationMs: 100,
      outcome: "completed",
    },
    checkpoint: {
      startedMs: 20,
      endedMs: 30,
      durationMs: 10,
      outcome: "failed",
    },
  });
  assert.ok(!JSON.stringify(evidence).includes("private"));
});

test("rejects malformed, inconsistent, unbounded and legacy absent spans", () => {
  const valid = {
    startedMs: 1,
    endedMs: 2,
    durationMs: 1,
    outcome: "completed",
  };
  for (const span of [
    undefined,
    null,
    {},
    { ...valid, startedMs: -1 },
    { ...valid, startedMs: "1" },
    { ...valid, endedMs: Infinity },
    { ...valid, endedMs: 0 },
    { ...valid, durationMs: 2 },
    { ...valid, durationMs: 1.5 },
    { ...valid, endedMs: 3_600_001 },
    { ...valid, outcome: "private-error" },
  ])
    assert.equal(
      setupPhaseTimingEvidence({ setupSpansMs: { tools: span } }),
      undefined,
    );
  assert.equal(setupPhaseTimingEvidence(), undefined);
  assert.equal(
    setupPhaseTimingEvidence({ setupTimingsMs: { tools: 10 } }),
    undefined,
  );
});
