import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";
import {
  hasPendingHackCleanup,
  requiresHackCleanup,
} from "./lib/hackRunCleanup";
import {
  admissionEnabled,
  readAdmissionGate,
  readAdmissionIntent,
  isAdmissionGateBlocking,
  releaseAdmissionGateForReceipt,
  assertDispatchNotStopped,
} from "./lib/agentDispatchAdmission";

async function requireLegacyAdmission(
  ctx: { db: QueryCtx["db"] },
  args: Owner,
) {
  if (await hasPendingHackCleanup(ctx, args)) fail("DISPATCH_CLEANUP_REQUIRED");
  if (!admissionEnabled()) return;
  const gate = await readAdmissionGate(ctx, args.chatId);
  if (gate && gate.user_id !== args.userId) fail("FORBIDDEN");
  if (isAdmissionGateBlocking(gate) || (await readAdmissionIntent(ctx, args)))
    fail("DISPATCH_USE_ADMISSION");
}

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
  dispatchId: v.string(),
};
const boundArgs = { ...ownerArgs, claimId: v.string() };
const terminalStatus = v.union(
  v.literal("COMPLETED"),
  v.literal("CANCELED"),
  v.literal("FAILED"),
  v.literal("CRASHED"),
  v.literal("SYSTEM_FAILURE"),
  v.literal("EXPIRED"),
  v.literal("TIMED_OUT"),
);
const receiptValidator = v.object({
  dispatchId: v.string(),
  requestMessageId: v.string(),
  payloadHash: v.string(),
  fingerprintVersion: v.literal(1),
  claimId: v.string(),
  state: v.union(
    v.literal("reserved"),
    v.literal("dispatching"),
    v.literal("accepted"),
    v.literal("terminal"),
  ),
  runId: v.optional(v.string()),
  createdAt: v.number(),
  dispatchStartedAt: v.optional(v.number()),
  acceptedAt: v.optional(v.number()),
  terminalAt: v.optional(v.number()),
  terminalStatus: v.optional(terminalStatus),
  requiresCleanup: v.optional(v.boolean()),
  cleanupConfirmedAt: v.optional(v.number()),
});
type Owner = {
  serviceKey: string;
  userId: string;
  chatId: string;
  dispatchId: string;
};
function fail(code: string): never {
  throw new ConvexError({ code, message: "Agent dispatch receipt rejected" });
}
function identifier(value: string) {
  if (!value || value.length > 200 || value.trim() !== value)
    fail("INVALID_DISPATCH");
}
function receipt(row: Doc<"agent_dispatch_requests">) {
  return {
    dispatchId: row.client_dispatch_id,
    requestMessageId: row.request_message_id,
    payloadHash: row.payload_hash,
    fingerprintVersion: row.fingerprint_version,
    claimId: row.claim_id,
    state: row.state,
    createdAt: row.created_at,
    ...(row.requires_cleanup === true ? { requiresCleanup: true } : {}),
    ...(row.cleanup_confirmed_at !== undefined
      ? { cleanupConfirmedAt: row.cleanup_confirmed_at }
      : {}),
    ...(row.run_id !== undefined ? { runId: row.run_id } : {}),
    ...(row.dispatch_started_at !== undefined
      ? { dispatchStartedAt: row.dispatch_started_at }
      : {}),
    ...(row.accepted_at !== undefined ? { acceptedAt: row.accepted_at } : {}),
    ...(row.terminal_at !== undefined ? { terminalAt: row.terminal_at } : {}),
    ...(row.terminal_status !== undefined
      ? { terminalStatus: row.terminal_status }
      : {}),
  };
}
async function readOwned(ctx: { db: QueryCtx["db"] }, args: Owner) {
  validateServiceKey(args.serviceKey);
  for (const id of [args.userId, args.chatId, args.dispatchId]) identifier(id);
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
    .take(2);
  const claims = await ctx.db
    .query("agent_run_claims")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
    .take(2);
  if (chats.length > 1 || claims.length > 1) fail("DISPATCH_CONFLICT");
  if (
    (chats[0] && chats[0].user_id !== args.userId) ||
    (claims[0] && claims[0].user_id !== args.userId)
  )
    fail("FORBIDDEN");
  // This exact indexed read participates in the mutation transaction, including
  // absence. It is deliberately independent of the replaceable claim row.
  const rows = await ctx.db
    .query("agent_dispatch_requests")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", args.userId)
        .eq("chat_id", args.chatId)
        .eq("client_dispatch_id", args.dispatchId),
    )
    .take(2);
  if (rows.length > 1) fail("DISPATCH_CONFLICT");
  return { row: rows[0], claim: claims[0], chat: chats[0] };
}
function requireStartingClaim(
  claim: Doc<"agent_run_claims"> | undefined,
  claimId: string,
) {
  if (
    !claim ||
    claim.claim_id !== claimId ||
    claim.phase !== "starting" ||
    claim.run_id !== undefined ||
    claim.cancel_requested_at !== undefined ||
    claim.lease_until <= Date.now()
  )
    fail("DISPATCH_CLAIM_LOST");
}
function requireBinding(
  row: Doc<"agent_dispatch_requests"> | undefined,
  claimId: string,
) {
  identifier(claimId);
  if (!row) fail("DISPATCH_NOT_FOUND");
  if (row.claim_id !== claimId) fail("DISPATCH_BINDING_CONFLICT");
  return row;
}
export const getForBackend = query({
  args: ownerArgs,
  returns: v.union(v.null(), receiptValidator),
  handler: async (ctx, args) => {
    const { row } = await readOwned(ctx, args);
    return row ? receipt(row) : null;
  },
});

