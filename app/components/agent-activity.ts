import type { ChatMode, ChatStatus, SidebarContent, Todo } from "@/types/chat";
import { isSidebarFile, isSidebarTerminal } from "@/types/chat";
import { buildLiveProgressPresentation } from "@/lib/chat/live-progress";
import { summarizeTranscriptTools } from "@/lib/chat/transcript-presentation";
import { estimateTextTokens } from "@/lib/client-token-estimate";

export type SubagentStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "not-approved"
  | "awaiting-approval";

export type SubagentRole =
  | "researcher"
  | "reviewer"
  | "planner"
  | "debugger"
  | "product_designer"
  | "security_analyst";

export interface AgentActivitySubagent {
  id: string;
  toolCallId?: string;
  /** Stable profile identity for its mark; each invocation still has its own id. */
  identity?: string;
  profileId?: string;
  model?: string;
  execution?: {
    mode?: string;
    steps?: number;
    toolCalls?: number;
    failedToolCalls?: number;
    toolsUsed?: string[];
    stopReason?: string;
  };
  name: string;
  role: string;
  task: string;
  status: SubagentStatus;
  durationMs?: number;
  summary?: string;
  error?: string;
  findings?: Array<Record<string, unknown>>;
  nextActions?: string[];
  confidence?: "high" | "medium" | "low";
}

export interface CreateSubagentDraft {
  name: string;
  role: SubagentRole;
  task: string;
  /** Set when the draft came from the catalog rather than being typed. */
  petId?: string;
  /** The archetype's own skills, so the subagent starts equipped. */
  skillIds?: readonly string[];
}

export function canCreateSubagentInMode(mode: ChatMode): boolean {
  return mode === "agent";
}

export function buildSubagentPrompt(draft: CreateSubagentDraft): string {
  const role = draft.role.trim().replaceAll("_", " ");
  // A subagent picked from the catalog arrives with the archetype's own
  // skills. Naming them in the prompt is what makes "equipped" real rather
  // than decorative — the runtime loads what the line asks for.
  const skills = draft.skillIds?.length
    ? ` Equip it with these skills: ${draft.skillIds.join(", ")}.`
    : "";
  return `Create and run a ${role} subagent named ${draft.name.trim()} to: ${draft.task.trim()}.${skills} Run the subagent now rather than only describing it.`;
}

export interface AgentActivityMessage {
  id?: string;
  role?: string;
  parts?: Array<{
    type?: string;
    toolCallId?: string;
    state?: string;
    errorText?: string;
    approval?: unknown;
    input?: unknown;
    output?: unknown;
    text?: unknown;
    data?: unknown;
  }>;
}

export interface AgentActivitySnapshot {
  completedSteps: number;
  totalSteps: number;
  runningTasks: number;
  activeStep: Todo | null;
  changedFiles: number;
  diffStat: DiffStat;
  toolOperations: number;
  terminalOperations: number;
  runningOperations: number;
  subagents: AgentActivitySubagent[];
  runningSubagents: number;
  activeAgents: number;
  totalAgents: number;
  label: string;
}

/**
 * Codex-style run counters reset at the latest user turn instead of growing for
 * the lifetime of the conversation. The current user message is retained so
 * consumers can still parse any turn metadata attached to it.
 */
export function getCurrentRunMessages<T extends AgentActivityMessage>(
  messages: readonly T[],
): T[] {
  let lastUserIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      lastUserIndex = index;
      break;
    }
  }

  return Array.from(
    lastUserIndex >= 0 ? messages.slice(lastUserIndex) : messages,
  );
}

/**
 * Assistant plans are stamped with their source message. Once stamped plans
 * exist, only plans emitted in the current user turn belong in the run HUD.
 * Source-less todos are retained solely as a compatibility fallback for older
 * chats that predate sourceMessageId.
 */
