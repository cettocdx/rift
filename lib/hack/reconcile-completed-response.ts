type TranscriptMessage = {
  id?: string;
  role: string;
  parts?: readonly { type?: string; text?: string }[];
};

function hasTrailingResponse(message: TranscriptMessage): boolean {
  const parts = message.parts ?? [];
  const text = parts.findLastIndex(
    (part) => part.type === "text" && Boolean(part.text?.trim()),
  );
  return (
    text >= 0 &&
    text >
      parts.findLastIndex((part) => part.type?.startsWith("tool-") === true)
  );
}

/** Recover presentation from an already-saved answer, never restart work.
 * Only the same assistant message can replace an incomplete local snapshot.
 * Older history must not remove a newly submitted user turn or active output.
 */
export function reconcileCompletedResponses<T extends TranscriptMessage>(
  local: T[],
  saved: readonly T[],
  settled: boolean,
): T[] {
  if (!settled || saved.length === 0) return local;
  const completed = new Map(
    saved
      .filter(
        (message) =>
          message.id &&
          message.role === "assistant" &&
          hasTrailingResponse(message),
      )
      .map((message) => [message.id, message]),
  );
  let changed = false;
  const result = local.map((message) => {
    if (
      !message.id ||
      message.role !== "assistant" ||
      hasTrailingResponse(message)
    )
      return message;
    const replacement = completed.get(message.id);
    if (!replacement) return message;
    changed = true;
    return replacement;
  });
  return changed ? result : local;
}
