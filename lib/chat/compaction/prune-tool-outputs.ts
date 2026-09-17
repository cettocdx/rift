import type { UIMessage } from "ai";
import { safeCountTokens } from "@/lib/token-utils";

/**
 * Default rolling token budget for tool outputs (protection window).
 * Tool outputs newer than this budget are kept intact; older ones are
 * replaced with compact one-line placeholders. 40 000 tokens ≈ ~30K words,
 * enough to keep the most recent tool interactions fully detailed.
 */
export const TOOL_OUTPUT_TOKEN_BUDGET = 40_000;

/**
 * Minimum token savings required to justify pruning.
 * If pruning would save fewer tokens than this, skip it entirely —
 * the overhead of replacing outputs isn't worth the small savings.
 * Matches OpenCode's PRUNE_MINIMUM threshold.
 */
const PRUNE_MINIMUM_SAVINGS = 20_000;

/**
 * Tools whose outputs should never be pruned. These contain state
 * or instructions that the agent needs to reference throughout the
 * conversation regardless of age.
 */
const PROTECTED_TOOLS = new Set([
  "todo_write",
  "create_note",
  "list_notes",
  "update_note",
  "delete_note",
  // These outputs are user deliverables, not disposable execution logs. Their
  // durable file IDs must survive long conversations and storage compaction.
  "generate_image",
  "generate_video",
]);

const TOOL_TYPE_PREFIX = "tool-";

export interface PruneResult {
  messages: UIMessage[];
  prunedCount: number;
  tokensSaved: number;
  /** Total tokens across all eligible (non-protected, non-pruned) tool outputs */
  totalToolOutputTokens: number;
  /** Number of tool output parts evaluated */
  toolOutputCount: number;
  /** Why pruning was skipped (null if pruning occurred) */
  skipReason:
    | "no-tool-outputs"
    | "within-budget"
    | "below-minimum-savings"
    | null;
}

/**
 * A piece of evidence lifted out of a message before it was shrunk.
 *
 * Compaction used to be destructive: the only way it made a message fit
 * Convex's 1 MiB document cap was by overwriting tool output with a one-line
 * placeholder, so the terminal output a user watched stream in was gone for
 * good on reload. The content is now handed back here so the caller can store
 * it beside the message instead of on top of it.
 */
export interface OffloadedEvidence {
  toolCallId?: string;
  toolName: string;
  kind: "terminal_output" | "tool_output" | "tool_input";
  content: string;
  command?: string;
  exitCode?: number;
  startedAt?: number;
  endedAt?: number;
  durationMs?: number;
}

export interface StorageCompactionResult<T extends UIMessage = UIMessage> {
  message: T;
  compacted: boolean;
  beforeSizeBytes: number;
  afterSizeBytes: number;
  strippedUiOnlyFields: boolean;
  prunedCount: number;
  /** Content removed from the message that the caller should persist. */
  offloaded: OffloadedEvidence[];
  /** Number of streamed terminal parts folded into `offloaded`. */
  strippedTerminalParts: number;
  /** Tool INPUT strings excerpted to make the message fit. */
  excerptedInputs: number;
  /** False means even the last pass could not get under the limit. */
  fitsSoftLimit: boolean;
}

// Text is also stored in the searchable content field. Reserve room for that
// duplicate plus document metadata and the full-history attachment.
const STORAGE_MESSAGE_SOFT_LIMIT_BYTES = 400 * 1024;
const STORAGE_TOOL_OUTPUT_TOKEN_BUDGET = 20_000;
/**
 * Below this, a tool input string is not worth excerpting: the placeholder and
 * its offload row would cost more than the string saves.
 */
const STORAGE_INPUT_STRING_MIN_BYTES = 2_000;
/** How much of an excerpted input survives inline, at each end. */
const STORAGE_INPUT_EXCERPT_HEAD_CHARS = 600;
const STORAGE_INPUT_EXCERPT_TAIL_CHARS = 200;
const STORAGE_REASONING_CHAR_BUDGET = 32_000;
const STORAGE_REASONING_PART_CHAR_LIMIT = 8_000;
const STORAGE_COMPACTED_REASONING_PREFIX =
  "[Earlier reasoning compacted for storage]\n\n";

// ---------------------------------------------------------------------------
// Placeholder builders per tool type
// ---------------------------------------------------------------------------

interface ToolPart {
  type: string;
  toolCallId?: string;
  state?: string;
  input?: any;
  output?: any;
}

const MODEL_TOOL_OUTPUT_TYPES = new Set([
  "text",
  "json",
  "execution-denied",
  "error-text",
  "error-json",
  "content",
]);

const isModelToolResultOutput = (
  output: unknown,
): output is { type: string; value?: unknown; reason?: unknown } =>
  typeof output === "object" &&
  output !== null &&
  "type" in output &&
  typeof output.type === "string" &&
  MODEL_TOOL_OUTPUT_TYPES.has(output.type);

const unwrapModelToolResultOutput = (output: unknown): unknown => {
  if (!isModelToolResultOutput(output)) return output;
  if (output.type === "execution-denied") return output.reason;
  return "value" in output ? output.value : output;
};

