import type { ModelMessage } from "ai";

export type SteeringInsertion = {
  id: string;
  sequence: number;
  afterResponseMessageCount: number;
  text: string;
};
export type SteeringHistoryInput = {
  initialMessages: readonly ModelMessage[];
  responseMessages: readonly ModelMessage[];
  insertions: readonly SteeringInsertion[];
  includedThroughSequence?: number;
};

/**
 * Rebuild canonical history from a cumulative generated tail, for both model
 * requests and checkpoints. The trusted watermark describes instructions
 * already present in initialMessages. Delivery/authentication belongs to the
 * caller; this function neither consumes inbox entries nor executes tools.
 *
 * Message objects are preserved by reference, including provider metadata and
 * binary content. Callers must supply immutable canonical snapshots.
 */
export function buildSteeredHistory(input: SteeringHistoryInput) {
  const watermark = input.includedThroughSequence ?? 0;
  if (!Number.isSafeInteger(watermark) || watermark < 0) {
    throw new Error("Invalid steering watermark");
  }
  const byId = new Map<string, SteeringInsertion>();
  const bySequence = new Map<number, string>();
  for (const insertion of input.insertions) {
    if (
      !insertion.id ||
      insertion.id.trim() !== insertion.id ||
      insertion.id.length > 200
    ) {
      throw new Error("Invalid steering identity");
    }
    if (!Number.isSafeInteger(insertion.sequence) || insertion.sequence < 1) {
      throw new Error("Invalid steering sequence");
    }
    if (!insertion.text.trim()) throw new Error("Invalid steering text");
    const previous = byId.get(insertion.id);
    if (previous) {
      if (
        previous.sequence !== insertion.sequence ||
        previous.afterResponseMessageCount !==
          insertion.afterResponseMessageCount ||
        previous.text !== insertion.text
      ) {
        throw new Error("Conflicting steering receipt");
      }
      continue;
    }
    if (bySequence.has(insertion.sequence)) {
      throw new Error("Conflicting steering sequence");
    }
    byId.set(insertion.id, insertion);
    bySequence.set(insertion.sequence, insertion.id);
  }
  const pendingInsertions = [...byId.values()]
    .filter((insertion) => insertion.sequence > watermark)
    .sort((a, b) => a.sequence - b.sequence);
  let previousOffset = 0;
  for (const insertion of pendingInsertions) {
    const offset = insertion.afterResponseMessageCount;
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset > input.responseMessages.length
    ) {
      throw new Error("Invalid steering response offset");
    }
    if (offset < previousOffset)
      throw new Error("Steering response offsets are out of order");
    previousOffset = offset;
  }

  const pendingTools = new Map<string, string>();
  const seenTools = new Set<string>();
  const assertClosed = () => {
    if (pendingTools.size)
      throw new Error("Steering history has unresolved tools");
  };
  const inspectMessage = (message: ModelMessage) => {
    // Every new assistant message requires the previous tool batch to be
    // closed, whether its content is a string or an array. Calls/results
    // executed by the provider within this same message are still processed
    // together below.
    if (
      message.role === "user" ||
      message.role === "system" ||
      message.role === "assistant"
    ) {
      assertClosed();
    }
    if (!Array.isArray(message.content)) return;
    for (const part of message.content) {
      if (
        part.type === "tool-approval-request" ||
        part.type === "tool-approval-response"
      ) {
        throw new Error("Steering history has unresolved approval state");
      }
      if (part.type !== "tool-call" && part.type !== "tool-result") continue;
      if (!part.toolCallId || !part.toolName)
        throw new Error("Invalid tool identity");
      if (part.type === "tool-call") {
        if (message.role !== "assistant" || !("input" in part))
          throw new Error("Invalid tool call");
        if (seenTools.has(part.toolCallId))
          throw new Error("Duplicate tool call identity");
        seenTools.add(part.toolCallId);
        pendingTools.set(part.toolCallId, part.toolName);
      } else {
        if (
          (message.role !== "tool" && message.role !== "assistant") ||
          !("output" in part) ||
          pendingTools.get(part.toolCallId) !== part.toolName
        ) {
          throw new Error("Orphan or mismatched tool result");
        }
        pendingTools.delete(part.toolCallId);
      }
    }
  };

  const messages: ModelMessage[] = [];
  for (const message of input.initialMessages) {
    inspectMessage(message);
    messages.push(message);
  }
  assertClosed();
  const insertedIds: string[] = [];
  let nextInsertion = 0;
  const insertAt = (offset: number) => {
    while (
      pendingInsertions[nextInsertion]?.afterResponseMessageCount === offset
    ) {
      assertClosed();
      const insertion = pendingInsertions[nextInsertion++];
      messages.push({ role: "user", content: insertion.text });
      insertedIds.push(insertion.id);
    }
  };
  insertAt(0);
  input.responseMessages.forEach((message, index) => {
    if (message.role !== "assistant" && message.role !== "tool") {
      throw new Error(
        "Generated response must contain only assistant/tool messages",
      );
    }
    inspectMessage(message);
    messages.push(message);
    insertAt(index + 1);
  });
  assertClosed();
  return {
    messages,
    insertedIds,
    includedThroughSequence: pendingInsertions.at(-1)?.sequence ?? watermark,
  };
}
