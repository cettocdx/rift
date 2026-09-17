import { NextRequest, NextResponse } from "next/server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/db/convex-client";
import { runs } from "@trigger.dev/sdk";
import { getUserID } from "@/lib/auth/get-user-id";
import { getChatById } from "@/lib/db/actions";
import { finishRunRecord } from "@/lib/ai/runs/run-recorder";
import { TERMINAL_RUN_STATUSES } from "@/lib/api/agent-long-runs";

export async function POST(req: NextRequest) {
  try {
    const userId = await getUserID(req);
    const body = await req.json();
    if (!Array.isArray(body.runs) || body.runs.length > 60)
      return new Response(null, { status: 400 });
    await getConvexClient().mutation(api.runs.reconcileCompletedMessages, {
      serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY!,
      userId,
      runIds: body.runs
        .map((r: { id?: unknown }) => r.id)
        .filter(
          (id: unknown): id is string =>
            typeof id === "string" && id.length < 200,
        ),
    });
    let closed = 0;
    for (const candidate of body.runs) {
      if (
        typeof candidate.id !== "string" ||
        !/^run_[a-zA-Z0-9]+$/.test(candidate.id) ||
        typeof candidate.chatId !== "string"
      )
        continue;
      const chat = await getChatById({ id: candidate.chatId });
      if (!chat || chat.user_id !== userId) continue;
      try {
        const run = await runs.retrieve(candidate.id);
        if (
          !run.tags.includes(`user_${userId}`) ||
          !run.tags.includes(`chat_${candidate.chatId}`)
        )
          continue;
        if (!TERMINAL_RUN_STATUSES.has(run.status)) continue;
        await finishRunRecord({
          runId: run.id,
          status:
            run.status === "COMPLETED"
              ? "completed"
              : run.status === "CANCELED"
                ? "cancelled"
                : "failed",
          stopReason: "worker_reconciled",
        });
        closed++;
      } catch {
        // Missing visibility (including 404) is not proof the producer exited.
        // The exact persisted-message reconciliation above remains available.
      }
    }
    return NextResponse.json({ closed });
  } catch {
    return new Response(null, { status: 401 });
  }
}
