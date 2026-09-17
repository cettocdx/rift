import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { validateServiceKey } from "./lib/utils";
import { requiresHackCleanup } from "./lib/hackRunCleanup";
import {
  admissionFailure as fail,
  readAdmissionGate,
  readAdmissionIntent,
  readDispatchStop,
  setAdmissionPhase,
} from "./lib/agentDispatchAdmission";

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
  dispatchId: v.string(),
};
type Owner = {
  serviceKey: string;
  userId: string;
  chatId: string;
  dispatchId: string;
};
const observation = v.object({
  dispatchId: v.string(),
  canceled: v.boolean(),
  claimId: v.optional(v.string()),
  runId: v.optional(v.string()),
});
async function readOwned(ctx: { db: QueryCtx["db"] }, owner: Owner) {
  validateServiceKey(owner.serviceKey);
  for (const value of [owner.userId, owner.chatId, owner.dispatchId])
    if (!value || value.length > 200 || value.trim() !== value)
      fail("INVALID_DISPATCH");
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", owner.chatId))
    .take(2);
  const claims = await ctx.db
    .query("agent_run_claims")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", owner.chatId))
    .take(2);
  const gate = await readAdmissionGate(ctx, owner.chatId);
  if (chats.length > 1 || claims.length > 1)
    fail("DISPATCH_ADMISSION_CONFLICT");
  if (
    [chats[0], claims[0], gate].some(
      (row) => row && row.user_id !== owner.userId,
    ) ||
    (chats[0] && chats[0].purpose !== "security")
  )
    fail("FORBIDDEN");
  const receipts = await ctx.db
    .query("agent_dispatch_requests")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", owner.userId)
        .eq("chat_id", owner.chatId)
        .eq("client_dispatch_id", owner.dispatchId),
    )
    .take(2);
  if (receipts.length > 1) fail("DISPATCH_ADMISSION_CONFLICT");
  const receipt = receipts[0];
  const intent = await readAdmissionIntent(ctx, owner);
  if (receipt && intent && receipt.claim_id !== intent.next_claim_id)
    fail("DISPATCH_BINDING_CONFLICT");
  const claimId = receipt?.claim_id ?? intent?.next_claim_id;
  const claim = claims[0]?.claim_id === claimId ? claims[0] : undefined;
  if (receipt?.run_id && claim?.run_id && receipt.run_id !== claim.run_id)
    fail("DISPATCH_BINDING_CONFLICT");
  return { chat: chats[0], claim, gate, intent, receipt };
}
function result(owner: Owner, current: Awaited<ReturnType<typeof readOwned>>) {
  const { receipt, intent, claim } = current;
  const runId = receipt?.run_id ?? claim?.run_id;
  // A revoked gate alone is insufficient: dispatch permission may already have
  // escaped to an in-flight Trigger request. Age and claim release prove nothing.
  const noProducer =
    !runId &&
    ((!receipt && (!intent || intent.phase !== "dispatching")) ||
      receipt?.state === "reserved" ||
      receipt?.not_dispatched_at !== undefined);
  const canceled =
    noProducer ||
    (receipt?.state === "terminal" && !requiresHackCleanup(receipt));
  return {
    dispatchId: owner.dispatchId,
    canceled,
    ...(!noProducer && (receipt?.claim_id ?? intent?.next_claim_id)
      ? { claimId: (receipt?.claim_id ?? intent?.next_claim_id)! }
      : {}),
    ...(runId ? { runId } : {}),
  };
}

/** Exact Stop is independent of rollout and entitlement changes. Missing chat
 * rows are allowed because authenticated requests can still be before admission.
 * This mutation's indexed tombstone read/write serializes with every admission
 * transition and activation; no predecessor/newer generation is touched. */
export const request = mutation({
  args: ownerArgs,
  returns: observation,
  handler: async (ctx, owner) => {
    const current = await readOwned(ctx, owner);
    const existing = await readDispatchStop(ctx, owner);
    if (!existing)
      await ctx.db.insert("agent_dispatch_stops", {
        user_id: owner.userId,
        chat_id: owner.chatId,
        dispatch_id: owner.dispatchId,
        requested_at: Date.now(),
      });
    // Evaluate before revoking, preserving evidence of escaped permission.
    const stopped = result(owner, current);
    const { gate, intent, claim, chat } = current;
    if (gate?.dispatch_id === owner.dispatchId && gate.phase !== "revoked") {
      await setAdmissionPhase(ctx, gate, "revoked");
    } else if (intent && intent.phase !== "revoked") {
      await ctx.db.patch(intent._id, { phase: "revoked" });
    }
    if (claim && claim.phase !== "released") {
      await ctx.db.patch(claim._id, {
        cancel_requested_at:
          claim.cancel_requested_at ?? existing?.requested_at ?? Date.now(),
        ...(stopped.canceled
          ? { phase: "released" as const, lease_until: Date.now() }
          : {}),
      });
      if (
        stopped.canceled &&
        claim.run_id &&
        chat?.active_trigger_run_id === claim.run_id
      )
        await ctx.db.patch(chat._id, { active_trigger_run_id: undefined });
    }
    return stopped;
  },
});
export const getForBackend = query({
  args: ownerArgs,
  returns: v.union(v.null(), observation),
  handler: async (ctx, owner) => {
    const current = await readOwned(ctx, owner);
    return (await readDispatchStop(ctx, owner)) ? result(owner, current) : null;
  },
});

/** Only the original server attempt may attest that it exited before invoking
 * Trigger. A thrown/lost Trigger response is NOT this evidence. */
export const recordNotDispatched = mutation({
  args: { ...ownerArgs, attemptId: v.string(), claimId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, owner) => {
    const { intent, receipt, claim } = await readOwned(ctx, owner);
    if (
      !intent ||
      intent.attempt_id !== owner.attemptId ||
      intent.next_claim_id !== owner.claimId ||
      !receipt ||
      receipt.claim_id !== owner.claimId ||
      receipt.run_id ||
      claim?.run_id ||
      (receipt.state !== "reserved" && receipt.state !== "dispatching")
    )
      return false;
    if (receipt.not_dispatched_at === undefined)
      await ctx.db.patch(receipt._id, {
        not_dispatched_at: Date.now(),
        ...(receipt.requires_cleanup === true
          ? { cleanup_pending: false }
          : {}),
      });
    return true;
  },
});