export function getCurrentRunTodos(
  todos: readonly Todo[],
  currentRunMessages: readonly AgentActivityMessage[],
): Todo[] {
  const uniqueTodos = Array.from(
    new Map(todos.map((todo) => [todo.id, todo])).values(),
  );
  const hasSourcedTodos = uniqueTodos.some((todo) => todo.sourceMessageId);
  if (!hasSourcedTodos) return uniqueTodos;

  const currentAssistantIds = new Set(
    currentRunMessages
      .filter((message) => message.role === "assistant")
      .map((message) => message.id)
      .filter((id): id is string => Boolean(id)),
  );

  return uniqueTodos.filter(
    (todo) =>
      Boolean(todo.sourceMessageId) &&
      currentAssistantIds.has(todo.sourceMessageId as string),
  );
}

const MUTATING_FILE_ACTIONS = new Set([
  "creating",
  "editing",
  "writing",
  "appending",
]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const asCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const normalizeSubagentStatus = (
  part: NonNullable<AgentActivityMessage["parts"]>[number],
  status: ChatStatus,
): SubagentStatus => {
  // Use the same known error/approval contracts as the transcript. A transport
  // finishing is not evidence that its unresolved delegate completed.
  const summary = summarizeTranscriptTools(
    [{ ...part, type: part.type ?? "tool-delegate_task" }],
    status,
  );
  if (summary.status === "running")
    return part.state === "input-streaming" ? "queued" : "running";
  if (summary.status === "unknown") return "interrupted";
  if (summary.status === "needs-setup") return "failed";
  if (summary.status === "interrupted") {
    const agent = asRecord(asRecord(part.output)?.agent);
    if (agent?.status === "cancelled" || agent?.status === "canceled")
      return "cancelled";
  }
  return summary.status;
};

/**
 * Read real delegate_task tool parts from the conversation. No placeholder
 * agents are produced: the list stays empty until the backend emits a tool call.
 */
export function extractSubagentsFromMessages(
  messages: readonly AgentActivityMessage[] = [],
  status?: ChatStatus,
  options: { currentRunOnly?: boolean } = {},
): AgentActivitySubagent[] {
  const byToolCall = new Map<string, AgentActivitySubagent>();
  const currentRunMessages = new Set(getCurrentRunMessages(messages));
  const lastAssistant = messages.findLast(
    (message) => message.role === "assistant",
  );

  messages.forEach((message, messageIndex) => {
    // Preserve the original indexes for id-less legacy messages, so the run
    // list and an all-history detail lookup resolve the same invocation.
    if (options.currentRunOnly && !currentRunMessages.has(message)) return;
    message.parts?.forEach((part, partIndex) => {
      if (part.type !== "tool-delegate_task") return;

      const input = asRecord(part.input);
      const output = asRecord(part.output);
      const agent = asRecord(output?.agent);
      // Tool call ids are expected on live SDK parts, but older persisted
      // messages may not have one. Include the source message in the fallback
      // so two real delegations at the same part index never overwrite each
      // other in the activity panel.
      const toolCallId =
        part.toolCallId ||
        `${message.id || `message-${messageIndex}`}-delegate-${partIndex}`;
      const existing = byToolCall.get(toolCallId);
      const profileId = asString(agent?.profileId) || asString(input?.agentId);
      const execution = asRecord(output?.execution);
      const effectiveStatus =
        currentRunMessages.has(message) &&
        (!lastAssistant || message === lastAssistant)
          ? (status ?? "streaming")
          : "ready";
      const findingsValue = output?.findings;
      const findings = Array.isArray(findingsValue)
        ? findingsValue
            .map(asRecord)
            .filter((item): item is Record<string, unknown> => Boolean(item))
        : existing?.findings;
      const nextActionsValue = output?.nextActions;
      const nextActions = Array.isArray(nextActionsValue)
        ? nextActionsValue
            .map(asString)
            .filter((item): item is string => Boolean(item))
        : existing?.nextActions;
      const durationValue = agent?.durationMs;
      const confidenceValue = asString(output?.confidence)?.toLowerCase();

      byToolCall.set(toolCallId, {
        id: toolCallId,
        toolCallId,
        profileId,
        identity:
          profileId ||
          asString(agent?.name) ||
          asString(input?.name) ||
          toolCallId,
        model: asString(agent?.model),
        execution: execution
          ? {
              mode: asString(execution.mode),
              steps: asCount(execution.steps),
              toolCalls: asCount(execution.toolCalls),
              failedToolCalls: asCount(execution.failedToolCalls),
              toolsUsed: Array.isArray(execution.toolsUsed)
                ? execution.toolsUsed
                    .map(asString)
                    .filter((tool): tool is string => Boolean(tool))
                : undefined,
              stopReason: asString(execution.stopReason),
            }
          : undefined,
        name:
          asString(agent?.name) ||
          asString(input?.name) ||
          asString(input?.agentId) ||
          existing?.name ||
          "Subagent",
        role:
          asString(agent?.role) ||
          asString(input?.role) ||
          existing?.role ||
          "specialist",
        task: asString(input?.task) || existing?.task || "Delegated task",
        status: normalizeSubagentStatus(part, effectiveStatus),
        durationMs:
          asCount(durationValue) !== undefined
            ? asCount(durationValue)
            : existing?.durationMs,
        summary: asString(output?.summary) || existing?.summary,
        error:
          asString(output?.error) ||
          asString(part.errorText) ||
          existing?.error,
        findings,
        nextActions,
        confidence:
          confidenceValue === "high" ||
          confidenceValue === "medium" ||
          confidenceValue === "low"
            ? confidenceValue
            : existing?.confidence,
      });
    });
  });

  return Array.from(byToolCall.values());
}

export interface DiffStat {
  added: number;
  removed: number;
}

export interface RunUsageTotals {
  tokens: number;
  costDollars: number;
  /** True when an in-flight estimate is folded in, so the UI can mark it "~". */
  isEstimated: boolean;
}

/**
 * What the conversation has burned so far, updated live.
 *
 * Finished turns report exact server-side figures through message metadata, so
 * those are used verbatim. The turn still streaming has no figures yet — its
 * tokens are estimated from the text on screen and priced at the rate this
 * conversation has actually been charged, rather than a guessed tariff. With
 * nothing charged yet there is no rate to apply, so cost stays at the exact
 * total and only the token count moves.
 */
/**
 * How full the model's context is: the input tokens of the most recent turn.
 *
 * Deliberately not the cumulative burn — a conversation can spend millions of
 * tokens while each turn still sends far less than the window holds. Reporting
 * the running total against the window would show a context "overflowing" that
 * is in fact half empty.
 */
export function getContextFillTokens(
  messages: readonly AgentActivityMessage[] = [],
): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const metadata = asRecord((message as { metadata?: unknown }).metadata);
    const inputTokens = metadata?.contextInputTokens ?? metadata?.inputTokens;
    if (typeof inputTokens === "number" && Number.isFinite(inputTokens)) {
      return inputTokens;
    }
  }
  return 0;
}

