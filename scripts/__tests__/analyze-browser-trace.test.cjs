const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  analyzeBrowserTrace,
} = require("../performance/analyze-browser-trace.cjs");
const clock = {
  validated: true,
  alignment: { valid: true, offsetMs: 1000, uncertaintyMs: 0.1 },
  markers: [
    { phase: "before-replay", startTime: 0, endTime: 30, validated: true },
    { phase: "after-replay", startTime: 200, endTime: 230, validated: true },
  ],
};
const e = (name, ph, ts, dur, extra = {}) => ({
  name,
  ph,
  ts: 1000000 + ts * 1000,
  ...(dur === undefined ? {} : { dur: dur * 1000 }),
  pid: 1,
  tid: 2,
  ...extra,
});
const markers = () => [
  e("thread_name", "M", 0, undefined, { args: { name: "CrRendererMain" } }),
  ...clock.markers.flatMap((m) =>
    ["start", "end"].map((edge) =>
      e(
        `rift-cpu-clock-${m.phase}-${edge}`,
        "R",
        edge === "start" ? m.startTime : m.endTime,
        undefined,
        { cat: "blink.user_timing" },
      ),
    ),
  ),
];
const task = { startTime: 50, duration: 100 };

test("clips nested X and B/E spans and never double counts parent durations", () => {
  const trace = [
    ...markers(),
    e("RunTask", "X", 40, 130),
    e("FunctionCall", "B", 60),
    e("Layout", "X", 80, 30),
    e("Layout", "B", 80),
    e("Layout", "E", 110),
    e("FunctionCall", "E", 130),
    e("Paint", "X", 140, 30),
    e("Layout", "X", 50, 100, { tid: 999 }),
  ];
  const result = analyzeBrowserTrace(trace, clock, [task]);
  assert.deepEqual(result.tasks[0].exclusiveMs, {
    "browser-other": 20,
    javascript: 40,
    layout: 30,
    paint: 10,
  });
  assert.equal(result.tasks[0].accountedMs, 100);
});
test("reports untraced gaps and incomplete boundary events without inventing durations", () => {
  const r = analyzeBrowserTrace(
    [
      ...markers(),
      e("FunctionCall", "E", 45),
      e("Layout", "X", 75, 10),
      e("Paint", "B", 100),
    ],
    clock,
    [task],
  );
  assert.deepEqual(r.incomplete, { unmatchedBegins: 1, unmatchedEnds: 1 });
  assert.deepEqual(r.tasks[0].exclusiveMs, { untraced: 90, layout: 10 });
});
test("rejects wrong thread, missing/ambiguous markers and incompatible clocks", () => {
  assert.throws(
    () =>
      analyzeBrowserTrace(markers(), { ...clock, validated: false }, [task]),
    /not validated/,
  );
  assert.throws(
    () => analyzeBrowserTrace(markers().slice(1), clock, [task]),
    /CrRendererMain/,
  );
  assert.throws(
    () => analyzeBrowserTrace(markers().slice(0, -1), clock, [task]),
    /Missing or ambiguous/,
  );
  assert.throws(
    () => analyzeBrowserTrace([...markers(), markers()[1]], clock, [task]),
    /ambiguous/,
  );
  const wrong = markers();
  wrong[4].tid = 3;
  assert.throws(
    () => analyzeBrowserTrace(wrong, clock, [task]),
    /different threads/,
  );
  const shifted = markers();
  shifted[4].ts += 10000;
  assert.throws(() => analyzeBrowserTrace(shifted, clock, [task]), /mismatch/);
});
test("rejects mismatched synchronous nesting and keeps nested GC exclusive", () => {
  assert.throws(
    () =>
      analyzeBrowserTrace(
        [...markers(), e("Layout", "B", 60), e("Paint", "E", 70)],
        clock,
        [task],
      ),
    /Mismatched/,
  );
  const r = analyzeBrowserTrace(
    [
      ...markers(),
      e("FunctionCall", "X", 50, 100),
      e("V8.GC_SCAVENGER", "X", 60, 20),
    ],
    clock,
    [task],
  );
  assert.deepEqual(r.tasks[0].exclusiveMs, { javascript: 80, gc: 20 });
});

test("crossing synchronous spans are explicitly ambiguous, not assigned by arbitrary order", () => {
  const r = analyzeBrowserTrace(
    [...markers(), e("FunctionCall", "X", 50, 60), e("Layout", "X", 90, 60)],
    clock,
    [task],
  );
  assert.deepEqual(r.tasks[0].exclusiveMs, {
    javascript: 40,
    "ambiguous-overlap": 20,
    layout: 40,
  });
  assert.equal(r.tasks[0].accountedMs, 100);
});

