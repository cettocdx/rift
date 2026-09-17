import { NextRequest, NextResponse } from "next/server";

import {
  claim,
  secondsUntilUtcMidnight,
  utcDay,
} from "@/lib/landing/demo-budget";
import { runDemoProbe } from "@/lib/landing/demo-probe";
import { clientKey } from "@/lib/landing/demo-rate-limit";

/**
 * One real reconnaissance pass, per visitor, per day.
 *
 * The target is fixed in lib/landing/demo-probe.ts and cannot be supplied by
 * the caller — this endpoint takes no parameters at all, which is the point.
 * See that file for why the host it does scan is one we are permitted to.
 *
 * Once per client per day rather than the six-an-hour the plan endpoint allows,
 * because this one opens sockets to a third party from our address. A visitor
 * gets to see it happen for real; a script does not get to use us as a scan
 * relay.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function POST(request: NextRequest) {
  // Shared across instances, so a visitor who lands on a cold one does not
  // get a second free pass. See lib/landing/demo-budget.ts.
  const limit = await claim(
    `landing:probe:${utcDay()}:${clientKey(request.headers)}`,
    1,
    secondsUntilUtcMidnight(),
  );
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: "already_run", retryAfter: limit.retryAfter },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }

  try {
    const result = await runDemoProbe();
    return NextResponse.json(
      { ok: true, ...result },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Soft failure: the frame falls back to its prepared trace. A marketing
    // page showing a stack trace where the product should be is worse than one
    // showing a canned example.
    console.error("[landing-probe] failed", error);
    return NextResponse.json(
      { ok: false, error: "unavailable" },
      { status: 503 },
    );
  }
}
