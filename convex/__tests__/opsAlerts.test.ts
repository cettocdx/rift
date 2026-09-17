import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/*
 * Ops alerts over the runs table.
 *
 * The 2026-09-02 outage (every run failing on an OpenRouter 402) was invisible
 * because each failure looked ordinary on its own. These tests pin the
 * aggregation that would have caught it, and the projection that keeps user
 * text out of Slack.
 */

jest.mock("../_generated/server", () => ({
  internalQuery: jest.fn((c: any) => c),
  internalAction: jest.fn((c: any) => c),
}));
jest.mock("../_generated/api", () => ({
  internal: new Proxy(
    {},
    {
      get: (_t, moduleName) =>
        new Proxy({}, { get: (_t2, fnName) => `${String(moduleName)}.${String(fnName)}` }),
    },
  ),
}));
jest.mock("convex/values", () => {
  const v: any = new Proxy({}, { get: () => () => "validator" });
  return { v, ConvexError: class ConvexError extends Error {} };
});

type Row = Record<string, any>;

const NOW = Date.UTC(2026, 8, 2, 12, 0, 0);
const MIN = 60 * 1_000;

/** The slice of ctx.db the internal query touches: a gte range, order, take. */
function fakeDb(rows: Row[]) {
  const seen: { index?: string; gte?: [string, number]; order?: string; take?: number } = {};
  const db = {
    query: (table: string) => {
      expect(table).toBe("runs");
      return {
        withIndex: (name: string, build: (q: any) => any) => {
          seen.index = name;
          const constraints: ((r: Row) => boolean)[] = [];
          const q: any = {
            gte: (f: string, val: number) => {
              seen.gte = [f, val];
              constraints.push((r) => r[f] >= val);
              return q;
            },
          };
          build(q);
          return {
            order: (direction: string) => {
              seen.order = direction;
              return {
                take: async (n: number) => {
                  seen.take = n;
                  return rows
                    .filter((r) => constraints.every((c) => c(r)))
                    .sort((a, b) =>
                      direction === "desc"
                        ? b.started_at - a.started_at
                        : a.started_at - b.started_at,
                    )
                    .slice(0, n);
                },
              };
            },
          };
        },
      };
    },
  };
  return { db, seen };
}

const run = (over: Row): Row => ({
  _id: over.id ?? "r",
  id: over.id ?? "r",
  chat_id: "chat",
  user_id: "user",
  goal: "SECRET user prompt text",
  status: "completed",
  started_at: NOW - 5 * MIN,
  ended_at: NOW - 4 * MIN,
  update_time: NOW,
  ...over,
});

describe("opsAlerts.recentRunsForOps", () => {
  it("ranges on by_started_at, newest first, and projects away user text", async () => {
    const { recentRunsForOps } = await import("../opsAlerts");
    const rows = [
      run({ id: "old", started_at: NOW - 3 * 60 * MIN }),
      run({ id: "new", started_at: NOW - 2 * MIN, error: "  boom\n\n at x  " }),
      run({ id: "mid", started_at: NOW - 30 * MIN, status: "failed" }),
    ];
    const { db, seen } = fakeDb(rows);
    const result = await (recentRunsForOps as any).handler(
      { db },
      { sinceMs: NOW - 60 * MIN },
    );

    expect(seen.index).toBe("by_started_at");
    expect(seen.gte).toEqual(["started_at", NOW - 60 * MIN]);
    expect(seen.order).toBe("desc");
    expect(result.map((r: Row) => r.started_at)).toEqual([NOW - 2 * MIN, NOW - 30 * MIN]);
    for (const projected of result) {
      expect(projected).not.toHaveProperty("goal");
      expect(projected).not.toHaveProperty("user_id");
      expect(projected).not.toHaveProperty("chat_id");
      expect(projected).not.toHaveProperty("_id");
    }
    expect(result[0].error).toBe("boom at x");
  });

  it("clips error strings and clamps the scan limit", async () => {
    const { recentRunsForOps, OPS_RUNS_SCAN_LIMIT, ERROR_SNIPPET_MAX_CHARS } =
      await import("../opsAlerts");
    const { db, seen } = fakeDb([run({ error: "e".repeat(500) })]);
    const result = await (recentRunsForOps as any).handler(
      { db },
      { sinceMs: 0, limit: 10 ** 9 },
    );
    expect(seen.take).toBe(OPS_RUNS_SCAN_LIMIT);
    expect(result[0].error).toHaveLength(ERROR_SNIPPET_MAX_CHARS);
  });
});

