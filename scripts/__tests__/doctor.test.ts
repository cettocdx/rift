/**
 * Unit tests for the pure env-evaluation logic behind `pnpm doctor` / `predev`.
 * No filesystem, no process.env: everything goes through evaluateEnv(env).
 */

import {
  evaluateEnv,
  parseDotEnv,
  formatTable,
  REQUIRED_VARS,
  UPSTASH_ROW_NAME,
  UPSTASH_EFFECT,
  TRIGGER_DEV_KEY_NOTE,
} from "../doctor";

const REQUIRED_NAMES = REQUIRED_VARS.map((v) => v.name);

const fullEnv = (): Record<string, string> => ({
  TRIGGER_SECRET_KEY: "tr_prod_x",
  TRIGGER_PROJECT_ID: "proj_x",
  NEXT_PUBLIC_CONVEX_URL: "https://x.convex.cloud",
  CONVEX_SERVICE_ROLE_KEY: "x",
  OPENROUTER_API_KEY: "x",
  E2B_API_KEY: "x",
  KV_REST_API_URL: "https://x.upstash.io",
  KV_REST_API_TOKEN: "x",
  NEXT_PUBLIC_POSTHOG_KEY: "x",
  OPS_ALERT_WEBHOOK_URL: "https://hooks.slack.com/x",
  BUILD_ENGINE: "opencode",
  LLM_PROXY_SECRET: "proxy-secret",
  REDIS_URL: "redis://localhost:6379",
});

describe("evaluateEnv — required vars", () => {
  test("the required list is exactly the six documented vars", () => {
    expect(REQUIRED_NAMES).toEqual([
      "TRIGGER_SECRET_KEY",
      "TRIGGER_PROJECT_ID",
      "NEXT_PUBLIC_CONVEX_URL",
      "CONVEX_SERVICE_ROLE_KEY",
      "OPENROUTER_API_KEY",
      "E2B_API_KEY",
    ]);
  });

  test("missing required vars -> ok:false and each one is listed as missing", () => {
    const env = fullEnv();
    delete env.E2B_API_KEY;
    delete env.TRIGGER_PROJECT_ID;

    const report = evaluateEnv(env);

    expect(report.ok).toBe(false);
    const missing = report.rows
      .filter((r) => r.level === "required" && r.status === "missing")
      .map((r) => r.name);
    expect(missing).toEqual(["TRIGGER_PROJECT_ID", "E2B_API_KEY"]);
    // The others are still reported, as ok.
    expect(
      report.rows.find((r) => r.name === "OPENROUTER_API_KEY")?.status,
    ).toBe("ok");
  });

  test("empty / whitespace-only values count as missing", () => {
    const env = fullEnv();
    env.OPENROUTER_API_KEY = "   ";
    const report = evaluateEnv(env);
    expect(report.ok).toBe(false);
    expect(
      report.rows.find((r) => r.name === "OPENROUTER_API_KEY")?.status,
    ).toBe("missing");
  });

  test("all present -> ok:true and no required row is missing", () => {
    const report = evaluateEnv(fullEnv());
    expect(report.ok).toBe(true);
    expect(
      report.rows
        .filter((r) => r.level === "required")
        .every((r) => r.status === "ok"),
    ).toBe(true);
    // Every row is ok, so nothing is flagged at all.
    expect(report.rows.filter((r) => r.status !== "ok")).toEqual([]);
  });

  test("evaluateEnv is pure: it does not mutate its input", () => {
    const env = fullEnv();
    const snapshot = { ...env };
    evaluateEnv(env);
    expect(env).toEqual(snapshot);
  });
});

