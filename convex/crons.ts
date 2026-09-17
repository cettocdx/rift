import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";
import { v } from "convex/values";

export const runPurge = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      const { deletedCount } = await ctx.runMutation(
        internal.fileStorage.purgeExpiredUnattachedFiles,
        { cutoffTimeMs: cutoff, limit: 100 },
      );
      if (deletedCount === 0) break;
    }
    return null;
  },
});

/**
 * Delete processed_webhooks rows older than 7 days. Stripe retries fall within
 * a ~72h window, so anything older is just idempotency dead weight.
 *
 * Processes up to 10 batches per run. If the last batch fills `limit`, more
 * work remains — schedule a follow-up so backlog can't outpace the daily cron.
 */
export const runProcessedWebhooksPurge = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const limit = 100;
    let lastDeletedCount = 0;
    for (let i = 0; i < 10; i++) {
      const { deletedCount } = await ctx.runMutation(
        internal.extraUsage.purgeOldProcessedWebhooks,
        { cutoffTimeMs: cutoff, limit },
      );
      lastDeletedCount = deletedCount;
      if (deletedCount < limit) break;
    }
    if (lastDeletedCount === limit) {
      await ctx.scheduler.runAfter(
        0,
        internal.crons.runProcessedWebhooksPurge,
        {},
      );
    }
    return null;
  },
});

/**
 * Delete disconnected local_sandbox_connections older than 30 days. Keeps
 * recent disconnects around long enough for any UX/support lookups.
 *
 * Processes up to 10 batches per run. If the last batch fills `limit`, more
 * work remains — schedule a follow-up so backlog can't outpace the daily cron.
 */
export const runStaleConnectionsPurge = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const limit = 100;
    let lastDeletedCount = 0;
    for (let i = 0; i < 10; i++) {
      const { deletedCount } = await ctx.runMutation(
        internal.localSandbox.purgeStaleDisconnectedConnections,
        { cutoffTimeMs: cutoff, limit },
      );
      lastDeletedCount = deletedCount;
      if (deletedCount < limit) break;
    }
    if (lastDeletedCount === limit) {
      await ctx.scheduler.runAfter(
        0,
        internal.crons.runStaleConnectionsPurge,
        {},
      );
    }
    return null;
  },
});

/**
 * Delete inert pre-verification password accounts (and their dangling
 * verification codes / fully-inert user rows) older than ~30 min, plus OTP
 * rate-limit rows whose window has long since lapsed.
 *
 * Processes up to 10 batches per table per run. If the last batch fills
 * `limit`, more work remains — schedule a follow-up so backlog can't outpace
 * the cron.
 */
export const runAuthCleanup = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const limit = 100;

    // Unverified password accounts older than 30 minutes.
    const accountCutoff = Date.now() - 30 * 60 * 1000;
    let lastAccountDeleted = 0;
    for (let i = 0; i < 10; i++) {
      const { deletedCount } = await ctx.runMutation(
        internal.authCleanup.purgeUnverifiedPasswordAccounts,
        { cutoffTimeMs: accountCutoff, limit },
      );
      lastAccountDeleted = deletedCount;
      if (deletedCount < limit) break;
    }

    // OTP rate-limit rows untouched for over an hour (well past the 15-min
    // window and 60s min-interval, so deleting them drops no live limit).
    const otpCutoff = Date.now() - 60 * 60 * 1000;
    let lastOtpDeleted = 0;
    for (let i = 0; i < 10; i++) {
      const { deletedCount } = await ctx.runMutation(
        internal.authCleanup.purgeStaleOtpLimits,
        { cutoffTimeMs: otpCutoff, limit },
      );
      lastOtpDeleted = deletedCount;
      if (deletedCount < limit) break;
    }

    if (lastAccountDeleted === limit || lastOtpDeleted === limit) {
      await ctx.scheduler.runAfter(0, internal.crons.runAuthCleanup, {});
    }
    return null;
  },
});

/** Purge abandoned one-time OAuth/PKCE state in bounded indexed batches. */
export const runMcpOAuthSessionPurge = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();
    const limit = 100;
    let lastDeletedCount = 0;
    for (let index = 0; index < 10; index += 1) {
      const { deletedCount } = await ctx.runMutation(
        internal.mcpServers.purgeExpiredOAuthSessions,
        { now, limit },
      );
      lastDeletedCount = deletedCount;
      if (deletedCount < limit) break;
    }
    if (lastDeletedCount === limit) {
      await ctx.scheduler.runAfter(
        0,
        internal.crons.runMcpOAuthSessionPurge,
        {},
      );
    }
    return null;
  },
});

/** Older records are candidates for saved-outcome reconciliation, not proof
 * of a dead worker. Agent tasks have no duration ceiling. */
const RUN_RECONCILE_AGE_MS = 75 * 60 * 1000;

export const runStaleRunsReconcile = internalAction({
  args: { cursor: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    const result = await ctx.runMutation(internal.runs.reconcileStaleRuns, {
      cutoffMs: Date.now() - RUN_RECONCILE_AGE_MS,
      limit: 100,
      ...(args.cursor ? { cursor: args.cursor } : {}),
    });
    if (!result.isDone) {
      if (!result.continueCursor || result.continueCursor === args.cursor)
        throw new Error("Run reconciliation cursor did not advance");
      await ctx.scheduler.runAfter(0, internal.crons.runStaleRunsReconcile, {
        cursor: result.continueCursor,
      });
    }
    return null;
  },
});

const crons = cronJobs();

crons.interval(
  "reconcile saved final run outcomes",
  { minutes: 15 },
  internal.crons.runStaleRunsReconcile,
  {},
);

crons.interval(
  "purge orphan files older than 24h",
  { hours: 1 },
  internal.crons.runPurge,
  {},
);

crons.interval(
  "purge processed webhook idempotency rows older than 7d",
  { hours: 24 },
  internal.crons.runProcessedWebhooksPurge,
  {},
);

crons.interval(
  "purge stale disconnected sandbox connections older than 30d",
  { hours: 24 },
  internal.crons.runStaleConnectionsPurge,
  {},
);

crons.interval(
  "purge unverified pre-verification accounts and stale otp limits",
  { minutes: 30 },
  internal.crons.runAuthCleanup,
  {},
);

crons.interval(
  "purge expired MCP OAuth sessions",
  { minutes: 15 },
  internal.crons.runMcpOAuthSessionPurge,
  {},
);

crons.interval(
  "ops: failure-rate check",
  { minutes: 15 },
  internal.opsAlerts.checkFailureRate,
  {},
);

crons.daily(
  "ops: daily run digest",
  { hourUTC: 8, minuteUTC: 0 },
  internal.opsAlerts.dailyRunDigest,
  {},
);

export default crons;
