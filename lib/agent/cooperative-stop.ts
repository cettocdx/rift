import {
  AgentRunCanceledError,
  type CanceledClaimBinding,
} from "./claim-cancellation";

type Claim = CanceledClaimBinding & { cancelRequestedAt?: number };

/** Read-only cancellation watcher. It never releases a claim or settles money.
 * A failed read is not cancellation; the route retains forced-stop fallback. */
export function watchClaimCancellation({
  binding,
  read,
  onCancel,
}: {
  binding: CanceledClaimBinding & { runId: string };
  read: () => Promise<Claim | null>;
  onCancel: (reason: AgentRunCanceledError) => void;
}) {
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const poll = async () => {
    try {
      const current = await read();
      if (disposed) return;
      if (
        current?.userId === binding.userId &&
        current.chatId === binding.chatId &&
        current.claimId === binding.claimId &&
        current.runId === binding.runId &&
        typeof current.cancelRequestedAt === "number" &&
        Number.isFinite(current.cancelRequestedAt)
      ) {
        disposed = true;
        onCancel(new AgentRunCanceledError(binding));
        return;
      }
    } catch {
      /* Read failure cannot authorize a stop. */
    }
    if (!disposed) timer = setTimeout(poll, 1000);
  };
  timer = setTimeout(poll, 1000);
  return () => {
    disposed = true;
    if (timer) clearTimeout(timer);
  };
}
