import type { ChatStatus } from "@/types";

export type ReasoningStatePart = {
  type: string;
  text?: string;
  state?: string;
};

export function collectReasoningRunText(
  parts: readonly ReasoningStatePart[],
  startIndex: number,
): string {
  const text: string[] = [];
  for (let index = startIndex; parts[index]?.type === "reasoning"; index++) {
    text.push(parts[index].text ?? "");
  }
  return text.join("");
}

export function hasVisibleReasoningText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && !/^(?:\[REDACTED\]\s*)+$/.test(trimmed);
}

export function isReasoningRunStreaming({
  parts,
  partIndex,
  status,
  isLastMessage,
}: {
  parts: readonly ReasoningStatePart[];
  partIndex: number;
  status: ChatStatus;
  isLastMessage?: boolean;
}): boolean {
  if (!isLastMessage || (status !== "streaming" && status !== "submitted")) {
    return false;
  }
  let endIndex = partIndex;
  if (parts[endIndex]?.type !== "reasoning") return false;
  while (parts[endIndex + 1]?.type === "reasoning") endIndex += 1;
  if (parts[endIndex].state === "done") return false;

  // Heartbeats, usage and step markers can follow an in-progress text part.
  // Only visible subsequent work means that the reasoning phase has moved on.
  return !parts.slice(endIndex + 1).some((part) => {
    if (part.type.startsWith("data-") && part.type !== "data-summarization") {
      return false;
    }
    return !["step-start", "finish-step"].includes(part.type);
  });
}

/** Mirrors the disclosure's visibility so the generic activity row can stay
 * visible when the provider sends no readable reasoning. */
export function hasVisibleLiveReasoning(
  parts: readonly ReasoningStatePart[],
  status: ChatStatus,
  isLastMessage: boolean,
): boolean {
  return parts.some(
    (part, partIndex) =>
      part.type === "reasoning" &&
      parts[partIndex - 1]?.type !== "reasoning" &&
      hasVisibleReasoningText(collectReasoningRunText(parts, partIndex)) &&
      isReasoningRunStreaming({ parts, partIndex, status, isLastMessage }),
  );
}
