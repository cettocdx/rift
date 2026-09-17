import "server-only";
import { randomUUID } from "node:crypto";
import { runs } from "@trigger.dev/sdk";
import {
  makeFunctionReference,
  type ApiFromModules,
  type FunctionArgs,
  type FunctionReturnType,
} from "convex/server";
import type * as admissionModule from "@/convex/agentDispatchAdmission";
import type * as receiptModule from "@/convex/agentDispatchRequests";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import {
  ACTIVE_RUN_STATUSES,
  TERMINAL_RUN_STATUSES,
  cancelRunAndConfirm,
} from "./agent-long-runs";
import { createAgentDispatchIdentity } from "./agent-dispatch-identity";

type DispatchApi = ApiFromModules<{
  agentDispatchAdmission: typeof admissionModule;
  agentDispatchRequests: typeof receiptModule;
}>;
type Admission = DispatchApi["agentDispatchAdmission"];
type Receipts = DispatchApi["agentDispatchRequests"];
function admissionMutation<
  Name extends
    | "elect"
    | "authorizeCancellation"
    | "attachClaim"
    | "markDispatching"
    | "rejectBeforeDispatch",
>(name: Name) {
  return makeFunctionReference<
    "mutation",
    FunctionArgs<Admission[Name]>,
    FunctionReturnType<Admission[Name]>
  >(`agentDispatchAdmission:${name}`);
}
const receiptQuery = makeFunctionReference<
  "query",
  FunctionArgs<Receipts["getForBackend"]>,
  FunctionReturnType<Receipts["getForBackend"]>
>("agentDispatchRequests:getForBackend");
const intentQuery = makeFunctionReference<
  "query",
  FunctionArgs<Admission["getForBackend"]>,
  FunctionReturnType<Admission["getForBackend"]>
>("agentDispatchAdmission:getForBackend");
const acceptanceMutation = makeFunctionReference<
  "mutation",
  FunctionArgs<Receipts["recordAccepted"]>,
  FunctionReturnType<Receipts["recordAccepted"]>
>("agentDispatchRequests:recordAccepted");
export const enabled = () =>
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true";
export const agentDispatchAdmissionEnabled = enabled;
function requireEnabled() {
  if (!enabled()) throw new Error("Durable dispatch admission is disabled");
}
function serviceKey() {
  const key = getConvexServiceKey();
  if (!key) throw new Error("Missing Convex service key");
  return key;
}
type Owner = { userId: string; chatId: string };
type Identity = Owner & { dispatchId: string };
export type AgentDispatchInput = Identity & {
  requestMessageId: string;
  payloadHash: string;
  replaceActiveRun: boolean;
  requiresCleanup?: boolean;
};
export type AgentDispatchHandle = {
  kind: "new";
  claimId: string;
  attemptId: string;
  dispatchId: string;
  idempotencyKey: string;
};
export type NewAgentDispatchHandle = AgentDispatchHandle;
export type AgentDispatchDuplicate = {
  kind: "duplicate";
  receipt: FunctionReturnType<Receipts["getForBackend"]>;
  intent: FunctionReturnType<Admission["getForBackend"]>;
};
export type AgentDispatchResult =
  | AgentDispatchHandle
  | AgentDispatchDuplicate
  | { kind: "busy" };