/** Integration must reserve the claim first. This endpoint does not dispatch,
 * acquire a replacement claim, or authorize replay of a previous dispatch. */
export const create = mutation({
  args: {
    ...boundArgs,
    requestMessageId: v.string(),
    payloadHash: v.string(),
    fingerprintVersion: v.literal(1),
  },
  returns: v.object({ created: v.boolean(), receipt: receiptValidator }),
  handler: async (ctx, args) => {
    const { row, claim } = await readOwned(ctx, args);
    identifier(args.claimId);
    identifier(args.requestMessageId);
    if (!/^[a-f0-9]{64}$/.test(args.payloadHash)) fail("INVALID_DISPATCH_HASH");
    if (row) {
      if (
        row.payload_hash !== args.payloadHash ||
        row.fingerprint_version !== args.fingerprintVersion ||
        row.claim_id !== args.claimId ||
        row.request_message_id !== args.requestMessageId
      )
        fail("DISPATCH_BINDING_CONFLICT");
      return { created: false, receipt: receipt(row) };
    }
    await requireLegacyAdmission(ctx, args);
    requireStartingClaim(claim, args.claimId);
    const value = {
      user_id: args.userId,
      chat_id: args.chatId,
      client_dispatch_id: args.dispatchId,
      request_message_id: args.requestMessageId,
      payload_hash: args.payloadHash,
      fingerprint_version: args.fingerprintVersion,
      claim_id: args.claimId,
      state: "reserved" as const,
      created_at: Date.now(),
    };
    const id = await ctx.db.insert("agent_dispatch_requests", value);
    return {
      created: true,
      receipt: receipt({ ...value, _id: id, _creationTime: value.created_at }),
    };
  },
});

/** Only transitioned=true grants the first caller permission to dispatch.
 * A retry finding dispatching is ambiguous and must never submit again. */
export const markDispatching = mutation({
  args: boundArgs,
  returns: v.object({ transitioned: v.boolean(), receipt: receiptValidator }),
  handler: async (ctx, args) => {
    const { row: found, claim } = await readOwned(ctx, args);
    const row = requireBinding(found, args.claimId);
    await requireLegacyAdmission(ctx, args);
    if (row.state !== "reserved")
      return { transitioned: false, receipt: receipt(row) };
    requireStartingClaim(claim, args.claimId);
    const patch = {
      state: "dispatching" as const,
      dispatch_started_at: Date.now(),
      ...(row.requires_cleanup === true ? { cleanup_pending: true } : {}),
    };
    await ctx.db.patch(row._id, patch);
    return { transitioned: true, receipt: receipt({ ...row, ...patch }) };
  },
});

/** Durable acceptance evidence is independent of whether a newer worker claim
 * now owns the chat. This receipt grants no authority to execute tools. */
