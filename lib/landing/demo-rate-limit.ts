/**
 * The client's key for the landing page's public endpoints.
 *
 * The counters that used to live here — a six-an-hour bucket and a
 * once-a-day bucket, both plain `Map`s — moved to lib/landing/demo-budget.ts
 * when this shipped to Vercel. Module scope is per-instance there, so a
 * per-instance counter is not a ceiling; it is a ceiling multiplied by however
 * many instances the platform keeps warm. The maps survive in that file as the
 * local floor, backed by the shared Redis counter that actually holds.
 */

/**
 * `x-forwarded-for` is client-controlled and can be forged, so this is not a
 * security boundary — it raises the cost of casual abuse and nothing more. The
 * hard ceilings are the per-call token cap in demo-plan.ts, the fixed scan
 * target in demo-probe.ts, and the shared daily budget in demo-budget.ts.
 */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip") || "unknown";
}