const compactText = (value: unknown, maxLength: number): string => {
  const normalized =
    typeof value === "string"
      ? value.replace(/\s+/g, " ").trim()
      : value == null
        ? ""
        : String(value);
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
};

const isCompactedModelToolOutput = (output: unknown): boolean => {
  const value = unwrapModelToolResultOutput(output);
  return (
    typeof value === "string" &&
    /^\[(?:Terminal|File|Search|Files|URL|Subagent|Tool):/.test(value)
  );
};

/**
 * Builds a compact placeholder string given the tool name, its input args, and output.
 * Shared by both UIMessage and ModelMessage pruners.
 */
const buildPlaceholderFromParts = (
  toolName: string,
  input: any,
  output: any,
): string => {
  const normalizedOutput = unwrapModelToolResultOutput(output) as any;

  switch (toolName) {
    case "run_terminal_cmd": {
      const cmd = input?.command ?? "unknown";
      const shortCmd = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
      const exitCode =
        normalizedOutput?.exitCode ?? normalizedOutput?.exit_code ?? "?";
      return `[Terminal: ran '${shortCmd}', exit code ${exitCode}]`;
    }

    case "file": {
      const action = input?.action ?? "unknown";
      const path = input?.path ?? input?.file_path ?? "unknown";
      if (action === "read") {
        const content = normalizedOutput?.content ?? normalizedOutput ?? "";
        const lines =
          typeof content === "string" ? content.split("\n").length : "?";
        return `[File: read ${path} (${lines} lines)]`;
      }
      return `[File: ${action} ${path}]`;
    }

    case "match": {
      let count = "?";
      let files = "";
      if (Array.isArray(normalizedOutput)) {
        count = String(normalizedOutput.length);
        const fileSet = new Set(
          normalizedOutput
            .map((m: any) => m.file ?? m.path ?? m.filename)
            .filter(Boolean),
        );
        files =
          fileSet.size > 0 ? ` in ${[...fileSet].slice(0, 5).join(", ")}` : "";
        if (fileSet.size > 5) files += ` (+${fileSet.size - 5} more)`;
      } else if (normalizedOutput && typeof normalizedOutput === "object") {
        const results =
          normalizedOutput.results ?? normalizedOutput.matches ?? [];
        count = Array.isArray(results) ? String(results.length) : "?";
      }
      return `[Match: ${count} results${files}]`;
    }

    case "web_search":
    case "web": {
      const query = input?.query ?? "unknown";
      return `[Search: '${query}']`;
    }

    case "get_terminal_files": {
      const n = Array.isArray(normalizedOutput) ? normalizedOutput.length : "?";
      return `[Files: retrieved ${n} files]`;
    }

    case "open_url":
    case "browse_url": {
      const url = input?.url ?? "unknown";
      return `[URL: opened ${url}]`;
    }

    case "delegate_task": {
      const name = compactText(
        normalizedOutput?.agent?.name ?? input?.name ?? "specialist",
        48,
      );
      const summary = compactText(
        normalizedOutput?.summary ??
          normalizedOutput?.error ??
          "completed without a summary",
        220,
      );
      return `[Subagent: ${name} — ${summary}]`;
    }

    case "search": {
      const si = (input ?? {}) as { kind?: string; pattern?: string };
      const so = (output ?? {}) as { count?: number };
      const sn = typeof so.count === "number" ? `${so.count} ` : "";
      return `[${si.kind === "glob" ? "Glob" : "Grep"}: '${si.pattern ?? ""}' → ${sn}results]`;
    }

    case "apply_patch": {
      const po = (output ?? {}) as { files?: unknown[] };
      const pn = Array.isArray(po.files) ? po.files.length : 0;
      return `[Patch: ${pn} file${pn === 1 ? "" : "s"}]`;
    }

    default:
      return `[Tool: ${toolName} completed]`;
  }
};

/** Builds a placeholder from a UIMessage ToolPart */
const buildPlaceholder = (part: ToolPart): string => {
  const toolName = part.type.slice(TOOL_TYPE_PREFIX.length);
  return buildPlaceholderFromParts(toolName, part.input, part.output);
};

// ---------------------------------------------------------------------------
// Token counting for a tool output
// ---------------------------------------------------------------------------

const countOutputTokens = (output: unknown): number => {
  const normalizedOutput = unwrapModelToolResultOutput(output);
  if (normalizedOutput == null) return 0;
  if (typeof normalizedOutput === "string") {
    return safeCountTokens(normalizedOutput);
  }
  return safeCountTokens(JSON.stringify(normalizedOutput));
};

export const estimateSerializedSizeBytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

const stripBulkyOutputFields = (part: ToolPart): ToolPart => {
  if (!part || typeof part !== "object") return part;
  const output = part.output;
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return part;
  }

  if (part.type === "tool-file") {
    const { originalContent, modifiedContent, ...restOutput } =
      output as Record<string, unknown>;

    if (originalContent !== undefined || modifiedContent !== undefined) {
      return { ...part, output: restOutput };
    }
  }

  if (part.type === "tool-update_note") {
    const { original, modified, ...restOutput } = output as Record<
      string,
      unknown
    >;

    if (original !== undefined || modified !== undefined) {
      return { ...part, output: restOutput };
    }
  }

  if (
    part.type === "tool-run_terminal_cmd" ||
    part.type === "tool-interact_terminal_session"
  ) {
    const { rawSnapshot, ...restOutput } = output as Record<string, unknown>;

    if (rawSnapshot !== undefined) {
      return { ...part, output: restOutput };
    }
  }

  return part;
};

