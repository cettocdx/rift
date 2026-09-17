import { hasBlockingHttpExecution } from "./lib/hackHttpExecutions";
import { hasPendingHackCleanup } from "./lib/hackRunCleanup";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";
import {
  admissionFailure as fail,
  requireAdmissionEnabled,
  readAdmissionGate,
  readAdmissionIntent,
  isAdmissionGateBlocking,
  setAdmissionPhase,
  assertDispatchNotStopped,
} from "./lib/agentDispatchAdmission";

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
  dispatchId: v.string(),
};
const tokenArgs = { ...ownerArgs, attemptId: v.string() };
type Owner = {
  serviceKey: string;
  userId: string;
  chatId: string;
  dispatchId: string;
};
type Token = Owner & { attemptId: string };
function id(value: string) {
  if (!value || value.trim() !== value || value.length > 200)
    fail("INVALID_DISPATCH");
}
async function readOwned(ctx: { db: QueryCtx["db"] }, args: Owner) {
  requireAdmissionEnabled();
  validateServiceKey(args.serviceKey);
  for (const value of [args.userId, args.chatId, args.dispatchId]) id(value);
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
    .take(2);
  const claims = await ctx.db
    .query("agent_run_claims")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
    .take(2);
  const gate = await readAdmissionGate(ctx, args.chatId);
  if (chats.length > 1 || claims.length > 1)
    fail("DISPATCH_ADMISSION_CONFLICT");
  if (
    [chats[0], claims[0], gate].some(
      (row) => row && row.user_id !== args.userId,
    )
  )
    fail("FORBIDDEN");
  return { chat: chats[0], claim: claims[0], gate };
}
async function readReceipt(ctx: { db: QueryCtx["db"] }, args: Owner) {
  const rows = await ctx.db
    .query("agent_dispatch_requests")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", args.userId)
        .eq("chat_id", args.chatId)
        .eq("client_dispatch_id", args.dispatchId),
    )
    .take(2);
  if (rows.length > 1) fail("DISPATCH_ADMISSION_CONFLICT");
  return rows[0];
}
async function currentGate(ctx: MutationCtx, args: Token) {
  id(args.attemptId);
  const current = await readOwned(ctx, args);
  await assertDispatchNotStopped(ctx, args);
  const gate = current.gate;
  if (
    !gate ||
    gate.dispatch_id !== args.dispatchId ||
    gate.attempt_id !== args.attemptId ||
    !isAdmissionGateBlocking(gate)
  )
    fail("DISPATCH_ADMISSION_LOST");
  return { ...current, gate };
}
function checkPredecessor(
  gate: Doc<"agent_dispatch_admissions">,
  claim: Doc<"agent_run_claims"> | undefined,
  chat: Doc<"chats"> | undefined,
) {
  if (
    (claim?.claim_id ?? null) !== gate.previous_claim_id ||
    claim?.run_id !== gate.previous_run_id
  )
    fail("DISPATCH_PREDECESSOR_CHANGED");
  // Exact old mapping may be cleared by terminal cleanup, but never replaced.
  if (
    chat?.active_trigger_run_id !== undefined &&
    chat.active_trigger_run_id !== gate.previous_chat_run_id
  )
    fail("DISPATCH_PREDECESSOR_CHANGED");
}

/** Election precedes every replacement cancellation. There is no lease expiry
 * takeover: an abandoned or ambiguous intent needs explicit reconciliation. */
