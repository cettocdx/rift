import { NextRequest, NextResponse } from "next/server";

import {
  DEMO_SURFACES,
  MAX_PROMPT_CHARS,
  generateDemoPlan,
  type DemoSurface,
} from "@/lib/landing/demo-plan";
import { claim } from "@/lib/landing/demo-budget";
import { clientKey } from "@/lib/landing/demo-rate-limit";

/**
 * The landing page's demo plan.
 *
 * Public and unauthenticated by design: the point of the frame on the marketing
 * page is that a visitor can use it before deciding whether to sign up. That
 * makes it a spend surface, so everything here is a boundary — a rate limit per
 * client, a hard cap on the prompt length, a small model, a low token ceiling,
 * and a short timeout.
 *
 * It plans and nothing else. No sandbox is opened, no tool is called, no file
 * is touched. The frame that renders the result says so under it.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

const isSurface = (value: unknown): value is DemoSurface =>
  typeof value === "string" &&
  (DEMO_SURFACES as readonly string[]).includes(value);

export async function POST(request: NextRequest) {
  // Six an hour, counted across every instance rather than per-instance.
  const limit = await claim(
    `landing:plan:${clientKey(request.headers)}`,
    6,
    60 * 60,
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "rate_limited" },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfter) },
      },
    );
  }

  let body: { prompt?: unknown; surface?: unknown };
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
      ? body.prompt.trim().slice(0, MAX_PROMPT_CHARS)
      : "";
  if (prompt.length < 3) {
    return NextResponse.json(
      { ok: false, error: "bad_request" },
      { status: 400 },
    );
  }

  const surface: DemoSurface = isSurface(body.surface) ? body.surface : "build";

  try {
    const plan = await generateDemoPlan(prompt, surface);
    return NextResponse.json(
      { ok: true, ...plan },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // The caller falls back to a prepared run. A landing page that shows an
    // error where the product should be is worse than one that quietly shows a
    // canned example, so this stays a soft failure.
    console.error("[landing-demo] plan failed", error);
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503 },
    );
  }
}
