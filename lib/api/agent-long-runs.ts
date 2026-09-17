import { runs } from "@trigger.dev/sdk";
import { finishRunRecord } from "@/lib/ai/runs/run-recorder";

/**
 * Statuses that mean a run is still the chat's live turn.
 *
 * DELAYED and PENDING_VERSION are included deliberately: a run that has not
 * started yet is still the answer the user is waiting for, and treating it as
 * absent would let a second run start beside it.
 */
export const ACTIVE_RUN_STATUSES = [
  "PENDING_VERSION",
  "QUEUED",
  "DEQUEUED",
  "EXECUTING",
  "WAITING",
  "DELAYED",
] as const;

/**
 * Resolve a chat's in-flight agent runs through server-created Trigger tags.
 *
 * Temporary chats deliberately have no durable row, so there is nowhere to
 * store `active_trigger_run_id` — which is why they were unreconnectable: the
 * run executed and billed while the UI had no handle for it at all. Tags are
 * the only other index onto the run, and they are written by the server at
 * trigger time (never supplied by the browser).
 *
 * OWNERSHIP IS ENFORCED HERE, and it must stay that way. The chat tag alone is
 * a caller-supplied identifier, so a chat id is not proof of ownership. Every
 * returned run must independently carry BOTH the chat tag and the
 * authenticated user's tag, and be an agent-long run. Callers pass a chatId
 * they got from the request; they must never pass a run id, and this function
 * must never return one that failed either check.
 */
export async function getOwnedTaggedRunIds({
  chatId,
  userId,
}: {
  chatId: string;
  userId: string;
}): Promise<string[]> {
  const chatTag = `chat_${chatId}`;
  const userTag = `user_${userId}`;
  const page = await runs.list({
    status: [...ACTIVE_RUN_STATUSES],
    taskIdentifier: "agent-long",
    tag: chatTag,
    limit: 100,
  });

  return page.data
    .filter(
      (run) =>
        run.taskIdentifier === "agent-long" &&
        ACTIVE_RUN_STATUSES.includes(
          run.status as (typeof ACTIVE_RUN_STATUSES)[number],
        ) &&
        run.tags.includes(chatTag) &&
        run.tags.includes(userTag),
    )
    .map((run) => run.id);
}

export const TERMINAL_RUN_STATUSES = new Set([
  "COMPLETED",
  "CANCELED",
  "FAILED",
  "CRASHED",
  "SYSTEM_FAILURE",
  "EXPIRED",
  "TIMED_OUT",
]);

async function observeBeforeDeadline<T>(
  request: Promise<T>,
  deadline: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Stop status unavailable")),
          Math.max(1, Math.min(2000, deadline - Date.now())),
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function recordObservedCancellation(runId: string, status: string) {
  // Completion/failure may win the race with Stop. Let its own outcome stand.
  if (status === "CANCELED")
    await finishRunRecord({ runId, status: "cancelled", stopReason: "user" });
}

/** Only an observed terminal state permits a replacement run. Provider 404s
 * can reflect lookup/environment problems and must preserve the original run. */
export async function isRunActive(runId: string): Promise<boolean> {
  const run = await runs.retrieve(runId);
  if ((ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
    return true;
  if (TERMINAL_RUN_STATUSES.has(run.status)) return false;
  throw new Error("The current run status could not be confirmed.");
}

/**
 * Cancel a run without losing the retry handle on transient Trigger failures.
 * Acceptance is not termination. Observe the exact run after requesting Stop;
 * an unresolved lookup or deadline keeps its handle available for retry.
 * Closes the run RECORD from the requesting side: a killed worker does not
 * reliably reach its own cleanup. Never throws from the record write.
 */
export async function cancelRunAndConfirm(runId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  let cancelFailed = false;
  try {
    await observeBeforeDeadline(runs.cancel(runId), deadline);
  } catch {
    cancelFailed = true;
    // The request may have been accepted before its response was lost. Read
    // this same run; never submit another cancellation or infer exit from 404.
  }
  while (Date.now() < deadline) {
    const run = await observeBeforeDeadline(runs.retrieve(runId), deadline);
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      await recordObservedCancellation(runId, run.status);
      return;
    }
    if (cancelFailed) throw new Error("Stop status unavailable");
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(250, Math.max(0, deadline - Date.now()))),
    );
  }
  throw new Error(
    "Stop has been requested but termination is not yet confirmed",
  );
}

/** The owner has already durably marked this exact claim canceled. New workers
 * abort their own tools, persist partial output and settle usage before exit.
 * Older/unresponsive workers retain the existing forced-stop behavior. */
export async function cancelClaimedRunAndConfirm(runId: string): Promise<void> {
  const deadline = Date.now() + 8_000;
  const read = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        runs.retrieve(runId),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error("Stop status unavailable")),
            Math.max(1, Math.min(1000, deadline - Date.now())),
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    let run = await read();
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      await recordObservedCancellation(runId, run.status);
      return;
    }
    if (run?.metadata?.cooperativeStopReady === true) {
      while (Date.now() < deadline) {
        if (TERMINAL_RUN_STATUSES.has(run.status)) {
          await recordObservedCancellation(runId, run.status);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
        run = await read();
      }
    }
  } catch {
    /* No terminal evidence: force cancellation and confirm as before. */
  }
  await cancelRunAndConfirm(runId);
}