test("explicit capture metadata must confirm no browser-reported data loss", () => {
  for (const traceMetadata of [{ dataLossOccurred: true }, {}])
    assert.throws(
      () => analyzeBrowserTrace(markers(), clock, [task], { traceMetadata }),
      /data loss/,
    );
  assert.equal(
    analyzeBrowserTrace({ traceEvents: markers() }, clock, [task], {
      traceMetadata: { dataLossOccurred: false },
    }).tasks[0].accountedMs,
    100,
  );
});

test("CLI requires capture sidecar completeness before writing attribution", () => {
  const fs = require("node:fs"),
    os = require("node:os"),
    path = require("node:path");
  const { spawnSync } = require("node:child_process");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rift-trace-analyzer-"));
  try {
    const trace = path.join(dir, "trace.json"),
      profile = path.join(dir, "profile.json"),
      result = path.join(dir, "result.json"),
      out = path.join(dir, "out.json");
    fs.writeFileSync(trace, JSON.stringify({ traceEvents: markers() }));
    fs.writeFileSync(profile, JSON.stringify({ riftPageClock: clock }));
    fs.writeFileSync(result, JSON.stringify({ longTaskEntries: [task] }));
    const run = () =>
      spawnSync(
        process.execPath,
        [
          path.resolve(__dirname, "../performance/analyze-browser-trace.cjs"),
          trace,
          profile,
          result,
          out,
        ],
        { encoding: "utf8" },
      );
    assert.notEqual(run().status, 0);
    assert.equal(fs.existsSync(out), false);
    fs.writeFileSync(
      trace + ".meta.json",
      JSON.stringify({ dataLossOccurred: true }),
    );
    assert.notEqual(run().status, 0);
    assert.equal(fs.existsSync(out), false);
    fs.writeFileSync(
      trace + ".meta.json",
      JSON.stringify({ dataLossOccurred: false }),
    );
    assert.equal(run().status, 0);
    assert.equal(JSON.parse(fs.readFileSync(out)).tasks[0].accountedMs, 100);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("observed RunTasks stay separate from Long Task API entries and omit clock marker work", () => {
  const r = analyzeBrowserTrace(
    [
      ...markers(),
      e("RunTask", "X", 0, 30),
      e("RunTask", "X", 60, 10),
      e("FunctionCall", "X", 61, 8),
      e("ThreadControllerImpl::RunTask", "X", 60, 10),
      e("RunTask", "X", 200, 30),
    ],
    clock,
    [],
  );
  assert.deepEqual(r.tasks, []);
  assert.equal(r.rendererRunTasks.count, 1);
  assert.equal(r.rendererRunTasks.longest[0].duration, 10);
  assert.deepEqual(r.rendererRunTasks.longest[0].exclusiveMs, {
    "browser-other": 2,
    javascript: 8,
  });
});

test("explicit measured replay window excludes later verification work and partitions coverage", () => {
  const r = analyzeBrowserTrace(
    [
      ...markers(),
      e("RunTask", "X", 60, 10),
      e("Layout", "X", 62, 3),
      e("RunTask", "X", 160, 30),
    ],
    clock,
    [],
    { replayWindow: task },
  );
  assert.equal(r.rendererRunTasks.count, 1);
  assert.deepEqual(r.replayPhaseCoverage.exclusiveMs, {
    untraced: 90,
    "browser-other": 7,
    layout: 3,
  });
  assert.throws(
    () =>
      analyzeBrowserTrace(markers(), clock, [], {
        replayWindow: { startTime: 0, duration: 250 },
      }),
    /outside validated markers/,
  );
});

test("boundary-crossing RunTasks are labeled and coverage is clipped", () => {
  const r = analyzeBrowserTrace(
    [...markers(), e("RunTask", "X", 40, 20), e("Layout", "X", 45, 10)],
    clock,
    [],
    { replayWindow: task },
  );
  assert.equal(r.rendererRunTasks.count, 0);
  assert.equal(r.rendererRunTasks.boundaryCrossingCount, 1);
  assert.equal(r.rendererRunTasks.boundaryCrossing[0].overlapMs, 10);
  assert.equal(r.replayPhaseCoverage.accountedMs, 100);
});