/**
 * Every long string inside a tool call's INPUT, with the path to reach it.
 *
 * Inputs were the blind spot that made storage compaction unable to converge.
 * Every other pass here trims `output`, and for a Build run the input is where
 * the bulk actually lives: the `file` tool carries a whole file body in
 * `input.text`, and an edit carries both halves in `input.edits[].find/.replace`.
 * Sixty file writes is ~900KB that nothing could shrink, which is how a message
 * still measured 1.99MB after five reduction passes and was refused by a
 * database whose document limit is 1MB -- taking an hour of finished work with
 * it. Walking the input generically (rather than naming `file.text`) means a
 * tool added next month is covered without anyone remembering to come here.
 */
interface InputStringRef {
  path: (string | number)[];
  value: string;
  bytes: number;
}

const collectInputStrings = (
  value: unknown,
  path: (string | number)[] = [],
  found: InputStringRef[] = [],
): InputStringRef[] => {
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value).byteLength;
    if (bytes >= STORAGE_INPUT_STRING_MIN_BYTES) {
      found.push({ path, value, bytes });
    }
    return found;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      collectInputStrings(entry, [...path, index], found),
    );
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      collectInputStrings(entry, [...path, key], found);
    }
  }
  return found;
};

/** Immutably replace the value at `path`, cloning only the spine. */
const setAtPath = (
  target: unknown,
  path: (string | number)[],
  next: unknown,
): unknown => {
  if (path.length === 0) return next;
  const [head, ...rest] = path;
  if (Array.isArray(target)) {
    const copy = target.slice();
    copy[head as number] = setAtPath(copy[head as number], rest, next);
    return copy;
  }
  const copy = { ...(target as Record<string, unknown>) };
  copy[head as string] = setAtPath(copy[head as string], rest, next);
  return copy;
};

const excerptInputString = (value: string): string => {
  const head = value.slice(0, STORAGE_INPUT_EXCERPT_HEAD_CHARS);
  const tail = value.slice(-STORAGE_INPUT_EXCERPT_TAIL_CHARS);
  const omitted = value.length - head.length - tail.length;
  return `${head}\n\n[... ${omitted.toLocaleString("en-US")} characters moved to run evidence ...]\n\n${tail}`;
};

/**
 * The pass that guarantees the message fits: excerpt tool INPUT strings,
 * largest first, until the payload is under the limit.
 *
 * Largest-first is what makes this both cheap and gentle -- one 400KB file body
 * usually buys the whole budget, so a run's smaller inputs stay whole. Nothing
 * is destroyed: every excerpted string goes to `offloaded` and is written to
 * the run's evidence rows beside the message.
 */
const excerptBulkyToolInputs = (
  parts: UIMessage["parts"],
  softLimitBytes: number,
  currentSizeBytes: number,
): {
  parts: UIMessage["parts"];
  offloaded: OffloadedEvidence[];
  excerptedCount: number;
} => {
  const candidates: (InputStringRef & { partIndex: number })[] = [];
  parts.forEach((part, partIndex) => {
    const toolPart = part as ToolPart;
    if (!toolPart?.type?.startsWith(TOOL_TYPE_PREFIX)) return;
    if (toolPart.input === undefined) return;
    for (const ref of collectInputStrings(toolPart.input)) {
      candidates.push({ ...ref, partIndex });
    }
  });

  if (candidates.length === 0) {
    return { parts, offloaded: [], excerptedCount: 0 };
  }

  candidates.sort((a, b) => b.bytes - a.bytes);

  const nextParts = parts.slice();
  const offloaded: OffloadedEvidence[] = [];
  let projectedBytes = currentSizeBytes;
  let excerptedCount = 0;

  for (const candidate of candidates) {
    if (projectedBytes <= softLimitBytes) break;
    const excerpt = excerptInputString(candidate.value);
    const excerptBytes = new TextEncoder().encode(excerpt).byteLength;
    if (excerptBytes >= candidate.bytes) continue;

    const toolPart = nextParts[candidate.partIndex] as ToolPart;
    nextParts[candidate.partIndex] = {
      ...toolPart,
      input: setAtPath(toolPart.input, candidate.path, excerpt),
    } as UIMessage["parts"][number];

    offloaded.push({
      toolCallId: toolPart.toolCallId,
      toolName: toolPart.type.slice(TOOL_TYPE_PREFIX.length),
      kind: "tool_input",
      content: candidate.value,
    });
    projectedBytes -= candidate.bytes - excerptBytes;
    excerptedCount += 1;
  }

  return { parts: nextParts, offloaded, excerptedCount };
};