describe("opsAlerts.summarizeRecentRuns", () => {
  const windowStart = NOW - 15 * MIN;

  it("counts failures only inside the window but stuck runs anywhere", async () => {
    const { summarizeRecentRuns } = await import("../opsAlerts");
    const runs = [
      { status: "failed", started_at: NOW - 2 * MIN, error: "OpenRouter 402 after 30012ms" },
      { status: "failed", started_at: NOW - 3 * MIN, error: "openrouter 402 after 30047ms" },
      { status: "failed", started_at: NOW - 4 * MIN, error: "timeout" },
      { status: "completed", started_at: NOW - 5 * MIN, ended_at: NOW - MIN },
      // outside the window: not part of the rate
      { status: "failed", started_at: NOW - 40 * MIN, error: "old" },
      // stuck: open, non-terminal, older than 10 min, started before the window
      { status: "starting", started_at: NOW - 50 * MIN },
      { status: "running", started_at: NOW - 12 * MIN },
      // open but young: not stuck
      { status: "running", started_at: NOW - 3 * MIN },
      // old but closed: not stuck
      { status: "running", started_at: NOW - 60 * MIN, ended_at: NOW - 30 * MIN },
    ];
    const summary = summarizeRecentRuns(runs, { now: NOW, windowStart });
    expect(summary.total).toBe(6);
    expect(summary.failed).toBe(3);
    expect(summary.stuck).toBe(2);
    // Digits are masked so the two 402 messages group together.
    expect(summary.topErrors[0]).toEqual({
      message: "openrouter # after #ms",
      count: 2,
    });
    expect(summary.topErrors[1]).toEqual({ message: "timeout", count: 1 });
  });

  it("returns zeros for an empty window", async () => {
    const { summarizeRecentRuns } = await import("../opsAlerts");
    expect(summarizeRecentRuns([], { now: NOW, windowStart })).toEqual({
      total: 0,
      failed: 0,
      stuck: 0,
      topErrors: [],
    });
  });
});

describe("opsAlerts.buildFailureRateAlert", () => {
  it("is critical when every run failed and includes stuck + errors", async () => {
    const { buildFailureRateAlert } = await import("../opsAlerts");
    const alert = buildFailureRateAlert(
      {
        total: 4,
        failed: 4,
        stuck: 2,
        topErrors: [{ message: "openrouter # credits", count: 4 }],
      },
      { windowMs: 15 * MIN },
    );
    expect(alert.severity).toBe("critical");
    expect(alert.title).toContain("100%");
    expect(alert.fields.map((f) => f.label)).toEqual([
      "Window",
      "Runs",
      "Failed",
      "Open > 10 min",
      "Error 1",
    ]);
  });

  it("is a warning for a partial failure and omits the stuck field at zero", async () => {
    const { buildFailureRateAlert } = await import("../opsAlerts");
    const alert = buildFailureRateAlert(
      { total: 10, failed: 3, stuck: 0, topErrors: [] },
      { windowMs: 15 * MIN },
    );
    expect(alert.severity).toBe("warning");
    expect(alert.fields.map((f) => f.label)).toEqual(["Window", "Runs", "Failed"]);
  });
});

describe("opsAlerts.digestTextToFields", () => {
  it("splits label lines and folds bullets into Top errors", async () => {
    const { digestTextToFields } = await import("../opsAlerts");
    const fields = digestTextToFields(
      [
        "*Agent run digest* — 2026-09-01 08:00 → 2026-09-02 08:00 UTC",
        "Runs: 10 total · 7 completed · 3 failed (30.0%) · 0 cancelled",
        "Top errors:",
        "  • 2× openrouter # credits",
        "  • 1× timeout",
      ].join("\n"),
    );
    expect(fields[0].label).toBe("Digest");
    expect(fields[1]).toEqual({
      label: "Runs",
      value: "10 total · 7 completed · 3 failed (30.0%) · 0 cancelled",
    });
    expect(fields[2]).toEqual({
      label: "Top errors",
      value: "• 2× openrouter # credits\n• 1× timeout",
    });
  });
});

