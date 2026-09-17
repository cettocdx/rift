import type { ModelMessage, UIMessage } from "ai";

type RecordValue = Record<string, unknown>;
const isRecord = (value: unknown): value is RecordValue =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function stableJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item) =>
    isRecord(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

/**
 * Project only the last user turn's completed generated tail. The chosen ID is
 * supplied by the durable caller, not generated on each retry. This is a UI
 * persistence projection, never a substitute for the canonical checkpoint.
 *
 * Default AI SDK UI conversion cannot losslessly represent every model part:
 * content/error-json/denied outputs, provider-executed tools and distinct local
 * result metadata need a separate canonical-history path. Return null for
 * those cases or an incomplete tail; never invent a result or flatten evidence.
 */
export function projectCheckpointAssistantMessage({
  messages,
  messageId,
}: {
  messages: ModelMessage[];
  messageId: string;
}): UIMessage | null {
  if (!Array.isArray(messages) || !messageId?.trim()) return null;
  // Checkpoints are JSON-persisted. Clone so filling a tool result never
  // mutates the model history or its nested input/provider metadata objects.
  let history: ModelMessage[];
  try {
    history = JSON.parse(JSON.stringify(messages));
  } catch {
    return null;
  }
  const userIndex = history.findLastIndex(
    (message) => message?.role === "user",
  );
  if (userIndex < 0 || userIndex === history.length - 1) return null;

  const parts: UIMessage["parts"] = [];
  const pending = new Map<
    string,
    { name: string; index: number; providerOptions: unknown }
  >();
  const seen = new Set<string>();
  let resultOrder: string[] = [];
  let resultIndex = 0;
  let sawToolMessage = false;

  for (const message of history.slice(userIndex + 1)) {
    if (
      !message ||
      (message.role !== "assistant" && message.role !== "tool") ||
      message.providerOptions !== undefined
    )
      return null;
    if (message.role === "assistant") {
      if (pending.size) return null;
      resultOrder = [];
      resultIndex = 0;
      sawToolMessage = false;
      parts.push({ type: "step-start" });
      if (typeof message.content === "string") {
        parts.push({ type: "text", text: message.content, state: "done" });
        continue;
      }
      if (!Array.isArray(message.content) || !message.content.length)
        return null;
      for (const source of message.content as unknown[]) {
        if (!isRecord(source)) return null;
        if (
          (source.type === "text" || source.type === "reasoning") &&
          typeof source.text === "string"
        ) {
          parts.push({
            type: source.type,
            text: source.text,
            state: "done",
            ...(source.providerOptions !== undefined
              ? { providerMetadata: source.providerOptions }
              : {}),
          } as UIMessage["parts"][number]);
        } else if (source.type === "tool-call") {
          const { toolCallId, toolName } = source;
          if (
            typeof toolCallId !== "string" ||
            !toolCallId ||
            typeof toolName !== "string" ||
            !toolName ||
            !("input" in source) ||
            seen.has(toolCallId) ||
            source.providerExecuted === true
          )
            return null;
          seen.add(toolCallId);
          resultOrder.push(toolCallId);
          pending.set(toolCallId, {
            name: toolName,
            index: parts.length,
            providerOptions: source.providerOptions,
          });
          parts.push({
            type: `tool-${toolName}`,
            toolCallId,
            input: source.input,
            state: "input-available",
            ...(source.providerExecuted !== undefined
              ? { providerExecuted: source.providerExecuted }
              : {}),
            ...(source.providerOptions !== undefined
              ? { callProviderMetadata: source.providerOptions }
              : {}),
          } as UIMessage["parts"][number]);
        } else return null;
      }
    } else {
      if (
        !Array.isArray(message.content) ||
        !message.content.length ||
        sawToolMessage
      )
        return null;
      sawToolMessage = true;
      for (const source of message.content as unknown[]) {
        if (
          !isRecord(source) ||
          source.type !== "tool-result" ||
          typeof source.toolCallId !== "string"
        )
          return null;
        const call = pending.get(source.toolCallId);
        if (
          !call ||
          call.name !== source.toolName ||
          resultOrder[resultIndex] !== source.toolCallId ||
          stableJson(call.providerOptions) !==
            stableJson(source.providerOptions)
        )
          return null;
        const output = source.output;
        if (!isRecord(output) || output.providerOptions !== undefined)
          return null;
        const previous = parts[call.index];
        if (output.type === "error-text" && typeof output.value === "string") {
          parts[call.index] = {
            ...previous,
            state: "output-error",
            errorText: output.value,
          } as UIMessage["parts"][number];
        } else if (
          (output.type === "text" && typeof output.value === "string") ||
          (output.type === "json" &&
            "value" in output &&
            typeof output.value !== "string")
        ) {
          parts[call.index] = {
            ...previous,
            state: "output-available",
            output: output.value,
          } as UIMessage["parts"][number];
        } else return null;
        pending.delete(source.toolCallId);
        resultIndex += 1;
      }
    }
  }
  return parts.length && !pending.size
    ? { id: messageId, role: "assistant", parts }
    : null;
}
