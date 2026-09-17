import "server-only";
import { runs } from "@trigger.dev/sdk";
import {
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type * as stopsModule from "@/convex/agentDispatchStops";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import {
  readAgentDispatchReceipt,
  refreshAgentDispatchTerminal,
} from "@/lib/api/agent-dispatch-admission";
import {
  cancelClaimedRunAndConfirm,
  TERMINAL_RUN_STATUSES,
} from "@/lib/api/agent-long-runs";
import type { AgentDispatchHandle } from "@/lib/api/agent-dispatch-admission";

type Stops = ApiFromModules<{
  agentDispatchStops: typeof stopsModule;
}>["agentDispatchStops"];
const requestRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Stops["request"]>,
  FunctionReturnType<Stops["request"]>
>("agentDispatchStops:request");
const readRef = makeFunctionReference<
  "query",
  FunctionArgs<Stops["getForBackend"]>,
  FunctionReturnType<Stops["getForBackend"]>
>("agentDispatchStops:getForBackend");
const absentRef = makeFunctionReference<
  "mutation",
  FunctionArgs<Stops["recordNotDispatched"]>,
  FunctionReturnType<Stops["recordNotDispatched"]>
>("agentDispatchStops:recordNotDispatched");
type Owner = { userId: string; chatId: string; dispatchId: string };
function authority(owner: Owner) {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) throw new Error("Missing Convex service key");
  return { ...owner, serviceKey };
}
export function readHackDispatchStop(owner: Owner) {
  return getConvexClient().query(readRef, authority(owner));
}
export function recordHackDispatchNotAttempted(
  owner: Pick<Owner, "userId" | "chatId">,
  handle: AgentDispatchHandle,
) {
  return getConvexClient().mutation(absentRef, {
    ...authority({ ...owner, dispatchId: handle.dispatchId }),
    attemptId: handle.attemptId,
    claimId: handle.claimId,
  });
}
async function bounded<T>(action: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      action(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Stop confirmation unavailable")),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Confirmation requires both a permanent admission fence and proof that the
 * exact accepted producer is terminal. Never discover a different chat run or
 * infer successful Stop from a released claim, age, 404, or cancel HTTP 2xx. */
export async function cancelHackDispatch(owner: Owner) {
  const client = getConvexClient();
  const args = authority(owner);
  // This write is required before looking at Trigger, including pre-admission.
  const stop = await client.mutation(requestRef, args);
  const response = (canceled: boolean) => ({
    canceled,
    dispatchId: owner.dispatchId,
  });
  if (stop.canceled) return response(true);
  if (!stop.runId || !stop.claimId) return response(false);
  try {
    await bounded(async () => {
      const run = await runs.retrieve(stop.runId!);
      const payload = run.payload as Record<string, unknown> | undefined;
      if (
        run.taskIdentifier !== "hack-long" ||
        !payload ||
        payload.userId !== owner.userId ||
        payload.chatId !== owner.chatId ||
        payload.dispatchId !== owner.dispatchId ||
        payload.startClaimId !== stop.claimId
      )
        throw new Error("Stop producer binding unavailable");
      if (!TERMINAL_RUN_STATUSES.has(run.status))
        await cancelClaimedRunAndConfirm(stop.runId!);
      const receipt = await readAgentDispatchReceipt(owner);
      if (
        !receipt ||
        receipt.claimId !== stop.claimId ||
        receipt.runId !== stop.runId
      )
        throw new Error("Stop receipt binding unavailable");
      await refreshAgentDispatchTerminal(owner, receipt);
    }, 15_000);
    // Re-read through the same atomic Stop mutation. It releases only this
    // generation after terminal persistence; a newer claim remains untouched.
    const confirmed = await client.mutation(requestRef, args);
    return response(confirmed.canceled);
  } catch {
    // The fence is durable. Retry this same ID to reconcile late acceptance,
    // lost cancel responses, unavailable provider state, or database failures.
    return response(false);
  }
}
