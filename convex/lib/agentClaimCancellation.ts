import { revokeAdmissionGateForStop } from "./agentDispatchAdmission";
import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/** Authenticated client mutations retain their existing "stop current chat"
 * contract. Read the current owner and mapping atomically, never an old snapshot. */
export async function cancelCurrentOwnedClaim(
  ctx: MutationCtx,
  args: { userId: string; chatId: string },
) {
  const claims = await ctx.db
    .query("agent_run_claims")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", args.chatId))
    .take(2);
  const chats = await ctx.db
    .query("chats")
    .withIndex("by_chat_id", (q) => q.eq("id", args.chatId))
    .take(2);
  if (claims.length > 1 || chats.length > 1)
    throw new ConvexError({
      code: "CLAIM_CONFLICT",
      message: "Chat claim is ambiguous",
    });
  const claim = claims[0];
  const chat = chats[0];
  if (
    (claim && claim.user_id !== args.userId) ||
    (chat && chat.user_id !== args.userId)
  )
    throw new ConvexError({
      code: "FORBIDDEN",
      message: "You do not own this chat",
    });
  await revokeAdmissionGateForStop(ctx, args);
  if (!claim || claim.phase === "released") return;
  if (
    claim.phase === "active" &&
    (!claim.run_id || (chat && chat.active_trigger_run_id !== claim.run_id))
  )
    return;
  if (claim.cancel_requested_at === undefined)
    await ctx.db.patch(claim._id, { cancel_requested_at: Date.now() });
}
