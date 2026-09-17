import "server-only";
import { readHackHttpExecution } from "@/lib/hack/http-execution";
import {
  readAgentDispatchReceipt,
  refreshAgentDispatchTerminal,
} from "@/lib/api/agent-dispatch-admission";

/** Release only the exact producer's admission fence. HTTP acknowledgement
 * proves termination, but does not itself claim a successful assessment. */
export async function recoverWorkspaceOutcome(identity: {
  userId: string;
  chatId: string;
  operationId: string;
}): Promise<"completed" | "failed" | "ended" | undefined> {
  const http = await readHackHttpExecution({
    userId: identity.userId,
    chatId: identity.chatId,
    executionId: identity.operationId,
  }).catch(() => undefined);
  if (http?.phase === "terminal" || http?.phase === "stopped")
    return http.canceled ? "failed" : "ended";
  if (http) return;
  const owner = {
    userId: identity.userId,
    chatId: identity.chatId,
    dispatchId: identity.operationId,
  };
  const saved = await readAgentDispatchReceipt(owner).catch(() => undefined);
  if (!saved) return;
  const refreshed = await refreshAgentDispatchTerminal(
    owner,
    saved,
    1000,
  ).catch(() => undefined);
  const receipt = refreshed?.receipt;
  if (
    receipt?.state !== "terminal" ||
    (receipt.requiresCleanup === true &&
      receipt.cleanupConfirmedAt === undefined)
  )
    return;
  return receipt.terminalStatus === "COMPLETED" ? "completed" : "failed";
}