export const recordAccepted = mutation({
  args: { ...boundArgs, runId: v.string() },
  returns: receiptValidator,
  handler: async (ctx, args) => {
    const row = requireBinding((await readOwned(ctx, args)).row, args.claimId);
    identifier(args.runId);
    if (row.run_id !== undefined && row.run_id !== args.runId)
      fail("DISPATCH_RUN_CONFLICT");
    if (row.state === "reserved") fail("DISPATCH_NOT_STARTED");
    if (row.state === "terminal" || row.state === "accepted") {
      await releaseAdmissionGateForReceipt(ctx, args);
      return receipt(row);
    }
    const patch = {
      state: "accepted" as const,
      run_id: args.runId,
      accepted_at: Date.now(),
      ...(requiresHackCleanup(row) ? { cleanup_pending: true } : {}),
    };
    await ctx.db.patch(row._id, patch);
    await releaseAdmissionGateForReceipt(ctx, args);
    return receipt({ ...row, ...patch });
  },
});

/** Caller must have definitive terminal evidence for this exact run. A claim
 * release or a failed network lookup is not terminal evidence. */
export const recordTerminal = mutation({
  args: { ...boundArgs, runId: v.string(), terminalStatus },
  returns: receiptValidator,
  handler: async (ctx, args) => {
    const current = await readOwned(ctx, args);
    const row = requireBinding(current.row, args.claimId);
    identifier(args.runId);
    if (row.run_id !== undefined && row.run_id !== args.runId)
      fail("DISPATCH_RUN_CONFLICT");
    if (row.state === "reserved") fail("DISPATCH_NOT_STARTED");
    if (row.state === "terminal") {
      if (row.terminal_status !== args.terminalStatus)
        fail("DISPATCH_TERMINAL_CONFLICT");
    }
    const now = Date.now();
    // Protocol v1 requires this same row's irreversible effects marker before
    // any work. This transaction closes entry/effects permission atomically:
    // either permission won first (keep the fence), or no work was authorized.
    // Terminality alone remains insufficient for older/effects-started workers.
    const noEffects =
      requiresHackCleanup(row) &&
      row.worker_lifecycle_version === 1 &&
      row.worker_effects_started_at === undefined;
    const patch = {
      state: "terminal" as const,
      run_id: args.runId,
      accepted_at: row.accepted_at ?? now,
      terminal_at: row.terminal_at ?? now,
      terminal_status: args.terminalStatus,
      ...(requiresHackCleanup(row) ? { cleanup_pending: true } : {}),
      ...(noEffects
        ? {
            cleanup_pending: false,
            cleanup_confirmed_at: now,
            worker_pre_execution_cleanup_at: now,
          }
        : {}),
    };
    await ctx.db.patch(row._id, patch);
    if (
      noEffects &&
      current.claim?.claim_id === args.claimId &&
      (current.claim.run_id === undefined ||
        current.claim.run_id === args.runId)
    ) {
      await ctx.db.patch(current.claim._id, { phase: "released" });
      if (current.chat?.active_trigger_run_id === args.runId)
        await ctx.db.patch(current.chat._id, {
          active_trigger_run_id: undefined,
          last_run_error: "The worker stopped before running tools.",
        });
    }
    await releaseAdmissionGateForReceipt(ctx, args);
    return receipt({ ...row, ...patch });
  },
});

/** The exact worker calls this after sealed tool settlement, confirmed remote
 * PTY exit and final persistence attempts. This proves resource settlement,
 * not successful billing/transcript writes. Trigger status is never this proof. */
