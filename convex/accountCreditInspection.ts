import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { validateServiceKey } from "./lib/utils";
import {
  accountCreditReceipt,
  accountCreditReservationState,
} from "./lib/accountCreditReservation";
import {
  productionCreditBinding,
  productionCreditDenial,
} from "./lib/accountCreditProductionAdmission";
import {
  storedTerminalCreditSettlement,
  terminalCreditSettlementResult,
} from "./lib/accountCreditSettlement";

const unresolvedState = v.union(
  v.literal("reserved"),
  v.literal("in_use"),
  v.literal("reconciliation_required"),
);
const summaryFields = {
  reservationKey: v.string(),
  userId: v.string(),
  amountPoints: v.number(),
  subscription: v.union(v.literal("pro"), v.literal("ultra")),
  state: accountCreditReservationState,
  createdAt: v.number(),
  updatedAt: v.number(),
  productionBinding: v.optional(productionCreditBinding),
  receipt: v.optional(accountCreditReceipt),
  admissionDenial: v.optional(
    v.object({ reason: productionCreditDenial, at: v.number() }),
  ),
  terminal: v.optional(
    v.object({
      revision: v.literal(1),
      actualPoints: v.union(v.number(), v.null()),
      usageStatus: v.union(v.literal("known"), v.literal("unknown")),
      result: terminalCreditSettlementResult,
    }),
  ),
};

function authorize(serviceKey: string) {
  // Convex validates the argument type. Also fail closed on missing/empty server
  // configuration rather than allowing two absent or empty values to match.
  if (!process.env.CONVEX_SERVICE_ROLE_KEY?.trim() || !serviceKey?.trim())
    throw new Error("Unauthorized: Invalid service key");
  validateServiceKey(serviceKey);
}

function summary(row: Doc<"account_credit_reservations">) {
  return {
    reservationKey: row.reservation_key,
    userId: row.user_id,
    amountPoints: row.amount_points,
    subscription: row.subscription,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    productionBinding: row.production_admission,
    receipt: row.receipt,
    admissionDenial: row.admission_denial,
    terminal: row.terminal_settlement
      ? {
          revision: row.terminal_settlement.revision,
          actualPoints: row.terminal_settlement.actualPoints,
          usageStatus: row.terminal_settlement.usage.status,
          result: row.terminal_settlement.result,
        }
      : undefined,
  };
}

/** Cross-account operator inspection, protected by the service authority.
 * Exact lookup exposes the immutable evidence needed to classify one operation.
 * It does not recover a lost in-memory snapshot or authorize a correction. */
export const getAccountCreditReservation = query({
  args: { serviceKey: v.string(), reservationKey: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      ...summaryFields,
      accountingGeneration: v.number(),
      ledgerId: v.optional(v.id("extra_usage")),
      includedCycleKey: v.optional(v.string()),
      includedCycleMonth: v.optional(v.string()),
      purchasedMonth: v.optional(v.string()),
      terminalSettlement: v.optional(storedTerminalCreditSettlement),
    }),
  ),
  handler: async (ctx, args) => {
    authorize(args.serviceKey);
    if (
      !args.reservationKey ||
      args.reservationKey.trim() !== args.reservationKey ||
      args.reservationKey.length > 200
    )
      throw new Error("Invalid reservation key");
    const row = await ctx.db
      .query("account_credit_reservations")
      .withIndex("by_reservation_key", (q) =>
        q.eq("reservation_key", args.reservationKey),
      )
      .unique();
    if (!row) return null;
    return {
      ...summary(row),
      accountingGeneration: row.accounting_generation,
      ledgerId: row.ledger_id,
      includedCycleKey: row.included_cycle_key,
      includedCycleMonth: row.included_cycle_month,
      purchasedMonth: row.purchased_month,
      terminalSettlement: row.terminal_settlement,
    };
  },
});

/** Scan one unsettled state, oldest update first. Keep state/updatedBefore fixed
 * while continuing the opaque cursor. This is a live queue, not a snapshot or
 * proof that old requests stopped. Short/empty pages can still have continuation. */
export const listUnresolvedAccountCreditReservations = query({
  args: {
    serviceKey: v.string(),
    state: unresolvedState,
    updatedBefore: v.number(),
    pageSize: v.number(),
    cursor: v.union(v.string(), v.null()),
  },
  returns: v.object({
    page: v.array(v.object(summaryFields)),
    isDone: v.boolean(),
    continueCursor: v.string(),
  }),
  handler: async (ctx, args) => {
    authorize(args.serviceKey);
    if (
      !Number.isSafeInteger(args.pageSize) ||
      args.pageSize < 1 ||
      args.pageSize > 100 ||
      !Number.isSafeInteger(args.updatedBefore) ||
      args.updatedBefore < 0 ||
      (args.cursor !== null &&
        (typeof args.cursor !== "string" || args.cursor.length > 8192)) ||
      !["reserved", "in_use", "reconciliation_required"].includes(args.state)
    )
      throw new Error("Invalid reservation queue bounds");
    const result = await ctx.db
      .query("account_credit_reservations")
      .withIndex("by_state_updated_at", (q) =>
        q.eq("state", args.state).lte("updated_at", args.updatedBefore),
      )
      .order("asc")
      .paginate({
        numItems: args.pageSize,
        cursor: args.cursor,
        maximumRowsRead: 100,
        maximumBytesRead: 512 * 1024,
      });
    return {
      page: result.page.map(summary),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});