export function readAgentDispatchReceipt(owner: Identity) {
  return getConvexClient().query(receiptQuery, {
    serviceKey: serviceKey(),
    userId: owner.userId,
    chatId: owner.chatId,
    dispatchId: owner.dispatchId,
  });
}
async function duplicateLookup(
  owner: Identity,
): Promise<AgentDispatchDuplicate> {
  const authority = {
    serviceKey: serviceKey(),
    userId: owner.userId,
    chatId: owner.chatId,
    dispatchId: owner.dispatchId,
  };
  const [receipt, intent] = await Promise.all([
    getConvexClient().query(receiptQuery, authority),
    getConvexClient().query(intentQuery, authority),
  ]);
  return { kind: "duplicate", receipt, intent };
}
function verifyBinding(
  result: AgentDispatchDuplicate,
  input: Pick<
    AgentDispatchInput,
    "requestMessageId" | "payloadHash" | "requiresCleanup"
  >,
) {
  for (const value of [result.receipt, result.intent])
    if (
      value &&
      (value.requestMessageId !== input.requestMessageId ||
        value.payloadHash !== input.payloadHash ||
        value.fingerprintVersion !== 1 ||
        (value.requiresCleanup === true) !== (input.requiresCleanup === true))
    )
      throw new Error("Dispatch payload conflicts with the original request");
}
/** Optional read-only preflight. Election remains mandatory even after null. */
export async function lookupAgentDispatch(
  input: Identity &
    Pick<
      AgentDispatchInput,
      "requestMessageId" | "payloadHash" | "requiresCleanup"
    >,
): Promise<AgentDispatchDuplicate | null> {
  requireEnabled();
  const result = await duplicateLookup(input);
  verifyBinding(result, input);
  return result.receipt || result.intent ? result : null;
}

/** Unknown statuses and retrieval failures retain the elected intent. Neither
 * elapsed time nor HTTP failure proves that an older run stopped. */
async function predecessorState(runId: string): Promise<"active" | "terminal"> {
  const run = await runs.retrieve(runId);
  if (TERMINAL_RUN_STATUSES.has(run.status)) return "terminal";
  if ((ACTIVE_RUN_STATUSES as readonly string[]).includes(run.status))
    return "active";
  throw new Error("The previous run state could not be confirmed");
}
export async function beginAgentDispatch(
  input: AgentDispatchInput,
): Promise<AgentDispatchResult> {
  requireEnabled();
  const idempotencyKey = createAgentDispatchIdentity(input);
  const authority = {
    serviceKey: serviceKey(),
    userId: input.userId,
    chatId: input.chatId,
    dispatchId: input.dispatchId,
  };
  const attemptId = randomUUID();
  const nextClaimId = randomUUID();
  const token = { ...authority, attemptId };
  const client = getConvexClient();
  const election = await client.mutation(admissionMutation("elect"), {
    ...token,
    nextClaimId,
    requestMessageId: input.requestMessageId,
    payloadHash: input.payloadHash,
    fingerprintVersion: 1,
    replaceActiveRun: input.replaceActiveRun,
    ...(input.requiresCleanup === true ? { requiresCleanup: true } : {}),
  });
  if (election.outcome === "busy") return { kind: "busy" };
  if (election.outcome === "duplicate") {
    const result = await duplicateLookup(input);
    verifyBinding(result, input);
    return result;
  }
  const oldRun = election.previousRunId;
  if (oldRun) {
    const state = await predecessorState(oldRun);
    if (state === "active") {
      if (!input.replaceActiveRun) {
        const rejected = await client.mutation(
          admissionMutation("rejectBeforeDispatch"),
          token,
        );
        if (!rejected.rejected)
          throw new Error("Undispatched admission rejection was not confirmed");
        return { kind: "busy" };
      }
      const cancellation = await client.mutation(
        admissionMutation("authorizeCancellation"),
        token,
      );
      if (cancellation.runId !== oldRun)
        throw new Error("The cancellation target changed");
      await cancelRunAndConfirm(oldRun);
      if ((await predecessorState(oldRun)) !== "terminal")
        throw new Error("Previous run cancellation remains unconfirmed");
    }
  }
  const attached = await client.mutation(admissionMutation("attachClaim"), {
    ...token,
    ...(oldRun ? { confirmedTerminalRunId: oldRun } : {}),
  });
  if (!attached.attached)
    throw new Error("This admission no longer permits a new dispatch");
  return {
    kind: "new",
    claimId: attached.claimId,
    attemptId,
    dispatchId: input.dispatchId,
    idempotencyKey,
  };
}
export async function markAgentDispatching(
  handle: AgentDispatchHandle,
  owner: Owner,
): Promise<boolean> {
  requireEnabled();
  const result = await getConvexClient().mutation(
    admissionMutation("markDispatching"),
    {
      serviceKey: serviceKey(),
      userId: owner.userId,
      chatId: owner.chatId,
      dispatchId: handle.dispatchId,
      attemptId: handle.attemptId,
    },
  );
  if (result.claimId !== handle.claimId)
    throw new Error("The dispatch claim binding changed");
  return result.transitioned;
}
/** Acceptance is required bookkeeping, not a best-effort log. Propagate errors
 * so callers retain an uncertain receipt and can reconcile the exact run. */