export const recordCleanup = mutation({
  args: {
    ...boundArgs,
    runId: v.string(),
    workerEntryId: v.optional(v.string()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = requireBinding((await readOwned(ctx, args)).row, args.claimId);
    identifier(args.runId);
    if (
      row.requires_cleanup !== true ||
      (row.worker_lifecycle_version === 1 &&
        (!args.workerEntryId || row.worker_entry_id !== args.workerEntryId)) ||
      row.run_id !== args.runId ||
      (row.state !== "accepted" && row.state !== "terminal")
    )
      fail("DISPATCH_CLEANUP_BINDING_CONFLICT");
    if (row.cleanup_confirmed_at === undefined)
      await ctx.db.patch(row._id, {
        cleanup_pending: false,
        cleanup_confirmed_at: Date.now(),
      });
    return true;
  },
});

const workerEntryArgs = {
  ...boundArgs,
  runId: v.string(),
  workerEntryId: v.string(),
  payloadHash: v.string(),
};
type WorkerEntry = Owner & {
  claimId: string;
  runId: string;
  workerEntryId: string;
  payloadHash: string;
};
async function readWorkerEntry(
  ctx: { db: QueryCtx["db"] },
  args: WorkerEntry,
  entering = false,
) {
  const current = await readOwned(ctx, args);
  const row = requireBinding(current.row, args.claimId);
  identifier(args.runId);
  identifier(args.workerEntryId);
  if (
    row.requires_cleanup !== true ||
    row.worker_lifecycle_version !== 1 ||
    row.payload_hash !== args.payloadHash ||
    !/^[a-f0-9]{64}$/.test(args.payloadHash) ||
    (row.run_id !== undefined && row.run_id !== args.runId) ||
    (row.state !== "dispatching" &&
      row.state !== "accepted" &&
      row.state !== "terminal") ||
    (entering
      ? row.worker_entry_id !== undefined &&
        row.worker_entry_id !== args.workerEntryId
      : row.worker_entry_id !== args.workerEntryId)
  )
    fail("DISPATCH_WORKER_ENTRY_CONFLICT");
  return { ...current, row };
}

/** Entry is identity-only. It grants no tools, billing or entitlement authority.
 * The invocation nonce comes from this worker process, never its task payload. */
export const enterWorker = mutation({
  args: workerEntryArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { row } = await readWorkerEntry(ctx, args, true);
    if (row.cleanup_confirmed_at !== undefined || row.state === "terminal")
      fail("DISPATCH_WORKER_ENTRY_CLOSED");
    await ctx.db.patch(row._id, {
      worker_entry_id: args.workerEntryId,
      run_id: args.runId,
      state: "accepted",
      accepted_at: row.accepted_at ?? Date.now(),
    });
    await releaseAdmissionGateForReceipt(ctx, args);
    return true;
  },
});

/** Irreversible boundary before effects, after live authorization. A lost
 * response cannot be reinterpreted as proof that no effects were permitted. */
export const markWorkerEffectsStarted = mutation({
  args: workerEntryArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { row, claim } = await readWorkerEntry(ctx, args);
    await assertDispatchNotStopped(ctx, args);
    if (
      row.cleanup_confirmed_at !== undefined ||
      row.state === "terminal" ||
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.phase === "released" ||
      claim.cancel_requested_at !== undefined ||
      (claim.run_id !== undefined && claim.run_id !== args.runId)
    )
      fail("DISPATCH_WORKER_ENTRY_CLOSED");
    if (row.worker_effects_started_at === undefined)
      await ctx.db.patch(row._id, { worker_effects_started_at: Date.now() });
    return true;
  },
});

/** No-effects proof is owned by the exact invocation and survives entitlement
 * revocation/rollout rollback. It never reopens or clears a successor's claim. */
export const recordPreExecutionCleanup = mutation({
  args: workerEntryArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const { row, claim, chat } = await readWorkerEntry(ctx, args);
    if (row.worker_effects_started_at !== undefined)
      fail("DISPATCH_EFFECTS_ALREADY_STARTED");
    if (row.worker_pre_execution_cleanup_at !== undefined) return true;
    if (row.cleanup_confirmed_at !== undefined)
      fail("DISPATCH_WORKER_ENTRY_CLOSED");
    const now = Date.now();
    await ctx.db.patch(row._id, {
      cleanup_pending: false,
      cleanup_confirmed_at: now,
      worker_pre_execution_cleanup_at: now,
    });
    if (
      claim?.claim_id === args.claimId &&
      (claim.run_id === undefined || claim.run_id === args.runId)
    ) {
      await ctx.db.patch(claim._id, { phase: "released" });
      if (chat?.active_trigger_run_id === args.runId)
        await ctx.db.patch(chat._id, {
          active_trigger_run_id: undefined,
          last_run_error: "The worker stopped before running tools.",
        });
    }
    await releaseAdmissionGateForReceipt(ctx, args);
    return true;
  },
});
