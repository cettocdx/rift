import type { UIMessageChunk } from "ai";

import {
  diffToolProgress,
  mapOpenCodeToolPart,
  type OpenCodeToolSnapshot,
  type ProgressCursor,
} from "@/lib/opencode/tool-map";
import type { OpenCodeEvent } from "@/lib/opencode/client";

/**
 * Pure state machine: OpenCode `/event` frames → AI SDK `UIMessageChunk`s.
 *
 * OpenCode streams `message.part.delta` (live text/reasoning deltas) and
 * `message.part.updated` (the full, durable part). The chat client only knows
 * AI SDK chunks, so this turns each into `text-*`, `reasoning-*`, `tool-*`,
 * `start-step`/`finish-step` and `data-terminal` chunks — with tool parts
 * renamed through the tool map first so persisted transcripts use RIFT names.
 * Every assistant message OpenCode creates in the turn is flattened into the
 * single RIFT assistant message. It holds no I/O: the driver feeds it events
 * and writes what comes back.
 */

export interface StepFinishInfo {
  reason?: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

export interface TranslatorCallbacks {
  onStepFinish?: (info: StepFinishInfo, toolNamesThisStep: string[]) => void;
  /** Every raw tool snapshot, before mapping (the file bridge listens here). */
  onToolSnapshot?: (snapshot: OpenCodeToolSnapshot) => void;
  onToolCompleted?: (info: { toolName: string; callID: string; ok: boolean; durationMs: number; errorText?: string }) => void;
}

interface TrackedTool {
  status: OpenCodeToolSnapshot["state"]["status"];
  toolName: string;
  cursor?: ProgressCursor;
  startedAt: number;
  terminalSeq: number;
}

type Part = Record<string, unknown> & { id: string; type: string; messageID?: string };

function num(v: unknown, d = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}
function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

export function createEventTranslator(opts: { sendReasoning?: boolean; callbacks?: TranslatorCallbacks } = {}) {
  const sendReasoning = opts.sendReasoning ?? true;
  const cb = opts.callbacks ?? {};

  // Text/reasoning parts we have opened, keyed by part id, with the text emitted so far.
  const openText = new Map<string, { kind: "text" | "reasoning"; emitted: string; closed: boolean }>();
  const tools = new Map<string, TrackedTool>(); // callID -> state
  let toolNamesThisStep: string[] = [];
  let stepOpen = false;
  // OpenCode re-publishes the USER message's parts too; only assistant parts
  // may become UI chunks. Roles arrive on `message.updated`.
  const userMessageIds = new Set<string>();

  function openStepIfNeeded(out: UIMessageChunk[]) {
    if (!stepOpen) {
      out.push({ type: "start-step" });
      stepOpen = true;
      toolNamesThisStep = [];
    }
  }

  function streamPart(out: UIMessageChunk[], part: Part, kind: "text" | "reasoning", fullText: string, ended: boolean) {
    if (kind === "reasoning" && !sendReasoning) return;
    let entry = openText.get(part.id);
    if (!entry) {
      openStepIfNeeded(out);
      entry = { kind, emitted: "", closed: false };
      openText.set(part.id, entry);
      out.push(kind === "text" ? { type: "text-start", id: part.id } : { type: "reasoning-start", id: part.id });
    }
    if (entry.closed) return;
    if (fullText.length > entry.emitted.length && fullText.startsWith(entry.emitted)) {
      const delta = fullText.slice(entry.emitted.length);
      out.push(kind === "text" ? { type: "text-delta", id: part.id, delta } : { type: "reasoning-delta", id: part.id, delta });
      entry.emitted = fullText;
    } else if (fullText !== entry.emitted && !fullText.startsWith(entry.emitted)) {
      // Rewritten text (rare). Emit the whole new text as one delta rather than desync.
      out.push(kind === "text" ? { type: "text-delta", id: part.id, delta: fullText } : { type: "reasoning-delta", id: part.id, delta: fullText });
      entry.emitted = fullText;
    }
    if (ended) {
      entry.closed = true;
      out.push(kind === "text" ? { type: "text-end", id: part.id } : { type: "reasoning-end", id: part.id });
    }
  }

  function handleToolPart(out: UIMessageChunk[], part: Part) {
    const snapshot: OpenCodeToolSnapshot = {
      tool: String(part.tool ?? ""),
      callID: String(part.callID ?? part.id),
      state: asObj(part.state) as OpenCodeToolSnapshot["state"],
    };
    cb.onToolSnapshot?.(snapshot);
    const mapped = mapOpenCodeToolPart(snapshot);
    const status = snapshot.state.status;
    let tracked = tools.get(snapshot.callID);

    if (!tracked) {
      openStepIfNeeded(out);
      tracked = { status: "pending", toolName: mapped.toolName, startedAt: Date.now(), terminalSeq: 0 };
      tools.set(snapshot.callID, tracked);
      toolNamesThisStep.push(mapped.toolName);
      out.push({ type: "tool-input-start", toolCallId: snapshot.callID, toolName: mapped.toolName });
      // pending carries the (possibly partial) input; running/completed carry the full input
      out.push({ type: "tool-input-available", toolCallId: snapshot.callID, toolName: mapped.toolName, input: mapped.input });
    }

    if (status === "running" && (snapshot.tool === "bash" || snapshot.tool === "shell")) {
      const { delta, cursor } = diffToolProgress(tracked.cursor, snapshot);
      tracked.cursor = cursor;
      if (delta) {
        tracked.terminalSeq += 1;
        out.push({
          type: "data-terminal",
          id: `oc-${snapshot.callID}-${tracked.terminalSeq}`,
          data: { terminal: delta, toolCallId: snapshot.callID, action: "exec" },
        } as UIMessageChunk);
      }
    }

    if ((status === "completed" || status === "error") && tracked.status !== "completed" && tracked.status !== "error") {
      if (status === "completed") {
        out.push({ type: "tool-output-available", toolCallId: snapshot.callID, output: mapped.output });
      } else {
        out.push({ type: "tool-output-error", toolCallId: snapshot.callID, errorText: mapped.errorText ?? "Tool failed" });
      }
      cb.onToolCompleted?.({
        toolName: mapped.toolName,
        callID: snapshot.callID,
        ok: status === "completed",
        durationMs: Date.now() - tracked.startedAt,
        errorText: mapped.errorText,
      });
    }
    tracked.status = status;
  }

  function feed(event: OpenCodeEvent): UIMessageChunk[] {
    const out: UIMessageChunk[] = [];
    const props = asObj(event.properties);

    if (event.type === "message.updated") {
      const info = asObj(props.info);
      if (info.role === "user" && typeof info.id === "string") userMessageIds.add(info.id);
      return out;
    }

    if (event.type === "message.part.delta") {
      const partID = String(props.partID ?? "");
      if (typeof props.messageID === "string" && userMessageIds.has(props.messageID)) return out;
      const field = String(props.field ?? "text");
      const delta = typeof props.delta === "string" ? props.delta : "";
      if (!partID || !delta) return out;
      const entry = openText.get(partID);
      // Deltas can arrive before the first `part.updated`; open the part lazily as text.
      const kind: "text" | "reasoning" = entry?.kind ?? (field === "reasoning" ? "reasoning" : "text");
      const emitted = entry?.emitted ?? "";
      streamPart(out, { id: partID, type: kind }, kind, emitted + delta, false);
      return out;
    }

    if (event.type === "message.part.updated") {
      const part = asObj(props.part) as Part;
      if (!part.id || !part.type) return out;
      if (typeof part.messageID === "string" && userMessageIds.has(part.messageID)) return out;
      switch (part.type) {
        case "step-start":
          if (stepOpen) {
            // A new step began without an explicit finish — close the previous one.
            out.push({ type: "finish-step" });
            stepOpen = false;
          }
          openStepIfNeeded(out);
          break;
        case "text":
          streamPart(out, part, "text", String(part.text ?? ""), !!asObj(part.time).end);
          break;
        case "reasoning":
          streamPart(out, part, "reasoning", String(part.text ?? ""), !!asObj(part.time).end);
          break;
        case "tool":
          handleToolPart(out, part);
          break;
        case "step-finish": {
          const tokens = asObj(part.tokens);
          const cache = asObj(tokens.cache);
          const info: StepFinishInfo = {
            reason: typeof part.reason === "string" ? part.reason : undefined,
            cost: num(part.cost),
            tokens: {
              input: num(tokens.input),
              output: num(tokens.output),
              reasoning: num(tokens.reasoning),
              cache: { read: num(cache.read), write: num(cache.write) },
            },
          };
          if (stepOpen) {
            out.push({ type: "finish-step" });
            stepOpen = false;
          }
          cb.onStepFinish?.(info, toolNamesThisStep);
          toolNamesThisStep = [];
          break;
        }
        default:
          break; // file/patch/snapshot/agent/subtask/retry/compaction: no UI chunk
      }
      return out;
    }

    return out;
  }

  /** Close anything still open (call at turn end). */
  function finalize(): UIMessageChunk[] {
    const out: UIMessageChunk[] = [];
    for (const [id, entry] of openText) {
      if (!entry.closed) {
        entry.closed = true;
        out.push(entry.kind === "text" ? { type: "text-end", id } : { type: "reasoning-end", id });
      }
    }
    for (const [callID, t] of tools) {
      if (t.status === "pending" || t.status === "running") {
        out.push({ type: "tool-output-error", toolCallId: callID, errorText: "Tool did not complete." });
        t.status = "error";
      }
    }
    if (stepOpen) {
      out.push({ type: "finish-step" });
      stepOpen = false;
    }
    return out;
  }

  return { feed, finalize };
}

export type EventTranslator = ReturnType<typeof createEventTranslator>;
