import { NextResponse, type NextRequest } from "next/server";

import { api } from "@/convex/_generated/api";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
import { ChatSDKError } from "@/lib/errors";
import { getUtcMonthRange } from "@/lib/monthly-usage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

const requireNonNegativeNumber = (value: unknown, field: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Invalid monthly usage aggregate: ${field}`);
  }
  return value;
};

/**
 * Return a bounded monthly usage aggregate from the per-day ledger. The
 * browser never downloads the underlying usage-log rows, so this endpoint has
 * constant payload size for both light and heavy users.
 */
export async function GET(request: NextRequest) {
  try {
    const userId = await getUserID(request);
    const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY;
    if (!serviceKey) {
      return json({ ok: false, error: "Usage data is unavailable." }, 503);
    }

    const period = getUtcMonthRange(Date.now());
    const startDay = new Date(period.start).toISOString().slice(0, 10);
    const endDay = new Date(period.end - 1).toISOString().slice(0, 10);
    const result = await getConvexClient().query(
      api.unitEconomics.getEntitySummary,
      {
        serviceKey,
        entityType: "user",
        entityId: userId,
        startDay,
        endDay,
      },
    );
    const totals = result?.totals;
    const requestCount = requireNonNegativeNumber(
      totals?.usageRequestCount,
      "usageRequestCount",
    );
    const inputTokens = requireNonNegativeNumber(
      totals?.inputTokens,
      "inputTokens",
    );
    const outputTokens = requireNonNegativeNumber(
      totals?.outputTokens,
      "outputTokens",
    );
    const cacheReadTokens = requireNonNegativeNumber(
      totals?.cacheReadTokens,
      "cacheReadTokens",
    );
    const cacheWriteTokens = requireNonNegativeNumber(
      totals?.cacheWriteTokens,
      "cacheWriteTokens",
    );
    const totalTokens = requireNonNegativeNumber(
      totals?.totalTokens,
      "totalTokens",
    );

    // The month as a zero-filled per-day token series, for the usage spark.
    // The rollup query already returns the day rows; only the totals were
    // being forwarded, so the shape of the month -- where the heavy days were
    // -- was computed and then thrown away. Bounded at 31 entries and summed
    // server-side, so the payload stays constant for heavy users.
    const dayRows = Array.isArray(result?.days) ? result.days : [];
    const tokensByDay = new Map<string, number>();
    for (const row of dayRows) {
      const day = typeof row?.day === "string" ? row.day : null;
      const tokens =
        (typeof row?.input_tokens === "number" ? row.input_tokens : 0) +
        (typeof row?.output_tokens === "number" ? row.output_tokens : 0) +
        (typeof row?.cache_read_tokens === "number"
          ? row.cache_read_tokens
          : 0) +
        (typeof row?.cache_write_tokens === "number"
          ? row.cache_write_tokens
          : 0);
      if (day && Number.isFinite(tokens) && tokens >= 0) {
        tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + tokens);
      }
    }
    const dailyTokens: number[] = [];
    for (
      let at = period.start;
      at < period.end && dailyTokens.length < 31;
      at += 24 * 60 * 60 * 1000
    ) {
      dailyTokens.push(
        tokensByDay.get(new Date(at).toISOString().slice(0, 10)) ?? 0,
      );
    }

    return json({
      ok: true,
      periodStart: period.start,
      periodEnd: period.end - 1,
      requestCount,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      totalTokens,
      dailyTokens,
    });
  } catch (error) {
    if (error instanceof ChatSDKError) {
      return json(
        {
          code: `${error.type}:${error.surface}`,
          message: error.message,
        },
        error.statusCode,
      );
    }

    console.error({
      timestamp: new Date().toISOString(),
      level: "error",
      event: "monthly_usage_summary_failed",
      service: "rift",
      environment: process.env.NODE_ENV ?? "unknown",
      error_name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Usage data is unavailable." }, 500);
  }
}
