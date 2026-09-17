import {
  buildRunDigest,
  DEFAULT_STUCK_STARTING_AFTER_MS,
  formatDigestText,
  formatDurationMs,
  normalizeErrorMessage,
  percentileNearestRank,
  shouldAlertFailureRate,
  type DigestRun,
} from "../run-digest";

const T0 = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01T00:00Z
const T1 = T0 + 24 * 60 * 60 * 1_000;
const MIN = 60_000;

const run = (overrides: Partial<DigestRun> & { started_at: number }): DigestRun => ({
  status: "completed",
  ...overrides,
});

describe("percentileNearestRank", () => {
  it("returns null for an empty sample", () => {
    expect(percentileNearestRank([], 0.5)).toBeNull();
  });

  it("uses nearest-rank on the sorted sample", () => {
    const s = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentileNearestRank(s, 0.5)).toBe(50);
    expect(percentileNearestRank(s, 0.95)).toBe(100);
    expect(percentileNearestRank(s, 0.9)).toBe(90);
    expect(percentileNearestRank(s, 0)).toBe(10);
    expect(percentileNearestRank(s, 1)).toBe(100);
  });

  it("handles a single element", () => {
    expect(percentileNearestRank([42], 0.5)).toBe(42);
    expect(percentileNearestRank([42], 0.95)).toBe(42);
  });
});

describe("normalizeErrorMessage", () => {
  it("lowercases, masks digits, squashes whitespace and caps length", () => {
    expect(normalizeErrorMessage("Timeout after 30001ms   on  attempt 2")).toBe(
      "timeout after #ms on attempt #",
    );
    expect(normalizeErrorMessage("  Boom  ")).toBe("boom");
    expect(normalizeErrorMessage("a".repeat(500))).toHaveLength(120);
  });
});