export function getRunUsageTotals(
  messages: readonly AgentActivityMessage[] = [],
): RunUsageTotals {
  let exactTokens = 0;
  let exactCost = 0;
  let pendingText = "";

  messages.forEach((message) => {
    if (message.role !== "assistant") return;

    const metadata = asRecord((message as { metadata?: unknown }).metadata);
    const tokens = metadata?.totalTokens;
    const cost = metadata?.costDollars;

    if (typeof tokens === "number" && Number.isFinite(tokens)) {
      exactTokens += tokens;
      if (typeof cost === "number" && Number.isFinite(cost)) exactCost += cost;
      return;
    }

    message.parts?.forEach((part) => {
      if (part.type === "text" && typeof part.text === "string") {
        pendingText += part.text;
      }
    });
  });

  if (!pendingText) {
    return { tokens: exactTokens, costDollars: exactCost, isEstimated: false };
  }

  const estimatedTokens = estimateTextTokens(pendingText);
  const observedRate = exactTokens > 0 ? exactCost / exactTokens : 0;

  return {
    tokens: exactTokens + estimatedTokens,
    costDollars: exactCost + estimatedTokens * observedRate,
    isEstimated: true,
  };
}

const splitLines = (value: string): string[] =>
  value.length === 0 ? [] : value.split(/\r\n|\r|\n/);