const compactReasoningParts = (
  parts: UIMessage["parts"],
): UIMessage["parts"] => {
  let remainingReasoningChars = STORAGE_REASONING_CHAR_BUDGET;

  const compacted = parts
    .slice()
    .reverse()
    .map((part) => {
      if (part?.type !== "reasoning") return part;

      const text = typeof part.text === "string" ? part.text : "";
      if (!text.trim()) return null;
      if (remainingReasoningChars <= 0) return null;

      const charLimit = Math.min(
        remainingReasoningChars,
        STORAGE_REASONING_PART_CHAR_LIMIT,
      );
      remainingReasoningChars -= Math.min(text.length, charLimit);

      if (text.length <= charLimit) return part;

      const prefixBudget = Math.min(
        STORAGE_COMPACTED_REASONING_PREFIX.length,
        charLimit,
      );
      const tailBudget = Math.max(0, charLimit - prefixBudget);

      return {
        ...part,
        text: `${STORAGE_COMPACTED_REASONING_PREFIX.slice(
          0,
          prefixBudget,
        )}${tailBudget > 0 ? text.slice(-tailBudget) : ""}`,
      };
    })
    .filter((part): part is UIMessage["parts"][number] => part !== null)
    .reverse();

  return compacted;
};

/**
 * Folds streamed `data-terminal` parts into one evidence blob per tool call and
 * removes them from the message.
 *
 * These carry the raw bytes the live terminal rendered. Each emit is its own
 * part with its own id, so a single long-running command can leave hundreds of
 * them on one message -- they were the largest single contributor to assistant
 * messages approaching the 1 MiB cap, and nothing in the compaction pipeline
 * could shrink them. The final tool result already holds the same output, so
 * removing them loses nothing once the text is preserved here.
 */
const extractStreamedTerminalParts = (
  parts: UIMessage["parts"],
): {
  parts: UIMessage["parts"];
  evidence: OffloadedEvidence[];
  strippedCount: number;
} => {
  const byToolCall = new Map<string, string[]>();
  let strippedCount = 0;

  const remaining = parts.filter((part) => {
    if ((part as { type?: string })?.type !== "data-terminal") return true;
    const data = (part as { data?: { terminal?: unknown; toolCallId?: unknown } })
      .data;
    const text = typeof data?.terminal === "string" ? data.terminal : "";
    const toolCallId =
      typeof data?.toolCallId === "string" ? data.toolCallId : "";
    strippedCount += 1;
    if (!text) return false;
    const bucket = byToolCall.get(toolCallId);
    if (bucket) bucket.push(text);
    else byToolCall.set(toolCallId, [text]);
    return false;
  });

  if (strippedCount === 0) {
    return { parts, evidence: [], strippedCount: 0 };
  }

  const evidence: OffloadedEvidence[] = [];
  for (const [toolCallId, chunks] of byToolCall) {
    evidence.push({
      toolCallId: toolCallId || undefined,
      toolName: "run_terminal_cmd",
      kind: "terminal_output",
      content: chunks.join(""),
    });
  }

  return { parts: remaining, evidence, strippedCount };
};

/** Serializes a tool output for storage as evidence text. */
const serializeToolOutput = (output: unknown): string => {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
};

/**
 * Identifies the tool outputs a pruning pass replaced with placeholders, by
 * comparing parts before and after. Pruning turns a structured output into a
 * one-line string, so that transition is the signal.
 */
const collectPrunedOutputs = (
  before: UIMessage["parts"],
  after: UIMessage["parts"],
): OffloadedEvidence[] => {
  const evidence: OffloadedEvidence[] = [];

  for (let index = 0; index < before.length; index += 1) {
    const original = before[index] as ToolPart | undefined;
    const next = after[index] as ToolPart | undefined;
    if (!original || !next) continue;
    if (original.type !== next.type) continue;
    if (!original.type?.startsWith(TOOL_TYPE_PREFIX)) continue;
    // Structured before, one-line placeholder after: this output was replaced.
    if (typeof original.output === "string" || original.output == null) continue;
    if (typeof next.output !== "string") continue;

    const toolName = original.type.slice(TOOL_TYPE_PREFIX.length);
    const result = (original.output as { result?: Record<string, unknown> })
      ?.result;
    const readNumber = (key: string): number | undefined => {
      const value = result?.[key] ?? (original.output as Record<string, unknown>)?.[key];
      return typeof value === "number" ? value : undefined;
    };

    evidence.push({
      toolCallId: original.toolCallId,
      toolName,
      kind: toolName === "run_terminal_cmd" ? "terminal_output" : "tool_output",
      content: serializeToolOutput(original.output),
      command:
        typeof original.input?.command === "string"
          ? original.input.command
          : undefined,
      exitCode: readNumber("exitCode"),
      startedAt: readNumber("startedAt"),
      endedAt: readNumber("endedAt"),
      durationMs: readNumber("durationMs"),
    });
  }

  return evidence;
};

const stripStorageOnlyParts = (parts: UIMessage["parts"]): UIMessage["parts"] =>
  parts.filter(
    (part) =>
      part?.type !== "step-start" && part?.type !== "data-summarization",
  );

/**
 * Compacts a single assistant UIMessage before database storage.
 *
 * Convex documents are capped at 1 MiB, so long agent runs can fail when a
 * single assistant message accumulates many tool outputs. This preserves normal
 * messages, then progressively removes UI-only bulk and old tool output detail
 * once the serialized parts payload approaches the document limit.
 */
