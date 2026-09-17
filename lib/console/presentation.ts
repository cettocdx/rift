import type { UIMessage } from "ai";
import type { ChatStatus } from "@/types/chat";
import type { ConsoleEntry } from "@/packages/console/src/protocol";
import {
  summarizeTranscriptTools,
  type TranscriptToolPart,
} from "@/lib/chat/transcript-presentation";

/** Terminal control sequences are data, never instructions to the emulator. */
export function consoleText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "");
}

/** A compact projection of the existing transcript, not a second agent log. */
export function consoleEntries(
  messages: readonly UIMessage[],
  status: ChatStatus,
): ConsoleEntry[] {
  const entries: ConsoleEntry[] = [];
  for (const message of messages.slice(-60)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    let tools: TranscriptToolPart[] = [];
    let groupIndex = 0;
    const flushTools = () => {
      if (!tools.length) return;
      const summary = summarizeTranscriptTools(tools, status);
      entries.push({
        id: `${message.id}:tools:${groupIndex++}`,
        kind: summary.failed ? "error" : "activity",
        text: consoleText(summary.label),
      });
      tools = [];
    };
    message.parts.forEach((part, index) => {
      if (part.type.startsWith("tool-") || part.type === "dynamic-tool") {
        tools.push(part as TranscriptToolPart);
        return;
      }
      if (part.type === "text" && part.text.trim()) {
        flushTools();
        entries.push({
          id: `${message.id}:${index}`,
          kind: message.role as "user" | "assistant",
          text: consoleText(part.text),
        });
      } else if (part.type === "reasoning") {
        // Mirror the public work indicator without manufacturing a thought log.
        flushTools();
        entries.push({
          id: `${message.id}:${index}`,
          kind: "activity",
          text: part.state === "streaming" ? "Thinking…" : "Reasoning complete",
        });
      } else if (part.type === "file") {
        flushTools();
        entries.push({
          id: `${message.id}:${index}`,
          kind: "activity",
          text: `File · ${consoleText(part.filename ?? "Attachment")}`,
        });
      }
    });
    flushTools();
  }
  // Preserve the newest output and leave a visible marker for bounded history.
  const bounded: ConsoleEntry[] = [];
  let remaining = 100_000;
  for (const entry of entries.slice(-300).reverse()) {
    if (remaining <= 0) break;
    const text = entry.text.slice(-Math.min(remaining, 60_000));
    bounded.push({
      ...entry,
      text: text.length < entry.text.length ? `…\n${text}` : text,
    });
    remaining -= text.length;
  }
  bounded.reverse();
  if (bounded.length < entries.length)
    bounded.unshift({
      id: "older-history",
      kind: "activity",
      text: "Earlier messages are available in the main chat.",
    });
  return bounded;
}
