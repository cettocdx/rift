export type SavedPreview = { url: string; port: number };

/** Messages arrive newest first; only completed, successful tool evidence counts. */
export function findSavedPreview(
  messages: Array<{ role: string; parts?: unknown }>,
): SavedPreview | null {
  for (const message of messages) {
    // Legacy text-only messages and partially hydrated history have no parts.
    // They cannot supply preview evidence, but must not break the transcript.
    if (message.role !== "assistant" || !Array.isArray(message.parts)) continue;
    for (const value of [...message.parts].reverse()) {
      if (!value || typeof value !== "object") continue;
      const part = value as {
        type?: string;
        state?: string;
        output?: Partial<SavedPreview> & { ok?: boolean };
      };
      const output = part.output;
      if (
        part.type === "tool-expose_preview" &&
        part.state === "output-available" &&
        output?.ok === true &&
        typeof output.url === "string" &&
        Number.isInteger(output.port) &&
        output.port! >= 1 &&
        output.port! <= 65535
      ) {
        return { url: output.url, port: output.port! };
      }
    }
  }
  return null;
}