export function compactMessageForStorage<T extends UIMessage>(
  message: T,
  {
    softLimitBytes = STORAGE_MESSAGE_SOFT_LIMIT_BYTES,
    toolOutputTokenBudget = STORAGE_TOOL_OUTPUT_TOKEN_BUDGET,
  }: {
    softLimitBytes?: number;
    toolOutputTokenBudget?: number;
  } = {},
): StorageCompactionResult<T> {
  const beforeSizeBytes = estimateSerializedSizeBytes(message.parts);

  if (message.role !== "assistant" || beforeSizeBytes <= softLimitBytes) {
    return {
      message,
      compacted: false,
      beforeSizeBytes,
      afterSizeBytes: beforeSizeBytes,
      strippedUiOnlyFields: false,
      prunedCount: 0,
      offloaded: [],
      strippedTerminalParts: 0,
      excerptedInputs: 0,
      // Reports the truth, not the fact that we returned early: this branch is
      // also taken by a non-assistant message, which is never compacted here
      // and so can leave without fitting.
      fitsSoftLimit: beforeSizeBytes <= softLimitBytes,
    };
  }

  // Everything this function removes to make the message fit is collected here
  // so the caller can persist it beside the message. Compaction bounds what a
  // message costs; it is not licence to destroy the run's evidence.
  const offloaded: OffloadedEvidence[] = [];

  let strippedUiOnlyFields = false;
  let parts = message.parts.map((part) => {
    const stripped = stripBulkyOutputFields(part as ToolPart);
    if (stripped !== part) strippedUiOnlyFields = true;
    return stripped as UIMessage["parts"][number];
  });

  let afterSizeBytes = estimateSerializedSizeBytes(parts);
  let prunedCount = 0;
  let strippedTerminalParts = 0;

  // Streamed terminal parts come out first: they are duplicates of output the
  // tool result already carries, and they are the biggest single contributor to
  // an oversized message. Removing them costs the least and saves the most.
  if (afterSizeBytes > softLimitBytes) {
    const extracted = extractStreamedTerminalParts(parts);
    if (extracted.strippedCount > 0) {
      parts = extracted.parts;
      offloaded.push(...extracted.evidence);
      strippedTerminalParts = extracted.strippedCount;
      afterSizeBytes = estimateSerializedSizeBytes(parts);
    }
  }

  if (afterSizeBytes > softLimitBytes) {
    const partsBefore = parts;
    const pruneResult = pruneToolOutputs(
      [{ ...message, parts }],
      toolOutputTokenBudget,
      0,
    );
    parts = pruneResult.messages[0]?.parts ?? parts;
    prunedCount += pruneResult.prunedCount;
    offloaded.push(...collectPrunedOutputs(partsBefore, parts));
    afterSizeBytes = estimateSerializedSizeBytes(parts);
  }

  if (afterSizeBytes > softLimitBytes) {
    const partsBefore = parts;
    const pruneResult = pruneToolOutputs([{ ...message, parts }], 0, 0);
    parts = pruneResult.messages[0]?.parts ?? parts;
    prunedCount += pruneResult.prunedCount;
    offloaded.push(...collectPrunedOutputs(partsBefore, parts));
    afterSizeBytes = estimateSerializedSizeBytes(parts);
  }

  if (afterSizeBytes > softLimitBytes) {
    parts = compactReasoningParts(parts);
    afterSizeBytes = estimateSerializedSizeBytes(parts);
  }

  if (afterSizeBytes > softLimitBytes) {
    parts = stripStorageOnlyParts(parts);
    afterSizeBytes = estimateSerializedSizeBytes(parts);
  }

  // The pass that has to work. Everything above trims OUTPUT, and a Build run's
  // bulk is in tool INPUT, so before this the cascade could run out of ideas
  // while still far over the limit -- and then returned the oversized message
  // anyway, handing the database a document it was certain to refuse.
  let excerptedInputs = 0;
  if (afterSizeBytes > softLimitBytes) {
    const excerpted = excerptBulkyToolInputs(
      parts,
      softLimitBytes,
      afterSizeBytes,
    );
    if (excerpted.excerptedCount > 0) {
      parts = excerpted.parts;
      offloaded.push(...excerpted.offloaded);
      excerptedInputs = excerpted.excerptedCount;
      afterSizeBytes = estimateSerializedSizeBytes(parts);
    }
  }

  // Last resort for string outputs, protected results, metadata or prose that
  // earlier passes intentionally preserve. saveMessage archives the COMPLETE
  // original before committing any compacted representation.
  if (afterSizeBytes > softLimitBytes) {
    const bounded = [...parts];
    const largestFirst = bounded.map((part, index) => ({
      index, size: estimateSerializedSizeBytes(part),
    })).sort((a, b) => b.size - a.size);
    for (const { index } of largestFirst) {
      if (afterSizeBytes <= softLimitBytes) break;
      const part = bounded[index];
      bounded[index] = part.type === "text"
        ? { type: "text", text: `${part.text.slice(0, 2000)}\n\n[Full text is preserved in the attached run archive.]` }
        : { type: "text", text: "[Full operation details are preserved in the attached run archive.]" };
      afterSizeBytes = estimateSerializedSizeBytes(bounded);
    }
    parts = bounded;
    if (afterSizeBytes > softLimitBytes) {
      // Also bound pathological numbers of individually small parts.
      parts = [{ type: "text", text: "Full run history is preserved in the attached archive." }];
      afterSizeBytes = estimateSerializedSizeBytes(parts);
    }
  }

  const compacted =
    strippedUiOnlyFields ||
    prunedCount > 0 ||
    strippedTerminalParts > 0 ||
    afterSizeBytes < beforeSizeBytes;

  return {
    message: compacted ? ({ ...message, parts } as T) : message,
    compacted,
    beforeSizeBytes,
    afterSizeBytes,
    strippedUiOnlyFields,
    prunedCount,
    offloaded,
    strippedTerminalParts,
    excerptedInputs,
    // Whether the cascade actually achieved its purpose. Callers log this: a
    // false here is the shape of the production failure that motivated the
    // input pass, and it is worth knowing about BEFORE the database refuses
    // the write rather than after an hour of work is already lost.
    fitsSoftLimit: afterSizeBytes <= softLimitBytes,
  };
}

