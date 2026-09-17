import type { ModelMessage } from "ai";

// Leave room below Convex's document limit for indexes and run ownership fields.
const MAX_CHECKPOINT_BYTES = 750_000;

export class AgentCheckpointTooLargeError extends Error {
  constructor() {
    super("Checkpoint history is too large");
    this.name = "AgentCheckpointTooLargeError";
  }
}

export type AgentStepCheckpoint = {
  version: 1;
  /** Absolute, one-based completed step, including any resumed prefix. */
  stepIndex: number;
  finishReason: string;
  messagesJson: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function assertClosedHistory(value: unknown): asserts value is ModelMessage[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Checkpoint history is invalid");
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  for (const message of value) {
    if (
      !isRecord(message) ||
      !["user", "system", "assistant", "tool"].includes(String(message.role)) ||
      !(typeof message.content === "string" || Array.isArray(message.content))
    )
      throw new Error("Checkpoint message is invalid");
    if (
      pending.size &&
      (message.role === "user" ||
        message.role === "system" ||
        message.role === "assistant")
    )
      throw new Error("Checkpoint has unresolved tools before another turn");
    if (!Array.isArray(message.content)) {
      if (message.role === "tool")
        throw new Error("Checkpoint tool content is invalid");
      continue;
    }
    for (const part of message.content) {
      if (!isRecord(part) || typeof part.type !== "string")
        throw new Error("Checkpoint message part is invalid");
      if (
        part.type === "tool-approval-request" ||
        part.type === "tool-approval-response"
      )
        throw new Error("Checkpoint contains unresolved approval state");
      if (part.type !== "tool-call" && part.type !== "tool-result") continue;
      const { toolCallId, toolName } = part;
      if (
        typeof toolCallId !== "string" ||
        !toolCallId ||
        typeof toolName !== "string" ||
        !toolName
      )
        throw new Error("Checkpoint tool identity is invalid");
      if (part.type === "tool-call") {
        if (message.role !== "assistant" || !("input" in part))
          throw new Error("Checkpoint tool call is invalid");
        if (seen.has(toolCallId))
          throw new Error("Checkpoint has duplicate tool call IDs");
        seen.add(toolCallId);
        pending.set(toolCallId, toolName);
      } else {
        if (
          !("output" in part) ||
          !["tool", "assistant"].includes(String(message.role))
        )
          throw new Error("Checkpoint tool result is invalid");
        if (pending.get(toolCallId) !== toolName)
          throw new Error("Checkpoint has an orphan or mismatched tool result");
        pending.delete(toolCallId);
      }
    }
    // Tool results must close before another turn, regardless of content shape.
    if ((message.role === "user" || message.role === "system") && pending.size)
      throw new Error("Checkpoint has unresolved tools before another turn");
  }
  if (pending.size) throw new Error("Checkpoint has unresolved tool calls");
}

function assertEnvelope(checkpoint: AgentStepCheckpoint) {
  if (
    checkpoint.version !== 1 ||
    !Number.isSafeInteger(checkpoint.stepIndex) ||
    checkpoint.stepIndex < 1 ||
    typeof checkpoint.finishReason !== "string" ||
    !checkpoint.finishReason ||
    typeof checkpoint.messagesJson !== "string"
  )
    throw new Error("Checkpoint metadata is invalid");
  if (
    new TextEncoder().encode(checkpoint.messagesJson).byteLength >
    MAX_CHECKPOINT_BYTES
  )
    throw new AgentCheckpointTooLargeError();
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 4096)
    text += String.fromCharCode(...bytes.subarray(i, i + 4096));
  return btoa(text);
}

/**
 * SDK response.messages is the cumulative generated tail, NOT this step's delta.
 * Always combine it with the same initial model history once. No UI compaction,
 * synthetic tool results, or dropped provider reasoning/signature metadata.
 */
export function createCompletedStepCheckpoint(args: {
  initialMessages: ModelMessage[];
  responseMessages: ModelMessage[];
  stepIndex: number;
  finishReason: string;
}): AgentStepCheckpoint {
  if (
    args.responseMessages.some(
      (message) => !["assistant", "tool"].includes(message.role),
    )
  )
    throw new Error("Checkpoint response must contain assistant/tool messages");
  const messagesJson = JSON.stringify(
    [...args.initialMessages, ...args.responseMessages],
    function (key, value: unknown) {
      // Buffer.toJSON runs before the replacer; inspect the original value too.
      const original: unknown = (this as Record<string, unknown>)[key];
      if (original instanceof Uint8Array) return base64(original);
      if (original instanceof ArrayBuffer)
        return base64(new Uint8Array(original));
      return value;
    },
  );
  const checkpoint: AgentStepCheckpoint = {
    version: 1,
    stepIndex: args.stepIndex,
    finishReason: args.finishReason,
    messagesJson,
  };
  restoreCompletedStepCheckpoint(checkpoint);
  return checkpoint;
}

/**
 * This is transcript recovery, not exactly-once execution. A durable begin-step
 * marker newer than the completed snapshot means effects may already have run;
 * callers must pause/reconcile, never replay those missing tool calls blindly.
 * Ownership, cancellation intent and monotonic writes belong to the DB fence.
 */
export function restoreCompletedStepCheckpoint(
  checkpoint: AgentStepCheckpoint,
  options: { inFlightStepIndex?: number } = {},
) {
  assertEnvelope(checkpoint);
  const messages: unknown = JSON.parse(checkpoint.messagesJson);
  assertClosedHistory(messages);
  const { inFlightStepIndex } = options;
  if (
    inFlightStepIndex !== undefined &&
    (!Number.isSafeInteger(inFlightStepIndex) || inFlightStepIndex < 0)
  )
    throw new Error("Checkpoint in-flight step is invalid");
  const reason =
    inFlightStepIndex !== undefined && inFlightStepIndex > checkpoint.stepIndex
      ? "in-flight-step"
      : checkpoint.finishReason === "stop"
        ? "already-finished"
        : checkpoint.finishReason === "tool-calls"
          ? "ready"
          : "non-continuable-finish";
  return {
    messages,
    stepIndex: checkpoint.stepIndex,
    finishReason: checkpoint.finishReason,
    resumeAllowed: reason === "ready",
    reason,
  } as const;
}
