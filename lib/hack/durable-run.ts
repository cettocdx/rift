import "server-only";
import type { UIMessage } from "ai";
import { makeFunctionReference } from "convex/server";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { resolveSubscriptionTier } from "@/lib/auth/entitlements";
import { assertHackWorkbenchAccess } from "@/lib/auth/premium-access";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import {
  agentDispatchAdmissionEnabled,
  readAgentDispatchReceipt,
} from "@/lib/api/agent-dispatch-admission";
import { hashAgentDispatchPayload } from "@/lib/api/agent-dispatch-identity";
import { parseApprovalMode } from "@/lib/ai/approval/policy";
import { coerceSelectedModel, isReasoningEffort } from "@/types";
import { ChatSDKError } from "@/lib/errors";

export type HackRunBinding = {
  version: 1;
  requestMessageId: string;
  requestHash: string;
  scope: string;
  replaceActiveRun: boolean;
};
type Payload = Record<string, unknown>;
const record = (value: unknown): value is Payload =>
  !!value && typeof value === "object" && !Array.isArray(value);
function denied(
  message = "The durable assessment no longer matches its authorized request.",
): never {
  throw new ChatSDKError("forbidden:auth", message);
}
function id(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !value ||
    value.trim() !== value ||
    value.length > 200
  )
    denied();
}

export function assertDurableHackEnabled(): void {
  if (
    process.env.RIFT_DURABLE_HACK_ENABLED !== "true" ||
    !agentDispatchAdmissionEnabled()
  )
    throw new ChatSDKError(
      "bad_request:api",
      "Durable assessments are not enabled.",
    );
}

function requestHash(message: UIMessage): string {
  id(message.id);
  if (
    message.role !== "user" ||
    !Array.isArray(message.parts) ||
    !message.parts.length
  )
    denied();
  const parts = message.parts.map((part) => {
    const value = part as unknown as Payload;
    if (value.type === "text" && typeof value.text === "string")
      return { type: "text", text: value.text };
    if (
      value.type === "file" &&
      typeof value.fileId === "string" &&
      value.fileId
    ) {
      // Convex resolves signed download URLs afresh; the owned file reference is
      // stable across those reads. Other file inputs are not admitted here.
      return {
        type: "file",
        fileId: value.fileId,
        filename: value.filename,
        mediaType: value.mediaType,
      };
    }
    denied("Durable assessments require text or saved file references.");
  });
  return hashAgentDispatchPayload({ id: message.id, parts });
}

export function createHackRunBinding(
  message: UIMessage,
  scope: unknown,
  replaceActiveRun = false,
): HackRunBinding {
  if (scope !== undefined && (typeof scope !== "string" || scope.length > 2048))
    denied("Invalid assessment scope.");
  return {
    version: 1,
    requestMessageId: message.id,
    requestHash: requestHash(message),
    scope: typeof scope === "string" ? scope.trim() : "",
    replaceActiveRun,
  };
}

function binding(value: unknown): HackRunBinding {
  if (!record(value) || value.version !== 1) denied();
  id(value.requestMessageId);
  if (
    typeof value.requestHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.requestHash) ||
    typeof value.scope !== "string" ||
    value.scope.length > 2048 ||
    value.scope.trim() !== value.scope ||
    typeof value.replaceActiveRun !== "boolean"
  )
    denied();
  return {
    version: 1,
    requestMessageId: value.requestMessageId,
    requestHash: value.requestHash,
    scope: value.scope,
    replaceActiveRun: value.replaceActiveRun,
  };
}

export function assertHackRunPayload(payload: Payload): HackRunBinding {
  if (
    payload.purpose !== "security" ||
    (payload.temporary !== undefined && payload.temporary !== false) ||
    (payload.regenerate !== undefined && payload.regenerate !== false) ||
    (payload.isAutoContinue !== undefined &&
      payload.isAutoContinue !== false) ||
    payload.scheduledRun !== undefined ||
    payload.workingFile !== undefined ||
    (payload.localDesktopAttachmentsPrepared !== undefined &&
      payload.localDesktopAttachmentsPrepared !== false) ||
    (payload.messages !== undefined &&
      (!Array.isArray(payload.messages) || payload.messages.length !== 0)) ||
    (payload.sandboxPreference !== undefined &&
      payload.sandboxPreference !== "e2b")
  )
    denied(
      "Durable Hack accepts only an explicit persistent cloud assessment.",
    );
  for (const value of [
    payload.userId,
    payload.chatId,
    payload.startClaimId,
    payload.dispatchId,
  ])
    id(value);
  const admitted = binding(payload.hackRun);
  if (admitted.requestMessageId !== payload.dispatchId) denied();
  return admitted;
}