// ---------------------------------------------------------------------------
// Main pruning function
// ---------------------------------------------------------------------------

/**
 * Prunes old tool outputs to stay within a rolling token budget.
 *
 * Walks messages from newest to oldest. For each tool part with
 * `state === "output-available"`, the output tokens are counted against
 * the remaining budget. Once the budget is exhausted, older tool outputs
 * are replaced with compact one-line placeholders.
 *
 * Returns a shallow copy of the messages array with pruned parts.
 * The original messages are not mutated.
 */
export function pruneToolOutputs(
  messages: UIMessage[],
  budget: number = TOOL_OUTPUT_TOKEN_BUDGET,
  minimumSavings: number = PRUNE_MINIMUM_SAVINGS,
): PruneResult {
  let remainingBudget = budget;
  let prunedCount = 0;
  let tokensSaved = 0;

  // Collect all tool parts newest→oldest with their locations
  const toolEntries: Array<{
    msgIdx: number;
    partIdx: number;
    part: ToolPart;
    tokens: number;
  }> = [];

  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    // Walk parts in reverse so newest tool calls within a message come first
    for (let pi = msg.parts.length - 1; pi >= 0; pi--) {
      const part = msg.parts[pi] as ToolPart;
      const toolName = part.type?.startsWith(TOOL_TYPE_PREFIX)
        ? part.type.slice(TOOL_TYPE_PREFIX.length)
        : null;
      if (
        toolName &&
        !PROTECTED_TOOLS.has(toolName) &&
        (part.state === "output-available" || part.state === "output-error") &&
        part.output != null &&
        typeof part.output !== "string" // skip already-pruned placeholders
      ) {
        toolEntries.push({
          msgIdx: mi,
          partIdx: pi,
          part,
          tokens: countOutputTokens(part.output),
        });
      }
    }
  }

  // Nothing to prune
  if (toolEntries.length === 0) {
    return {
      messages,
      prunedCount: 0,
      tokensSaved: 0,
      totalToolOutputTokens: 0,
      toolOutputCount: 0,
      skipReason: "no-tool-outputs",
    };
  }

  const totalToolOutputTokens = toolEntries.reduce((s, e) => s + e.tokens, 0);

  // Determine which entries to prune (beyond budget)
  const toPrune = new Set<string>(); // "msgIdx:partIdx"

  for (const entry of toolEntries) {
    // Budget already exhausted by previous entries — prune this one
    if (remainingBudget <= 0) {
      toPrune.add(`${entry.msgIdx}:${entry.partIdx}`);
      prunedCount++;
      const placeholderTokens = safeCountTokens(buildPlaceholder(entry.part));
      tokensSaved += entry.tokens - placeholderTokens;
      continue;
    }
    // Deduct from budget; if this entry causes overshoot, keep it but
    // subsequent entries will be pruned
    remainingBudget -= entry.tokens;
  }

  if (prunedCount === 0 || tokensSaved < minimumSavings) {
    return {
      messages,
      prunedCount: 0,
      tokensSaved: 0,
      totalToolOutputTokens,
      toolOutputCount: toolEntries.length,
      skipReason: prunedCount === 0 ? "within-budget" : "below-minimum-savings",
    };
  }

  // Build new messages array with pruned parts
  const newMessages: UIMessage[] = messages.map((msg, mi) => {
    // Check if any parts in this message need pruning
    const hasPartsToPrune = msg.parts.some((_, pi) =>
      toPrune.has(`${mi}:${pi}`),
    );
    if (!hasPartsToPrune) return msg;

    const newParts = msg.parts.map((part, pi) => {
      if (!toPrune.has(`${mi}:${pi}`)) return part;

      const toolPart = part as ToolPart;
      const placeholder = buildPlaceholder(toolPart);

      return {
        ...toolPart,
        output: placeholder,
      } as typeof part;
    });

    return { ...msg, parts: newParts } as typeof msg;
  });

  return {
    messages: newMessages,
    prunedCount,
    tokensSaved,
    totalToolOutputTokens,
    toolOutputCount: toolEntries.length,
    skipReason: null,
  };
}

// ---------------------------------------------------------------------------
// Model-level (ModelMessage) pruning — runs during the agentic loop
// ---------------------------------------------------------------------------

