/**
 * scripts/doctor.ts — local environment preflight for RIFT.
 *
 * WHY THIS EXISTS
 * ---------------
 * For a long time the documented default command (`pnpm dev`) started Next and
 * Convex but NOT the Trigger.dev worker. The Build path
 * (/api/agent-long -> Trigger task) was therefore dead on every local machine
 * in the most silent way possible: the POST returned 200, the run sat queued
 * forever because nothing was there to pick it up, and the UI gave up after
 * 60 s with "RIFT could not start this agent run in time". No log line said
 * why. On top of that, several env vars degrade to silent no-ops when unset
 * (rate limiting, the free-run lock, the monthly cap, the mid-stream
 * BudgetMonitor, PostHog telemetry, Slack ops alerts), so a machine could look
 * perfectly healthy while half the product was switched off. Nobody could tell.
 *
 * `pnpm dev` now starts the Trigger worker, and this script runs first
 * (`predev`, also `pnpm doctor`) to print ONE table of what is set, what is
 * missing, and what each gap actually does. Values are never printed.
 *
 * Zero dependencies beyond Node. The check logic is the pure, exported
 * `evaluateEnv` so it is unit-tested (scripts/__tests__/doctor.test.ts); the
 * CLI wrapper at the bottom only does I/O.
 *
 * Usage:
 *   npx tsx scripts/doctor.ts          # aligned table, exit 1 if a required var is missing
 *   npx tsx scripts/doctor.ts --json   # machine-readable {ok, rows}
 *   npx tsx scripts/doctor.ts --env path/to/other.env   # check a different file
 */

import fs from "fs";
import path from "path";

export type RowStatus = "ok" | "missing" | "warn";
export type RowLevel = "required" | "optional" | "info";

export interface DoctorRow {
  /** Env var name (or a short label when one row covers a pair of names). */
  name: string;
  /** required = exit 1 when missing; optional = warn only; info = advisory note. */
  level: RowLevel;
  status: RowStatus;
  /** What happens when this is missing / what the note means. Always populated,
   *  even on ok rows, so --json consumers can show it; the table prints "-" for ok. */
  effect: string;
}

export interface DoctorReport {
  /** false only when at least one REQUIRED var is missing. */
  ok: boolean;
  rows: DoctorRow[];
}

export type EnvMap = Record<string, string | undefined>;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

/** Vars without which the core product cannot run locally at all. */
export const REQUIRED_VARS: ReadonlyArray<{ name: string; effect: string }> = [
  {
    name: "TRIGGER_SECRET_KEY",
    effect:
      "Build runs cannot be triggered: /api/agent-long fails before a run exists",
  },
  {
    // trigger.config.ts reads `project: process.env.TRIGGER_PROJECT_ID`.
    name: "TRIGGER_PROJECT_ID",
    effect:
      "trigger.config.ts has no project ref; `trigger dev` refuses to start",
  },
  {
    name: "NEXT_PUBLIC_CONVEX_URL",
    effect: "browser and server cannot reach Convex; nothing loads",
  },
  {
    name: "CONVEX_SERVICE_ROLE_KEY",
    effect: "server-side Convex calls (auth, runs, billing, usage) all fail",
  },
  {
    name: "OPENROUTER_API_KEY",
    effect: "no model access; every chat and agent call fails",
  },
  {
    name: "E2B_API_KEY",
    effect: "no sandboxes; Build and Secure runs fail at startup",
  },
];

/** Single optional vars: absence only degrades the product, silently. */
export const OPTIONAL_VARS: ReadonlyArray<{ name: string; effect: string }> = [
  {
    name: "NEXT_PUBLIC_POSTHOG_KEY",
    effect: "telemetry disabled",
  },
  {
    name: "OPS_ALERT_WEBHOOK_URL",
    effect: "ops alerts disabled",
  },
  {
    // lib/llm-proxy/token.ts — falls back to CONVEX_SERVICE_ROLE_KEY.
    name: "LLM_PROXY_SECRET",
    effect: "LLM proxy tokens signed with CONVEX_SERVICE_ROLE_KEY",
  },
  {
    // lib/utils/redis-pubsub.ts — a *different* Redis than the Upstash REST
    // pair below: node-redis pub/sub used to relay Stop across instances.
    name: "REDIS_URL",
    effect:
      "live HTTP chat resumption and Redis cancellation relay disabled; durable worker transport is separate",
  },
];

/**
 * The Upstash REST pair, exactly as lib/rate-limit/redis.ts resolves it:
 * URL  = UPSTASH_REDIS_REST_URL   || KV_REST_API_URL
 * TOKEN = UPSTASH_REDIS_REST_TOKEN || KV_REST_API_TOKEN
 * Without BOTH, createRedisClient() returns null and every limiter short-circuits
 * with rateLimitSkipped: true — which also makes captureBudgetSnapshot() return
 * null, i.e. the mid-stream BudgetMonitor never arms.
 */
export const UPSTASH_ROW_NAME =
  "UPSTASH_REDIS_REST_URL/_TOKEN (or KV_REST_API_*)";
export const UPSTASH_EFFECT =
  "rate-limit, free-run lock, monthly cap and BudgetMonitor are disabled locally";

export const TRIGGER_DEV_KEY_PREFIX = "tr_dev_";
export const TRIGGER_DEV_KEY_NOTE =
  "dev key: runs need `trigger dev` (started by `pnpm dev`)";

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