export const elect = mutation({
  args: {
    ...tokenArgs,
    nextClaimId: v.string(),
    requestMessageId: v.string(),
    payloadHash: v.string(),
    fingerprintVersion: v.literal(1),
    replaceActiveRun: v.boolean(),
    requiresCleanup: v.optional(v.boolean()),
  },
  returns: v.union(
    v.object({
      outcome: v.literal("elected"),
      previousRunId: v.union(v.string(), v.null()),
    }),
    v.object({ outcome: v.literal("duplicate") }),
    v.object({ outcome: v.literal("busy") }),
  ),
  handler: async (ctx, args) => {
    const { chat, claim, gate } = await readOwned(ctx, args);
    await assertDispatchNotStopped(ctx, args);
    if (await hasBlockingHttpExecution(ctx, args))
      return { outcome: "busy" as const };
    for (const value of [
      args.attemptId,
      args.nextClaimId,
      args.requestMessageId,
    ])
      id(value);
    if (!/^[a-f0-9]{64}$/.test(args.payloadHash)) fail("INVALID_DISPATCH_HASH");
    const intent = await readAdmissionIntent(ctx, args);
    const receipt = await readReceipt(ctx, args);
    for (const existing of [intent, receipt])
      if (
        existing &&
        (existing.payload_hash !== args.payloadHash ||
          existing.fingerprint_version !== args.fingerprintVersion ||
          existing.request_message_id !== args.requestMessageId ||
          (existing.requires_cleanup === true) !==
            (args.requiresCleanup === true))
      )
        fail("DISPATCH_BINDING_CONFLICT");
    if (intent || receipt) return { outcome: "duplicate" as const };
    if (await hasPendingHackCleanup(ctx, args))
      return { outcome: "busy" as const };
    if (isAdmissionGateBlocking(gate)) return { outcome: "busy" as const };
    if (
      claim?.phase === "starting" &&
      claim.run_id === undefined &&
      claim.lease_until > Date.now()
    )
      return { outcome: "busy" as const };
    if (
      claim?.run_id &&
      chat?.active_trigger_run_id &&
      claim.run_id !== chat.active_trigger_run_id
    )
      fail("DISPATCH_PREDECESSOR_CHANGED");
    if (claim?.claim_id === args.nextClaimId) fail("DISPATCH_BINDING_CONFLICT");
    const value = {
      user_id: args.userId,
      chat_id: args.chatId,
      dispatch_id: args.dispatchId,
      attempt_id: args.attemptId,
      next_claim_id: args.nextClaimId,
      request_message_id: args.requestMessageId,
      payload_hash: args.payloadHash,
      fingerprint_version: args.fingerprintVersion,
      replace_active_run: args.replaceActiveRun,
      // The per-chat gate is reused; explicitly clear a prior Hack capability.
      requires_cleanup: args.requiresCleanup === true,
      phase: "elected" as const,
      previous_claim_id: claim?.claim_id ?? null,
      previous_run_id: claim?.run_id,
      previous_chat_run_id: chat?.active_trigger_run_id,
      created_at: Date.now(),
      cancellation_authorized_at: undefined,
    };
    await ctx.db.insert("agent_dispatch_intents", value);
    if (gate) await ctx.db.patch(gate._id, value);
    else await ctx.db.insert("agent_dispatch_admissions", value);
    return {
      outcome: "elected" as const,
      previousRunId:
        value.previous_run_id ?? value.previous_chat_run_id ?? null,
    };
  },
});

/** Returned run ID is the ONLY permitted cancellation target. A caller must
 * never substitute a later run found after this authorization. */
export const authorizeCancellation = mutation({
  args: tokenArgs,
  returns: v.object({ runId: v.union(v.string(), v.null()) }),
  handler: async (ctx, args) => {
    const { gate, claim, chat } = await currentGate(ctx, args);
    if (gate.phase !== "elected" || !gate.replace_active_run)
      fail("DISPATCH_CANCELLATION_DENIED");
    checkPredecessor(gate, claim, chat);
    if (await hasPendingHackCleanup(ctx, args))
      fail("DISPATCH_CLEANUP_REQUIRED");
    const runId = gate.previous_run_id ?? gate.previous_chat_run_id ?? null;
    if (
      claim &&
      runId &&
      claim.run_id === runId &&
      claim.phase !== "released" &&
      claim.cancel_requested_at === undefined
    )
      await ctx.db.patch(claim._id, { cancel_requested_at: Date.now() });
    if (gate.cancellation_authorized_at === undefined) {
      const patch = { cancellation_authorized_at: Date.now() };
      await ctx.db.patch(gate._id, patch);
      const intent = await readAdmissionIntent(ctx, args);
      if (!intent || intent.attempt_id !== gate.attempt_id)
        fail("DISPATCH_ADMISSION_CONFLICT");
      await ctx.db.patch(intent._id, patch);
    }
    return { runId };
  },
});

/** Service caller must independently verify terminality of confirmedTerminalRunId.
 * Supplying an ID is not a public-client proof or permission to cancel a run. */