describe("opsAlerts actions", () => {
  const originalFetch = globalThis.fetch;
  const originalWebhook = process.env.OPS_ALERT_WEBHOOK_URL;
  let fetchMock: jest.Mock<any>;

  beforeEach(() => {
    fetchMock = jest.fn<any>().mockResolvedValue({ ok: true, status: 200 });
    (globalThis as any).fetch = fetchMock;
    process.env.OPS_ALERT_WEBHOOK_URL = "https://hooks.example/test";
  });

  afterEach(() => {
    (globalThis as any).fetch = originalFetch;
    if (originalWebhook === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = originalWebhook;
  });

  const ctxWith = (rows: Row[]) => ({
    runQuery: jest.fn<any>(async (_ref: string, args: { sinceMs: number }) =>
      rows.filter((r) => r.started_at >= args.sinceMs),
    ),
  });

  it("checkFailureRate posts when the rate gate trips", async () => {
    const { checkFailureRate } = await import("../opsAlerts");
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    const ctx = ctxWith([
      { status: "failed", started_at: NOW - 2 * MIN, error: "402 credits" },
      { status: "failed", started_at: NOW - 3 * MIN, error: "402 credits" },
      { status: "failed", started_at: NOW - 4 * MIN, error: "402 credits" },
    ]);
    await (checkFailureRate as any).handler(ctx, {});
    expect(ctx.runQuery).toHaveBeenCalledWith("opsAlerts.recentRunsForOps", {
      sinceMs: NOW - 75 * MIN,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.text).toContain("100%");
    expect(body.text).not.toContain("SECRET");
    (Date.now as any).mockRestore();
  });

  it("checkFailureRate stays quiet below the floor", async () => {
    const { checkFailureRate } = await import("../opsAlerts");
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    const ctx = ctxWith([
      { status: "failed", started_at: NOW - 2 * MIN, error: "x" },
      { status: "completed", started_at: NOW - 3 * MIN, ended_at: NOW - MIN },
    ]);
    await (checkFailureRate as any).handler(ctx, {});
    expect(fetchMock).not.toHaveBeenCalled();
    (Date.now as any).mockRestore();
  });

  it("checkFailureRate survives a query failure without throwing", async () => {
    const { checkFailureRate } = await import("../opsAlerts");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    const ctx = { runQuery: jest.fn<any>().mockRejectedValue(new Error("db down")) };
    await expect((checkFailureRate as any).handler(ctx, {})).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("dailyRunDigest posts an info alert built from the 24h window", async () => {
    const { dailyRunDigest } = await import("../opsAlerts");
    jest.spyOn(Date, "now").mockReturnValue(NOW);
    const ctx = ctxWith([
      { status: "completed", started_at: NOW - 60 * MIN, ended_at: NOW - 50 * MIN, cost_dollars: 0.5 },
      { status: "failed", started_at: NOW - 120 * MIN, ended_at: NOW - 119 * MIN, error: "402" },
    ]);
    await (dailyRunDigest as any).handler(ctx, {});
    expect(ctx.runQuery).toHaveBeenCalledWith("opsAlerts.recentRunsForOps", {
      sinceMs: NOW - 24 * 60 * MIN,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0] as any)[1].body);
    expect(body.text).toContain(":information_source:");
    expect(body.text).toContain("2 runs, 1 failed");
    (Date.now as any).mockRestore();
  });

  it("returns quietly when no webhook is configured", async () => {
    delete process.env.OPS_ALERT_WEBHOOK_URL;
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    const { dailyRunDigest } = await import("../opsAlerts");
    await (dailyRunDigest as any).handler(ctxWith([]), {});
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});
