/**
 * OpenRouter credit watch.
 *
 * On 2026-09-02 production started answering every agent request with
 * OpenRouter's 402 "This request would exceed your available credits". The
 * account had $0.66 left. Nothing had warned anyone: the balance is only
 * visible on OpenRouter's dashboard, which nobody opens until something is
 * already broken, and a 402 looks like any other provider error in the logs.
 *
 * This module is the pure half of the fix: parse the credits endpoint, decide
 * which band a balance is in, decide whether that deserves a message, and
 * build the message. It has no clock, no env and no network of its own so it
 * can be unit-tested exhaustively; `fetchOpenRouterCredits` is the one
 * impure function and it is written to never throw, because a monitor that
 * crashes when the thing it monitors is down is not a monitor.
 *
 * Thresholds are dollars, not percentages. Spend is roughly linear in usage,
 * so "$20 left" is a meaningful runway regardless of how much was topped up.
 */

import type { OpsAlert } from "./alerts";

export interface OpenRouterCredits {
  totalCredits: number;
  totalUsage: number;
  remaining: number;
}

export type CreditsBand = "ok" | "warn" | "critical";

export const DEFAULT_WARN_BELOW_USD = 20;
export const DEFAULT_CRITICAL_BELOW_USD = 5;
export const DEFAULT_CREDITS_TIMEOUT_MS = 5_000;
export const OPENROUTER_CREDITS_URL = "https://openrouter.ai/api/v1/credits";

const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

/**
 * Accepts the raw JSON body of GET /api/v1/credits:
 * `{ data: { total_credits, total_usage } }`. Returns null on anything else
 * rather than guessing -- a misparsed zero would page as "critical" forever.
 */
