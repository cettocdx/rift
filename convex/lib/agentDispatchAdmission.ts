import { ConvexError } from "convex/values";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

type Reader = { db: QueryCtx["db"] };
export const admissionEnabled = () =>
  process.env.RIFT_DURABLE_DISPATCH_ADMISSION === "true";
export function admissionFailure(code: string): never {
  throw new ConvexError({ code, message: "Agent dispatch admission rejected" });
}
export function requireAdmissionEnabled() {
  if (!admissionEnabled()) admissionFailure("DISPATCH_ADMISSION_DISABLED");
}
export async function readAdmissionGate(ctx: Reader, chatId: string) {
  const rows = await ctx.db
    .query("agent_dispatch_admissions")
    .withIndex("by_chat_id", (q) => q.eq("chat_id", chatId))
    .take(2);
  if (rows.length > 1) admissionFailure("DISPATCH_ADMISSION_CONFLICT");
  return rows[0];
}
export function isAdmissionGateBlocking(
  gate: Doc<"agent_dispatch_admissions"> | undefined,
) {
  return (
    !!gate &&
    (gate.phase === "elected" ||
      gate.phase === "attached" ||
      gate.phase === "dispatching")
  );
}
export async function readAdmissionIntent(
  ctx: Reader,
  owner: { userId: string; chatId: string; dispatchId: string },
) {
  const rows = await ctx.db
    .query("agent_dispatch_intents")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", owner.userId)
        .eq("chat_id", owner.chatId)
        .eq("dispatch_id", owner.dispatchId),
    )
    .take(2);
  if (rows.length > 1) admissionFailure("DISPATCH_ADMISSION_CONFLICT");
  return rows[0];
}
export async function setAdmissionPhase(
  ctx: MutationCtx,
  gate: Doc<"agent_dispatch_admissions">,
  phase: Doc<"agent_dispatch_admissions">["phase"],
) {
  const intent = await readAdmissionIntent(ctx, {
    userId: gate.user_id,
    chatId: gate.chat_id,
    dispatchId: gate.dispatch_id,
  });
  if (
    !intent ||
    intent.attempt_id !== gate.attempt_id ||
    intent.next_claim_id !== gate.next_claim_id
  )
    admissionFailure("DISPATCH_ADMISSION_CONFLICT");
  await ctx.db.patch(gate._id, { phase });
  await ctx.db.patch(intent._id, { phase });
}
/** Invoke inside the owner-authorized Stop transaction, even if no active
 * worker exists yet. Revocation is permanent for this logical request. */
export async function revokeAdmissionGateForStop(
  ctx: MutationCtx,
  owner: { userId: string; chatId: string },
): Promise<boolean> {
  if (!admissionEnabled()) return false;
  const gate = await readAdmissionGate(ctx, owner.chatId);
  if (gate && gate.user_id !== owner.userId) admissionFailure("FORBIDDEN");
  if (!isAdmissionGateBlocking(gate)) return false;
  await setAdmissionPhase(ctx, gate!, "revoked");
  return true;
}
/** Receipt evidence may arrive after Stop or a newer admission. Never release
 * another intent's gate and never undo revocation. */
export async function releaseAdmissionGateForReceipt(
  ctx: MutationCtx,
  owner: {
    userId: string;
    chatId: string;
    dispatchId: string;
    claimId: string;
  },
) {
  // Rollback stops new admissions, not settlement of already-issued receipts.
  const gate = await readAdmissionGate(ctx, owner.chatId);
  if (gate && gate.user_id !== owner.userId) admissionFailure("FORBIDDEN");
  if (
    gate &&
    gate.dispatch_id === owner.dispatchId &&
    gate.next_claim_id === owner.claimId &&
    (gate.phase === "attached" || gate.phase === "dispatching")
  )
    await setAdmissionPhase(ctx, gate, "released");
}

export async function readDispatchStop(
  ctx: Reader,
  owner: { userId: string; chatId: string; dispatchId: string },
) {
  const rows = await ctx.db
    .query("agent_dispatch_stops")
    .withIndex("by_owner_chat_dispatch", (q) =>
      q
        .eq("user_id", owner.userId)
        .eq("chat_id", owner.chatId)
        .eq("dispatch_id", owner.dispatchId),
    )
    .take(2);
  if (rows.length > 1) admissionFailure("DISPATCH_ADMISSION_CONFLICT");
  return rows[0];
}
export async function assertDispatchNotStopped(
  ctx: Reader,
  owner: { userId: string; chatId: string; dispatchId: string },
) {
  if (await readDispatchStop(ctx, owner)) admissionFailure("DISPATCH_STOPPED");
}
