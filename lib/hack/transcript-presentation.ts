import type { FilePart } from "@/types/file";
import { summarizeTranscriptTools } from "@/lib/chat/transcript-presentation";

export type HackTranscriptItem =
  | { kind: "reason"; text: string; state?: string }
  | { kind: "line"; cls: string; text: string }
  | { kind: "file"; part: FilePart }
  | {
      kind: "tool";
      name: string;
      cmd: string;
      out: string;
      streamOut: string;
      state?: string;
      toolCallId?: string;
      errorText?: string;
      preliminary?: boolean;
      input?: unknown;
      output?: unknown;
    };
export type HackToolItem = Extract<HackTranscriptItem, { kind: "tool" }>;

/** These are durable producer outcomes, not guesses from the model's prose. */
export function hackCutoffMessage(
  finishReason: string | undefined,
): string | undefined {
  switch (finishReason) {
    case undefined:
    case "stop":
    case "tool-calls":
      return undefined;
    case "timeout":
    case "preemptive-timeout":
      return "The run stopped at its time limit before completing this response.";
    case "context-limit":
      return "The run stopped at its context limit before completing this response.";
    case "budget-exhausted":
      return "The run stopped because its usage budget was exhausted.";
    case "doom-loop":
      return "The run stopped after repeating actions without progress.";
    default:
      // Unknown explicit outcomes are not completion evidence. Missing legacy
      // metadata remains compatible with the canonical completed outcomes.
      return finishReason.trim()
        ? "The run ended without confirming a complete response."
        : undefined;
  }
}
export function hackToolSummary(tool: HackToolItem, running: boolean) {
  return summarizeTranscriptTools(
    [
      {
        type: `tool-${tool.name}`,
        input: tool.input,
        output: tool.output,
        errorText: tool.errorText,
        state: tool.preliminary ? "input-available" : tool.state,
      },
    ],
    running ? "streaming" : "ready",
  );
}
/** Trailing prose is the response candidate; the run outcome determines whether
 * it completed. Earlier prose remains an update in the work log. */
export function hackResponseRange(
  items: readonly HackTranscriptItem[],
  running: boolean,
) {
  const end = items.findLastIndex((item) => item.kind === "line");
  if (
    end < 0 ||
    (!running && end < items.findLastIndex((item) => item.kind === "tool"))
  )
    return null;
  let start = end;
  while (start > 0 && items[start - 1].kind === "line") start--;
  const text = items
    .slice(start, end + 1)
    .map((item) => (item.kind === "line" ? item.text : ""))
    .join("\n\n");
  return { start, end, text };
}
export function plainToolOutput(text: string) {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

export function redactHackCommand(command: string): string {
  return command
    .replace(/(https?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(
      /(\b(?:api[_-]?key|access[_-]?token|password|secret)\b\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]",
    )
    .replace(
      /(--(?:api[-_]?key|token|password|secret)(?:=|\s+))(?:"[^"]*"|'[^']*'|[^\s]+)/gi,
      "$1[redacted]",
    );
}
