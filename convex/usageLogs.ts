import { providerReceiptUsage } from "./lib/providerReceipt";
import { mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { validateServiceKey } from "./lib/utils";
import { applyUnitEconomicsDelta, utcDay } from "./unitEconomicsLib";

const typeValidator = v.union(v.literal("included"), v.literal("extra"));

const settlementIdentity = {
  serviceKey: v.string(),
  user_id: v.string(),
  run_id: v.string(),
  attempt_id: v.string(),
};
function validateSettlementIdentity(args: {
  serviceKey: string;
  user_id: string;
  run_id: string;
  attempt_id: string;
}) {
  validateServiceKey(args.serviceKey);
  for (const value of [args.user_id, args.run_id, args.attempt_id])
    if (!value || value.trim() !== value || value.length > 256)
      throw new Error("Invalid settlement identity");
}

/** Only the transaction which creates the intent can authorize an unkeyed debit.
 * If its acknowledgment is lost, even an exact replay must not execute a debit. */
export const beginSettlement = mutation({
  args: {
    ...settlementIdentity,
    evidence: v.string(),
    chat_id: v.optional(v.string()),
    operation_id: v.optional(v.string()),
    actual_points: v.optional(v.number()),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validateSettlementIdentity(args);
    if (
      args.chat_id !== undefined &&
      (!args.chat_id.trim() || args.chat_id.length > 200)
    )
      throw new Error("Invalid settlement chat");
    if (
      args.operation_id !== undefined &&
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/.test(args.operation_id)
    )
      throw new Error("Invalid settlement operation");
    if (
      args.actual_points !== undefined &&
      (!Number.isSafeInteger(args.actual_points) || args.actual_points < 0)
    )
      throw new Error("Invalid settlement points");
    if (args.evidence.length > 16_384)
      throw new Error("Settlement evidence too large");
    const parsed = JSON.parse(args.evidence);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("Invalid settlement evidence");
    const rows = await ctx.db
      .query("usage_settlements")
      .withIndex("by_user_run", (q) =>
        q.eq("user_id", args.user_id).eq("run_id", args.run_id),
      )
      .take(2);
    if (rows.length > 1) throw new Error("Ambiguous settlement");
    if (rows[0]) {
      if (
        rows[0].evidence !== args.evidence ||
        rows[0].actual_points !== args.actual_points ||
        rows[0].chat_id !== args.chat_id ||
        rows[0].operation_id !== args.operation_id
      )
        throw new Error("Conflicting settlement evidence");
      return false;
    }
    const { serviceKey: _key, ...record } = args;
    await ctx.db.insert("usage_settlements", {
      ...record,
      state: "pending",
      created_at: Date.now(),
    });
    return true;
  },
});

export const finishSettlement = mutation({
  args: {
    ...settlementIdentity,
    state: v.union(v.literal("acknowledged"), v.literal("uncertain")),
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validateSettlementIdentity(args);
    const rows = await ctx.db
      .query("usage_settlements")
      .withIndex("by_user_run", (q) =>
        q.eq("user_id", args.user_id).eq("run_id", args.run_id),
      )
      .take(2);
    const row = rows[0];
    if (rows.length !== 1 || row.attempt_id !== args.attempt_id)
      throw new Error("Settlement ownership mismatch");
    if (row.state === args.state) return true;
    if (row.state !== "pending")
      throw new Error("Conflicting settlement outcome");
    await ctx.db.patch(row._id, {
      state: args.state,
      completed_at: Date.now(),
    });
    return true;
  },
});

/** Operational recovery inventory, not an automatic collection queue. */
export const listUnresolvedSettlements = query({
  args: {
    serviceKey: v.string(),
    state: v.union(v.literal("pending"), v.literal("uncertain")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    return ctx.db
      .query("usage_settlements")
      .withIndex("by_state_created", (q) => q.eq("state", args.state))
      .paginate(args.paginationOpts);
  },
});

const cleanModelName = (model: string): string =>
  model
    .replace(/^model-/, "")
    .replace(/^fallback-/, "")
    .replace(/-model$/, "")
    .replace(/^[a-z-]+\//, "")
    .replace(/-\d{8}$/, "");

/**
 * Insert a usage log record (called from backend after each request).
 */
export const logUsage = mutation({
  args: {
    serviceKey: v.string(),
    user_id: v.string(),
    organization_id: v.optional(v.string()),
    chat_id: v.optional(v.string()),
    endpoint: v.optional(
      v.union(
        v.literal("/api/chat"),
        v.literal("/api/agent-long"),
        v.literal("/api/hack-long"),
        v.literal("/api/console/model"),
      ),
    ),
    mode: v.optional(v.union(v.literal("ask"), v.literal("agent"))),
    subscription: v.optional(v.string()),
    model: v.string(),
    type: typeValidator,
    input_tokens: v.number(),
    output_tokens: v.number(),
    cache_read_tokens: v.optional(v.number()),
    cache_write_tokens: v.optional(v.number()),
    total_tokens: v.number(),
    cost_dollars: v.number(),
    model_cost_dollars: v.optional(v.number()),
    non_model_cost_dollars: v.optional(v.number()),
    cost_source: v.optional(
      v.union(v.literal("provider"), v.literal("token_estimate")),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    const modelCostDollars = Number.isFinite(args.model_cost_dollars)
      ? args.model_cost_dollars!
      : args.cost_dollars;
    const nonModelCostDollars = Number.isFinite(args.non_model_cost_dollars)
      ? args.non_model_cost_dollars!
      : 0;
    const now = Date.now();

    await ctx.db.insert("usage_logs", {
      user_id: args.user_id,
      organization_id: args.organization_id,
      chat_id: args.chat_id,
      endpoint: args.endpoint,
      mode: args.mode,
      subscription: args.subscription,
      model: args.model,
      type: args.type,
      input_tokens: args.input_tokens,
      output_tokens: args.output_tokens,
      cache_read_tokens: args.cache_read_tokens,
      cache_write_tokens: args.cache_write_tokens,
      total_tokens: args.total_tokens,
      cost_dollars: args.cost_dollars,
      model_cost_dollars: modelCostDollars,
      non_model_cost_dollars: nonModelCostDollars,
      cost_source: args.cost_source,
    });

    const commonDelta = {
      day: utcDay(now),
      modelCostDollars,
      nonModelCostDollars,
      includedUsageCostDollars:
        args.type === "included" ? args.cost_dollars : 0,
      extraUsageCostDollars: args.type === "extra" ? args.cost_dollars : 0,
      usageRequestCount: 1,
      inputTokens: args.input_tokens,
      outputTokens: args.output_tokens,
      cacheReadTokens: args.cache_read_tokens ?? 0,
      cacheWriteTokens: args.cache_write_tokens ?? 0,
      totalTokens: args.total_tokens,
    };

    await applyUnitEconomicsDelta(ctx, {
      ...commonDelta,
      entityType: "user",
      entityId: args.user_id,
      userId: args.user_id,
      organizationId: args.organization_id,
    });

    if (args.organization_id) {
      await applyUnitEconomicsDelta(ctx, {
        ...commonDelta,
        entityType: "organization",
        entityId: args.organization_id,
        organizationId: args.organization_id,
      });
    }

    return null;
  },
});

/**
 * Daily usage cost aggregates for the last N days (default 7).
 * Used for projected exhaustion date calculation.
 */
export const getDailyUsageSummary = query({
  args: {
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    const userId = identity.subject.split("|")[0];
    const days = Math.min(Math.max(Math.round(args.days ?? 7), 1), 30);
    const startDate = Date.now() - days * 24 * 60 * 60 * 1000;

    const logs = await ctx.db
      .query("usage_logs")
      .withIndex("by_user", (q) =>
        q.eq("user_id", userId).gte("_creationTime", startDate),
      )
      .collect();

    // Aggregate by day (UTC), zero-filling missing days
    const dailyMap = new Map<string, number>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      dailyMap.set(d.toISOString().slice(0, 10), 0);
    }
    for (const log of logs) {
      const day = new Date(log._creationTime).toISOString().slice(0, 10);
      dailyMap.set(day, (dailyMap.get(day) ?? 0) + log.cost_dollars);
    }

    return Array.from(dailyMap.entries())
      .map(([date, costDollars]) => ({ date, costDollars }))
      .sort((a, b) => a.date.localeCompare(b.date));
  },
});

/**
 * Paginated usage logs for the authenticated user within a date range.
 * Uses Convex cursor-based pagination via usePaginatedQuery on the client.
 */
export const getUserUsageLogs = query({
  args: {
    paginationOpts: paginationOptsValidator,
    startDate: v.number(),
    endDate: v.number(),
  },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated");
    }
    const userId = identity.subject.split("|")[0];

    const results = await ctx.db
      .query("usage_logs")
      .withIndex("by_user", (q) =>
        q
          .eq("user_id", userId)
          .gte("_creationTime", args.startDate)
          .lte("_creationTime", args.endDate),
      )
      .order("desc")
      .paginate(args.paginationOpts);

    return {
      ...results,
      page: results.page.map((log) => ({
        _id: log._id,
        _creationTime: log._creationTime,
        model: cleanModelName(log.model),
        type: log.type as "included" | "extra",
        input_tokens: log.input_tokens,
        output_tokens: log.output_tokens,
        cache_read_tokens: log.cache_read_tokens,
        cache_write_tokens: log.cache_write_tokens,
        total_tokens: log.total_tokens,
        cost_dollars: log.cost_dollars,
        model_cost_dollars: log.model_cost_dollars,
        non_model_cost_dollars: log.non_model_cost_dollars,
        cost_source: log.cost_source,
      })),
    };
  },
});

/** Append immutable evidence. An acknowledged replay cannot add a second row.
 * This mutation never adjusts account credits or usage aggregates. */
export const recordProviderReceipt = mutation({
  args: {
    serviceKey: v.string(),
    receipt_id: v.string(),
    user_id: v.string(),
    run_id: v.string(),
    chat_id: v.optional(v.string()),
    model: v.string(),
    usage: providerReceiptUsage,
  },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    for (const value of [
      args.receipt_id,
      args.user_id,
      args.run_id,
      args.model,
      ...(args.chat_id === undefined ? [] : [args.chat_id]),
    ]) {
      if (!value || value.trim() !== value || value.length > 256)
        throw new Error("Invalid usage receipt identity");
    }
    for (const [key, value] of Object.entries(args.usage)) {
      if (
        value !== undefined &&
        (!Number.isFinite(value) ||
          value < 0 ||
          (key !== "cost_dollars" && !Number.isSafeInteger(value)))
      )
        throw new Error("Invalid usage receipt evidence");
    }
    const rows = await ctx.db
      .query("provider_usage_receipts")
      .withIndex("by_receipt_id", (q) => q.eq("receipt_id", args.receipt_id))
      .take(2);
    if (rows.length > 1) throw new Error("Ambiguous usage receipt");
    if (rows[0]) {
      const row = rows[0];
      if (
        row.user_id !== args.user_id ||
        row.run_id !== args.run_id ||
        row.chat_id !== args.chat_id ||
        row.model !== args.model ||
        [
          ...new Set([...Object.keys(row.usage), ...Object.keys(args.usage)]),
        ].some(
          (key) =>
            row.usage[key as keyof typeof row.usage] !==
            args.usage[key as keyof typeof args.usage],
        )
      )
        throw new Error("Conflicting usage receipt replay");
      return true;
    }
    const { serviceKey: _serviceKey, ...receipt } = args;
    await ctx.db.insert("provider_usage_receipts", {
      ...receipt,
      observed_at: Date.now(),
    });
    return true;
  },
});

/** Recovery/admin reader. Ownership is explicit; no public list of other users. */
export const getProviderReceiptsForRun = query({
  args: {
    serviceKey: v.string(),
    user_id: v.string(),
    run_id: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);
    return ctx.db
      .query("provider_usage_receipts")
      .withIndex("by_user_run", (q) =>
        q.eq("user_id", args.user_id).eq("run_id", args.run_id),
      )
      .paginate(args.paginationOpts);
  },
});