export const attachClaim = mutation({
  args: { ...tokenArgs, confirmedTerminalRunId: v.optional(v.string()) },
  returns: v.object({ attached: v.boolean(), claimId: v.string() }),
  handler: async (ctx, args) => {
    const { gate, claim, chat } = await currentGate(ctx, args);
    if (gate.phase !== "elected")
      return { attached: false, claimId: gate.next_claim_id };
    checkPredecessor(gate, claim, chat);
    if (await hasPendingHackCleanup(ctx, args))
      fail("DISPATCH_CLEANUP_REQUIRED");
    const oldRun = gate.previous_run_id ?? gate.previous_chat_run_id;
    if (oldRun !== args.confirmedTerminalRunId)
      fail("DISPATCH_TERMINAL_PROOF_REQUIRED");
    if (
      !oldRun &&
      claim &&
      claim.phase !== "released" &&
      !(
        claim.phase === "starting" &&
        claim.run_id === undefined &&
        claim.lease_until <= Date.now()
      )
    )
      fail("DISPATCH_PREDECESSOR_ACTIVE");
    if (await readReceipt(ctx, args)) fail("DISPATCH_BINDING_CONFLICT");
    const now = Date.now();
    const next = {
      user_id: args.userId,
      chat_id: args.chatId,
      claim_id: gate.next_claim_id,
      dispatch_id: args.dispatchId,
      phase: "starting" as const,
      run_id: undefined,
      started_at: now,
      lease_until: now + 90000,
      expected_chat_run_id: chat?.active_trigger_run_id,
      cancel_requested_at: undefined,
    };
    if (claim) await ctx.db.patch(claim._id, next);
    else await ctx.db.insert("agent_run_claims", next);
    await ctx.db.insert("agent_dispatch_requests", {
      user_id: args.userId,
      chat_id: args.chatId,
      client_dispatch_id: args.dispatchId,
      request_message_id: gate.request_message_id,
      payload_hash: gate.payload_hash,
      fingerprint_version: gate.fingerprint_version,
      claim_id: gate.next_claim_id,
      state: "reserved",
      ...(gate.requires_cleanup === true
        ? { requires_cleanup: true, worker_lifecycle_version: 1 as const }
        : {}),
      created_at: gate.created_at,
    });
    await setAdmissionPhase(ctx, gate, "attached");
    return { attached: true, claimId: gate.next_claim_id };
  },
});

export const markDispatching = mutation({
  args: tokenArgs,
  returns: v.object({ transitioned: v.boolean(), claimId: v.string() }),
  handler: async (ctx, args) => {
    const { gate, claim, chat } = await currentGate(ctx, args);
    if (await hasPendingHackCleanup(ctx, args, gate.next_claim_id))
      fail("DISPATCH_CLEANUP_REQUIRED");
    if (gate.phase === "dispatching")
      return { transitioned: false, claimId: gate.next_claim_id };
    if (
      gate.phase !== "attached" ||
      !claim ||
      claim.claim_id !== gate.next_claim_id ||
      claim.phase !== "starting" ||
      claim.run_id !== undefined ||
      claim.cancel_requested_at !== undefined ||
      claim.expected_chat_run_id !== chat?.active_trigger_run_id
    )
      fail("DISPATCH_CLAIM_LOST");
    const receipt = await readReceipt(ctx, args);
    if (
      !receipt ||
      receipt.claim_id !== gate.next_claim_id ||
      receipt.state !== "reserved" ||
      receipt.not_dispatched_at !== undefined
    )
      fail("DISPATCH_BINDING_CONFLICT");
    await ctx.db.patch(receipt._id, {
      state: "dispatching",
      dispatch_started_at: Date.now(),
      ...(receipt.requires_cleanup === true ? { cleanup_pending: true } : {}),
    });
    await setAdmissionPhase(ctx, gate, "dispatching");
    return { transitioned: true, claimId: gate.next_claim_id };
  },
});

/** Duplicate callers can inspect progress without obtaining the elected attempt
 * token. No lookup response grants cancellation or dispatch permission. */
export const getForBackend = query({
  args: ownerArgs,
  returns: v.union(
    v.null(),
    v.object({
      dispatchId: v.string(),
      phase: v.union(
        v.literal("elected"),
        v.literal("attached"),
        v.literal("dispatching"),
        v.literal("released"),
        v.literal("revoked"),
      ),
      claimId: v.string(),
      payloadHash: v.string(),
      fingerprintVersion: v.literal(1),
      requestMessageId: v.string(),
      requiresCleanup: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    await readOwned(ctx, args);
    const intent = await readAdmissionIntent(ctx, args);
    return intent
      ? {
          dispatchId: intent.dispatch_id,
          phase: intent.phase,
          claimId: intent.next_claim_id,
          payloadHash: intent.payload_hash,
          fingerprintVersion: intent.fingerprint_version,
          requestMessageId: intent.request_message_id,
          ...(intent.requires_cleanup === true
            ? { requiresCleanup: true }
            : {}),
        }
      : null;
  },
});

/** Only abandon a positively undispatched election. Cancellation authorization,
 * claim attachment and dispatch uncertainty must be reconciled, never reset. */
export const rejectBeforeDispatch = mutation({
  args: tokenArgs,
  returns: v.object({ rejected: v.boolean() }),
  handler: async (ctx, args) => {
    const { gate } = await currentGate(ctx, args);
    if (
      gate.phase !== "elected" ||
      gate.cancellation_authorized_at !== undefined ||
      (await readReceipt(ctx, args))
    )
      fail("DISPATCH_REJECTION_UNSAFE");
    await setAdmissionPhase(ctx, gate, "revoked");
    return { rejected: true };
  },
});
