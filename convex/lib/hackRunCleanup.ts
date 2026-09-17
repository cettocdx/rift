import type { QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { admissionFailure } from "./agentDispatchAdmission";

type Reader = { db: QueryCtx["db"] };
type Owner = { userId: string; chatId: string };

export function requiresHackCleanup(
  receipt: Pick<
    Doc<"agent_dispatch_requests">,
    "requires_cleanup" | "cleanup_confirmed_at"
  >,
): boolean {
  return (
    receipt.requires_cleanup === true &&
    receipt.cleanup_confirmed_at === undefined
  );
}

/** This indexed read serializes every producer admission with dispatch/cleanup.
 * It survives cleared chat mappings and released or replaced claim rows. */
export async function hasPendingHackCleanup(
  ctx: Reader,
  owner: Owner,
  exceptClaimId?: string,
): Promise<boolean> {
  const rows = await ctx.db
    .query("agent_dispatch_requests")
    .withIndex("by_chat_cleanup_pending", (q) =>
      q.eq("chat_id", owner.chatId).eq("cleanup_pending", true),
    )
    .take(2);
  if (rows.some((row) => row.user_id !== owner.userId))
    admissionFailure("FORBIDDEN");
  return rows.some((row) => row.claim_id !== exceptClaimId);
}

export async function readClaimCleanupReceipt(
  ctx: Reader,
  owner: Owner,
  claim: Pick<Doc<"agent_run_claims">, "claim_id" | "dispatch_id">,
) {
  if (!claim.dispatch_id) return undefined;
  const rows = await ctx.db
    .query("agent_dispatch_requests")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", owner.userId)
        .eq("chat_id", owner.chatId)
        .eq("client_dispatch_id", claim.dispatch_id!),
    )
    .take(2);
  if (rows.length > 1) admissionFailure("DISPATCH_ADMISSION_CONFLICT");
  const row = rows[0];
  if (row && row.claim_id !== claim.claim_id)
    admissionFailure("DISPATCH_BINDING_CONFLICT");
  return row;
}