/**
 * A tool-result content part inside a ModelMessage with role "tool".
 * Shape: { type: "tool-result", toolCallId, toolName, output, providerOptions? }
 */
interface ToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: unknown;
  providerOptions?: unknown;
}

export interface ModelPruneResult {
  messages: Array<Record<string, unknown>>;
  prunedCount: number;
  tokensSaved: number;
  totalToolOutputTokens: number;
  toolOutputCount: number;
  skipReason:
    | "no-tool-outputs"
    | "within-budget"
    | "below-minimum-savings"
    | null;
}

/**
 * Prunes old tool-result outputs in ModelMessage[] (model-level messages).
 *
 * This runs inside prepareStep to prune tool outputs that accumulate
 * during the agentic loop (up to 100 tool calls per streamText invocation).
 *
 * ModelMessage format:
 *   assistant: { role: "assistant", content: [{ type: "tool-call", toolCallId, toolName, input }] }
 *   tool:      { role: "tool", content: [{ type: "tool-result", toolCallId, toolName, output: { type, value } }] }
 *
 * To build rich placeholders, we first index tool-call args by toolCallId
 * from assistant messages, then correlate with tool-result outputs.
 */
export function pruneModelMessages(
  messages: Array<Record<string, unknown>>,
  budget: number = TOOL_OUTPUT_TOKEN_BUDGET,
  minimumSavings: number = PRUNE_MINIMUM_SAVINGS,
): ModelPruneResult {
  // Step 1: Index tool-call args by toolCallId for placeholder building
  const argsById = new Map<string, unknown>();
  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = part as Record<string, unknown>;
      if (p.type === "tool-call" && typeof p.toolCallId === "string") {
        argsById.set(p.toolCallId, "input" in p ? p.input : p.args);
      }
    }
  }

  // Step 2: Collect tool-result entries newest→oldest
  let remainingBudget = budget;
  const toolEntries: Array<{
    msgIdx: number;
    partIdx: number;
    toolName: string;
    toolCallId: string;
    output: unknown;
    tokens: number;
  }> = [];

  for (let mi = messages.length - 1; mi >= 0; mi--) {
    const msg = messages[mi];
    if (msg.role !== "tool") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (let pi = (content as unknown[]).length - 1; pi >= 0; pi--) {
      const part = (content as unknown[])[pi] as ToolResultPart;
      if (
        part.type !== "tool-result" ||
        !part.toolName ||
        PROTECTED_TOOLS.has(part.toolName)
      )
        continue;

      // Skip placeholders produced by an earlier compaction pass.
      if (isCompactedModelToolOutput(part.output)) continue;
      if (part.output == null) continue;

      const tokens = countOutputTokens(part.output);
      toolEntries.push({
        msgIdx: mi,
        partIdx: pi,
        toolName: part.toolName,
        toolCallId: part.toolCallId,
        output: part.output,
        tokens,
      });
    }
  }

  if (toolEntries.length === 0) {
    return {
      messages,
      prunedCount: 0,
      tokensSaved: 0,
      totalToolOutputTokens: 0,
      toolOutputCount: 0,
      skipReason: "no-tool-outputs",
    };
  }

  const totalToolOutputTokens = toolEntries.reduce((s, e) => s + e.tokens, 0);

  // Step 3: Determine which to prune
  let prunedCount = 0;
  let tokensSaved = 0;
  const toPrune = new Set<string>();

  for (const entry of toolEntries) {
    if (remainingBudget <= 0) {
      toPrune.add(`${entry.msgIdx}:${entry.partIdx}`);
      prunedCount++;
      const args = argsById.get(entry.toolCallId);
      const placeholder = buildPlaceholderFromParts(
        entry.toolName,
        args,
        entry.output,
      );
      tokensSaved += entry.tokens - safeCountTokens(placeholder);
      continue;
    }
    remainingBudget -= entry.tokens;
  }

  if (prunedCount === 0 || tokensSaved < minimumSavings) {
    return {
      messages,
      prunedCount: 0,
      tokensSaved: 0,
      totalToolOutputTokens,
      toolOutputCount: toolEntries.length,
      skipReason: prunedCount === 0 ? "within-budget" : "below-minimum-savings",
    };
  }

  // Step 4: Build new messages with pruned tool-result outputs
  const newMessages = messages.map((msg, mi) => {
    if (msg.role !== "tool") return msg;
    const content = msg.content as unknown[];
    if (!Array.isArray(content)) return msg;

    const hasPartsToPrune = content.some((_, pi) => toPrune.has(`${mi}:${pi}`));
    if (!hasPartsToPrune) return msg;

    const newContent = content.map((part, pi) => {
      if (!toPrune.has(`${mi}:${pi}`)) return part;

      const resultPart = part as ToolResultPart;
      const args = argsById.get(resultPart.toolCallId);
      const placeholder = buildPlaceholderFromParts(
        resultPart.toolName,
        args,
        resultPart.output,
      );

      return {
        ...resultPart,
        output: isModelToolResultOutput(resultPart.output)
          ? { type: "text", value: placeholder }
          : placeholder,
      };
    });

    return { ...msg, content: newContent };
  });

  return {
    messages: newMessages,
    prunedCount,
    tokensSaved,
    totalToolOutputTokens,
    toolOutputCount: toolEntries.length,
    skipReason: null,
  };
}

