const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  alignClock,
  profileSamples,
  summarizeWindow,
} = require("../performance/profile-clock.cjs");
test("intersects independent page/CDP clock brackets and rejects incompatible clocks", () => {
  const clock = alignClock([
    { pageBeforeMs: 100, pageAfterMs: 102, timestampSeconds: 1.101 },
    { pageBeforeMs: 200, pageAfterMs: 201, timestampSeconds: 1.201 },
  ]);
  assert.equal(clock.valid, true);
  assert.equal(clock.offsetLowMs, 1000);
  assert.equal(clock.offsetHighMs, 1001);
  assert.equal(clock.uncertaintyMs, 0.5);
  assert.equal(
    alignClock([
      { pageBeforeMs: 0, pageAfterMs: 1, timestampSeconds: 1 },
      { pageBeforeMs: 0, pageAfterMs: 1, timestampSeconds: 2 },
    ]).valid,
    false,
  );
});
test("maps cumulative CPU microseconds into page milliseconds and reports sample counts inside a LoAF", () => {
  const profile = {
    startTime: 1000000,
    timeDeltas: [10000, 1000, 1000],
    samples: [1, 2, 2],
    nodes: [
      {
        id: 1,
        callFrame: {
          functionName: "scheduler",
          url: "app.js",
          lineNumber: 1,
          columnNumber: 2,
        },
        children: [2],
      },
      {
        id: 2,
        callFrame: {
          functionName: "markdown",
          url: "app.js",
          lineNumber: 3,
          columnNumber: 4,
        },
      },
    ],
  };
  const clock = { valid: true, offsetMs: 1000, uncertaintyMs: 0.25 };
  assert.deepEqual(
    profileSamples(profile, clock).map((s) => s.pageMs),
    [10, 11, 12],
  );
  const window = summarizeWindow(profile, clock, 10.5, 2);
  assert.equal(window.sampleCount, 2);
  assert.equal(window.topSelf[0].functionName, "markdown");
  assert.equal(
    window.topInclusive.find((f) => f.functionName === "scheduler").samples,
    2,
  );
  assert.throws(() => profileSamples(profile, { valid: false }), /clock/);
});
test("requires sampled named marker evidence instead of accepting clock bounds alone", () => {
  const { validateMarkers } = require("../performance/profile-clock.cjs");
  const profile = {
    startTime: 1000000,
    timeDeltas: [10000, 1000, 1000],
    samples: [2, 2, 2],
    nodes: [
      {
        id: 1,
        callFrame: { functionName: "riftProfileClockMarker" },
        children: [2],
      },
      { id: 2, callFrame: { functionName: "now" } },
    ],
  };
  const markers = validateMarkers(
    profile,
    { valid: true, offsetMs: 1000, uncertaintyMs: 0.1 },
    [
      { phase: "test", startTime: 9, endTime: 13 },
      { phase: "wrong-clock", startTime: 20, endTime: 30 },
    ],
  );
  assert.equal(markers[0].validated, true);
  assert.equal(markers[1].validated, false);
});