describe("buildRunDigest", () => {
  const fixture: DigestRun[] = [
    // durations: 1,2,3,4,5,6,7,8,9,10 minutes -> p50 = 5min, p95 = 10min
    ...Array.from({ length: 10 }, (_, i) =>
      run({
        started_at: T0 + i * MIN,
        ended_at: T0 + i * MIN + (i + 1) * MIN,
        cost_dollars: 0.1,
        total_tokens: 1_000,
      }),
    ),
    run({
      status: "failed",
      started_at: T0 + 2 * 60 * MIN,
      ended_at: T0 + 2 * 60 * MIN + 30_000,
      error: "Timeout after 30001ms",
      cost_dollars: 0.05,
      total_tokens: 500,
    }),
    run({
      status: "failed",
      started_at: T0 + 3 * 60 * MIN,
      ended_at: T0 + 3 * 60 * MIN + 30_000,
      error: "timeout after 30047ms",
    }),
    run({
      status: "failed",
      started_at: T0 + 4 * 60 * MIN,
      ended_at: T0 + 4 * 60 * MIN + 1_000,
      error: "Provider returned 502",
    }),
    run({
      status: "completed_with_warnings",
      started_at: T0 + 5 * 60 * MIN,
      ended_at: T0 + 5 * 60 * MIN + 45_000,
      finish_reason: "doom-loop",
    }),
    run({
      status: "completed_with_warnings",
      started_at: T0 + 6 * 60 * MIN,
      ended_at: T0 + 6 * 60 * MIN + 45_000,
      finish_reason: "budget-exhausted",
    }),
    run({
      status: "completed_with_warnings",
      started_at: T0 + 7 * 60 * MIN,
      ended_at: T0 + 7 * 60 * MIN + 45_000,
      finish_reason: "context-limit",
    }),
    run({
      status: "cancelled",
      started_at: T0 + 8 * 60 * MIN,
      ended_at: T0 + 8 * 60 * MIN + 5_000,
      stop_reason: "reconciled",
    }),
    // disconnected, not terminal, no ended_at, old -> counts as stuck too
    run({ status: "disconnected", started_at: T0 + 9 * 60 * MIN }),
    // starting with no end, well past the threshold -> stuck
    run({ status: "starting", started_at: T0 + 10 * 60 * MIN }),
    // starting but recent (1 min before window end) -> not stuck
    run({ status: "starting", started_at: T1 - MIN }),
    // unknown status: counted raw in byStatus, narrowed to disconnected
    run({ status: "weird_legacy", started_at: T0 + 11 * 60 * MIN, ended_at: T0 + 11 * 60 * MIN + 1 }),
    // outside the window: must be ignored entirely
    run({ status: "failed", started_at: T0 - 1, error: "outside" }),
    run({ status: "failed", started_at: T1, error: "outside" }),
  ];

  const digest = buildRunDigest(fixture, { start: T0, end: T1 });

  it("counts only runs whose started_at falls in [start, end)", () => {
    expect(digest.total).toBe(21);
    expect(digest.windowStart).toBe(T0);
    expect(digest.windowEnd).toBe(T1);
    expect(digest.topErrors.find((e) => e.message === "outside")).toBeUndefined();
  });

  it("tallies raw statuses", () => {
    expect(digest.byStatus).toEqual({
      completed: 10,
      failed: 3,
      completed_with_warnings: 3,
      cancelled: 1,
      disconnected: 1,
      starting: 2,
      weird_legacy: 1,
    });
  });

  it("counts disconnected through the status narrowing (unknown -> disconnected)", () => {
    expect(digest.disconnected).toBe(2);
  });

  it("counts reconciled stop reasons", () => {
    expect(digest.reconciled).toBe(1);
  });

  it("sums cost and tokens, treating missing values as zero", () => {
    expect(digest.costDollars).toBeCloseTo(1.05, 6);
    expect(digest.totalTokens).toBe(10_500);
  });

  it("computes nearest-rank duration percentiles over ended runs", () => {
    // 18 ended runs; sorted durations (ms):
    // 1, 1000, 5000, 30000, 30000, 45000x3, 60000, 120000, 180000 ... 600000
    // p50 rank = ceil(0.5*18) = 9 -> 60000; p95 rank = ceil(0.95*18) = 18 -> 600000
    expect(digest.durationMsP50).toBe(1 * MIN);
    expect(digest.durationMsP95).toBe(10 * MIN);
  });

  it("counts finish-reason circuit breakers", () => {
    expect(digest.doomLoop).toBe(1);
    expect(digest.budgetExhausted).toBe(1);
    expect(digest.contextLimit).toBe(1);
  });

  it("groups normalised error messages and orders by count", () => {
    expect(digest.topErrors).toEqual([
      { message: "timeout after #ms", count: 2 },
      { message: "provider returned #", count: 1 },
    ]);
  });

  it("detects stuck non-terminal runs using the default 10 minute threshold", () => {
    expect(DEFAULT_STUCK_STARTING_AFTER_MS).toBe(10 * MIN);
    // disconnected@9h, starting@10h are stuck; starting@T1-1min is not
    expect(digest.stuckStarting).toBe(2);
  });

  it("honours a custom threshold and clock for stuck detection", () => {
    const strict = buildRunDigest(fixture, { start: T0, end: T1 }, {
      stuckStartingAfterMs: 30_000,
      now: T1,
    });
    expect(strict.stuckStarting).toBe(3);

    const early = buildRunDigest(fixture, { start: T0, end: T1 }, {
      now: T0 + 9 * 60 * MIN + 5 * MIN,
    });
    expect(early.stuckStarting).toBe(0);
  });

  it("does not count terminal runs as stuck even without ended_at", () => {
    const d = buildRunDigest(
      [run({ status: "failed", started_at: T0 }), run({ status: "completed", started_at: T0 })],
      { start: T0, end: T1 },
    );
    expect(d.stuckStarting).toBe(0);
  });

  it("caps topErrors at five", () => {
    const rows = Array.from({ length: 8 }, (_, i) =>
      run({ status: "failed", started_at: T0 + i, error: `error kind ${String.fromCharCode(97 + i)}` }),
    );
    expect(buildRunDigest(rows, { start: T0, end: T1 }).topErrors).toHaveLength(5);
  });

  it("returns nulls and zeros for an empty window", () => {
    const empty = buildRunDigest([], { start: T0, end: T1 });
    expect(empty.total).toBe(0);
    expect(empty.durationMsP50).toBeNull();
    expect(empty.durationMsP95).toBeNull();
    expect(empty.costDollars).toBe(0);
    expect(empty.topErrors).toEqual([]);
    expect(empty.byStatus).toEqual({});
  });

  it("ignores ended_at earlier than started_at for durations", () => {
    const d = buildRunDigest(
      [run({ status: "completed", started_at: T0 + MIN, ended_at: T0 })],
      { start: T0, end: T1 },
    );
    expect(d.durationMsP50).toBeNull();
  });
});

