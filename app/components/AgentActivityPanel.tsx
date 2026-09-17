"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowLeft, Check, ChevronRight, Circle, Plus, X } from "lucide-react";
import { AgentActivityMark } from "@/components/ai-elements/activity-icon";
import { CursorActivityGlyph } from "@/components/ui/cursor-thinking";
import type { ChatStatus, SidebarContent, Todo } from "@/types/chat";
import { useDesktopWorkspaceAccess } from "../hooks/useDesktopWorkspaceAccess";
import styles from "./AgentActivityPanel.module.css";
import { useChatApprovals } from "@/app/contexts/ChatApprovalContext";
import {
  getActionText,
  getDisplayTarget,
  getSidebarIcon,
  TRACE_ICON_CLASS,
} from "./computer-sidebar-utils";
import { getActivityStatus } from "./activity-utils";
import { isSidebarProxy, isSidebarTerminal } from "@/types/chat";
// Shared with the landing page's replica of this panel, so the two cannot drift.
import {
  ACTIVITY_ARG_CLASS,
  ACTIVITY_ARG_MONO_CLASS,
  ACTIVITY_CONNECTOR_CLASS,
  ACTIVITY_CONNECTOR_TICK_CLASS,
  ACTIVITY_ICON_CLASS,
  ACTIVITY_LABEL_GROUP_CLASS,
  ACTIVITY_ROW_CLASS,
  ACTIVITY_SECTION_COUNT_CLASS,
  ACTIVITY_SECTION_TITLE_CLASS,
  ACTIVITY_VERB_CLASS,
  activityPlanIconClass,
  activityPlanRowClass,
} from "@/lib/ui/workspace-chrome";
import {
  buildAgentActivitySnapshot,
  extractSubagentsFromMessages,
  getContextFillTokens,
  getCurrentRunMessages,
  getCurrentRunTodos,
  getRunUsageTotals,
  type AgentActivityMessage,
  type AgentActivitySubagent,
  type CreateSubagentDraft,
  type SubagentRole,
  type SubagentStatus,
} from "./agent-activity";
import {
  extractAllSidebarContent,
  type Message,
} from "@/lib/utils/sidebar-utils";
import { AGENT_PET_CATALOG } from "@/lib/ai/agents/pet-roster";

interface AgentActivityPanelProps {
  selectedHistoryMessageId?: string;
  onSelectHistoryMessage?: (id: string) => void;
  todos: readonly Todo[];
  /** Sourced plans across the conversation, only used for explicit history selection. */
  historyTodos?: readonly Todo[];
  toolExecutions: readonly SidebarContent[];
  messages?: readonly AgentActivityMessage[];
  status?: ChatStatus;
  currentIndex?: number;
  subagents?: readonly AgentActivitySubagent[];
  onSelectExecution?: (content: SidebarContent) => void;
  onCreateSubagent?: (draft: CreateSubagentDraft) => boolean | void;
  /** Invocation key, shared with transcript links. Null returns to the run list. */
  selectedSubagentToolCallId?: string | null;
  onSelectSubagent?: (toolCallId: string | null) => void;
  /** Selected model's context window, for the fill readout. */
  contextWindowTokens?: number;
  /** Per-million input/output price of the selected model. */
  modelPrice?: { input: string; output: string };
}

/** Compact token count for the status line: 940, 26.2k, 1.4M. */
export const formatTokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
  return `${tokens}`;
};

/** Cost for the status line. Sub-cent spend keeps its precision. */
export const formatUsageDollars = (costDollars: number): string =>
  costDollars < 0.01
    ? `$${costDollars.toFixed(4)}`
    : `$${costDollars.toFixed(2)}`;

const MAX_RENDERED_OPERATIONS = 120;

/** `26s`, `1m 54s`, `25m 11s` — the form Grok reports run time in. */
export const formatElapsed = (seconds: number): string => {
  const whole = Math.max(0, Math.floor(seconds));
  if (whole < 60) return `${whole}s`;
  return `${Math.floor(whole / 60)}m ${whole % 60}s`;
};

/**
 * Seconds since the run started, ticking while it is live.
 *
 * The trace pins this to its last row, so the reader always knows what is
 * happening and how long it has been happening without expanding anything.
 */
function useElapsedSeconds(active: boolean): number | null {
  const [seconds, setSeconds] = useState<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const startedAt = Date.now();
    const id = setInterval(() => {
      setSeconds((Date.now() - startedAt) / 1000);
    }, 1000);
    return () => {
      clearInterval(id);
      setSeconds(null);
    };
  }, [active]);

  // Null until the first tick, so a new run never briefly shows the previous
  // run's time. The phase label carries the row on its own for that one second.
  return seconds;
}

const planStatusIcon = (todo: Todo) => {
  if (todo.status === "completed") {
    return <Check className="size-3" aria-hidden="true" />;
  }
  if (todo.status === "cancelled") {
    return <X className="size-3" aria-hidden="true" />;
  }
  if (todo.status === "in_progress") {
    return <CursorActivityGlyph active />;
  }
  return <Circle className="size-2.5" aria-hidden="true" />;
};