export function recordAgentDispatchAccepted(
  owner: Identity & { claimId: string },
  runId: string,
) {
  return getConvexClient().mutation(acceptanceMutation, {
    serviceKey: serviceKey(),
    userId: owner.userId,
    chatId: owner.chatId,
    dispatchId: owner.dispatchId,
    claimId: owner.claimId,
    runId,
  });
}

type TerminalStatus = FunctionArgs<
  Receipts["recordTerminal"]
>["terminalStatus"];
function confirmedTerminalStatus(status: string): TerminalStatus | undefined {
  switch (status) {
    case "COMPLETED":
    case "CANCELED":
    case "FAILED":
    case "CRASHED":
    case "SYSTEM_FAILURE":
    case "EXPIRED":
    case "TIMED_OUT":
      return status;
    default:
      return undefined;
  }
}
const terminalMutation = makeFunctionReference<
  "mutation",
  FunctionArgs<Receipts["recordTerminal"]>,
  FunctionReturnType<Receipts["recordTerminal"]>
>("agentDispatchRequests:recordTerminal");
type Receipt = NonNullable<FunctionReturnType<Receipts["getForBackend"]>>;

/** Reconcile only the already owner-authorized receipt's exact run. Slow or
 * missing provider evidence cannot become terminality or resend permission. */
export async function refreshAgentDispatchTerminal(
  owner: Identity,
  receipt: Receipt,
  timeoutMs = 1000,
): Promise<{
  receipt: Receipt;
  reconciliation: "terminal" | "active" | "unavailable";
}> {
  if (receipt.dispatchId !== owner.dispatchId)
    throw new Error("Dispatch receipt binding mismatch");
  if (receipt.state === "terminal") {
    if (
      receipt.requiresCleanup === true &&
      receipt.cleanupConfirmedAt === undefined &&
      receipt.runId &&
      receipt.terminalStatus
    ) {
      // Replay trusted persisted terminal evidence. The backend alone decides
      // whether protocol-v1 no-effects proof permits clearing this fence.
      const updated = await getConvexClient().mutation(terminalMutation, {
        serviceKey: serviceKey(),
        userId: owner.userId,
        chatId: owner.chatId,
        dispatchId: owner.dispatchId,
        claimId: receipt.claimId,
        runId: receipt.runId,
        terminalStatus: receipt.terminalStatus,
      });
      return { receipt: updated, reconciliation: "terminal" };
    }
    return { receipt, reconciliation: "terminal" };
  }
  if (!receipt.runId) return { receipt, reconciliation: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let status: string | undefined;
  try {
    const observed = await Promise.race([
      runs.retrieve(receipt.runId),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), Math.max(1, timeoutMs));
      }),
    ]);
    status = observed?.status;
  } catch {
    return { receipt, reconciliation: "unavailable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!status) return { receipt, reconciliation: "unavailable" };
  const terminalStatus = confirmedTerminalStatus(status);
  if (!terminalStatus)
    return {
      receipt,
      reconciliation: (ACTIVE_RUN_STATUSES as readonly string[]).includes(
        status,
      )
        ? "active"
        : "unavailable",
    };
  // Backend ownership/binding and persistence failures propagate. Never serve
  // a stale authorization after the durable write explicitly rejected it.
  const updated = await getConvexClient().mutation(terminalMutation, {
    serviceKey: serviceKey(),
    userId: owner.userId,
    chatId: owner.chatId,
    dispatchId: owner.dispatchId,
    claimId: receipt.claimId,
    runId: receipt.runId,
    terminalStatus,
  });
  return { receipt: updated, reconciliation: "terminal" };
}
