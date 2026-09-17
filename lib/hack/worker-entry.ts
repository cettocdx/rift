import "server-only";
import { randomUUID } from "node:crypto";
import { makeFunctionReference } from "convex/server";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { assertHackRunPayload, hashHackRunPayload } from "./durable-run";

export type HackWorkerEntryBinding = {
  userId: string;
  chatId: string;
  dispatchId: string;
  claimId: string;
  runId: string;
  workerEntryId: string;
  payloadHash: string;
};
export type HackWorkerLifecycle = {
  binding: HackWorkerEntryBinding;
  handoff(): void;
  beforeEffects(): Promise<void>;
};
const entryRef = makeFunctionReference<
  "mutation",
  HackWorkerEntryBinding & { serviceKey: string },
  boolean
>("agentDispatchRequests:enterWorker");
const effectsRef = makeFunctionReference<
  "mutation",
  HackWorkerEntryBinding & { serviceKey: string },
  boolean
>("agentDispatchRequests:markWorkerEffectsStarted");
const cleanupRef = makeFunctionReference<
  "mutation",
  HackWorkerEntryBinding & { serviceKey: string },
  boolean
>("agentDispatchRequests:recordPreExecutionCleanup");

const WORKER_RECEIPT_DEADLINE_MS = 10_000;

/** A deadline ends waiting, not the remote transaction. Never retry or infer
 * permission/cleanup from timeout: its durable fence remains authoritative. */
async function awaitReceipt(
  operation: string,
  invoke: () => Promise<unknown>,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Worker ${operation} acknowledgment timed out`)),
          WORKER_RECEIPT_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Must be called inside the trusted deployment scope, before live authorization.
 * Identity-only entry allows cleanup after revocation, never execution. */
export async function withHackWorkerEntry<T>(
  payload: Record<string, unknown>,
  runId: string,
  execute: (entry: HackWorkerLifecycle) => Promise<T>,
  onUnconfirmed: () => void,
): Promise<T> {
  assertHackRunPayload(payload);
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) throw new Error("Missing Convex service key");
  const binding: HackWorkerEntryBinding = {
    userId: payload.userId as string,
    chatId: payload.chatId as string,
    dispatchId: payload.dispatchId as string,
    claimId: payload.startClaimId as string,
    runId,
    workerEntryId: randomUUID(),
    payloadHash: hashHackRunPayload(payload),
  };
  const client = getConvexClient();
  const args = { ...binding, serviceKey };
  if (
    (await awaitReceipt("entry", () => client.mutation(entryRef, args))) !==
    true
  )
    throw new Error("Worker entry not confirmed");
  let handedOff = false;
  let failed = false;
  try {
    return await execute({
      binding,
      handoff() {
        handedOff = true;
      },
      async beforeEffects() {
        if (
          (await awaitReceipt("effects", () =>
            client.mutation(effectsRef, args),
          )) !== true
        )
          throw new Error("Worker effects not confirmed");
      },
    });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    if (!handedOff) {
      try {
        if (
          (await awaitReceipt("cleanup", () =>
            client.mutation(cleanupRef, args),
          )) !== true
        )
          throw new Error("Early cleanup not confirmed");
      } catch (error) {
        try {
          onUnconfirmed();
        } catch {
          /* Diagnostics cannot replace the setup error. */
        }
        if (!failed) throw error;
      }
    }
  }
}