describe("evaluateEnv — optional vars warn but do not fail", () => {
  test("missing optional vars are listed as warn with their effect, ok stays true", () => {
    const env = fullEnv();
    delete env.NEXT_PUBLIC_POSTHOG_KEY;
    delete env.OPS_ALERT_WEBHOOK_URL;
    delete env.REDIS_URL;
    delete env.BUILD_ENGINE;
    delete env.LLM_PROXY_SECRET;

    const report = evaluateEnv(env);

    expect(report.ok).toBe(true);
    const warns = Object.fromEntries(
      report.rows
        .filter((r) => r.level === "optional" && r.status === "warn")
        .map((r) => [r.name, r.effect]),
    );
    expect(warns).toEqual({
      NEXT_PUBLIC_POSTHOG_KEY: "telemetry disabled",
      OPS_ALERT_WEBHOOK_URL: "ops alerts disabled",
      LLM_PROXY_SECRET: "LLM proxy tokens signed with CONVEX_SERVICE_ROLE_KEY",
      REDIS_URL:
        "live HTTP chat resumption and Redis cancellation relay disabled; durable worker transport is separate",
    });
  });

  test("Upstash pair missing entirely -> single warn row with the limiter effect", () => {
    const env = fullEnv();
    delete env.KV_REST_API_URL;
    delete env.KV_REST_API_TOKEN;

    const report = evaluateEnv(env);
    const row = report.rows.find((r) => r.name === UPSTASH_ROW_NAME);

    expect(report.ok).toBe(true);
    expect(row).toMatchObject({
      level: "optional",
      status: "warn",
      effect: UPSTASH_EFFECT,
    });
    expect(row?.effect).toContain("rate-limit");
    expect(row?.effect).toContain("free-run lock");
    expect(row?.effect).toContain("monthly cap");
    expect(row?.effect).toContain("BudgetMonitor");
  });

  test("Upstash pair accepts the standalone UPSTASH_* names too", () => {
    const env = fullEnv();
    delete env.KV_REST_API_URL;
    delete env.KV_REST_API_TOKEN;
    env.UPSTASH_REDIS_REST_URL = "https://x.upstash.io";
    env.UPSTASH_REDIS_REST_TOKEN = "x";

    const row = evaluateEnv(env).rows.find((r) => r.name === UPSTASH_ROW_NAME);
    expect(row?.status).toBe("ok");
  });

  test("half an Upstash pair is flagged as such (URL without TOKEN)", () => {
    const env = fullEnv();
    delete env.KV_REST_API_TOKEN;

    const row = evaluateEnv(env).rows.find((r) => r.name === UPSTASH_ROW_NAME);
    expect(row?.status).toBe("warn");
    expect(row?.effect).toContain("URL set but TOKEN missing");
    expect(row?.effect).toContain(UPSTASH_EFFECT);
  });
});

describe("evaluateEnv — tr_dev_ Trigger key note", () => {
  test("a tr_dev_ key adds an info row saying runs need `trigger dev`", () => {
    const env = fullEnv();
    env.TRIGGER_SECRET_KEY = "tr_dev_abc";

    const report = evaluateEnv(env);
    const note = report.rows.find((r) => r.level === "info");

    expect(report.ok).toBe(true);
    expect(note).toBeDefined();
    expect(note?.name).toContain("TRIGGER_SECRET_KEY");
    expect(note?.status).toBe("warn");
    expect(note?.effect).toBe(TRIGGER_DEV_KEY_NOTE);
    expect(note?.effect).toContain("trigger dev");
    expect(note?.effect).toContain("pnpm dev");
  });

  test("a non-dev key adds no info row", () => {
    const report = evaluateEnv(fullEnv());
    expect(report.rows.some((r) => r.level === "info")).toBe(false);
  });

  test("a missing key adds no info row (only the required-missing row)", () => {
    const env = fullEnv();
    delete env.TRIGGER_SECRET_KEY;
    const report = evaluateEnv(env);
    expect(report.rows.some((r) => r.level === "info")).toBe(false);
    expect(
      report.rows.find((r) => r.name === "TRIGGER_SECRET_KEY")?.status,
    ).toBe("missing");
  });
});

describe("parseDotEnv", () => {
  test("parses KEY=VALUE, export prefix, quotes and comments; never interpolates", () => {
    const parsed = parseDotEnv(
      [
        "# comment",
        "",
        "A=1",
        'B="two words"',
        "C='single'",
        "export D=exported",
        "E=with # trailing comment",
        "F=has=equals",
        "not a line",
        "G=$HOME",
      ].join("\n"),
    );
    expect(parsed).toEqual({
      A: "1",
      B: "two words",
      C: "single",
      D: "exported",
      E: "with",
      F: "has=equals",
      G: "$HOME",
    });
  });
});

describe("formatTable", () => {
  test("prints a header and one aligned line per row without leaking values", () => {
    const env = fullEnv();
    env.TRIGGER_SECRET_KEY = "tr_dev_SECRETVALUE";
    delete env.OPS_ALERT_WEBHOOK_URL;

    const report = evaluateEnv(env);
    const out = formatTable(report);
    const lines = out.split("\n");

    expect(lines[0]).toMatch(/^name\s+\| status\s+\| effect$/);
    expect(lines).toHaveLength(2 + report.rows.length);
    expect(out).toContain("OPS_ALERT_WEBHOOK_URL");
    expect(out).toContain("ops alerts disabled");
    expect(out).not.toContain("SECRETVALUE");
    // Column separators line up: every data row has the '|' at the same offset.
    const pipeOffsets = lines.slice(2).map((l) => l.indexOf(" | "));
    expect(new Set(pipeOffsets).size).toBe(1);
  });
});