/**
 * Added/removed line counts across the run's file writes — what `diff` means
 * everywhere else, rather than a count of touched files.
 *
 * Lines are compared as multisets instead of by position: a block moved down
 * the file is not 200 additions and 200 deletions, which is what a positional
 * comparison would claim. Unmatched lines on each side are the real change.
 */
export function getRunDiffStat(
  toolExecutions: readonly SidebarContent[],
): DiffStat {
  let added = 0;
  let removed = 0;

  toolExecutions.forEach((execution) => {
    if (
      !isSidebarFile(execution) ||
      !execution.action ||
      !MUTATING_FILE_ACTIONS.has(execution.action) ||
      execution.diffUnavailable
    ) {
      return;
    }

    const after = execution.modifiedContent ?? execution.content ?? "";
    const before = execution.originalContent;

    // A create/write with nothing before it is all additions.
    if (typeof before !== "string") {
      added += splitLines(after).length;
      return;
    }

    const remaining = new Map<string, number>();
    splitLines(before).forEach((line) => {
      remaining.set(line, (remaining.get(line) ?? 0) + 1);
    });

    splitLines(after).forEach((line) => {
      const count = remaining.get(line);
      if (count) remaining.set(line, count - 1);
      else added += 1;
    });

    remaining.forEach((count) => {
      removed += count;
    });
  });

  return { added, removed };
}

/** One changed file's totals for the run, plus the execution to open it with. */
export type FileDiffStat = {
  path: string;
  added: number;
  removed: number;
  /** At least one confirmed edit has no reliable before content. */
  diffUnavailable?: boolean;
  /** The LAST mutating execution for this path -- the freshest view of it. */
  execution: SidebarContent;
};

/**
 * Per-file version of {@link getRunDiffStat}: same multiset comparison, same
 * mutating-action filter, accumulated per path instead of into one pair of
 * totals. Multiple edits to the same file fold together, because each
 * execution carries its own before/after and the sum of the deltas is the
 * run's change to that file. Ordered by first touch, which is the order the
 * reader watched the run make them.
 */
export function getPerFileDiffStats(
  toolExecutions: readonly SidebarContent[],
): FileDiffStat[] {
  const byPath = new Map<string, FileDiffStat>();

  toolExecutions.forEach((execution) => {
    if (
      !isSidebarFile(execution) ||
      !execution.action ||
      !MUTATING_FILE_ACTIONS.has(execution.action)
    ) {
      return;
    }

    let added = 0;
    let removed = 0;
    const after = execution.modifiedContent ?? execution.content ?? "";
    const before = execution.originalContent;

    if (execution.diffUnavailable) {
      // Keep the confirmed file entry, but never turn an unknown diff into
      // invented additions. Consumers must hide totals for this entry.
    } else if (typeof before !== "string") {
      added = splitLines(after).length;
    } else {
      const remaining = new Map<string, number>();
      splitLines(before).forEach((line) => {
        remaining.set(line, (remaining.get(line) ?? 0) + 1);
      });
      splitLines(after).forEach((line) => {
        const count = remaining.get(line);
        if (count) remaining.set(line, count - 1);
        else added += 1;
      });
      remaining.forEach((count) => {
        removed += count;
      });
    }

    const entry = byPath.get(execution.path);
    if (entry) {
      entry.added += added;
      entry.removed += removed;
      entry.execution = execution;
      if (execution.diffUnavailable) entry.diffUnavailable = true;
    } else {
      byPath.set(execution.path, {
        path: execution.path,
        added,
        removed,
        execution,
        ...(execution.diffUnavailable ? { diffUnavailable: true } : {}),
      });
    }
  });

  return Array.from(byPath.values());
}