/**
 * Filters out assistant messages with empty or whitespace-only content.
 *
 * convertToModelMessages() splits multi-step UIMessages at step-start boundaries.
 * When a step contains only reasoning (no text or tool calls), it produces an
 * assistant ModelMessage with content: [] — which strict providers like Moonshot AI
 * reject with "must not be empty" errors.
 *
 * Safe to remove (not patch) because reasoning-only steps have no tool calls,
 * so removing them won't orphan any subsequent tool messages.
 */
export function filterEmptyAssistantMessages<T extends Record<string, unknown>>(
  messages: T[],
): T[] {
  return messages.filter((msg) => {
    if (msg.role !== "assistant") return true;
    const content = msg.content;
    // Handle non-array content: empty string, null, undefined are all empty
    if (!Array.isArray(content)) {
      if (content == null) return false;
      if (typeof content === "string") return !!content.trim();
      return true;
    }
    if (content.length === 0) return false;
    return content.some((part: any) => {
      if (part.type === "text") return !!part.text?.trim();
      // Reasoning parts are stripped by the AI SDK before the HTTP request,
      // so they don't count as substantive content for the provider.
      if (part.type === "reasoning" || part.type === "redacted-reasoning")
        return false;
      return true; // tool-call, file, etc. are substantive
    });
  });
}

const ANTHROPIC_CONTINUE_MESSAGE = {
  role: "user",
  content:
    "Continue from the previous assistant message. Do not repeat completed work.",
} as const;

export type PromptMessage = Record<string, unknown> & {
  role?: unknown;
  content?: unknown;
};

export type AnthropicPromptRepairAction =
  | "none"
  | "appended_continue"
  | "trimmed";

export type AnthropicPromptRepairReason =
  | "not_trailing_assistant"
  | "useful_assistant_tail"
  | "no_useful_content"
  | "dangling_tool_call";

export type AppliedAnthropicPromptRepairReason = Exclude<
  AnthropicPromptRepairReason,
  "not_trailing_assistant"
>;

export interface AppliedAnthropicPromptRepair {
  messages: PromptMessage[];
  action: Exclude<AnthropicPromptRepairAction, "none">;
  reason: AppliedAnthropicPromptRepairReason;
  trailingAssistantContentTypes?: string[];
}

export interface NoAnthropicPromptRepair {
  messages: PromptMessage[];
  action: "none";
  reason: "not_trailing_assistant";
}

export type AnthropicPromptRepairTelemetry =
  | AppliedAnthropicPromptRepair
  | NoAnthropicPromptRepair;

const getContentTypes = (content: unknown): string[] | undefined => {
  if (typeof content === "string") return ["text"];
  if (!Array.isArray(content)) return undefined;
  return content
    .map((part: any) => part?.type)
    .filter((type: unknown): type is string => typeof type === "string");
};

const hasDanglingAssistantToolCall = (content: unknown): boolean => {
  if (!Array.isArray(content)) return false;
  return content.some((part: any) => part?.type === "tool-call");
};

const hasUsefulAssistantContent = (content: unknown): boolean => {
  if (typeof content === "string") return content.trim().length > 0;
  if (!Array.isArray(content)) return content != null;

  return content.some((part: any) => {
    if (part?.type === "text") return !!part.text?.trim();
    if (part?.type === "reasoning" || part?.type === "redacted-reasoning") {
      return false;
    }
    if (part?.type === "tool-call") return false;
    return true;
  });
};

/**
 * Anthropic treats a final assistant message in the prompt as an assistant
 * prefill. Claude Opus 4.6 / Sonnet 4.6 reject prefill, so before calling an
 * Anthropic model we ensure the prompt does not end with assistant content.
 *
 * When the trailing assistant message has useful non-tool context, preserve it
 * and append a provider-only user continuation. If it is empty/reasoning-only
 * or contains a dangling tool call, trim it to avoid follow-up provider errors.
 */
export function repairAnthropicModelMessagesWithTelemetry(
  messages: PromptMessage[],
): AnthropicPromptRepairTelemetry {
  const lastMessage = messages.at(-1);
  if (lastMessage?.role !== "assistant") {
    return {
      messages,
      action: "none",
      reason: "not_trailing_assistant",
    };
  }

  const trailingAssistantContentTypes = getContentTypes(lastMessage.content);

  if (hasDanglingAssistantToolCall(lastMessage.content)) {
    return {
      messages: messages.slice(0, -1),
      action: "trimmed",
      reason: "dangling_tool_call",
      trailingAssistantContentTypes,
    };
  }

  if (hasUsefulAssistantContent(lastMessage.content)) {
    return {
      messages: [...messages, ANTHROPIC_CONTINUE_MESSAGE],
      action: "appended_continue",
      reason: "useful_assistant_tail",
      trailingAssistantContentTypes,
    };
  }

  return {
    messages: messages.slice(0, -1),
    action: "trimmed",
    reason: "no_useful_content",
    trailingAssistantContentTypes,
  };
}

export function repairAnthropicModelMessages(
  messages: PromptMessage[],
): PromptMessage[] {
  return repairAnthropicModelMessagesWithTelemetry(messages).messages;
}