describe("shouldAlertFailureRate", () => {
  it("requires both the absolute floor and the ratio", () => {
    expect(shouldAlertFailureRate({ failed: 1, total: 2 })).toBe(false); // ratio ok, floor not
    expect(shouldAlertFailureRate({ failed: 3, total: 3_000 })).toBe(false); // floor ok, ratio not
    expect(shouldAlertFailureRate({ failed: 3, total: 15 })).toBe(true); // exactly 20%
    expect(shouldAlertFailureRate({ failed: 2, total: 10 })).toBe(false);
    expect(shouldAlertFailureRate({ failed: 0, total: 0 })).toBe(false);
  });

  it("honours custom thresholds", () => {
    expect(shouldAlertFailureRate({ failed: 1, total: 10, minFailed: 1, minRatio: 0.1 })).toBe(true);
    expect(shouldAlertFailureRate({ failed: 5, total: 10, minFailed: 6 })).toBe(false);
  });
});

describe("formatDurationMs", () => {
  it("formats null, ms, seconds and minutes", () => {
    expect(formatDurationMs(null)).toBe("n/a");
    expect(formatDurationMs(250)).toBe("250ms");
    expect(formatDurationMs(4_500)).toBe("4.5s");
    expect(formatDurationMs(83_000)).toBe("1m 23s");
    expect(formatDurationMs(5 * MIN)).toBe("5m 00s");
  });
});

describe("formatDigestText", () => {
  it("contains the key numbers, formatted", () => {
    const text = formatDigestText({
      windowStart: T0,
      windowEnd: T1,
      total: 1234,
      byStatus: { completed: 1000, failed: 200, cancelled: 30, disconnected: 4 },
      disconnected: 4,
      reconciled: 2,
      costDollars: 1234.5,
      totalTokens: 9_876_543,
      durationMsP50: 5 * MIN,
      durationMsP95: 12 * MIN + 7_000,
      doomLoop: 3,
      budgetExhausted: 1,
      contextLimit: 0,
      topErrors: [{ message: "timeout after #ms", count: 42 }],
      stuckStarting: 5,
    });
    expect(text).toContain("2026-09-01 00:00");
    expect(text).toContain("1,234 total");
    expect(text).toContain("1,000 completed");
    expect(text).toContain("200 failed (16.2%)");
    expect(text).toContain("30 cancelled");
    expect(text).toContain("4 disconnected");
    expect(text).toContain("2 reconciled");
    expect(text).toContain("5 stuck");
    expect(text).toContain("3 doom-loop");
    expect(text).toContain("1 budget-exhausted");
    expect(text).toContain("0 context-limit");
    expect(text).toContain("$1,234.50");
    expect(text).toContain("9,876,543 tokens");
    expect(text).toContain("p50 5m 00s");
    expect(text).toContain("p95 12m 07s");
    expect(text).toContain("42× timeout after #ms");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(8);
  });

  it("shows n/a durations and 'none' for an empty digest", () => {
    const text = formatDigestText(buildRunDigest([], { start: T0, end: T1 }));
    expect(text).toContain("0 total");
    expect(text).toContain("0 failed (0.0%)");
    expect(text).toContain("p50 n/a");
    expect(text).toContain("By status: none");
    expect(text).toContain("Top errors: none");
    expect(text).toContain("$0.00");
  });
});
