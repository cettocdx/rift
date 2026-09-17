import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { ConvexError, v } from "convex/values";
import { validateServiceKey } from "./lib/utils";

const ownerArgs = {
  serviceKey: v.string(),
  userId: v.string(),
  chatId: v.string(),
  claimId: v.string(),
  runId: v.string(),
  resourceId: v.string(),
  sandboxId: v.string(),
};
type Owner = {
  serviceKey: string;
  userId: string;
  chatId: string;
  claimId: string;
  runId: string;
  resourceId: string;
  sandboxId: string;
};
function conflict(): never {
  throw new ConvexError({
    code: "RESOURCE_CONFLICT",
    message: "Remote resource identity does not match",
  });
}
function validate(args: Owner) {
  validateServiceKey(args.serviceKey);
  for (const value of [
    args.userId,
    args.chatId,
    args.claimId,
    args.runId,
    args.resourceId,
    args.sandboxId,
  ]) {
    if (!value || value.length > 200 || value.trim() !== value) conflict();
  }
}
async function readResource(ctx: { db: QueryCtx["db"] }, args: Owner) {
  const rows = await ctx.db
    .query("agent_run_resources")
    .withIndex("by_resource_id", (q) => q.eq("resource_id", args.resourceId))
    .take(2);
  if (rows.length > 1) conflict();
  const row = rows[0];
  if (
    row &&
    (row.user_id !== args.userId ||
      row.chat_id !== args.chatId ||
      row.claim_id !== args.claimId ||
      row.run_id !== args.runId ||
      row.sandbox_id !== args.sandboxId)
  )
    conflict();
  return row;
}

/** Only a first, durably accepted reservation authorizes a remote launch.
 * A lost response must not be retried as a new launch identity. */
export const reserveCommand = mutation({
  args: ownerArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validate(args);
    if (await readResource(ctx, args)) return false;
    const claims = await ctx.db
      .query("agent_run_claims")
      .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
      .take(2);
    if (claims.length > 1) conflict();
    const claim = claims[0];
    if (claim && claim.user_id !== args.userId) conflict();
    if (
      !claim ||
      claim.claim_id !== args.claimId ||
      claim.run_id !== args.runId ||
      claim.phase !== "active" ||
      claim.cancel_requested_at !== undefined ||
      !claim.remote_cleanup_required ||
      claim.remote_cleanup_confirmed
    )
      return false;
    await ctx.db.insert("agent_run_resources", {
      user_id: args.userId,
      chat_id: args.chatId,
      claim_id: args.claimId,
      run_id: args.runId,
      resource_id: args.resourceId,
      sandbox_id: args.sandboxId,
      kind: "foreground_command",
      state: "reserved",
      created_at: Date.now(),
    });
    await ctx.db.patch(claim._id, { resource_journal_enabled: true });
    return true;
  },
});
const processArgs = {
  ...ownerArgs,
  pid: v.number(),
  processIdentity: v.string(),
};
type Receipt = Owner & { pid: number; processIdentity: string };
async function record(ctx: MutationCtx, args: Receipt, exited: boolean) {
  validate(args);
  if (
    !Number.isSafeInteger(args.pid) ||
    args.pid <= 0 ||
    !args.processIdentity ||
    args.processIdentity.length > 512 ||
    args.processIdentity.trim() !== args.processIdentity
  )
    conflict();
  const row = await readResource(ctx, args);
  if (!row || row.state === "not_started" || row.state === "sandbox_absent")
    conflict();
  if (
    row.state !== "reserved" &&
    (row.pid !== args.pid || row.process_identity !== args.processIdentity)
  )
    conflict();
  if (exited && row.state === "reserved") conflict();
  if (row.state === "exited" || (!exited && row.state === "started"))
    return true;
  await ctx.db.patch(
    row._id,
    exited
      ? { state: "exited", exited_at: Date.now() }
      : {
          state: "started",
          pid: args.pid,
          process_identity: args.processIdentity,
          started_at: Date.now(),
        },
  );
  return true;
}
/** Trusted runner persists a verified remote identity, not just a reusable PID.
 * Historical receipts remain writable after cancellation or claim replacement. */
export const recordStarted = mutation({
  args: processArgs,
  returns: v.boolean(),
  handler: (ctx, args) => record(ctx, args, false),
});
/** Call only after actual exit evidence for the exact recorded process. */
export const recordExited = mutation({
  args: processArgs,
  returns: v.boolean(),
  handler: (ctx, args) => record(ctx, args, true),
});

/** Only the launcher holding the first successful reservation may call this,
 * before invoking the remote SDK at all. A timeout/lost SDK response is NOT proof. */
export const recordNotStarted = mutation({
  args: ownerArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validate(args);
    const row = await readResource(ctx, args);
    if (!row) conflict();
    if (row.state === "not_started") return true;
    if (row.state !== "reserved") conflict();
    await ctx.db.patch(row._id, {
      state: "not_started",
      exited_at: Date.now(),
    });
    return true;
  },
});

/** Read-only recovery inventory, scoped to the exact historical run owner. */
export const listPending = query({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    chatId: v.string(),
    claimId: v.string(),
    runId: v.string(),
    state: v.union(v.literal("reserved"), v.literal("started")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    for (const value of [args.userId, args.chatId, args.claimId, args.runId]) {
      if (!value || value.trim() !== value || value.length > 200) conflict();
    }
    return ctx.db
      .query("agent_run_resources")
      .withIndex("by_owner_run_state", (q) =>
        q
          .eq("user_id", args.userId)
          .eq("chat_id", args.chatId)
          .eq("claim_id", args.claimId)
          .eq("run_id", args.runId)
          .eq("state", args.state),
      )
      .paginate({
        ...args.paginationOpts,
        numItems: Math.min(100, args.paginationOpts.numItems),
      });
  },
});

/** Trusted recovery adapter only: two typed provider not-found responses and a
 * complete running+paused inventory. This settles resource liveness, NOT success. */
export const recordSandboxAbsent = mutation({
  args: ownerArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validate(args);
    const row = await readResource(ctx, args);
    if (!row) conflict();
    if (["sandbox_absent", "exited", "not_started"].includes(row.state))
      return true;
    await ctx.db.patch(row._id, {
      state: "sandbox_absent",
      absence_verified_at: Date.now(),
    });
    return true;
  },
});
