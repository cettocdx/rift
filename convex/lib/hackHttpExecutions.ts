import { ConvexError } from "convex/values";
import type { QueryCtx } from "../_generated/server";

type Reader = { db: QueryCtx["db"] };
export type HttpOwner = { userId: string; chatId: string; executionId: string };
export function httpExecutionFailure(code: string): never {
  throw new ConvexError({
    code,
    message: "HTTP assessment execution rejected",
  });
}
export async function readHttpExecutionHead(ctx: Reader, chatId: string) {
  const rows = await ctx.db
    .query("hack_http_execution_heads")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", chatId))
    .take(2);
  if (rows.length > 1) httpExecutionFailure("HTTP_EXECUTION_CONFLICT");
  return rows[0];
}
export async function readHttpExecution(ctx: Reader, owner: HttpOwner) {
  const rows = await ctx.db
    .query("hack_http_executions")
    .withIndex("by_owner_chat_execution", (q) =>
      q
        .eq("user_id", owner.userId)
        .eq("chat_id", owner.chatId)
        .eq("execution_id", owner.executionId),
    )
    .take(2);
  if (rows.length > 1) httpExecutionFailure("HTTP_EXECUTION_CONFLICT");
  return rows[0];
}
/** Called from HTTP admission and durable election/reservation transactions.
 * The same indexed head/record reads serialize both producer kinds. */
export async function hasBlockingHttpExecution(
  ctx: Reader,
  owner: { userId: string; chatId: string },
) {
  const head = await readHttpExecutionHead(ctx, owner.chatId);
  if (!head) return false;
  if (head.user_id !== owner.userId) httpExecutionFailure("FORBIDDEN");
  const row = await readHttpExecution(ctx, {
    ...owner,
    executionId: head.execution_id,
  });
  if (!row) httpExecutionFailure("HTTP_EXECUTION_CONFLICT");
  return row.phase !== "terminal";
}