/** This digest is stored by authenticated dispatch, never accepted from JSON. */
export function hashHackRunPayload(payload: Payload): string {
  const admitted = binding(payload.hackRun);
  const selectedModel =
    coerceSelectedModel(payload.selectedModel ?? null) ?? undefined;
  if (payload.selectedModel !== undefined && !selectedModel) denied();
  if (
    payload.reasoningEffort !== undefined &&
    !isReasoningEffort(payload.reasoningEffort)
  )
    denied();
  return hashAgentDispatchPayload({
    kind: "hack-long:v1",
    hackRun: admitted,
    selectedModel,
    reasoningEffort: payload.reasoningEffort,
    approvalMode: parseApprovalMode(payload.approvalMode),
    projectId: payload.projectId,
    activeGoal: payload.activeGoal,
    baseTodos: payload.baseTodos ?? [],
    userLocation: payload.userLocation ?? {},
    organizationId: payload.organizationId,
    sandboxPreference: "e2b",
    purpose: "security",
  });
}

export function assertHackRunMessage(
  admitted: HackRunBinding,
  message: UIMessage | undefined,
): void {
  if (
    !message ||
    message.id !== admitted.requestMessageId ||
    requestHash(message) !== admitted.requestHash
  )
    denied("The saved assessment request changed. Start a new assessment.");
}

const entitlementQuery = makeFunctionReference<
  "query",
  { serviceKey: string; userId: string },
  string[]
>("subscriptions:getEntitlementsForBackend");
export async function assertLiveHackAccess(
  userId: string,
  execution = true,
): Promise<void> {
  if (execution) assertDurableHackEnabled();
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) denied();
  const [entitlements] = await Promise.all([
    getConvexClient().query(entitlementQuery, { serviceKey, userId }),
    assertUserCanMakeCostIncurringRequest(userId),
  ]);
  assertHackWorkbenchAccess(resolveSubscriptionTier(entitlements));
}

async function authorizeHackRun(
  payload: Payload,
  runId: string,
  observation: boolean,
): Promise<HackRunBinding> {
  if (!observation) assertDurableHackEnabled();
  const admitted = assertHackRunPayload(payload);
  const userId = payload.userId as string;
  await assertLiveHackAccess(userId, !observation);
  const receipt = await readAgentDispatchReceipt({
    userId,
    chatId: payload.chatId as string,
    dispatchId: payload.dispatchId as string,
  });
  if (
    !receipt ||
    receipt.fingerprintVersion !== 1 ||
    receipt.claimId !== payload.startClaimId ||
    receipt.requestMessageId !== admitted.requestMessageId ||
    receipt.payloadHash !== hashHackRunPayload(payload) ||
    (!observation && receipt.state === "terminal") ||
    (!observation &&
      (receipt.requiresCleanup !== true ||
        receipt.cleanupConfirmedAt !== undefined)) ||
    (observation && receipt.runId !== runId) ||
    (receipt.runId !== undefined && receipt.runId !== runId)
  )
    denied();
  return admitted;
}

/** The task payload must never choose the backend used to authenticate itself. */
export function resolveHackWorkerConvexUrl(payloadUrl: unknown): string {
  const trusted = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!trusted || payloadUrl !== trusted)
    denied("The assessment worker deployment does not match its dispatch.");
  return trusted;
}

export function authorizeHackWorkerRun(
  payload: Payload,
  runId: string,
): Promise<HackRunBinding> {
  return authorizeHackRun(payload, runId, false);
}

/** Observation grants no execution claim; terminal receipts remain readable. */
export function authorizeHackRunObservation(
  payload: Payload,
  runId: string,
): Promise<HackRunBinding> {
  resolveHackWorkerConvexUrl(payload.convexUrl);
  return authorizeHackRun(payload, runId, true);
}
