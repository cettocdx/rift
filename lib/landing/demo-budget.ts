import { Redis } from "@upstash/redis";

/**
 * The landing page's counters, made durable.
 *
 * The limiters this replaces were plain `Map`s in module scope, and on a
 * single long-lived server that is exactly right. On Vercel it is a money bug.
 * Every serverless instance gets its own module scope, so "40 renders a day"
 * became "40 renders a day *per warm instance*", and the ceiling on what an
 * anonymous page could spend was however many instances the platform decided
 * to keep warm. The same applies to "one probe per visitor a day": an ordinary
 * visitor who happened to land on a cold instance got another one free.
 *
 * `INCR` in Redis is atomic and shared, so a counter built on it is the same
 * counter for every instance in every region. `EXPIRE` is set only on the
 * first increment, which is what makes the window fixed rather than sliding
 * forward each time somebody touches it.
 *
 * ── When Redis is not configured ──
 *
 * Local development has no Upstash credentials, and neither does CI. Rather
 * than failing open — which would make the cap meaningless exactly where it is
 * easiest to hit by accident — the in-process map stays as the floor. It is
 * per-instance and therefore weaker, and that is the honest tradeoff: one
 * process on a laptop is one instance, so locally it is exactly correct.
 */

let client: Redis | null | undefined;

function redis(): Redis | null {
  if (client !== undefined) return client;
  // Vercel's own Redis integration exposes KV_REST_API_*; a standalone Upstash
  // project exposes UPSTASH_REDIS_REST_*. Accept both, the way desktop auth
  // already does, so this uses whichever store the deployment has.
  const url =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  client = url && token ? new Redis({ url, token }) : null;
  return client;
}

/* ── The local floor ──────────────────────────────────────────────────── */

type Entry = { count: number; resetAt: number };
const local = new Map<string, Entry>();
const MAX_TRACKED = 5000;

function claimLocal(key: string, limit: number, windowMs: number, now: number) {
  if (local.size > MAX_TRACKED) {
    for (const [k, entry] of local) {
      if (entry.resetAt <= now) local.delete(k);
      if (local.size <= MAX_TRACKED) break;
    }
  }

  const entry = local.get(key);
  if (!entry || entry.resetAt <= now) {
    local.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfter: windowMs / 1000 };
  }
  if (entry.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfter: Math.ceil((entry.resetAt - now) / 1000),
    };
  }
  entry.count += 1;
  return {
    allowed: true,
    remaining: limit - entry.count,
    retryAfter: Math.ceil((entry.resetAt - now) / 1000),
  };
}

/* ── The claim ────────────────────────────────────────────────────────── */

export type Claim = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets. */
  retryAfter: number;
};

/**
 * Take one unit from a counter, or refuse.
 *
 * Both stores are consulted: the local floor first, because it is free and
 * catches a burst inside one instance before a round trip, then Redis for the
 * shared truth. A local refusal is final; a local pass still has to clear the
 * shared counter.
 *
 * If Redis is configured but unreachable, this falls back to the local result
 * rather than throwing. That fails *open* relative to the shared cap, which is
 * the lesser evil: the alternative is a Redis blip turning the marketing page
 * into an error page. The per-instance floor still applies, and the per-call
 * cost ceilings elsewhere are what actually bound the damage.
 */
export async function claim(
  key: string,
  limit: number,
  windowSeconds: number,
  now = Date.now(),
): Promise<Claim> {
  const localResult = claimLocal(key, limit, windowSeconds * 1000, now);
  if (!localResult.allowed) return localResult;

  const store = redis();
  if (!store) return localResult;

  try {
    const count = await store.incr(key);
    if (count === 1) await store.expire(key, windowSeconds);
    if (count > limit) {
      const ttl = await store.ttl(key);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: ttl > 0 ? ttl : windowSeconds,
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, limit - count),
      retryAfter: windowSeconds,
    };
  } catch {
    return localResult;
  }
}

/** Hand a unit back when the work it was claimed for failed. */
export async function refund(key: string): Promise<void> {
  const entry = local.get(key);
  if (entry && entry.count > 0) entry.count -= 1;

  const store = redis();
  if (!store) return;
  try {
    await store.decr(key);
  } catch {
    // A refund that does not land costs one unit of quota, never correctness.
  }
}

/** The UTC day, for keys that reset at midnight rather than on a rolling window. */
export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Seconds remaining in the current UTC day. */
export function secondsUntilUtcMidnight(now = Date.now()): number {
  const next = Date.UTC(
    new Date(now).getUTCFullYear(),
    new Date(now).getUTCMonth(),
    new Date(now).getUTCDate() + 1,
  );
  return Math.max(60, Math.ceil((next - now) / 1000));
}