const formatDuration = (durationMs?: number) => {
  if (
    typeof durationMs !== "number" ||
    !Number.isFinite(durationMs) ||
    durationMs < 0
  )
    return null;
  if (durationMs < 1_000) return `${Math.floor(durationMs)}ms`;
  if (durationMs >= 60_000) return formatElapsed(durationMs / 1000);
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
};

const formatRole = (role: string) => role.replaceAll("_", " ");
const getSubagentStatusLabel = (status: SubagentStatus) => {
  if (status === "queued") return "Queued";
  if (status === "running") return "Working";
  if (status === "awaiting-approval") return "Awaiting approval";
  if (status === "completed") return "Done";
  if (status === "cancelled" || status === "interrupted") return "Stopped";
  if (status === "not-approved") return "Not approved";
  return "Failed";
};
const isActiveSubagent = (agent: AgentActivitySubagent) =>
  ["queued", "running", "awaiting-approval"].includes(agent.status);
const subagentKey = (agent: AgentActivitySubagent) =>
  agent.toolCallId ?? agent.id;
type SubagentGroupKind = "working" | "done";

function SubagentRow({
  agent,
  onSelect,
  registerRow,
}: {
  agent: AgentActivitySubagent;
  onSelect: (id: string) => void;
  registerRow: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const key = subagentKey(agent);
  const descriptionId = useId();
  const duration = formatDuration(agent.durationMs);
  return (
    <li>
      <button
        ref={(element) => registerRow(key, element)}
        type="button"
        onClick={() => onSelect(key)}
        aria-label={`Show details for ${agent.name}`}
        aria-describedby={`${descriptionId}-task ${descriptionId}-status${duration ? ` ${descriptionId}-duration` : ""}`}
        className="group flex min-h-11 w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-100 hover:bg-foreground/[0.035] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <span className="mt-0.5 shrink-0" aria-hidden="true">
          <AgentActivityMark
            identity={agent.identity ?? agent.profileId ?? key}
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline gap-2">
            <span className="truncate text-[length:var(--rift-type-body)] font-medium text-foreground">
              {agent.name}
            </span>
            <span
              id={`${descriptionId}-status`}
              className={`shrink-0 text-[length:var(--rift-type-caption)] ${agent.status === "failed" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {getSubagentStatusLabel(agent.status)}
            </span>
            {duration ? (
              <span
                id={`${descriptionId}-duration`}
                className="ml-auto shrink-0 text-[length:var(--rift-type-label)] tabular-nums text-muted-foreground"
              >
                {duration}
              </span>
            ) : null}
          </span>
          <span
            id={`${descriptionId}-task`}
            className="mt-0.5 truncate block text-[length:var(--rift-type-label)] leading-4 text-[var(--cursor-text-secondary)]"
          >
            {agent.task}
          </span>
        </span>
        <ChevronRight
          className="mt-1 size-3.5 shrink-0 text-muted-foreground"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </button>
    </li>
  );
}

function SubagentGroup({
  agents,
  open,
  onToggle,
  label,
  onSelect,
  registerRow,
}: {
  agents: AgentActivitySubagent[];
  open: boolean;
  onToggle: () => void;
  label: string;
  onSelect: (id: string) => void;
  registerRow: (id: string, element: HTMLButtonElement | null) => void;
}) {
  const groupId = useId();
  if (agents.length === 0) return null;
  return (
    <section aria-labelledby={`${groupId}-label`}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={groupId}
        className="flex min-h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[length:var(--rift-type-label)] text-muted-foreground hover:bg-foreground/[0.035] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring"
      >
        <ChevronRight
          className={`size-3.5 ${open ? "rotate-90" : ""}`}
          strokeWidth={1.5}
          aria-hidden="true"
        />
        <span id={`${groupId}-label`} className="font-medium">
          {label}
        </span>
        <span className="ml-auto tabular-nums">{agents.length}</span>
      </button>
      {open ? (
        <ul id={groupId} className="pb-2">
          {agents.map((agent) => (
            <SubagentRow
              key={subagentKey(agent)}
              agent={agent}
              onSelect={onSelect}
              registerRow={registerRow}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SubagentDetail({
  agent,
  onBack,
  selectionKey,
}: {
  agent?: AgentActivitySubagent;
  onBack: () => void;
  selectionKey: string;
}) {
  const backRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    backRef.current?.focus({ preventScroll: true });
  }, [selectionKey]);
  const duration = formatDuration(agent?.durationMs);
  const facts = agent
    ? [
        ["Role", formatRole(agent.role)],
        ["Model", agent.model],
        ["Steps", agent.execution?.steps],
        ["Tool calls", agent.execution?.toolCalls],
        ["Failed reads", agent.execution?.failedToolCalls],
        ["Tools used", agent.execution?.toolsUsed?.join(", ")],
        ["Mode", agent.execution?.mode?.replaceAll("-", " ")],
        ["Stop reason", agent.execution?.stopReason?.replaceAll("-", " ")],
        ["Confidence", agent.confidence],
      ]
    : [];
  return (
    <div
      data-ui="subagent-detail"
      role="region"
      aria-label="Agent task details"
      className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5"
    >
      <button
        ref={backRef}
        type="button"
        onClick={onBack}
        aria-label="Back to activity"
        className="-ml-2 my-2 inline-flex min-h-8 items-center gap-1.5 rounded-md px-2 text-[length:var(--rift-type-label)] text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
      >
        <ArrowLeft className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
        Activity
      </button>
      {agent ? (
        <>
          <h3 className="flex items-center gap-2 text-[length:var(--rift-type-body)] font-medium text-foreground">
            <AgentActivityMark
              identity={agent.identity ?? agent.profileId ?? subagentKey(agent)}
            />
            {agent.name}
          </h3>
          <p className="mt-1 flex items-center gap-2 text-[length:var(--rift-type-label)] text-muted-foreground">
            <span
              className={
                agent.status === "failed" ? "text-destructive" : undefined
              }
            >
              {getSubagentStatusLabel(agent.status)}
            </span>
            {duration ? (
              <span className="ml-auto tabular-nums">{duration}</span>
            ) : null}
          </p>
          <p className="mt-2 whitespace-pre-wrap break-words text-[length:var(--rift-type-body)] leading-5 text-[var(--cursor-text-secondary)]">
            {agent.task}
          </p>
          {agent.error ? (
            <p
              className={`mt-4 whitespace-pre-wrap break-words text-[length:var(--rift-type-body)] leading-5 ${agent.status === "failed" ? "text-destructive" : "text-[var(--cursor-text-secondary)]"}`}
            >
              {agent.error}
            </p>
          ) : null}
          {agent.summary ? (
            <section className="mt-4">
              <h4 className="mb-1 text-[length:var(--rift-type-label)] font-medium text-foreground">
                Result
              </h4>
              <p className="whitespace-pre-wrap break-words text-[length:var(--rift-type-body)] leading-5 text-[var(--cursor-text-secondary)]">
                {agent.summary}
              </p>
            </section>
          ) : !agent.error ? (
            <p className="mt-4 text-[length:var(--rift-type-label)] leading-5 text-muted-foreground">
              {isActiveSubagent(agent)
                ? "The result will appear here when this task finishes."
                : "No result was recorded for this task."}
            </p>
          ) : null}
          {agent.findings?.length ? (
            <section className="mt-4">
              <h4 className="mb-2 text-[length:var(--rift-type-label)] font-medium text-foreground">
                {agent.findings.length} finding
                {agent.findings.length === 1 ? "" : "s"}
              </h4>
              <ul className="space-y-3">
                {agent.findings.map((finding, index) => (
                  <li
                    key={index}
                    className="text-[length:var(--rift-type-body)] leading-5"
                  >
                    {typeof finding.title === "string" ? (
                      <p className="font-medium text-foreground">
                        {finding.title}
                      </p>
                    ) : null}
                    {typeof finding.detail === "string" ? (
                      <p className="whitespace-pre-wrap break-words text-[var(--cursor-text-secondary)]">
                        {finding.detail}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {agent.nextActions?.length ? (
            <section className="mt-4">
              <h4 className="mb-1 text-[length:var(--rift-type-label)] font-medium text-foreground">
                Next actions
              </h4>
              <ul className="list-disc space-y-1 pl-4 text-[length:var(--rift-type-body)] leading-5 text-[var(--cursor-text-secondary)]">
                {agent.nextActions.map((action, index) => (
                  <li key={index} className="break-words">
                    {action}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <details key={selectionKey} className={`${styles.disclosure} mt-4`}>
            <summary className={styles.summary}>
              <ChevronRight className={styles.chevron} aria-hidden="true" />
              Execution details
            </summary>
            <dl className={styles.facts}>
              {facts
                .filter(
                  ([, value]) =>
                    value !== undefined && value !== null && value !== "",
                )
                .map(([label, value]) => (
                  <div key={String(label)} className={styles.fact}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
            </dl>
          </details>
        </>
      ) : (
        <p className="text-[length:var(--rift-type-body)] leading-5 text-muted-foreground">
          This agent task is no longer available in this conversation.
        </p>
      )}
    </div>
  );
}

/**
 * The catalog's own role names, mapped onto the six the runtime understands.
 * Anything unmapped is a researcher, which is the least destructive default.
 */
function subagentRoleForCatalogRole(roleName: string): SubagentRole {
  const value = roleName.toLowerCase();
  if (value.includes("review") || value.includes("quality")) return "reviewer";
  if (value.includes("debug")) return "debugger";
  if (value.includes("design")) return "product_designer";
  if (value.includes("security")) return "security_analyst";
  if (
    value.includes("lead") ||
    value.includes("architect") ||
    value.includes("delivery")
  ) {
    return "planner";
  }
  return "researcher";
}

function CreateSubagentForm({
  id,
  onCancel,
  onCreate,
}: {
  id: string;
  onCancel: () => void;
  onCreate: (draft: CreateSubagentDraft) => boolean | void;
}) {
  const [name, setName] = useState("");
  const [admissionError, setAdmissionError] = useState(false);
  const [role, setRole] = useState<SubagentRole>("researcher");
  const [task, setTask] = useState("");
  // Set when the draft came from the catalog, so the archetype's own skills
  // travel with it instead of the subagent starting bare.
  const [pet, setPet] = useState<(typeof AGENT_PET_CATALOG)[number] | null>(
    null,
  );

  const pickFromCatalog = (entry: (typeof AGENT_PET_CATALOG)[number]) => {
    setPet(entry);
    setName(`${entry.petName} · ${entry.roleName}`);
    setRole(subagentRoleForCatalogRole(entry.roleName));
    setTask(entry.mission);
  };

  return (
    <form
      id={id}
      aria-label="Create a subagent"
      className="space-y-3 border-t border-border/70 px-4 py-3"
      onSubmit={(event) => {
        event.preventDefault();
        const draft: CreateSubagentDraft = {
          name: name.trim(),
          role,
          task: task.trim(),
          ...(pet
            ? { petId: pet.id, skillIds: [...pet.suggestedSkillIds] }
            : {}),
        };
        if (!draft.name || !draft.task) return;
        if (onCreate(draft) === false) {
          setAdmissionError(true);
          return;
        }
        setAdmissionError(false);
        onCancel();
      }}
    >
      {/* Pick one and the form is already filled: name, role, the archetype's
          mission as the task, and its own skills. Delegating a bounded piece
          of work should not start with writing a job description. */}
      <div className="space-y-1.5">
        <span className="text-[length:var(--rift-type-caption)] text-muted-foreground">
          Start from the catalog
        </span>
        <div
          role="group"
          aria-label="Agent catalog"
          className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto pr-0.5"
        >
          {AGENT_PET_CATALOG.map((entry) => {
            const selected = pet?.id === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                aria-pressed={selected}
                data-testid={`subagent-catalog-${entry.id}`}
                onClick={() => pickFromCatalog(entry)}
                title={entry.mission}
                className={`flex min-w-0 flex-col items-start rounded-sm border px-2 py-1.5 text-left focus-visible:outline-2 focus-visible:outline-ring ${
                  selected
                    ? "border-foreground/45 bg-muted text-foreground"
                    : "border-border/70 text-muted-foreground hover:bg-muted/60 hover:text-foreground active:bg-muted"
                }`}
              >
                <span className="w-full truncate text-[length:var(--rift-type-label)] font-medium">
                  {entry.petName}
                </span>
                <span className="w-full truncate text-[10.5px] text-muted-foreground">
                  {entry.roleName}
                </span>
              </button>
            );
          })}
        </div>
        {pet ? (
          <p
            data-testid="subagent-catalog-skills"
            className="text-[10.5px] leading-4 text-muted-foreground"
          >
            Arrives with {pet.suggestedSkillIds.length} skills:{" "}
            {pet.suggestedSkillIds.join(", ")}
          </p>
        ) : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_112px] gap-2">
        <label className="space-y-1 text-[length:var(--rift-type-caption)] text-muted-foreground">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 w-full rounded-sm border border-border/70 bg-background px-2.5 text-[length:var(--rift-type-label)] text-foreground outline-none focus-visible:border-ring"
            placeholder="UI reviewer"
            minLength={2}
            maxLength={40}
            required
          />
        </label>
        <label className="space-y-1 text-[length:var(--rift-type-caption)] text-muted-foreground">
          <span>Role</span>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as SubagentRole)}
            className="h-8 w-full rounded-sm border border-border/70 bg-background px-2 text-[length:var(--rift-type-label)] text-foreground outline-none focus-visible:border-ring"
          >
            <option value="researcher">Researcher</option>
            <option value="reviewer">Reviewer</option>
            <option value="planner">Planner</option>
            <option value="debugger">Debugger</option>
            <option value="product_designer">Product designer</option>
            <option value="security_analyst">Security analyst</option>
          </select>
        </label>
      </div>
      <label className="block space-y-1 text-[length:var(--rift-type-caption)] text-muted-foreground">
        <span>Task</span>
        <textarea
          value={task}
          onChange={(event) => setTask(event.target.value)}
          className="min-h-20 w-full resize-y rounded-sm border border-border/70 bg-background px-2.5 py-2 text-[length:var(--rift-type-label)] leading-5 text-foreground outline-none focus-visible:border-ring"
          placeholder="Describe the bounded task to delegate"
          minLength={8}
          maxLength={4_000}
          required
        />
      </label>
      {admissionError && (
        <p
          role="alert"
          className="text-[length:var(--rift-type-label)] text-destructive"
        >
          The task was not added. Your draft is kept here; check the
          conversation and queue before trying again.
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-8 rounded-sm px-3 text-[length:var(--rift-type-label)] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="h-8 rounded-sm border border-border/80 bg-foreground px-3 text-[length:var(--rift-type-label)] font-medium text-background hover:bg-foreground/90 focus-visible:outline-2 focus-visible:outline-ring"
        >
          Create subagent
        </button>
      </div>
    </form>
  );
}

/** History stays opt-in: current-run counters never absorb earlier turns. */
export function AgentActivityPanel(props: AgentActivityPanelProps) {
  const [localTurn, setLocalTurn] = useState("");
  const selectedTurn = props.selectedHistoryMessageId ?? localTurn;
  const setSelectedTurn = (id: string) => {
    setLocalTurn(id);
    props.onSelectHistoryMessage?.(id);
  };
  const turns = useMemo(
    () =>
      (props.messages ?? []).flatMap((message, index) =>
        message.role === "user" && message.id
          ? [
              {
                id: message.id,
                index,
                label:
                  message.parts
                    ?.filter((part) => part.type === "text")
                    .map((part) =>
                      typeof part.text === "string" ? part.text : "",
                    )
                    .join(" ")
                    .trim() || "Message",
              },
            ]
          : [],
      ),
    [props.messages],
  );
  const historicalTurn = turns
    .slice(0, -1)
    .find((turn) => turn.id === selectedTurn);
  const historyMessages = useMemo(() => {
    if (!historicalTurn) return null;
    const next = turns.find((turn) => turn.index > historicalTurn.index);
    return props.messages?.slice(historicalTurn.index, next?.index) ?? [];
  }, [historicalTurn, turns, props.messages]);
  const historyExecutions = useMemo(
    () =>
      historyMessages
        ? extractAllSidebarContent(historyMessages as Message[])
        : null,
    [historyMessages],
  );
  const historyTodos = useMemo(
    () =>
      historyMessages
        ? getCurrentRunTodos(
            (props.historyTodos ?? props.todos).filter(
              (todo) => !!todo.sourceMessageId,
            ),
            historyMessages,
          )
        : [],
    [props.todos, props.historyTodos, historyMessages],
  );
  return (
    <div className="flex h-full min-h-0 flex-col">
      {turns.length > 1 && (
        <label className="flex shrink-0 items-center gap-2 border-b border-border/60 px-3 py-2 text-[length:var(--rift-type-label)] text-muted-foreground">
          <span>Activity</span>
          <select
            aria-label="Activity for message"
            value={historicalTurn?.id ?? ""}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            onChange={(event) => {
              setSelectedTurn(event.target.value);
              props.onSelectSubagent?.(null);
            }}
          >
            <option value="">Latest message</option>
            {turns
              .slice(0, -1)
              .reverse()
              .map((turn) => (
                <option key={turn.id} value={turn.id}>
                  {turn.label.slice(0, 90)}
                </option>
              ))}
          </select>
        </label>
      )}
      <div className="min-h-0 flex-1">
        <ActivityRunPanel
          key={historicalTurn?.id ?? "latest"}
          {...props}
          {...(historyMessages
            ? {
                messages: historyMessages,
                toolExecutions: historyExecutions ?? [],
                todos: historyTodos,
                status: "ready" as ChatStatus,
                currentIndex: -1,
                subagents: undefined,
                onCreateSubagent: undefined,
              }
            : {})}
        />
      </div>
    </div>
  );
}

function ActivityRunPanel({
  todos,
  toolExecutions,
  messages,
  status,
  currentIndex = -1,
  subagents,
  onSelectExecution,
  onCreateSubagent,
  selectedSubagentToolCallId,
  onSelectSubagent,
  contextWindowTokens,
}: AgentActivityPanelProps) {
  const approvals = useChatApprovals();
  // Scope the external approval subscription to this displayed turn. Historical
  // operations must not inherit a current turn's waiting state.
  const pendingIds = useMemo(
    () =>
      new Set(
        approvals.toolCallIds.filter((id) =>
          toolExecutions.some(
            (execution) =>
              "toolCallId" in execution && execution.toolCallId === id,
          ),
        ),
      ),
    [approvals.toolCallIds, toolExecutions],
  );
  const { grants } = useDesktopWorkspaceAccess();
  const createFormId = useId();
  const createButtonRef = useRef<HTMLButtonElement>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const closeCreateForm = () => {
    setShowCreateForm(false);
    createButtonRef.current?.focus({ preventScroll: true });
  };
  const [localSelection, setLocalSelection] = useState<string | null>(null);
  const selection =
    selectedSubagentToolCallId === undefined
      ? localSelection
      : selectedSubagentToolCallId;
  const [groupOpen, setGroupOpen] = useState<
    Record<SubagentGroupKind, boolean | null>
  >({ working: null, done: null });
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusRef = useRef<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const registerRow = (id: string, element: HTMLButtonElement | null) => {
    if (element) rowRefs.current.set(id, element);
    else rowRefs.current.delete(id);
  };
  const selectSubagent = (id: string | null) => {
    if (selectedSubagentToolCallId === undefined) setLocalSelection(id);
    onSelectSubagent?.(id);
  };
  const allSubagents = useMemo(
    () =>
      selection === null ? [] : extractSubagentsFromMessages(messages, status),
    [messages, status, selection],
  );
  const selectedAgent = selection
    ? (subagents?.find((agent) => subagentKey(agent) === selection) ??
      allSubagents.find((agent) => subagentKey(agent) === selection))
    : undefined;
  const backToActivity = () => {
    restoreFocusRef.current = selection;
    if (selectedAgent)
      setGroupOpen((previous) => ({
        ...previous,
        [isActiveSubagent(selectedAgent) ? "working" : "done"]: true,
      }));
    selectSubagent(null);
  };
  useLayoutEffect(() => {
    if (selection !== null || restoreFocusRef.current === null) return;
    const row = rowRefs.current.get(restoreFocusRef.current);
    (row ?? listRef.current)?.focus({ preventScroll: true });
    restoreFocusRef.current = null;
  }, [selection]);
  const uniqueTodos = useMemo(
    () =>
      messages
        ? getCurrentRunTodos(todos, getCurrentRunMessages(messages))
        : Array.from(new Map(todos.map((todo) => [todo.id, todo])).values()),
    [todos, messages],
  );
  const snapshot = useMemo(
    () =>
      buildAgentActivitySnapshot({
        todos: uniqueTodos,
        toolExecutions: toolExecutions.map((execution) =>
          "toolCallId" in execution &&
          pendingIds.has(execution.toolCallId ?? "")
            ? { ...execution, isExecuting: false, isSearching: false }
            : execution,
        ),
        messages,
        subagents,
        status,
      }),
    [messages, status, subagents, uniqueTodos, toolExecutions, pendingIds],
  );
  const subagentGroups = useMemo(
    () => ({
      working: snapshot.subagents.filter(isActiveSubagent),
      done: snapshot.subagents.filter((agent) => !isActiveSubagent(agent)),
    }),
    [snapshot.subagents],
  );
  const isStreaming = status === "streaming" || status === "submitted";
  const elapsedSeconds = useElapsedSeconds(isStreaming);
  const operationWindow = useMemo(() => {
    if (toolExecutions.length <= MAX_RENDERED_OPERATIONS) {
      return { executions: toolExecutions, startIndex: 0 };
    }

    const latestStart = toolExecutions.length - MAX_RENDERED_OPERATIONS;
    const centeredStart =
      currentIndex >= 0
        ? Math.max(
            0,
            Math.min(
              currentIndex - Math.floor(MAX_RENDERED_OPERATIONS / 2),
              latestStart,
            ),
          )
        : latestStart;

    return {
      executions: toolExecutions.slice(
        centeredStart,
        centeredStart + MAX_RENDERED_OPERATIONS,
      ),
      startIndex: centeredStart,
    };
  }, [currentIndex, toolExecutions]);

  const usage = useMemo(() => getRunUsageTotals(messages), [messages]);
  const contextFill = useMemo(() => getContextFillTokens(messages), [messages]);
  const hasRunActivity =
    uniqueTodos.length > 0 ||
    snapshot.subagents.length > 0 ||
    toolExecutions.length > 0;
  const hasRunDetails =
    hasRunActivity ||
    usage.tokens > 0 ||
    grants.length > 0 ||
    (contextFill > 0 && Boolean(contextWindowTokens));

  return (
    <section
      aria-label="Agent activity"
      className="flex h-full min-h-0 flex-col bg-background"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          event.nativeEvent.isComposing
        )
          return;
        const target = event.target as HTMLElement;
        const disclosure = target.closest<HTMLDetailsElement>("details[open]");
        if (disclosure && event.currentTarget.contains(disclosure)) {
          disclosure.open = false;
          disclosure
            .querySelector<HTMLElement>("summary")
            ?.focus({ preventScroll: true });
        } else if (selection !== null) {
          backToActivity();
        } else if (showCreateForm) {
          closeCreateForm();
        } else {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      {selection !== null ? (
        <SubagentDetail
          agent={selectedAgent}
          selectionKey={selection}
          onBack={backToActivity}
        />
      ) : null}
      <div
        ref={listRef}
        tabIndex={-1}
        hidden={selection !== null}
        className={
          selection !== null ? "hidden" : "flex h-full min-h-0 flex-col"
        }
      >
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {pendingIds.size > 0 && (
            <div className="m-3 rounded-lg border border-border p-3 text-sm">
              <p>Waiting for your approval. The pending action has not run.</p>
              {approvals.onReview && (
                <button
                  type="button"
                  onClick={approvals.onReview}
                  className="mt-2 rounded-md border border-border px-3 py-2 font-medium"
                >
                  Review in chat
                </button>
              )}
            </div>
          )}
          {!hasRunActivity && !isStreaming && !showCreateForm ? (
            <div className="px-4 py-5">
              <p className="text-[length:var(--rift-type-body)] font-medium text-foreground">
                No activity yet
              </p>
              <p className="mt-1 max-w-[36ch] text-[length:var(--rift-type-label)] leading-5 text-muted-foreground">
                Agent tasks and tool activity appear here as work starts.
              </p>
            </div>
          ) : null}
          {uniqueTodos.length > 0 ? (
            <div>
              <div className="flex items-center justify-between px-4 pb-2 pt-3">
                <h3 className={ACTIVITY_SECTION_TITLE_CLASS}>Plan</h3>
                {snapshot.totalSteps > 0 ? (
                  <span className={ACTIVITY_SECTION_COUNT_CLASS}>
                    {snapshot.completedSteps} / {snapshot.totalSteps}
                  </span>
                ) : null}
              </div>
              {snapshot.totalSteps > 0 ? (
                <ol className="px-2 pb-2">
                  {uniqueTodos.map((todo) => (
                    <li
                      key={todo.id}
                      className={activityPlanRowClass(todo.status)}
                      aria-current={
                        todo.status === "in_progress" ? "step" : undefined
                      }
                    >
                      <span className={activityPlanIconClass(todo.status)}>
                        {planStatusIcon(todo)}
                      </span>
                      <span className="min-w-0 flex-1 break-words">
                        {todo.content}
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          ) : null}

          {snapshot.subagents.length > 0 || onCreateSubagent ? (
            <div>
              <div className="flex min-h-10 items-center justify-between px-4 py-2">
                {snapshot.subagents.length > 0 ? (
                  <h3 className="text-[length:var(--rift-type-label)] font-medium text-foreground">
                    Agents
                  </h3>
                ) : (
                  <span />
                )}
                {onCreateSubagent ? (
                  <button
                    ref={createButtonRef}
                    type="button"
                    onClick={() => setShowCreateForm((open) => !open)}
                    aria-label="New subagent"
                    aria-expanded={showCreateForm}
                    aria-controls={createFormId}
                    className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[length:var(--rift-type-label)] text-muted-foreground hover:bg-foreground/[0.035] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    New
                  </button>
                ) : null}
              </div>
              {snapshot.subagents.length > 0 ? (
                <div className="px-2 pb-2">
                  {(["working", "done"] as const).map((kind) => {
                    const open = groupOpen[kind] ?? true;
                    return (
                      <SubagentGroup
                        key={kind}
                        agents={subagentGroups[kind]}
                        open={open}
                        onToggle={() =>
                          setGroupOpen((previous) => ({
                            ...previous,
                            [kind]: !open,
                          }))
                        }
                        label={kind === "working" ? "Active" : "Done"}
                        onSelect={selectSubagent}
                        registerRow={registerRow}
                      />
                    );
                  })}
                </div>
              ) : null}
              {showCreateForm && onCreateSubagent ? (
                <CreateSubagentForm
                  id={createFormId}
                  onCancel={closeCreateForm}
                  onCreate={onCreateSubagent}
                />
              ) : null}
            </div>
          ) : null}

          {toolExecutions.length > 0 ? (
            <div>
              <div className="flex items-center justify-between px-4 pb-2 pt-3">
                {/* No status here: the live phase and elapsed time are pinned to
                the last row of the trace, where the reader's eye already is. */}
                <h3 className={ACTIVITY_SECTION_TITLE_CLASS}>Operations</h3>
              </div>
              {toolExecutions.length > 0 ? (
                <ol className="px-3 pb-3">
                  {toolExecutions.length > MAX_RENDERED_OPERATIONS ? (
                    <li className="pb-1.5 text-[10px] tabular-nums text-muted-foreground">
                      Showing {operationWindow.startIndex + 1}-
                      {operationWindow.startIndex +
                        operationWindow.executions.length}
                      {" of "}
                      {toolExecutions.length} operations
                    </li>
                  ) : null}
                  {operationWindow.executions.map((execution, visibleIndex) => {
                    const index = operationWindow.startIndex + visibleIndex;
                    const executionStatus = getActivityStatus(execution, false);
                    const target = getDisplayTarget(execution);
                    const toolCallId =
                      "toolCallId" in execution
                        ? execution.toolCallId
                        : `operation-${index}`;
                    const awaitingApproval = pendingIds.has(toolCallId ?? "");
                    // Literal code tokens get the mono face; filenames and prose
                    // arguments do not. Grok draws the line in the same place.
                    const argIsCode =
                      isSidebarTerminal(execution) || isSidebarProxy(execution);
                    const isLast =
                      visibleIndex === operationWindow.executions.length - 1;

                    return (
                      <li key={toolCallId || `operation-${index}`}>
                        <button
                          type="button"
                          onClick={() => onSelectExecution?.(execution)}
                          disabled={!onSelectExecution}
                          aria-current={
                            index === currentIndex ? "step" : undefined
                          }
                          className={`${ACTIVITY_ROW_CLASS} ${styles.operation} ${
                            index === currentIndex
                              ? "[&_*]:text-foreground"
                              : ""
                          }`}
                        >
                          <span className={ACTIVITY_ICON_CLASS}>
                            {getSidebarIcon(execution, TRACE_ICON_CLASS)}
                          </span>
                          <span className={ACTIVITY_LABEL_GROUP_CLASS}>
                            <span
                              className={`${ACTIVITY_VERB_CLASS} ${
                                !awaitingApproval &&
                                executionStatus === "running"
                                  ? "rift-thinking-shimmer"
                                  : executionStatus === "error"
                                    ? "!text-destructive"
                                    : ""
                              }`}
                            >
                              {awaitingApproval
                                ? "Awaiting approval"
                                : getActionText(execution)}
                            </span>
                            {target ? (
                              <span
                                className={
                                  argIsCode
                                    ? ACTIVITY_ARG_MONO_CLASS
                                    : ACTIVITY_ARG_CLASS
                                }
                              >
                                {target}
                              </span>
                            ) : null}
                          </span>
                        </button>
                        {!isLast || isStreaming ? (
                          <div className={ACTIVITY_CONNECTOR_CLASS} aria-hidden>
                            <span className={ACTIVITY_CONNECTOR_TICK_CLASS} />
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              ) : null}
            </div>
          ) : null}
          {isStreaming ? (
            <div className="px-3 pb-3 pt-2">
              <div
                className={ACTIVITY_ROW_CLASS}
                role="status"
                aria-live="polite"
                data-ui="activity-live-row"
              >
                <span className={ACTIVITY_ICON_CLASS}>
                  <CursorActivityGlyph active />
                </span>
                <span className={ACTIVITY_LABEL_GROUP_CLASS}>
                  <span className={ACTIVITY_VERB_CLASS}>
                    {pendingIds.size > 0
                      ? "Waiting for approval"
                      : snapshot.label}
                  </span>
                  {elapsedSeconds === null ? null : (
                    <span className={ACTIVITY_ARG_CLASS} aria-hidden="true">
                      {formatElapsed(elapsedSeconds)}
                    </span>
                  )}
                </span>
              </div>
            </div>
          ) : null}
          {hasRunDetails ? (
            <details
              className={`${styles.disclosure} mx-3 mb-3 mt-2 border-t border-border/50 pt-2`}
            >
              <summary className={styles.summary}>
                <ChevronRight className={styles.chevron} aria-hidden="true" />
                <span>Run details</span>
                {grants.length > 0 ? (
                  <span className="ml-auto text-[length:var(--rift-type-caption)] font-normal">
                    {grants.length} shared
                  </span>
                ) : null}
              </summary>
              <dl className={styles.facts}>
                {snapshot.totalAgents > 0 ? (
                  <div className={styles.fact}>
                    <dt>Agents</dt>
                    <dd>
                      {snapshot.totalAgents} ({snapshot.activeAgents} active)
                    </dd>
                  </div>
                ) : null}
                {snapshot.toolOperations > 0 ? (
                  <div className={styles.fact}>
                    <dt>Tool operations</dt>
                    <dd>
                      {snapshot.toolOperations}
                      {snapshot.runningOperations > 0
                        ? ` (${snapshot.runningOperations} running)`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {snapshot.changedFiles > 0 ? (
                  <div className={styles.fact}>
                    <dt>Changed files</dt>
                    <dd>{snapshot.changedFiles}</dd>
                  </div>
                ) : null}
                {snapshot.diffStat.added > 0 ||
                snapshot.diffStat.removed > 0 ? (
                  <div className={styles.fact}>
                    <dt>Changed lines</dt>
                    <dd>
                      +{snapshot.diffStat.added} / −{snapshot.diffStat.removed}
                    </dd>
                  </div>
                ) : null}
                {contextFill > 0 && contextWindowTokens ? (
                  <div className={styles.fact} data-ui="context-fill">
                    <dt>Context used</dt>
                    <dd>
                      {formatTokenCount(contextFill)} /{" "}
                      {formatTokenCount(contextWindowTokens)}
                    </dd>
                  </div>
                ) : null}
                {usage.tokens > 0 ? (
                  <div className={styles.fact} data-ui="run-usage">
                    <dt>
                      {usage.isEstimated ? "Estimated tokens" : "Tokens used"}
                    </dt>
                    <dd>{formatTokenCount(usage.tokens)}</dd>
                  </div>
                ) : null}
                {usage.costDollars > 0 ? (
                  <div className={styles.fact}>
                    <dt>{usage.isEstimated ? "Estimated cost" : "Cost"}</dt>
                    <dd>
                      {usage.isEstimated ? "~" : ""}
                      {formatUsageDollars(usage.costDollars)}
                    </dd>
                  </div>
                ) : null}
              </dl>
              {grants.length > 0 ? (
                <div className="border-t border-border/50 pt-2">
                  <h3 className="px-1.5 text-[length:var(--rift-type-label)] font-medium text-foreground">
                    Shared items
                  </h3>
                  <dl className={styles.facts}>
                    {grants.map((grant) => (
                      <div key={grant.grantId} className={styles.fact}>
                        <dt>{grant.name}</dt>
                        <dd>{grant.writable ? "Can edit" : "Read only"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              ) : null}
            </details>
          ) : null}
        </div>
      </div>
    </section>
  );
}
