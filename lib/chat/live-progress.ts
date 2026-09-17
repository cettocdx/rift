import { buildReasoningPresentation } from "./reasoning-presentation";

export type LiveProgressPhase =
  | "starting"
  | "connecting"
  | "reasoning"
  | "terminal"
  | "working";

export interface LiveProgressPresentation {
  title: string;
  ariaLabel: string;
  phase: LiveProgressPhase;
  source: "reasoning" | "todo" | "tool" | "text" | "file" | "fallback";
  toolName?: string;
}

type MessagePartLike = {
  type?: unknown;
  toolCallId?: unknown;
  state?: unknown;
  text?: unknown;
  input?: unknown;
  output?: unknown;
  data?: unknown;
};

type TodoLike = {
  content?: unknown;
  status?: unknown;
};

const MAX_PROGRESS_TITLE_LENGTH = 72;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const compact = (value: string): string => value.replace(/\s+/g, " ").trim();

const clampTitle = (value: string): string => {
  const normalized = compact(value).replace(/[.!?:;,]+$/, "");
  if (normalized.length <= MAX_PROGRESS_TITLE_LENGTH) return normalized;

  const candidate = normalized.slice(0, MAX_PROGRESS_TITLE_LENGTH + 1);
  const wordBreak = candidate.lastIndexOf(" ");
  const end =
    wordBreak >= Math.floor(MAX_PROGRESS_TITLE_LENGTH * 0.62)
      ? wordBreak
      : MAX_PROGRESS_TITLE_LENGTH;
  return `${candidate.slice(0, end).trimEnd()}…`;
};