export function parseOpenRouterCredits(json: unknown): OpenRouterCredits | null {
  if (typeof json !== "object" || json === null) return null;
  const data = (json as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const totalCredits = asFiniteNumber(
    (data as { total_credits?: unknown }).total_credits,
  );
  const totalUsage = asFiniteNumber(
    (data as { total_usage?: unknown }).total_usage,
  );
  if (totalCredits === null || totalUsage === null) return null;
  const remaining = Math.round((totalCredits - totalUsage) * 1_000_000) / 1_000_000;
  return { totalCredits, totalUsage, remaining };
}

const BAND_RANK: Record<CreditsBand, number> = { ok: 0, warn: 1, critical: 2 };

export function classifyCreditsBand(
  remaining: number,
  warnBelow = DEFAULT_WARN_BELOW_USD,
  criticalBelow = DEFAULT_CRITICAL_BELOW_USD,
): CreditsBand {
  if (!Number.isFinite(remaining)) return "critical";
  if (remaining < criticalBelow) return "critical";
  if (remaining < warnBelow) return "warn";
  return "ok";
}

export interface EvaluateCreditsAlertInput {
  remaining: number;
  warnBelow?: number;
  criticalBelow?: number;
  /** Band the last alert was sent for, when the caller can remember one. */
  lastAlertedBand?: CreditsBand;
}

export interface EvaluateCreditsAlertResult {
  band: CreditsBand;
  shouldAlert: boolean;
}

/**
 * Alert once per downward band transition. Going ok -> warn alerts, warn ->
 * critical alerts, but warn -> warn and critical -> warn do not: the operator
 * already knows, and recovery to ok is visible on the next digest rather than
 * worth a message of its own.
 */
export function evaluateCreditsAlert(
  input: EvaluateCreditsAlertInput,
): EvaluateCreditsAlertResult {
  const band = classifyCreditsBand(
    input.remaining,
    input.warnBelow,
    input.criticalBelow,
  );
  const previous = input.lastAlertedBand ?? "ok";
  const shouldAlert = band !== "ok" && BAND_RANK[band] > BAND_RANK[previous];
  return { band, shouldAlert };
}

export interface ThrottleWindowInput {
  band: CreditsBand;
  /** Wall clock of this check. */
  now: Date | number;
  /** Cadence of the scheduled check, so the "top of the window" test knows how wide a window is. */
  checkIntervalMinutes?: number;
  /** How often to repeat the warn-band message. */
  warnEveryHours?: number;
}

export const DEFAULT_CHECK_INTERVAL_MINUTES = 30;
export const DEFAULT_WARN_EVERY_HOURS = 6;

/**
 * Stateless throttle for a scheduled check that cannot remember its last
 * run. Critical posts on every check (money is about to run out; being
 * nagged every half hour is the point). Warn posts only on the check that
 * lands in the first `checkIntervalMinutes` of every `warnEveryHours`-th
 * UTC hour, i.e. four times a day at the defaults. Ok never posts.
 *
 * Stateless is a deliberate trade: Trigger.dev has no cross-run state, and
 * persisting a "last alerted band" somewhere else would add a write path to a
 * monitor whose whole value is that it has nothing to break.
 */
export function shouldPostCreditsAlertAt(input: ThrottleWindowInput): boolean {
  if (input.band === "ok") return false;
  if (input.band === "critical") return true;
  const interval = input.checkIntervalMinutes ?? DEFAULT_CHECK_INTERVAL_MINUTES;
  const everyHours = input.warnEveryHours ?? DEFAULT_WARN_EVERY_HOURS;
  const date = input.now instanceof Date ? input.now : new Date(input.now);
  if (Number.isNaN(date.getTime())) return false;
  return (
    date.getUTCHours() % everyHours === 0 && date.getUTCMinutes() < interval
  );
}

const fmtUsd = (n: number): string =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export interface BuildCreditsAlertInput extends OpenRouterCredits {
  band: CreditsBand;
  warnBelow?: number;
  criticalBelow?: number;
}

const BAND_SEVERITY: Record<CreditsBand, OpsAlert["severity"]> = {
  ok: "info",
  warn: "warning",
  critical: "critical",
};

export function buildCreditsAlert(input: BuildCreditsAlertInput): OpsAlert {
  const warnBelow = input.warnBelow ?? DEFAULT_WARN_BELOW_USD;
  const criticalBelow = input.criticalBelow ?? DEFAULT_CRITICAL_BELOW_USD;
  const threshold = input.band === "critical" ? criticalBelow : warnBelow;
  const title =
    input.band === "ok"
      ? `OpenRouter credits healthy (${fmtUsd(input.remaining)} left)`
      : `OpenRouter credits ${input.band === "critical" ? "nearly exhausted" : "running low"}: ${fmtUsd(input.remaining)} left (below ${fmtUsd(threshold)})`;
  return {
    title,
    severity: BAND_SEVERITY[input.band],
    fields: [
      { label: "Remaining", value: fmtUsd(input.remaining) },
      { label: "Band", value: input.band },
      { label: "Total credits", value: fmtUsd(input.totalCredits) },
      { label: "Total usage", value: fmtUsd(input.totalUsage) },
      {
        label: "Thresholds",
        value: `warn < ${fmtUsd(warnBelow)} · critical < ${fmtUsd(criticalBelow)}`,
      },
    ],
    link: "https://openrouter.ai/settings/credits",
  };
}

export interface FetchOpenRouterCreditsOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  url?: string;
}

/**
 * Never throws. Missing key, network failure, timeout, non-2xx, malformed
 * body all collapse to null; the caller decides whether "could not check" is
 * itself worth saying.
 */
export async function fetchOpenRouterCredits(
  options: FetchOpenRouterCreditsOptions,
): Promise<OpenRouterCredits | null> {
  const apiKey = options.apiKey?.trim();
  if (!apiKey) return null;
  const fetchImpl =
    options.fetchImpl ?? (typeof fetch === "function" ? fetch : undefined);
  if (!fetchImpl) return null;

  const timeoutMs = options.timeoutMs ?? DEFAULT_CREDITS_TIMEOUT_MS;
  const controller =
    typeof AbortController === "function" ? new AbortController() : undefined;
  const timer = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : undefined;

  try {
    const response = await fetchImpl(options.url ?? OPENROUTER_CREDITS_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${apiKey}`,
        accept: "application/json",
      },
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return parseOpenRouterCredits(body);
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
