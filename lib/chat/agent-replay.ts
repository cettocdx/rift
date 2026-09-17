import type { UIMessage } from "ai";

/** Trigger replays a whole turn; the SDK otherwise appends it to saved parts.
 * Call only after a successful durable resume, before the SDK snapshots the
 * last message. A 204 or failed reconnect leaves the visible answer intact.
 */
export function prepareMessagesForAgentReplay<T extends UIMessage>(
  messages: T[],
  runId: string,
): T[] {
  const last = messages.at(-1);
  if (
    last?.role !== "assistant" ||
    last.id !== runId ||
    last.parts.length === 0
  )
    return messages;
  return [...messages.slice(0, -1), { ...last, parts: [] }];
}
