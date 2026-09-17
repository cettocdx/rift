import { NextRequest, NextResponse } from "next/server";

import {
  claim,
  refund,
  secondsUntilUtcMidnight,
  utcDay,
} from "@/lib/landing/demo-budget";
import {
  DAILY_CAP,
  ImagePromptRejected,
  MAX_IMAGE_PROMPT_CHARS,
  generateDemoImage,
} from "@/lib/landing/demo-image";
import { clientKey } from "@/lib/landing/demo-rate-limit";

/**
 * One real render, per visitor, per day, inside a fixed daily budget.
 *
 * This is the only endpoint on the marketing page that spends money, so it has
 * two ceilings rather than one: a per-client limit that stops an ordinary
 * visitor refreshing for free renders, and a global per-day cap that holds
 * even when the per-client key is forged. See lib/landing/demo-image.ts for
 * the numbers and how to change them.
 *
 * The budget is claimed before the provider is called and released if the call
 * fails, so an outage at the provider does not silently burn the day's quota.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (DAILY_CAP === 0) {
    return NextResponse.json(
      { ok: false, error: "disabled" },
      { status: 503 },
    );
  }

  let body: { prompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
  }

  const prompt =
    typeof body.prompt === "string"
      ? body.prompt.trim().slice(0, MAX_IMAGE_PROMPT_CHARS)
      : "";
  if (prompt.length < 3) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
  }

  const day = utcDay();
  const untilMidnight = secondsUntilUtcMidnight();
  const budgetKey = `landing:image:day:${day}`;

  // Per-client first: a visitor who has already had their render should not be
  // able to consume the day's budget by asking again.
  const perClient = await claim(
    `landing:image:${day}:${clientKey(request.headers)}`,
    1,
    untilMidnight,
  );
  if (!perClient.allowed) {
    return NextResponse.json(
      { ok: false, error: "already_run", retryAfter: perClient.retryAfter },
      { status: 429, headers: { "Retry-After": String(perClient.retryAfter) } },
    );
  }

  // Then the day's money. This is the ceiling that actually holds, because it
  // is one counter shared by every instance rather than one per instance —
  // see lib/landing/demo-budget.ts for why that distinction is the difference
  // between a $1.60 day and an unbounded one.
  const budget = await claim(budgetKey, DAILY_CAP, untilMidnight);
  if (!budget.allowed) {
    return NextResponse.json(
      { ok: false, error: "budget_spent" },
      { status: 429 },
    );
  }

  try {
    const image = await generateDemoImage(prompt);
    return NextResponse.json(
      { ok: true, ...image, remainingToday: budget.remaining },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // The provider failed, so the day should not be charged for it.
    await refund(budgetKey);
    if (error instanceof ImagePromptRejected) {
      return NextResponse.json(
        { ok: false, error: "prompt_rejected" },
        { status: 400 },
      );
    }
    // Soft failure everywhere else: the frame falls back to its prepared
    // stills rather than showing a marketing page an error message.
    console.error("[landing-image] render failed", error);
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503 },
    );
  }
}