const isSet = (value: string | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Evaluate an env map. Pure: no fs, no process, no printing.
 */
export function evaluateEnv(env: EnvMap): DoctorReport {
  const rows: DoctorRow[] = [];

  for (const { name, effect } of REQUIRED_VARS) {
    rows.push({
      name,
      level: "required",
      status: isSet(env[name]) ? "ok" : "missing",
      effect,
    });
  }

  // Trigger dev-key advisory. Only meaningful when the key is present.
  const triggerKey = env.TRIGGER_SECRET_KEY;
  if (isSet(triggerKey) && triggerKey.startsWith(TRIGGER_DEV_KEY_PREFIX)) {
    rows.push({
      name: `TRIGGER_SECRET_KEY (${TRIGGER_DEV_KEY_PREFIX}*)`,
      level: "info",
      status: "warn",
      effect: TRIGGER_DEV_KEY_NOTE,
    });
  }

  // Upstash REST pair (either naming scheme).
  const upstashUrl = env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL;
  const upstashToken = env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN;
  const hasUrl = isSet(upstashUrl);
  const hasToken = isSet(upstashToken);
  if (hasUrl && hasToken) {
    rows.push({
      name: UPSTASH_ROW_NAME,
      level: "optional",
      status: "ok",
      effect: UPSTASH_EFFECT,
    });
  } else if (hasUrl !== hasToken) {
    rows.push({
      name: UPSTASH_ROW_NAME,
      level: "optional",
      status: "warn",
      effect: `${hasUrl ? "URL set but TOKEN missing" : "TOKEN set but URL missing"}; treated as unconfigured: ${UPSTASH_EFFECT}`,
    });
  } else {
    rows.push({
      name: UPSTASH_ROW_NAME,
      level: "optional",
      status: "warn",
      effect: UPSTASH_EFFECT,
    });
  }

  for (const { name, effect } of OPTIONAL_VARS) {
    const present = isSet(env[name]);
    rows.push({
      name,
      level: "optional",
      status: present ? "ok" : "warn",
      effect,
    });
  }

  const ok = rows.every(
    (r) => !(r.level === "required" && r.status === "missing"),
  );
  return { ok, rows };
}

/**
 * Minimal .env parser: `KEY=VALUE` per line, optional `export ` prefix,
 * `#` comments, surrounding single/double quotes stripped. No interpolation.
 * Pure, so it is testable without touching disk.
 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    const quoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (quoted) {
      value = value.slice(1, -1);
    } else {
      // Strip an unquoted trailing comment: KEY=value # note
      const hash = value.indexOf(" #");
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/** Render the aligned `name | status | effect` table. Pure. The effect column
 *  is "what happens because this is missing", so ok rows print "-". */
export function formatTable(report: DoctorReport): string {
  const statusLabel: Record<RowStatus, string> = {
    ok: "OK",
    missing: "MISSING",
    warn: "WARN",
  };
  const header = { name: "name", status: "status", effect: "effect" };
  const cells = report.rows.map((r) => ({
    name: r.name,
    status: statusLabel[r.status],
    effect: r.status === "ok" ? "-" : r.effect || "-",
  }));
  const nameW = Math.max(
    header.name.length,
    ...cells.map((c) => c.name.length),
  );
  const statusW = Math.max(
    header.status.length,
    ...cells.map((c) => c.status.length),
  );
  const line = (c: { name: string; status: string; effect: string }) =>
    `${c.name.padEnd(nameW)} | ${c.status.padEnd(statusW)} | ${c.effect}`;
  const rule = `${"-".repeat(nameW)}-+-${"-".repeat(statusW)}-+-${"-".repeat(6)}`;
  return [line(header), rule, ...cells.map(line)].join("\n");
}

// ---------------------------------------------------------------------------
// CLI wrapper (I/O only)
// ---------------------------------------------------------------------------

function loadEnv(envPath: string): EnvMap {
  let fileEnv: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    fileEnv = parseDotEnv(fs.readFileSync(envPath, "utf8"));
  }
  // Same precedence as Next: an already-exported shell var beats .env.local.
  return { ...fileEnv, ...process.env };
}

/** Repo-relative when inside the repo, absolute otherwise. */
function displayPath(target: string, repoRoot: string): string {
  const rel = path.relative(repoRoot, target);
  return rel && !rel.startsWith("..") ? rel : target;
}

function main(): void {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const envFlag = argv.indexOf("--env");
  const repoRoot = path.resolve(__dirname, "..");
  const envPath =
    envFlag >= 0 && argv[envFlag + 1]
      ? path.resolve(process.cwd(), argv[envFlag + 1])
      : path.join(repoRoot, ".env.local");
  const report = evaluateEnv(loadEnv(envPath));

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    const missing = report.rows.filter(
      (r) => r.level === "required" && r.status === "missing",
    );
    process.stdout.write(
      `rift doctor — ${fs.existsSync(envPath) ? "loaded" : "no env file at"} ${displayPath(envPath, repoRoot)}\n\n`,
    );
    process.stdout.write(formatTable(report) + "\n\n");
    if (report.ok) {
      process.stdout.write(
        "OK: all required vars set. WARN rows are silent no-ops locally, not failures.\n",
      );
    } else {
      process.stdout.write(
        `FAIL: ${missing.length} required var(s) missing: ${missing.map((m) => m.name).join(", ")}\n` +
          "Copy the names from .env.local.example into .env.local and rerun `pnpm doctor`.\n",
      );
    }
  }

  process.exitCode = report.ok ? 0 : 1;
}

// Run only when executed directly (tsx / node), not when imported by Jest.
const entry = process.argv[1] ?? "";
if (/(^|[\\/])doctor(\.[cm]?[jt]s)?$/.test(entry)) {
  main();
}
