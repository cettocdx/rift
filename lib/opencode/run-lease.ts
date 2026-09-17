import { createRedisClient } from "@/lib/rate-limit/redis";

/**
 * Per-run authorization + usage accounting for the OpenCode LLM proxy, in Redis.
 *
 * The proxy token proves *identity* (which sandbox/run); this lease proves the
 * run is *live and allowed to spend*. Every model call checks the lease and the
 * per-leg dollar ceiling; when a run ends or is cancelled the lease is revoked,
 * so a leaked token is inert outside an active run. Usage is tallied per run as
 * integer fields (cost in micro-dollars) via atomic HINCRBY, and is the single
 * billing source the driver feeds into UsageTracker. All helpers no-op safely
 * when Redis is not configured.
 */

const LEASE_TTL_SECONDS = 70 * 60;
const USAGE_TTL_SECONDS = 24 * 60 * 60;

export interface RunLease {
  runId: string;
  chatId: string;
  userId: string;
  sandboxId: string;
  sessionId?: string;
  subscription: string;
  modelKey: string;
  reasoningEffort?: string;
  ceilingDollars: number;
  serverBaseUrl: string;
  serverAuth: string;
  createdAt: number;
}

export interface RunUsageTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  requests: number;
  costDollars: number;
}

const sandboxKey = (id: string) => `llm:lease:sandbox:${id}`;
const chatKey = (id: string) => `llm:lease:chat:${id}`;
const runKey = (id: string) => `llm:lease:run:${id}`;
const usageKey = (runId: string) => `llm:usage:${runId}`;
const inflightKey = (runId: string) => `llm:inflight:${runId}`;

export async function createRunLease(lease: RunLease): Promise<void> {
  const redis = createRedisClient();
  if (!redis) return;
  const json = JSON.stringify(lease);
  await Promise.all([
    redis.set(sandboxKey(lease.sandboxId), json, { ex: LEASE_TTL_SECONDS }),
    redis.set(chatKey(lease.chatId), lease.sandboxId, {
      ex: LEASE_TTL_SECONDS,
    }),
    redis.set(runKey(lease.runId), lease.sandboxId, { ex: LEASE_TTL_SECONDS }),
  ]);
}

const REFRESH_RUN_LEASE = `
local raw = redis.call("GET", KEYS[2])
if not raw then return 0 end
local ok, lease = pcall(cjson.decode, raw)
if not ok or type(lease) ~= "table" or lease.runId ~= ARGV[1] or lease.chatId ~= ARGV[3] then
  return 0
end
if redis.call("GET", KEYS[1]) ~= ARGV[2] then return 0 end
local runSandbox = redis.call("GET", KEYS[3])
if runSandbox and runSandbox ~= ARGV[2] then return 0 end
redis.call("SET", KEYS[2], ARGV[4], "EX", ARGV[5])
redis.call("EXPIRE", KEYS[1], ARGV[5])
redis.call("SET", KEYS[3], ARGV[2], "EX", ARGV[5])
return 1
`;

/** Refresh only a current live lease; cancellation/replacement must be final. */
export async function refreshRunLease(lease: RunLease): Promise<void> {
  const redis = createRedisClient();
  if (!redis) return;
  await redis.eval(
    REFRESH_RUN_LEASE,
    [chatKey(lease.chatId), sandboxKey(lease.sandboxId), runKey(lease.runId)],
    [
      lease.runId,
      lease.sandboxId,
      lease.chatId,
      JSON.stringify(lease),
      LEASE_TTL_SECONDS,
    ],
  );
}

export async function getLeaseBySandbox(
  sandboxId: string,
): Promise<RunLease | null> {
  const redis = createRedisClient();
  if (!redis) return null;
  const raw = await redis.get(sandboxKey(sandboxId));
  if (!raw) return null;
  try {
    return typeof raw === "string"
      ? (JSON.parse(raw) as RunLease)
      : (raw as RunLease);
  } catch {
    return null;
  }
}

const REVOKE_RUN_LEASE = `
local raw = redis.call("GET", KEYS[2])
local revoked = 0
if raw then
  local ok, lease = pcall(cjson.decode, raw)
  if ok and type(lease) == "table" and lease.runId == ARGV[1] and lease.chatId == ARGV[3] then
    redis.call("DEL", KEYS[2])
    if redis.call("GET", KEYS[1]) == ARGV[2] then
      redis.call("DEL", KEYS[1])
    end
    revoked = 1
  end
end
if redis.call("GET", KEYS[3]) == ARGV[2] then
  redis.call("DEL", KEYS[3])
end
return revoked
`;

/** Revoke only this run; a delayed cleanup must not revoke its replacement. */
export async function revokeRunLeases(
  chatId: string,
  runId: string,
): Promise<void> {
  const redis = createRedisClient();
  if (!redis) return;
  // The per-run index finds the old sandbox even after a replacement updates
  // the chat index. The fallback supports leases created before this index.
  const sandboxId =
    (await redis.get(runKey(runId))) ?? (await redis.get(chatKey(chatId)));
  if (sandboxId && typeof sandboxId === "string") {
    await redis.eval(
      REVOKE_RUN_LEASE,
      [chatKey(chatId), sandboxKey(sandboxId), runKey(runId)],
      [runId, sandboxId, chatId],
    );
  }
}

export interface ProxyUsageDelta {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  costMicros: number;
}

/** Atomically add one request's usage to the run tally. */
export async function recordProxyUsage(
  runId: string,
  delta: ProxyUsageDelta,
): Promise<void> {
  const redis = createRedisClient();
  if (!redis) return;
  const k = usageKey(runId);
  await Promise.all([
    redis.hincrby(k, "input_tokens", Math.round(delta.inputTokens)),
    redis.hincrby(k, "output_tokens", Math.round(delta.outputTokens)),
    redis.hincrby(k, "cache_read_tokens", Math.round(delta.cacheReadTokens)),
    redis.hincrby(k, "reasoning_tokens", Math.round(delta.reasoningTokens)),
    redis.hincrby(k, "cost_micros", Math.round(delta.costMicros)),
    redis.hincrby(k, "requests", 1),
  ]);
  await redis.expire(k, USAGE_TTL_SECONDS);
}

function toInt(v: unknown): number {
  const n =
    typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
}

export async function readRunUsage(runId: string): Promise<RunUsageTotals> {
  const redis = createRedisClient();
  const empty: RunUsageTotals = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    requests: 0,
    costDollars: 0,
  };
  if (!redis) return empty;
  const h = (await redis.hgetall(usageKey(runId))) as Record<
    string,
    unknown
  > | null;
  if (!h) return empty;
  return {
    inputTokens: toInt(h.input_tokens),
    outputTokens: toInt(h.output_tokens),
    cacheReadTokens: toInt(h.cache_read_tokens),
    reasoningTokens: toInt(h.reasoning_tokens),
    requests: toInt(h.requests),
    costDollars: toInt(h.cost_micros) / 1_000_000,
  };
}

/** Reserve an in-flight slot; returns the new count. Caller must release. */
export async function acquireInflight(runId: string): Promise<number> {
  const redis = createRedisClient();
  if (!redis) return 1;
  const n = await redis.incr(inflightKey(runId));
  await redis.expire(inflightKey(runId), 900);
  return typeof n === "number" ? n : 1;
}

export async function releaseInflight(runId: string): Promise<void> {
  const redis = createRedisClient();
  if (!redis) return;
  await redis.decr(inflightKey(runId));
}