const basename = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  const withoutQuery = value.trim().split(/[?#]/, 1)[0] ?? "";
  return withoutQuery.split(/[\\/]/).filter(Boolean).at(-1) ?? null;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  isRecord(value) ? value : {};

const asTodoList = (value: unknown): TodoLike[] =>
  Array.isArray(value)
    ? value.filter((item): item is TodoLike => isRecord(item))
    : [];

const progress = (
  title: string,
  phase: LiveProgressPhase,
  source: LiveProgressPresentation["source"],
  toolName?: string,
): LiveProgressPresentation => {
  const safeTitle = clampTitle(title) || "Planning next moves";
  return {
    title: safeTitle,
    ariaLabel: `${safeTitle}. Live agent activity`,
    phase,
    source,
    ...(toolName ? { toolName } : {}),
  };
};

const isToolRunning = (part: MessagePartLike): boolean =>
  part.state === "input-streaming" || part.state === "input-available";

const todoProgressTitle = (part: MessagePartLike): string => {
  const input = asRecord(part.input);
  const output = asRecord(part.output);
  const todos = [
    ...asTodoList(output.currentTodos),
    ...asTodoList(input.todos),
  ];
  const activeTodo = [...todos]
    .reverse()
    .find(
      (todo) =>
        todo.status === "in_progress" &&
        typeof todo.content === "string" &&
        todo.content.trim(),
    );

  if (activeTodo && typeof activeTodo.content === "string") {
    return activeTodo.content;
  }
  return isToolRunning(part)
    ? "Organizing the implementation plan"
    : "Choosing the next implementation step";
};

const terminalProgressTitle = (part: MessagePartLike): string => {
  const input = asRecord(part.input);
  const data = asRecord(part.data);
  const command = [input.command, input.cmd, data.command, data.terminal]
    .find((value): value is string => typeof value === "string")
    ?.toLowerCase();
  const complete = !isToolRunning(part);

  if (
    command &&
    /(?:^|\s)(?:pnpm|npm|yarn|bun)?\s*(?:test|jest|vitest|playwright|cypress)\b/.test(
      command,
    )
  ) {
    return complete ? "Reviewing test results" : "Running focused tests";
  }
  if (
    command &&
    /(?:^|\s)(?:pnpm|npm|yarn|bun)?\s*(?:run\s+)?build\b|next\s+build/.test(
      command,
    )
  ) {
    return complete
      ? "Reviewing the production build"
      : "Verifying the production build";
  }
  if (
    command &&
    /(?:^|\s)(?:pnpm|npm|yarn|bun)?\s*(?:run\s+)?(?:lint|typecheck|check)\b|tsc\b/.test(
      command,
    )
  ) {
    return complete ? "Reviewing code quality checks" : "Checking code quality";
  }
  if (
    command &&
    /(?:^|\s)(?:rg|find|ls|git\s+(?:status|diff|log))\b/.test(command)
  ) {
    return complete
      ? "Reviewing the project structure"
      : "Inspecting the project";
  }
  if (
    command &&
    /(?:^|\s)(?:pnpm|npm|yarn|bun)?\s*(?:run\s+)?(?:dev|start)\b/.test(command)
  ) {
    return complete ? "Checking the live preview" : "Starting the live preview";
  }
  return complete ? "Reviewing command results" : "Running command";
};

const fileProgressTitle = (part: MessagePartLike): string => {
  const input = asRecord(part.input);
  const action = typeof input.action === "string" ? input.action : "";
  const target = basename(input.path ?? input.filePath ?? input.filename);
  const suffix = target ? ` ${target}` : " the project";

  if (["write", "append", "edit", "replace"].includes(action)) {
    return `${isToolRunning(part) ? "Updating" : "Reviewing"}${suffix}`;
  }
  if (["read", "view"].includes(action)) {
    return `${isToolRunning(part) ? "Reading" : "Reviewing"}${suffix}`;
  }
  if (["search", "list"].includes(action)) {
    return isToolRunning(part)
      ? "Searching the project"
      : "Reviewing project matches";
  }
  return isToolRunning(part)
    ? "Inspecting project files"
    : "Reviewing project files";
};

const humanizeToolName = (toolName: string): string =>
  toolName
    .replace(/^tool-/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const toolProgress = (
  part: MessagePartLike,
  type: string,
): LiveProgressPresentation => {
  const toolName = type.replace(/^tool-/, "");
  const complete = !isToolRunning(part);

  if (toolName === "find_skills") {
    // Playbooks load automatically; the ticker says only that it happened.
    // Naming the packs made routine plumbing read like a decision on display.
    const title = isToolRunning(part) ? "Loading skills" : "Skills loaded";
    return progress(title, "reasoning", "tool", toolName);
  }

  if (toolName === "todo_write") {
    return progress(todoProgressTitle(part), "reasoning", "todo", toolName);
  }

  if (
    toolName === "shell" ||
    toolName === "run_terminal_cmd" ||
    toolName === "interact_terminal_session"
  ) {
    return progress(terminalProgressTitle(part), "terminal", "tool", toolName);
  }

  if (
    toolName === "file" ||
    ["read_file", "write_file", "search_replace", "multi_edit"].includes(
      toolName,
    )
  ) {
    return progress(fileProgressTitle(part), "working", "tool", toolName);
  }

  const knownTitles: Record<string, [string, string]> = {
    web_search: [
      "Researching implementation details",
      "Reviewing research results",
    ],
    open_url: [
      "Reading the selected reference",
      "Reviewing the selected reference",
    ],
    browse_url: ["Reading the selected page", "Reviewing the selected page"],
    delegate_task: [
      "Consulting a project specialist",
      "Reviewing specialist findings",
    ],
    verify_app: ["Verifying the app", "Reviewing app verification"],
    expose_preview: ["Preparing the live preview", "Checking the live preview"],
    generate_image: [
      "Generating the requested image",
      "Reviewing the generated image",
    ],
    generate_video: [
      "Generating the requested video",
      "Reviewing the generated video",
    ],
    get_terminal_files: [
      "Collecting generated files",
      "Reviewing generated files",
    ],
    create_note: ["Saving the project note", "Reviewing the saved note"],
    list_notes: ["Reading project notes", "Reviewing project notes"],
    update_note: ["Updating the project note", "Reviewing the updated note"],
    delete_note: ["Removing the project note", "Confirming the note removal"],
  };
  const known = knownTitles[toolName];
  const title = known
    ? known[complete ? 1 : 0]
    : `${complete ? "Reviewing" : "Using"} ${humanizeToolName(toolName)}`;
  return progress(title, "working", "tool", toolName);
};

const ignoredPartTypes = new Set([
  "data-agent-heartbeat",
  "data-appendMessage",
  "data-auto-continue",
  "data-context-usage",
  "data-rate-limit-warning",
  "data-title",
  "finish-step",
  "step-start",
]);

/**
 * Derive a concise public progress label exclusively from stream data already
 * visible to the user. This is operational telemetry, never hidden model
 * chain-of-thought.
 */
export function buildLiveProgressPresentation(
  parts: readonly MessagePartLike[],
): LiveProgressPresentation {
  // Terminal chunks carry output, not lifecycle state. Resolve them through
  // the associated tool so live output cannot masquerade as completed work.
  const tools = new Map<string, { part: MessagePartLike; type: string }>();
  for (const part of parts) {
    if (
      typeof part?.type === "string" &&
      part.type.startsWith("tool-") &&
      typeof part.toolCallId === "string" &&
      part.toolCallId
    )
      tools.set(part.toolCallId, { part, type: part.type });
  }
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    const type = typeof part?.type === "string" ? part.type : "";
    if (!type || ignoredPartTypes.has(type)) continue;

    if (type === "data-provider-capacity") {
      const data = asRecord(part.data);
      if (data.status === "waiting")
        return progress(
          "Waiting for provider · resumes automatically",
          "working",
          "fallback",
        );
      continue;
    }

    if (type === "reasoning") {
      const reasoningParts: string[] = [];
      for (let runIndex = index; runIndex >= 0; runIndex -= 1) {
        const candidate = parts[runIndex];
        if (candidate?.type !== "reasoning") break;
        if (typeof candidate.text === "string")
          reasoningParts.unshift(candidate.text);
      }
      const visibleReasoning = reasoningParts.join("");
      if (
        !visibleReasoning.trim() ||
        /^(?:\[REDACTED\])+$/i.test(visibleReasoning.trim())
      ) {
        continue;
      }
      const presentation = buildReasoningPresentation(visibleReasoning, true);
      return progress(presentation.title, "reasoning", "reasoning");
    }

    if (type.startsWith("tool-")) return toolProgress(part, type);
    if (type === "data-terminal") {
      const id = asRecord(part.data).toolCallId;
      const matching = typeof id === "string" ? tools.get(id) : undefined;
      if (matching) return toolProgress(matching.part, matching.type);
      continue;
    }
    if (type === "text" && typeof part.text === "string" && part.text.trim()) {
      return progress("Writing the response", "reasoning", "text");
    }
    if (type === "file") {
      return progress("Reviewing generated files", "working", "file");
    }
  }

  return progress("Planning next moves", "reasoning", "fallback");
}
