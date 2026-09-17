import type { UIMessage } from "ai";

/** Persistent requests were saved by the route; temporary requests were not. */
export function agentWorkerIncomingMessages(
  temporary: boolean | undefined,
  messages: UIMessage[],
): UIMessage[] {
  return temporary ? messages : [];
}