export function getChangedFilePaths(
  toolExecutions: readonly SidebarContent[],
): string[] {
  const paths = new Set<string>();

  toolExecutions.forEach((execution) => {
    if (
      isSidebarFile(execution) &&
      execution.action &&
      MUTATING_FILE_ACTIONS.has(execution.action)
    ) {
      paths.add(execution.path);
    }
  });

  return Array.from(paths);
}

export function buildAgentActivitySnapshot({
  todos,
  toolExecutions,
  messages,
  subagents,
  status,
}: {
  todos: readonly Todo[];
  toolExecutions: readonly SidebarContent[];
  messages?: readonly AgentActivityMessage[];
  subagents?: readonly AgentActivitySubagent[];
  status?: ChatStatus;
}): AgentActivitySnapshot {
  const uniqueTodos = Array.from(
    new Map(todos.map((todo) => [todo.id, todo])).values(),
  );
  // A run starts at the latest user turn. Keep subagent counters on the same
  // boundary as plan and operation counters even when a caller passes the
  // complete conversation (the normal Computer sidebar does).
  const currentRunMessages = messages
    ? getCurrentRunMessages(messages)
    : undefined;
  const resolvedSubagents = subagents
    ? Array.from(subagents)
    : extractSubagentsFromMessages(messages, status, { currentRunOnly: true });
  const completedSteps = uniqueTodos.filter(
    (todo) => todo.status === "completed",
  ).length;
  const runningTasks = uniqueTodos.filter(
    (todo) => todo.status === "in_progress",
  ).length;
  const activeStep =
    uniqueTodos.find((todo) => todo.status === "in_progress") ||
    uniqueTodos.find((todo) => todo.status === "pending") ||
    null;
  const terminalOperations = toolExecutions.filter(isSidebarTerminal).length;
  const runningOperations = toolExecutions.filter((execution) => {
    if (isSidebarTerminal(execution)) return execution.isExecuting;
    return "isExecuting" in execution && execution.isExecuting;
  }).length;
  const runningSubagents = resolvedSubagents.filter(
    (agent) =>
      agent.status === "queued" ||
      agent.status === "running" ||
      agent.status === "awaiting-approval",
  ).length;
  const coordinatorActive = status === "streaming" || status === "submitted";
  const hasCoordinator =
    coordinatorActive ||
    uniqueTodos.length > 0 ||
    toolExecutions.length > 0 ||
    resolvedSubagents.length > 0 ||
    Boolean(
      currentRunMessages?.some((message) => message.role === "assistant"),
    );
  const activeAgents = runningSubagents + (coordinatorActive ? 1 : 0);
  const totalAgents = resolvedSubagents.length + (hasCoordinator ? 1 : 0);
  const liveProgress = buildLiveProgressPresentation(
    currentRunMessages?.flatMap((message) => message.parts ?? []) ?? [],
  );

  let label = "Ready";
  if (activeStep) label = activeStep.content;
  else if (runningSubagents > 0) {
    const activeSubagent = resolvedSubagents.find(
      (agent) =>
        agent.status === "queued" ||
        agent.status === "running" ||
        agent.status === "awaiting-approval",
    );
    label = activeSubagent
      ? `Coordinating ${activeSubagent.name}`
      : "Coordinating project specialists";
  } else if (
    runningOperations > 0 ||
    status === "streaming" ||
    status === "submitted"
  ) {
    label = liveProgress.title;
  } else if (uniqueTodos.length > 0 && completedSteps === uniqueTodos.length) {
    label = "Run complete";
  } else if (toolExecutions.length > 0) {
    label = "Activity captured";
  }

  return {
    completedSteps,
    totalSteps: uniqueTodos.length,
    runningTasks,
    activeStep,
    changedFiles: getChangedFilePaths(toolExecutions).length,
    diffStat: getRunDiffStat(toolExecutions),
    toolOperations: toolExecutions.length,
    terminalOperations,
    runningOperations,
    subagents: resolvedSubagents,
    runningSubagents,
    activeAgents,
    totalAgents,
    label,
  };
}
