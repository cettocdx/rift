"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";
import { observeChatViewport } from "./chat-layout/ChatViewport";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { renderHackReport } from "@/lib/hack/report-html";
import { HackDispatchState } from "@/lib/chat/hack-dispatch-state";
import {
  createHackAssessmentDraft,
  getHackAssessmentDraft,
} from "@/lib/hack/assessment-drafts";
import { HackTurnTranscript } from "./hack/HackTurnTranscript";
import { reconcileCompletedResponses } from "@/lib/hack/reconcile-completed-response";
import { hasVisibleReasoningText } from "@/lib/chat/reasoning-state";
import { isConnectionFailure } from "@/lib/chat/interrupted-response";
import {
  hackCutoffMessage,
  hackResponseRange,
  hackToolSummary,
  redactHackCommand,
  type HackTranscriptItem,
} from "@/lib/hack/transcript-presentation";
import { HackWorkbenchHeader } from "./hack/HackWorkbenchHeader";
import { useMessageScroll } from "@/app/hooks/useMessageScroll";
import { useRetainedChat } from "@/app/hooks/useRetainedChat";
import { readApprovalMode } from "@/app/hooks/useApprovalMode";
import { ToolApprovalRequests } from "./ToolApprovalRequests";
import { DefaultChatTransport } from "ai";
import { fetchHackChatStream, cancelHackRun } from "@/lib/chat/hack-transport";
import { prepareMessagesForAgentReplay } from "@/lib/chat/agent-replay";
import { v4 as uuidv4 } from "uuid";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useFileUpload } from "@/app/hooks/useFileUpload";
import { useAutoResume } from "@/app/hooks/useAutoResume";
import { FilePartRenderer } from "./FilePartRenderer";
import { api } from "@/convex/_generated/api";
import { convertToUIMessages } from "@/lib/utils";
import type { FilePart } from "@/types/file";
import type { ChatMessage } from "@/types/chat";
import { isUserStoppedToolError } from "@/lib/chat/tool-abort-utils";
import {
  hasAssessmentEvidence,
  isAssessmentReportAvailable,
} from "@/lib/hack/assessment-report-state";
import {
  summarizeCoverage,
  canPresentCleanResult,
} from "@/lib/hack/report-coverage";
import {
  extractFindings,
  extractSubdomains,
  extractEndpoints,
  extractPorts,
} from "@/lib/hack/evidence-parsers";
export { extractFindings } from "@/lib/hack/evidence-parsers";
import {
  ChevronDown,
  FileSearch,
  FileText,
  Paperclip,
  Play,
  SquareTerminal,
  X as XIcon,
} from "lucide-react";

import {
  HACK_TASK_GROUPS as CHAIN,
  type TaskPreset,
} from "@/lib/hack/task-catalog";

const TASKS = CHAIN.flatMap((group) => group.ops);
/** Security operation entry stays owned by the dedicated Hack Workbench. */
export const HACK_WORKBENCH_OPERATION_IDS = TASKS.map((item) => item.id);
const TASK_BY_ID: Record<string, TaskPreset> = Object.fromEntries(
  TASKS.map((item) => [item.id, item]),
);
const taskPrompt = (preset: TaskPreset, target: string) =>
  preset.prompt.replaceAll(
    "{target}",
    target.trim() || "the authorized target",
  );
const PHASE_OF: Record<string, string> = {};
CHAIN.forEach((g) => g.ops.forEach((o) => (PHASE_OF[o.id] = g.title)));
type TItem = HackTranscriptItem;
type ToolItem = Extract<TItem, { kind: "tool" }>;
type ToolVisualState =
  | "preparing"
  | "running"
  | "waiting"
  | "complete"
  | "failed"
  | "stopped"
  | "denied"
  | "interrupted";
function toolVisualState(item: ToolItem, liveLast: boolean): ToolVisualState {
  if (hackToolSummary(item, liveLast).status === "failed") return "failed";
  if (item.state === "output-denied") return "denied";
  if (item.state === "output-error")
    return isUserStoppedToolError(item.errorText) ? "stopped" : "failed";
  if (item.state === "approval-requested") return "waiting";
  if (item.state === "output-available" && !item.preliminary) return "complete";
  if (liveLast) {
    if (item.state === "input-streaming") return "preparing";
    if (
      item.state === "input-available" ||
      item.state === "approval-responded" ||
      (item.state === "output-available" && item.preliminary) ||
      (!item.state && !item.out)
    )
      return "running";
  }
  if (item.out || item.streamOut) return "complete";
  return "interrupted";
}
type Turn = { role: "user" | "rift"; items: TItem[]; id?: string };
type Port = { port: string; proto: string; service: string; sev: string };
type Sev = "C" | "H" | "M" | "L";
type Finding = {
  id: string;
  sev: Sev;
  title: string;
  evidence: string;
  rec: string;
};
type Part = {
  type?: string;
  text?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  result?: unknown;
} & Record<string, unknown>;
type Msg = {
  id?: string;
  role: string;
  parts?: Part[];
  metadata?: ChatMessage["metadata"];
};

const MAX_TERMINAL_DISPLAY_CHARS = 96_000;
const MAX_EVIDENCE_ANALYSIS_CHARS = 512_000;
const MAX_RENDERED_TURNS = 80;
const OUTPUT_OMISSION_MARKER =
  "\n\n… earlier output omitted to keep the live console responsive …\n\n";

export function capLiveText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const available = Math.max(0, maxChars - OUTPUT_OMISSION_MARKER.length);
  const headLength = Math.floor(available * 0.35);
  const tailLength = available - headLength;
  return (
    text.slice(0, headLength) +
    OUTPUT_OMISSION_MARKER +
    text.slice(text.length - tailLength)
  );
}

/**
 * Join streamed chunks without first allocating their potentially enormous
 * full concatenation. We preserve both the beginning (command/banner) and the
 * newest tail (live findings/errors), giving extractors and operators useful
 * context while placing a hard upper bound on every render-time scan.
 */
export function joinBoundedText(
  parts: readonly string[],
  maxChars: number,
): string {
  const populated = parts.filter(Boolean);
  let totalLength = Math.max(0, populated.length - 1);
  for (const part of populated) totalLength += part.length;
  if (totalLength <= maxChars) return populated.join("\n");

  const available = Math.max(0, maxChars - OUTPUT_OMISSION_MARKER.length);
  const prefixBudget = Math.floor(available * 0.35);
  const suffixBudget = available - prefixBudget;

  let prefix = "";
  for (const part of populated) {
    const separator = prefix ? "\n" : "";
    const remaining = prefixBudget - prefix.length;
    if (remaining <= 0) break;
    const segment = `${separator}${part}`;
    prefix += segment.slice(0, remaining);
    if (segment.length > remaining) break;
  }

  let suffix = "";
  for (let index = populated.length - 1; index >= 0; index--) {
    const separator = suffix ? "\n" : "";
    const remaining = suffixBudget - suffix.length - separator.length;
    if (remaining <= 0) break;
    const part = populated[index];
    const selected =
      part.length > remaining ? part.slice(part.length - remaining) : part;
    suffix = `${selected}${separator}${suffix}`;
    if (part.length > remaining) break;
  }

  return `${prefix}${OUTPUT_OMISSION_MARKER}${suffix}`;
}

type HackTranscript = {
  lineCount: number;
  evidence: string;
  turns: Turn[];
};

function buildHackTranscript(messages: readonly Msg[]): HackTranscript {
  const turns: Turn[] = [];
  const evidenceParts: string[] = [];
  let lineCount = 0;

  for (const message of messages) {
    if (message.role === "user") {
      const items: TItem[] = [];
      const text = textOf(message);
      if (text) {
        lineCount += 1;
        items.push({ kind: "line", cls: "utext", text });
      }
      for (const part of message.parts ?? []) {
        if (part.type === "file") {
          items.push({ kind: "file", part: part as unknown as FilePart });
        }
      }
      if (items.length) {
        turns.push({ role: "user", items, id: message.id });
      }
      continue;
    }

    const items: TItem[] = [];
    const terminalChunksByToolCallId = new Map<string, string[]>();
    for (const part of message.parts ?? []) {
      if (part.type !== "data-terminal") continue;
      const data = part.data;
      if (!data || typeof data !== "object" || Array.isArray(data)) continue;
      const terminalData = data as Record<string, unknown>;
      const toolCallId = terminalData.toolCallId;
      const terminal = terminalData.terminal;
      if (typeof toolCallId !== "string" || typeof terminal !== "string") {
        continue;
      }
      const chunks = terminalChunksByToolCallId.get(toolCallId) ?? [];
      chunks.push(terminal);
      terminalChunksByToolCallId.set(toolCallId, chunks);
      evidenceParts.push(terminal);
    }

    const terminalOutputByToolCallId = new Map<string, string>();
    for (const [toolCallId, chunks] of terminalChunksByToolCallId) {
      terminalOutputByToolCallId.set(
        toolCallId,
        joinBoundedText(chunks, MAX_TERMINAL_DISPLAY_CHARS),
      );
    }

    let reasoningBuffer: string[] = [];
    let liveReasoningBuffer: string[] = [];
    let reasoningState: string | undefined;
    const flushReasoning = () => {
      if (!reasoningBuffer.length) return;
      const text = reasoningBuffer.join("");
      if (hasVisibleReasoningText(text)) {
        items.push({
          kind: "reason",
          text,
          state: hasVisibleReasoningText(liveReasoningBuffer.join(""))
            ? reasoningState
            : "done",
        });
      }
      reasoningBuffer = [];
      liveReasoningBuffer = [];
      reasoningState = undefined;
    };

    for (const part of message.parts ?? []) {
      if (part.type === "reasoning" && typeof part.text === "string") {
        lineCount += 1;
        reasoningBuffer.push(part.text);
        reasoningState = part.state;
        if (part.state === "done") liveReasoningBuffer = [];
        else liveReasoningBuffer.push(part.text);
        continue;
      }

      if (
        part.type === "text" &&
        typeof part.text === "string" &&
        part.text.trim()
      ) {
        lineCount += 1;
        flushReasoning();
        const cls = isCveOrTag(part.text) ? "crit" : "o";
        const previous = items[items.length - 1];
        if (previous?.kind === "line" && previous.cls === cls) {
          previous.text += part.text;
        } else {
          items.push({ kind: "line", cls, text: part.text });
        }
        continue;
      }

      if (part.type === "file") {
        flushReasoning();
        items.push({ kind: "file", part: part as unknown as FilePart });
        continue;
      }

      if (part.type?.startsWith("tool-")) {
        flushReasoning();
        const { cmd, out } = toolParts(part);
        const toolCallId =
          typeof part.toolCallId === "string" ? part.toolCallId : undefined;
        const streamOut = toolCallId
          ? (terminalOutputByToolCallId.get(toolCallId) ?? "")
          : "";
        if (out) evidenceParts.push(out);
        if (out || cmd || streamOut) lineCount += 1;
        const errorText =
          typeof part.errorText === "string" ? part.errorText : undefined;
        if (cmd || out || streamOut || part.state || errorText) {
          items.push({
            kind: "tool",
            name: part.type.replace(/^tool-/, ""),
            cmd,
            out: capLiveText(out, MAX_TERMINAL_DISPLAY_CHARS),
            streamOut,
            state: part.state,
            toolCallId,
            errorText: errorText
              ? capLiveText(errorText, MAX_TERMINAL_DISPLAY_CHARS)
              : undefined,
            preliminary: part.preliminary === true,
            input: part.input,
            output: part.output ?? part.result,
          });
        }
      }
    }
    flushReasoning();
    if (items.length) turns.push({ role: "rift", items, id: message.id });
  }

  return {
    lineCount,
    evidence: joinBoundedText(evidenceParts, MAX_EVIDENCE_ANALYSIS_CHARS),
    turns,
  };
}

const textOf = (m: Msg) =>
  (m.parts ?? [])
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text as string)
    .join("");

const OUTPUT_KEYS = [
  "stdout",
  "output",
  "content",
  "text",
  "result",
  "brief",
  "stderr",
];
function pickStringField(obj: Record<string, unknown>): string {
  for (const k of OUTPUT_KEYS) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}
function toolParts(part: Part): { cmd: string; out: string } {
  const inp = (part.input ?? {}) as Record<string, unknown>;
  const outObj = (part.output ?? part.result ?? {}) as Record<string, unknown>;
  let cmd = "";
  for (const k of ["command", "cmd", "query", "url", "path", "input"]) {
    const v = inp[k] ?? (part as Record<string, unknown>)[k];
    if (typeof v === "string" && v.trim()) {
      cmd = v.trim();
      break;
    }
  }
  // Most tools return a flat string field. run_terminal_cmd (and others) nest
  // the real payload one level deeper as `{ result: { output, exitCode, ... } }`
  // rather than a flat string — if the flat search comes up empty, descend
  // into any object-valued field of the same key set and retry once.
  let out =
    pickStringField(outObj) || pickStringField(part as Record<string, unknown>);
  if (!out) {
    for (const k of OUTPUT_KEYS) {
      const nested = outObj[k];
      if (nested && typeof nested === "object" && !Array.isArray(nested)) {
        out = pickStringField(nested as Record<string, unknown>);
        if (out) break;
      }
    }
  }
  return { cmd, out };
}

function terminalCommandPreview(command: string): string {
  const redacted = redactHackCommand(command);
  return redacted.length > 140 ? `${redacted.slice(0, 139)}…` : redacted;
}

const isCveOrTag = (t: string) => /CVE-\d|\[(critical|high)\]/i.test(t);
const SEV_ORDER: Record<Sev, number> = { C: 0, H: 1, M: 2, L: 3 };
const SEV_LABEL: Record<Sev, string> = {
  C: "CRIT",
  H: "HIGH",
  M: "MED",
  L: "LOW",
};

type OverviewMetric = {
  label: string;
  value: string | number;
  tone?: "blue" | "green" | "yellow" | "hot";
};

function OverviewCard({
  title,
  badge,
  metrics,
  actionLabel,
  actionIcon,
  onAction,
  actionDisabled = false,
}: {
  title: string;
  badge: string;
  metrics: OverviewMetric[];
  actionLabel: string;
  actionIcon: React.ReactNode;
  onAction: () => void;
  actionDisabled?: boolean;
}) {
  return (
    <article className="overview-card">
      <header className="overview-card-head">
        <div>
          <h2>{title}</h2>
          <span>{badge}</span>
        </div>
        <button
          type="button"
          className="overview-action"
          onClick={onAction}
          disabled={actionDisabled}
          aria-label={actionLabel}
          title={actionLabel}
        >
          {actionIcon}
        </button>
      </header>
      <dl className="overview-metrics">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <dt>{metric.label}</dt>
            <dd className={metric.tone ?? ""} title={String(metric.value)}>
              {metric.value}
            </dd>
          </div>
        ))}
      </dl>
    </article>
  );
}

function LiveRunTimer() {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = performance.now();
    const timer = window.setInterval(() => {
      setSeconds((performance.now() - startedAt) / 1000);
    }, 200);
    return () => window.clearInterval(timer);
  }, []);

  return <>{seconds.toFixed(1)}s</>;
}

export function HackerMode({
  chatId,
  accountId,
  durableEnabled = false,
  onNewAssessment,
  onPreviousAssessment,
}: {
  chatId: string;
  accountId?: string;
  durableEnabled?: boolean;
  onNewAssessment?: () => void;
  onPreviousAssessment?: () => void;
}) {
  const [localDraft] = useState(createHackAssessmentDraft);
  const viewportRef = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      viewportRef.current
        ? observeChatViewport(viewportRef.current)
        : undefined,
    [],
  );
  const draft = useMemo(
    () => (accountId ? getHackAssessmentDraft(accountId, chatId) : localDraft),
    [accountId, chatId, localDraft],
  );
  const { target, cmd, activeOp } = useSyncExternalStore(
    draft.subscribe,
    draft.getSnapshot,
    draft.getServerSnapshot,
  );
  const { setTarget, setCmd, setActiveOp } = draft;
  const [fallbackDispatch] = useState(() => new HackDispatchState());
  const dispatchStateRef = useRef(fallbackDispatch);
  const transportSessionRef = useRef<{
    getMessages: () => ChatMessage[];
    setMessages: (messages: ChatMessage[]) => void;
    registerResumeAbort: (abort: () => void) => () => void;
    registerRequestContext: (body: Record<string, unknown>) => void;
  }>({
    getMessages: () => [],
    setMessages: () => {},
    registerResumeAbort: () => () => {},
    registerRequestContext: () => {},
  });
  const streamStateRef = useRef<{
    durable: boolean;
    legacy: boolean;
    http?: string;
    loaded: boolean;
  }>({ durable: false, legacy: false, loaded: false });
  const { selectedModel, setChatPurpose } = useGlobalState();
  const {
    fileInputRef,
    handleFileUploadEvent,
    handleRemoveFile,
    handleAttachClick,
    getUploadedFileMessageParts,
    anyFilesUploading,
    uploadedFiles = draft.uploads.getSnapshot(),
    clearUploadedFiles = draft.uploads.clear,
  } = useFileUpload("agent", {
    store: draft.uploads,
    sandboxPreference: "e2b",
  });
  const paginatedMessages = usePaginatedQuery(
    api.messages.getMessagesByChatId,
    { chatId },
    { initialNumItems: MAX_RENDERED_TURNS },
  );
  const chatData = useQuery(api.chats.getChatByIdFromClient, { id: chatId });
  const pendingToolApprovals = useQuery(api.approvals.pending, { chatId });
  useLayoutEffect(() => {
    streamStateRef.current = {
      durable: Boolean(chatData?.active_trigger_run_id),
      legacy: Boolean(chatData?.active_stream_id),
      http: chatData?.active_http_execution_id,
      loaded: chatData !== undefined,
    };
  }, [
    chatData,
    chatData?.active_trigger_run_id,
    chatData?.active_stream_id,
    chatData?.active_http_execution_id,
  ]);
  const serverMessages: ChatMessage[] = useMemo(
    () =>
      paginatedMessages.results.length > 0
        ? convertToUIMessages([...paginatedMessages.results].reverse())
        : [],
    [paginatedMessages.results],
  );
  const fetchAssessment = useCallback<
    NonNullable<
      NonNullable<
        ConstructorParameters<typeof DefaultChatTransport>[0]
      >["fetch"]
    >
  >(
    (_input, init) => {
      const controls = transportSessionRef.current;
      const requestDispatchId =
        dispatchStateRef.current.getSnapshot().dispatchId;
      return fetchHackChatStream(
        {
          chatId,
          durableEnabled,
          hasDurableRun: streamStateRef.current.durable,
          hasLegacyStream:
            streamStateRef.current.legacy ||
            Boolean(streamStateRef.current.http),
          registerResumeAbort: controls.registerResumeAbort,
          onHttpExecution: (executionId) => {
            dispatchStateRef.current.restore(
              requestDispatchId,
              executionId,
              "http",
            );
          },
          onReplay: (runId) => {
            const current = controls.getMessages();
            const replayBase = prepareMessagesForAgentReplay(current, runId);
            if (replayBase !== current) controls.setMessages(replayBase);
          },
          onRequestContext: (context) => {
            // A late response from an older request must not rebind a new turn.
            if (
              requestDispatchId !==
              dispatchStateRef.current.getSnapshot().dispatchId
            )
              return;
            if (context.dispatchId)
              dispatchStateRef.current.restore(
                requestDispatchId,
                context.dispatchId,
              );
            controls.registerRequestContext(context);
            if (context.purpose === "security" && context.scope !== undefined)
              setTarget(context.scope);
          },
        },
        init,
      );
    },
    [chatId, durableEnabled, setTarget],
  );
  const prepareAssessmentReconnect = useCallback(
    ({ id }: { id: string }) => ({
      api:
        durableEnabled || streamStateRef.current.durable
          ? `/api/hack-long/resume?chatId=${encodeURIComponent(id)}`
          : `/api/chat/${encodeURIComponent(id)}/stream`,
    }),
    [durableEnabled],
  );
  const prepareAssessmentSend = useCallback<
    NonNullable<
      NonNullable<
        ConstructorParameters<typeof DefaultChatTransport>[0]
      >["prepareSendMessagesRequest"]
    >
  >(
    ({ id, messages, body }) => {
      const dispatchId = durableEnabled
        ? messages.findLast((message) => message.role === "user")?.id
        : uuidv4();
      dispatchStateRef.current.begin(
        dispatchId,
        durableEnabled ? "durable" : "http",
      );
      return {
        body: {
          chatId: id,
          messages: messages.slice(-1),
          purpose: "security",
          ...body,
          ...(!durableEnabled ? { executionId: dispatchId } : {}),
        },
      };
    },
    [durableEnabled],
  );
  const transport = useMemo(
    () =>
      // The SDK constructor stores these callbacks; it never invokes fetch or
      // reconnect during render. They read committed session refs on I/O only.
      new DefaultChatTransport({
        api: durableEnabled ? "/api/hack-long" : "/api/hack-chat",
        fetch: fetchAssessment,
        prepareReconnectToStreamRequest: prepareAssessmentReconnect,
        // Persisted chats are rebuilt from the database on the server. Sending
        // the entire client transcript here duplicates every earlier turn in
        // model context, so only submit the newly-created message.
        prepareSendMessagesRequest: prepareAssessmentSend,
      }),
    [
      durableEnabled,
      fetchAssessment,
      prepareAssessmentReconnect,
      prepareAssessmentSend,
    ],
  );
  const {
    messages,
    sendMessage,
    setMessages,
    status,
    stop,
    error,
    resumeStream,
    retentionEnabled,
    stopRetainedReader,
    getRetainedMessages,
    registerResumeAbort,
    registerRequestContext,
    hackDispatch,
  } = useRetainedChat({
    id: chatId,
    experimental_throttle: 50,
    transport,
    messages: serverMessages,
    generateId: () => uuidv4(),
  });
  const dispatchState = hackDispatch ?? fallbackDispatch;
  const cancellation = useSyncExternalStore(
    dispatchState.subscribe,
    dispatchState.getSnapshot,
    dispatchState.getSnapshot,
  );
  const stopping = cancellation.status === "stopping";
  const stopError = cancellation.status === "failed";
  useLayoutEffect(() => {
    dispatchStateRef.current = dispatchState;
  }, [dispatchState]);
  useLayoutEffect(() => {
    transportSessionRef.current = {
      getMessages: getRetainedMessages ?? (() => messages),
      setMessages,
      registerResumeAbort: registerResumeAbort ?? (() => () => {}),
      registerRequestContext: registerRequestContext ?? (() => {}),
    };
  }, [
    getRetainedMessages,
    messages,
    setMessages,
    registerResumeAbort,
    registerRequestContext,
  ]);
  const stoppedEarlyRef = useRef(false);
  const [wasStoppedEarly, setStoppedEarly] = useState(false);
  const stoppedEarly = wasStoppedEarly || cancellation.status !== "idle";
  useLayoutEffect(() => {
    if (cancellation.status !== "idle") stoppedEarlyRef.current = true;
  }, [cancellation.status]);
  const [interruptedResponses, setInterruptedResponses] = useState(
    () => new Set<string>(),
  );
  const markCurrentResponseInterrupted = useCallback(() => {
    const latest = messages.at(-1);
    if (latest?.role !== "assistant") return;
    setInterruptedResponses((previous) =>
      previous.has(latest.id) ? previous : new Set(previous).add(latest.id),
    );
  }, [messages]);
  // Preserve the outcome before a later turn clears the SDK error. Adjust
  // render state only when that external error changes, avoiding an extra
  // post-paint effect that briefly relabels the previous response.
  const [recordedError, setRecordedError] = useState<unknown>(undefined);
  if (error !== recordedError) {
    setRecordedError(error);
    if (error) markCurrentResponseInterrupted();
  }
  const cancelStreamMutation = useMutation(
    api.chatStreams.cancelStreamFromClient,
  );
  // Stop the retained reader immediately, then require an acknowledged stop
  // from the producer. An unconfirmed result remains visible and retryable.
  const stopOperation = useCallback(() => {
    if (dispatchState.getSnapshot().status === "stopping") return;
    stoppedEarlyRef.current = true;
    setStoppedEarly(true);
    markCurrentResponseInterrupted();
    void stop();
    // Pin retries to the originally stopped request, even if newer messages
    // arrive from another window while its acknowledgment is uncertain.
    const fallbackId = transportSessionRef.current
      .getMessages()
      .findLast((message) => message.role === "user")?.id;
    const snapshot = dispatchState.getSnapshot();
    const producer =
      snapshot.stopTransport ??
      snapshot.transport ??
      (streamStateRef.current.http
        ? "http"
        : streamStateRef.current.durable
          ? "durable"
          : streamStateRef.current.loaded && streamStateRef.current.legacy
            ? "legacy"
            : undefined);
    if (!producer) {
      dispatchState.rejectUnidentifiedStop();
      return;
    }
    void dispatchState
      .cancel(
        producer === "http" ? streamStateRef.current.http : fallbackId,
        (dispatchId) =>
          cancelHackRun({
            chatId,
            dispatchId,
            durable: producer === "durable",
            transport: producer,
            ...(producer === "http" ? { executionId: dispatchId } : {}),
            cancelLegacy: () => cancelStreamMutation({ chatId }),
          }),
        producer,
      )
      .catch(() => {
        /* The retained failed state keeps Retry Stop visible. */
      });
  }, [
    stop,
    dispatchState,
    cancelStreamMutation,
    chatId,
    markCurrentResponseInterrupted,
  ]);
  const historyHydratedRef = useRef(false);
  useEffect(() => {
    if (historyHydratedRef.current) return;
    if (paginatedMessages.status === "LoadingFirstPage") return;
    if (status !== "ready") return;

    // A completed Hack session is loaded after the client hook is created.
    // Hydrate it exactly once; if the operator already submitted a new turn,
    // preserve that live local state instead of replacing it with a query.
    if (messages.length === 0 && serverMessages.length > 0) {
      setMessages(serverMessages);
    }
    historyHydratedRef.current = true;
  }, [
    messages.length,
    paginatedMessages.status,
    serverMessages,
    setMessages,
    status,
  ]);
  const recoveryPending = useAutoResume({
    autoResume: true,
    status,
    error,
    stopReader: stopRetainedReader,
    preserveReaderOnUnmount: retentionEnabled,
    hasManuallyStoppedRef: stoppedEarlyRef,
    initialMessages: serverMessages,
    resumeStream,
    setMessages,
    hasActiveStream:
      chatData === undefined
        ? undefined
        : Boolean(
            chatData?.active_stream_id ||
            chatData?.active_trigger_run_id ||
            chatData?.active_http_execution_id,
          ),
  });
  const settledForPresentation =
    status === "ready" &&
    chatData !== undefined &&
    !chatData?.active_stream_id &&
    !chatData?.active_trigger_run_id &&
    !chatData?.active_http_execution_id;
  const msgs = useMemo(
    () =>
      reconcileCompletedResponses(
        messages,
        serverMessages,
        settledForPresentation,
      ) as unknown as Msg[],
    [messages, serverMessages, settledForPresentation],
  );

  const savedInterruptedResponses = useMemo(() => {
    const ids = new Set<string>();
    // Message-level cancellation survives later turns and page reloads.
    for (const message of [...serverMessages, ...msgs]) {
      if (
        message.id &&
        message.role === "assistant" &&
        message.metadata?.stopReason === "user"
      ) {
        ids.add(message.id);
      }
    }
    // Chat-level outcome belongs only to the latest settled turn. Never apply
    // an old failure while the next request is being submitted or resumed.
    const latest = msgs.at(-1);
    if (
      status === "ready" &&
      !chatData?.active_stream_id &&
      !chatData?.active_trigger_run_id &&
      (chatData?.last_run_error || chatData?.canceled_at) &&
      latest?.role === "assistant" &&
      latest.id
    )
      ids.add(latest.id);
    return ids;
  }, [serverMessages, msgs, status, chatData]);

  const savedCutoffResponses = useMemo(() => {
    const reasons = new Map<string, string>();
    // Per-message outcomes survive later turns. Saved metadata also applies
    // when the retained local reader ended before it received the finish part.
    for (const message of [...msgs, ...serverMessages]) {
      if (
        message.id &&
        message.role === "assistant" &&
        message.metadata?.finishReason !== undefined
      ) {
        reasons.set(message.id, message.metadata.finishReason);
      }
    }
    const latest = msgs.at(-1);
    const latestSaved = serverMessages.at(-1);
    // Compatibility for history loaded before the message projection includes
    // finish_reason. A chat outcome belongs only to its latest settled answer;
    // never override a message's explicit completed outcome or an active run.
    if (
      status === "ready" &&
      chatData !== undefined &&
      !chatData?.active_stream_id &&
      !chatData?.active_trigger_run_id &&
      latest?.role === "assistant" &&
      latest.id &&
      latest.id === latestSaved?.id &&
      !reasons.has(latest.id) &&
      chatData?.finish_reason
    ) {
      reasons.set(latest.id, chatData.finish_reason);
    }
    return new Map(
      [...reasons].flatMap(([id, reason]) => {
        const message = hackCutoffMessage(reason);
        return message ? [[id, message] as const] : [];
      }),
    );
  }, [serverMessages, msgs, status, chatData]);

  const [taskQuery, setTaskQuery] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [overlay, setOverlay] = useState<
    | null
    | { type: "tasks" }
    | { type: "findings" }
    | { type: "finding"; f: Finding }
    | { type: "report" }
  >(null);
  const cmdRef = useRef<HTMLTextAreaElement>(null);
  const resizeCommand = useCallback(() => {
    const input = cmdRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(144, Math.max(24, input.scrollHeight))}px`;
  }, []);
  useLayoutEffect(resizeCommand, [cmd, resizeCommand]);
  useLayoutEffect(() => {
    const input = cmdRef.current;
    if (!input || typeof ResizeObserver === "undefined") return;
    let previousWidth: number | undefined;
    let frame: number | undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = entry?.contentRect.width;
      // Height changes caused by autosizing must not trigger another resize.
      if (!width || width === previousWidth) return;
      previousWidth = width;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = undefined;
        resizeCommand();
      });
    });
    observer.observe(input);
    return () => {
      observer.disconnect();
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [resizeCommand]);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const overlayPanelRef = useRef<HTMLDivElement>(null);
  const overlayCloseRef = useRef<HTMLButtonElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const spinRef = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<HTMLCanvasElement>(null);
  // Which phases this session actually launched. A phase that never ran is a
  // coverage gap the report has to declare, and only the session knows this.
  const ranPhasesRef = useRef<Set<string>>(new Set());
  const runningRef = useRef(false);
  const activityRef = useRef(0);
  const critRef = useRef(false);
  const findingsRef = useRef(0);
  const portsRef = useRef(0);

  useEffect(() => setChatPurpose("security"), [setChatPurpose]);
  const reconnecting =
    isConnectionFailure(error) &&
    !stoppedEarlyRef.current &&
    Boolean(
      chatData?.active_stream_id ||
      chatData?.active_trigger_run_id ||
      chatData?.active_http_execution_id,
    );
  const running =
    status === "submitted" ||
    status === "streaming" ||
    stopping ||
    stopError ||
    recoveryPending ||
    reconnecting;
  useEffect(() => {
    if (!running) return;
    const startedAt = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [running]);

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((open) => {
      const nextOpen = !open;
      if (!nextOpen) {
        const activeElement = document.activeElement;
        if (activeElement?.closest("#rift-task-sidebar"))
          requestAnimationFrame(() => sidebarToggleRef.current?.focus());
      }
      return nextOpen;
    });
  }, []);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "b") {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [toggleSidebar]);
  const filteredChain = useMemo(() => {
    const query = taskQuery.trim().toLowerCase();
    if (!query) return CHAIN;
    return CHAIN.map((group) => ({
      ...group,
      ops: group.ops.filter((item) =>
        `${item.label} ${item.detail}`.toLowerCase().includes(query),
      ),
    })).filter((group) => group.ops.length > 0);
  }, [taskQuery]);

  const exec = useCallback(() => {
    if (running || anyFilesUploading()) return;
    const v = cmd.trim();
    const files = getUploadedFileMessageParts();
    if (!v && files.length === 0) return;
    stoppedEarlyRef.current = false;
    setStoppedEarly(false);
    setElapsed(0);
    const preset = TASKS.find((preset) => taskPrompt(preset, target) === v);
    setActiveOp(preset?.id ?? "custom");
    const phase = preset && PHASE_OF[preset.id];
    if (phase) ranPhasesRef.current.add(phase);
    setCmd("");
    // Free-text console input runs in AGENT mode so the operator gets the full
    // toolchain (run_terminal_cmd + sandbox → nmap/nuclei/sqlmap) and can
    // directly execute, not just discuss. Ask mode strips every terminal tool.
    void sendMessage(
      // FileMessagePart intentionally omits `url` (S3 URLs expire; resolved
      // on-demand via fileId) so it doesn't structurally match the AI SDK's
      // FileUIPart — same cast used at the main chat's send call site.
      {
        text: v || undefined,
        files: files.length ? (files as any) : undefined,
      },
      {
        body: {
          mode: "agent",
          purpose: "security",
          scope: target.trim(),
          selectedModel,
          sandboxPreference: "e2b",
          approvalMode: readApprovalMode(),
          todos: [],
        },
      },
    );
    if (files.length) clearUploadedFiles();
  }, [
    cmd,
    target,
    sendMessage,
    selectedModel,
    anyFilesUploading,
    getUploadedFileMessageParts,
    clearUploadedFiles,
    running,
    setActiveOp,
    setCmd,
  ]);

  const prepareCommand = useCallback(
    (opId: string, verb: string) => {
      if (running) return;
      const safeTarget = target.trim();
      if (!safeTarget) return;
      setActiveOp(opId);
      setCmd(`${verb} ${safeTarget}`);
      requestAnimationFrame(() => cmdRef.current?.focus());
    },
    [running, target, setActiveOp, setCmd],
  );

  const prepareTask = useCallback(
    (preset: TaskPreset) => {
      if (running) return;
      setActiveOp(preset.id);
      setCmd(taskPrompt(preset, target));
      requestAnimationFrame(() => cmdRef.current?.focus());
    },
    [running, target, setActiveOp, setCmd],
  );

  const changeTarget = useCallback(
    (nextTarget: string) => {
      const preset = TASK_BY_ID[activeOp];
      setCmd((current) =>
        preset && current === taskPrompt(preset, target)
          ? taskPrompt(preset, nextTarget)
          : current,
      );
      setTarget(nextTarget);
    },
    [activeOp, target, setCmd, setTarget],
  );

  const launchTask = useCallback(
    (preset: TaskPreset, taskTarget: string) => {
      if (running || !taskTarget.trim()) {
        cmdRef.current?.focus();
        return;
      }
      stoppedEarlyRef.current = false;
      setStoppedEarly(false);
      setElapsed(0);
      // Record the phase before the request leaves: the report needs to know
      // which phases ran, and a phase that never launched is a coverage gap.
      const phase = PHASE_OF[preset.id];
      if (phase) ranPhasesRef.current.add(phase);
      setActiveOp(preset.id);
      setCmd("");
      void sendMessage(
        { text: taskPrompt(preset, taskTarget) },
        {
          body: {
            mode: "agent",
            purpose: "security",
            scope: taskTarget.trim(),
            selectedModel,
            sandboxPreference: "e2b",
            approvalMode: readApprovalMode(),
            todos: [],
          },
        },
      );
    },
    [running, selectedModel, sendMessage, setActiveOp, setCmd],
  );

  // RUN button + target-field enter launches the selected capability preset.
  const runTarget = useCallback(() => {
    if (running) return;
    if (cmd.trim()) {
      exec();
      return;
    }
    const preset = TASK_BY_ID[activeOp];
    if (preset) launchTask(preset, target);
  }, [activeOp, cmd, exec, launchTask, running, target]);

  // Build the terminal turns, evidence index, and display count in one pass.
  // Tool output is bounded before regex/tokenization so long-running scanners
  // remain responsive instead of reprocessing an ever-growing transcript on
  // every streamed chunk.
  const { lineCount, evidence, turns } = useMemo(
    () => buildHackTranscript(msgs),
    [msgs],
  );
  // Keep loaded turns mounted: a new turn must not evict readable history.
  const visibleTurns = turns;
  const assessmentHasEvidence = hasAssessmentEvidence(evidence);
  const reportAvailable = isAssessmentReportAvailable(evidence, running);
  const latestTurn = turns.at(-1);
  const latestCutoff = latestTurn?.id
    ? savedCutoffResponses.get(latestTurn.id)
    : undefined;
  const latestResponsePartial =
    latestTurn?.role === "rift" &&
    Boolean(
      latestCutoff ||
      error ||
      stoppedEarly ||
      (latestTurn.id &&
        (interruptedResponses.has(latestTurn.id) ||
          savedInterruptedResponses.has(latestTurn.id))),
    );
  // Announce the same latest-turn outcome as the visible response. An older
  // partial answer must not change a later turn's completion announcement.
  const settledAnnouncement = latestResponsePartial
    ? `Partial assessment response. ${latestCutoff ?? "The run was interrupted."}`
    : !running &&
        latestTurn?.role === "rift" &&
        hackResponseRange(latestTurn.items, false)
      ? "Assessment response ready"
      : lineCount
        ? "Assessment ended without a final response."
        : "Security console ready";
  const liveActivity = useMemo(() => {
    if (!running) return { kind: "idle", label: "Ready", detail: "" } as const;
    const latestTurn = turns.at(-1);
    const currentTurn = latestTurn?.role === "rift" ? latestTurn : undefined;
    const item = currentTurn?.items[currentTurn.items.length - 1];
    if (item?.kind === "tool") {
      const command = item.cmd.replace(/\s+/g, " ").trim();
      const program = command.split(" ")[0] || item.name.replaceAll("_", " ");
      const visualState = toolVisualState(item, true);
      return {
        kind: "tool",
        label:
          visualState === "failed"
            ? `${program} failed`
            : visualState === "stopped"
              ? `${program} stopped`
              : visualState === "denied"
                ? `${program} denied`
                : visualState === "waiting"
                  ? `${program} needs approval`
                  : visualState === "complete"
                    ? `${program} completed — reading output`
                    : visualState === "preparing"
                      ? `Preparing ${program}…`
                      : `Running ${program}…`,
        detail: terminalCommandPreview(command),
      } as const;
    }
    if (item?.kind === "reason" && item.state !== "done")
      return {
        kind: "thinking",
        label: "Planning the next step…",
        detail: "Considering your request and the available evidence",
      } as const;
    if (item?.kind === "line")
      return {
        kind: "writing",
        label: "Writing response…",
        detail: "Responding to your request",
      } as const;
    return {
      kind: "waiting",
      label: "Working…",
      detail: "Reading your request",
    } as const;
  }, [running, turns]);

  const ports: Port[] = useMemo(() => extractPorts(evidence), [evidence]);

  const findings = useMemo(() => extractFindings(evidence), [evidence]);
  const subdomains = useMemo(
    () => extractSubdomains(evidence, target),
    [evidence, target],
  );
  const endpoints = useMemo(() => extractEndpoints(evidence), [evidence]);

  const resolvedIp = useMemo(() => {
    const m = evidence.match(/(\d+\.\d+\.\d+\.\d+)/);
    return m ? m[1] : "—";
  }, [evidence]);
  const rdns = useMemo(() => {
    const m = evidence.match(/\(([a-z0-9.-]+\.[a-z]{2,})\)/i);
    return m ? m[1] : "—";
  }, [evidence]);

  const sevCounts = useMemo(() => {
    const c = { C: 0, H: 0, M: 0, L: 0 } as Record<Sev, number>;
    for (const v of findings) c[v.sev] += 1;
    return c;
  }, [findings]);
  const critCount = sevCounts.C + ports.filter((p) => p.sev === "c").length;
  const threat = !assessmentHasEvidence
    ? "PENDING"
    : critCount
      ? "CRITICAL"
      : findings.length || ports.length
        ? "ELEVATED"
        : "LOW";

  // Feed the live 3D attack-surface + scan with real signal from the console.
  const activity = Math.min(
    1,
    findings.length * 0.11 +
      ports.length * 0.07 +
      subdomains.length * 0.03 +
      endpoints.length * 0.02 +
      (running ? 0.12 : 0),
  );

  const {
    scrollRef: termRef,
    contentRef: transcriptContentRef,
    isAtBottom: followingOutput,
    scrollToBottom: scrollTranscriptToBottom,
  } = useMessageScroll();
  const followLatest = useCallback(() => {
    scrollTranscriptToBottom({ force: true });
  }, [scrollTranscriptToBottom]);

  useEffect(() => {
    if (window.matchMedia("(min-width: 761px)").matches) {
      cmdRef.current?.focus();
    }
  }, []);

  // ESC closes any overlay
  useEffect(() => {
    if (!overlay) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    requestAnimationFrame(() => overlayCloseRef.current?.focus());
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOverlay(null);
        return;
      }
      if (e.key !== "Tab") return;
      const panel = overlayPanelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", h);
    return () => {
      window.removeEventListener("keydown", h);
      previouslyFocused?.focus();
    };
  }, [overlay]);

  // ---- Pentest report (professional, print-to-PDF) ----
  const buildReportHtml = useCallback(() => {
    // What the assessment did NOT establish. A report that lists only findings
    // invites the reader to treat their absence as safety; a stopped scan, a
    // failed tool or an unrun phase has simply not looked.
    const coverage = summarizeCoverage({
      messages: msgs as unknown as ReadonlyArray<{
        parts?: ReadonlyArray<Record<string, unknown>>;
      }>,
      allPhases: CHAIN.map((group) => group.title),
      ranPhases: [...ranPhasesRef.current],
      stoppedEarly: stoppedEarlyRef.current,
      target,
    });
    return renderHackReport({
      coverage,
      findings,
      ports,
      subdomains,
      endpoints,
      target,
      sevCounts,
      threat,
    });
  }, [findings, ports, subdomains, endpoints, target, sevCounts, threat, msgs]);

  const downloadPdf = useCallback(() => {
    if (!reportAvailable) return;
    const html = buildReportHtml();
    const w = window.open("", "_blank", "width=900,height=1200");
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => {
      try {
        w.print();
      } catch {
        /* user can print manually */
      }
    }, 400);
  }, [buildReportHtml, reportAvailable]);

  // Keep live canvas inputs current without restarting its animation effect.
  useEffect(() => {
    runningRef.current = running;
    activityRef.current = activity;
    critRef.current = critCount > 0;
    findingsRef.current = findings.length;
    portsRef.current = ports.length;
  }, [activity, critCount, findings.length, ports.length, running]);

  // canvases: faint bg grid + scan tick-spinner + wireframe blob
  useEffect(() => {
    const visualCanvases = [
      bgRef.current,
      spinRef.current,
      blobRef.current,
    ].filter((canvas): canvas is HTMLCanvasElement => Boolean(canvas));
    if (
      visualCanvases.length === 0 ||
      visualCanvases.every((canvas) => canvas.getClientRects().length === 0)
    )
      return;
    const reduce = window.matchMedia("(prefers-reduced-motion:reduce)").matches;
    let raf = 0,
      sa = 0,
      ba = 0;
    const dpi = (c: HTMLCanvasElement) => {
      const r = c.getBoundingClientRect();
      const d = Math.min(2, window.devicePixelRatio || 1);
      c.width = r.width * d;
      c.height = r.height * d;
      const x = c.getContext("2d")!;
      x.setTransform(d, 0, 0, d, 0, 0);
      return { x, w: r.width, h: r.height };
    };
    let bg: ReturnType<typeof dpi> | null = null;
    let sp: ReturnType<typeof dpi> | null = null;
    let bl: ReturnType<typeof dpi> | null = null;
    const measure = () => {
      bg = bgRef.current ? dpi(bgRef.current) : null;
      sp = spinRef.current ? dpi(spinRef.current) : null;
      bl = blobRef.current ? dpi(blobRef.current) : null;
      if (bg) {
        const { x, w, h } = bg;
        x.clearRect(0, 0, w, h);
        x.strokeStyle = "rgba(255,255,255,.035)";
        x.lineWidth = 1;
        const s = Math.max(w, h) / 9;
        for (let gx = 0; gx < w; gx += s) {
          x.beginPath();
          x.moveTo(gx, 0);
          x.lineTo(gx, h);
          x.stroke();
        }
        for (let gy = 0; gy < h; gy += s) {
          x.beginPath();
          x.moveTo(0, gy);
          x.lineTo(w, gy);
          x.stroke();
        }
      }
    };
    measure();
    window.addEventListener("resize", measure);
    const LAT = 18,
      LON = 26;
    const frame = () => {
      const act = activityRef.current;
      const crit = critRef.current;
      // spinner
      if (spinRef.current && sp) {
        const { x, w, h } = sp;
        const cx = w / 2,
          cy = h / 2,
          Rr = Math.min(w, h) / 2 - 3;
        x.clearRect(0, 0, w, h);
        sa += reduce ? 0 : runningRef.current ? 0.05 : 0.012 + act * 0.02;
        const N = 44;
        for (let i = 0; i < N; i++) {
          const a = (i / N) * 6.283,
            near = (((sa - a) % 6.283) + 6.283) % 6.283,
            on = near < 1.1;
          const r1 = Rr - (on ? 9 : 5),
            r2 = Rr;
          x.beginPath();
          x.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
          x.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
          x.strokeStyle = on
            ? crit
              ? "rgba(255,80,80,.95)"
              : "rgba(255,255,255,.95)"
            : "rgba(255,255,255,.22)";
          x.lineWidth = 1.3;
          x.stroke();
        }
        x.beginPath();
        x.arc(cx, cy, 7, 0, 7);
        x.strokeStyle = "rgba(255,255,255,.8)";
        x.lineWidth = 1.2;
        x.stroke();
      }
      // wireframe blob — deformation, spin and lighting all scale with activity
      if (blobRef.current && bl) {
        const { x, w, h } = bl;
        const cx = w / 2,
          cy = h / 2,
          Rr = Math.min(w, h) * 0.36;
        x.clearRect(0, 0, w, h);
        ba += reduce ? 0 : (runningRef.current ? 0.016 : 0.006) + act * 0.02;
        const cosY = Math.cos(ba),
          sinY = Math.sin(ba),
          cosX = Math.cos(0.5),
          sinX = Math.sin(0.5);
        const amp = 0.16 * (1 + act * 1.6);
        const pts: { x: number; y: number; z: number }[][] = [];
        for (let i = 0; i <= LAT; i++) {
          pts[i] = [];
          const th = (i / LAT) * Math.PI;
          for (let j = 0; j <= LON; j++) {
            const ph = (j / LON) * 2 * Math.PI;
            const def =
              1 +
              amp * Math.sin(3 * th + ba) * Math.cos(4 * ph) +
              0.08 * Math.cos(2 * th);
            const r = Rr * def,
              X = r * Math.sin(th) * Math.cos(ph),
              Y = r * Math.cos(th),
              Z = r * Math.sin(th) * Math.sin(ph);
            const x1 = X * cosY - Z * sinY,
              z1 = X * sinY + Z * cosY,
              y1 = Y * cosX - z1 * sinX,
              z2 = Y * sinX + z1 * cosX;
            pts[i][j] = { x: cx + x1, y: cy + y1, z: z2 };
          }
        }
        const accent = crit ? [255, 90, 90] : [43, 211, 255];
        for (let i = 0; i <= LAT; i++)
          for (let j = 0; j <= LON; j++) {
            const p = pts[i][j];
            let op = (p.z + Rr) / (2 * Rr);
            op = (runningRef.current ? 0.17 : 0.1) + op * 0.5;
            const useAccent =
              act > 0.02 &&
              (i * 7 + j) % Math.max(2, Math.round(7 - act * 5)) === 0;
            x.strokeStyle = useAccent
              ? `rgba(${accent[0]},${accent[1]},${accent[2]},${(op * (0.5 + act * 0.5)).toFixed(3)})`
              : "rgba(255,255,255," + op.toFixed(3) + ")";
            x.lineWidth = runningRef.current ? 0.7 : 0.6;
            if (j < LON) {
              const q = pts[i][j + 1];
              x.beginPath();
              x.moveTo(p.x, p.y);
              x.lineTo(q.x, q.y);
              x.stroke();
            }
            if (i < LAT) {
              const q2 = pts[i + 1][j];
              x.beginPath();
              x.moveTo(p.x, p.y);
              x.lineTo(q2.x, q2.y);
              x.stroke();
            }
          }
        // node pulses — one bright vertex per discovered artefact
        const nodes = Math.min(24, findingsRef.current + portsRef.current);
        for (let n = 0; n < nodes; n++) {
          const ii = (n * 5 + 3) % (LAT + 1),
            jj = (n * 9 + 5) % (LON + 1);
          const p = pts[ii][jj];
          if (p.z < 0) continue;
          const pulse = 0.5 + 0.5 * Math.sin(ba * 3 + n);
          x.beginPath();
          x.arc(p.x, p.y, 1.4 + pulse * 1.2, 0, 7);
          x.fillStyle = crit
            ? `rgba(255,90,90,${(0.4 + pulse * 0.5).toFixed(2)})`
            : `rgba(43,211,255,${(0.4 + pulse * 0.5).toFixed(2)})`;
          x.fill();
        }
      }
      if (!reduce) raf = requestAnimationFrame(frame);
    };
    frame();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
  }, []);

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const activePhase = PHASE_OF[activeOp] ?? (activeOp ? "CUSTOM" : "—");
  const scanBig = ports.length || subdomains.length;
  const scanLabel = running
    ? "SCANNING…"
    : ports.length
      ? "OPEN SERVICES"
      : subdomains.length
        ? "HOSTS MAPPED"
        : "IDLE";
  const meterFill = running
    ? elapsed % 38
    : Math.min(38, findings.length * 3 + ports.length * 2);
  const meter = Array.from({ length: 38 }, (_, i) => i < meterFill);

  return (
    <div
      ref={viewportRef}
      data-rift-workspace
      className={`fui rift-chat-viewport sidebar-${sidebarOpen ? "open" : "closed"}${
        running ? " is-running" : ""
      }`}
    >
      <RootShellPresence kind="workspace" />
      <style
        dangerouslySetInnerHTML={{
          __html:
            CSS +
            CURSOR_OVERRIDES +
            REFERENCE_OVERRIDES +
            PRODUCT_TYPOGRAPHY +
            WORKBENCH_REFINEMENT,
        }}
      />
      <a className="skip-link" href="#rift-console">
        Skip to security console
      </a>

      <HackWorkbenchHeader
        onNewAssessment={onNewAssessment}
        onPreviousAssessment={onPreviousAssessment}
        target={target}
        onTargetChange={changeTarget}
        onRun={runTarget}
        onStop={stopOperation}
        running={running}
        canRun={Boolean(target.trim() && TASK_BY_ID[activeOp])}
        elapsed={`${mm}:${ss}`}
        taskName={TASK_BY_ID[activeOp]?.label ?? "Choose a task"}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenTaskBrowser={() => setOverlay({ type: "tasks" })}
        sidebarToggleRef={sidebarToggleRef}
      />

      {turns.length > 0 && (
        <details className="overview-panel">
          <summary className="overview-toggle">
            <span>Assessment overview</span>
            <span className="overview-counts">
              {subdomains.length} hosts · {findings.length} findings
            </span>
            <ChevronDown size={14} aria-hidden="true" />
          </summary>
          <section className="overview" aria-label="Assessment overview">
            <OverviewCard
              title="Attack surface"
              // A target selects scope; it does not establish authorization.
              badge={target.trim() ? "SCOPE SET" : "SCOPE REQUIRED"}
              metrics={[
                { label: "Hosts", value: subdomains.length },
                { label: "Services", value: ports.length },
                { label: "Endpoints", value: endpoints.length, tone: "blue" },
                { label: "Resolved IP", value: resolvedIp, tone: "blue" },
                { label: "Phase", value: activePhase, tone: "yellow" },
                { label: "Target", value: target || "—" },
              ]}
              actionDisabled={
                !running && (!target.trim() || !TASK_BY_ID[activeOp])
              }
              actionLabel={
                running ? "Stop active assessment" : "Run active task"
              }
              actionIcon={<Play size={13} aria-hidden="true" />}
              onAction={() => {
                if (running) stopOperation();
                else runTarget();
              }}
            />
            <OverviewCard
              title="Verified risk"
              badge={threat}
              metrics={[
                { label: "Findings", value: findings.length },
                {
                  label: "Critical",
                  value: critCount,
                  tone: critCount ? "hot" : undefined,
                },
                {
                  label: "High",
                  value: sevCounts.H,
                  tone: sevCounts.H ? "yellow" : undefined,
                },
                { label: "Medium", value: sevCounts.M },
                { label: "Low", value: sevCounts.L, tone: "blue" },
                {
                  label: "Posture",
                  value: threat,
                  tone:
                    threat === "PENDING"
                      ? undefined
                      : threat === "LOW"
                        ? "green"
                        : "hot",
                },
              ]}
              actionLabel="Open verified findings"
              actionIcon={<FileSearch size={13} aria-hidden="true" />}
              onAction={() => setOverlay({ type: "findings" })}
              actionDisabled={!findings.length}
            />
            <OverviewCard
              title="Agent session"
              badge={running ? "LIVE" : "READY"}
              metrics={[
                {
                  label: "Selected task",
                  value:
                    TASK_BY_ID[activeOp]?.label ??
                    (activeOp ? "Custom request" : "Choose a task"),
                },
                { label: "Model", value: "RIFT", tone: "blue" },
                { label: "Mode", value: "AGENT", tone: "blue" },
                {
                  label: "State",
                  value: running ? "WORKING" : "READY",
                  tone: running ? "yellow" : "green",
                },
                {
                  label: "Tools used",
                  value: turns.reduce(
                    (total, turn) =>
                      total +
                      turn.items.filter((item) => item.kind === "tool").length,
                    0,
                  ),
                },
                { label: "Transcript", value: `${lineCount} lines` },
              ]}
              actionLabel={
                reportAvailable
                  ? "Open assessment report"
                  : running
                    ? "Report available when the current assessment finishes"
                    : "Run an assessment to create an evidence report"
              }
              actionIcon={<FileText size={13} aria-hidden="true" />}
              onAction={() => setOverlay({ type: "report" })}
              actionDisabled={!reportAvailable}
            />
          </section>
        </details>
      )}

      <nav
        id="rift-task-sidebar"
        className="win ops"
        aria-label="Security operations"
        aria-hidden={!sidebarOpen}
        inert={!sidebarOpen}
      >
        <div className="wbar">
          <span className="wt">Tasks</span>
          <span className="wid">{TASKS.length} CAPABILITIES</span>
        </div>
        <label className="task-filter">
          <span aria-hidden="true">⌕</span>
          <span className="sr-only">Filter security tasks</span>
          <input
            type="search"
            name="task-filter"
            value={taskQuery}
            onChange={(event) => setTaskQuery(event.target.value)}
            placeholder="Filter tasks…"
            spellCheck={false}
            autoComplete="off"
          />
          {taskQuery && (
            <button
              type="button"
              onClick={() => setTaskQuery("")}
              aria-label="Clear task filter"
            >
              ×
            </button>
          )}
        </label>
        <div className="chain">
          {filteredChain.map((g) => (
            <div
              key={g.title}
              className={"ph" + (g.title === activePhase ? " act" : "")}
            >
              <div className="ph-h">
                <span className="t">{g.title}</span>
                <span className="n">{g.ops.length}</span>
              </div>
              {g.ops.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  className={"op" + (o.id === activeOp ? " on" : "")}
                  onClick={() => prepareTask(o)}
                  disabled={running}
                  title={o.detail}
                >
                  <span className="mk" />
                  <span className="op-copy">
                    <b>{o.label}</b>
                    <small>{o.detail}</small>
                  </span>
                  <span className="op-arrow" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          ))}
          {filteredChain.length === 0 && (
            <p className="task-empty">No Matching Task</p>
          )}
        </div>
        <section
          className="ops-summary"
          aria-label="Current assessment summary"
        >
          <div className="summary-head">
            <span>Current Run</span>
            <b>{running ? "Working" : "Ready"}</b>
          </div>
          <dl>
            <div>
              <dt>Hosts</dt>
              <dd>{subdomains.length}</dd>
            </div>
            <div>
              <dt>Services</dt>
              <dd>{ports.length}</dd>
            </div>
            <div>
              <dt>Findings</dt>
              <dd>{findings.length}</dd>
            </div>
            <div>
              <dt>Critical</dt>
              <dd className={critCount ? "hot" : ""}>{critCount}</dd>
            </div>
          </dl>
          <div className="summary-actions">
            <button
              type="button"
              onClick={() => setOverlay({ type: "findings" })}
              disabled={!findings.length}
            >
              Findings
            </button>
            <button
              type="button"
              onClick={() => setOverlay({ type: "report" })}
              disabled={!reportAvailable}
              title={
                reportAvailable
                  ? "Open assessment report"
                  : "Complete an assessment with evidence first"
              }
            >
              Open Report
            </button>
          </div>
        </section>
        <div className="kit">
          <span className="lbl">AVAILABLE TOOLS</span>
          <div className="tags">
            <span className="tg">terminal</span>
            <span className="tg">web search</span>
            <span className="tg">files</span>
            <span className="tg">sandbox</span>
          </div>
        </div>
      </nav>

      <main
        className="win term"
        id="rift-console"
        tabIndex={-1}
        aria-busy={running}
      >
        <div className="wbar">
          <span className="wt">rift / hack</span>
          <span className="wid">
            ~/security{activeOp ? `/${activePhase.toLowerCase()}` : ""}
          </span>
          <span className="sr-only" role="status" aria-live="polite">
            {pendingToolApprovals?.length
              ? "Awaiting your approval"
              : running
                ? liveActivity.label
                : settledAnnouncement}
          </span>
          {running ? (
            <span className="livetool">
              <span className="ld" />
              {liveActivity.kind === "tool"
                ? "TERMINAL"
                : liveActivity.kind.toUpperCase()}
            </span>
          ) : (
            <span className="wid">{lineCount} lines</span>
          )}
          <span
            className="mobile-stats"
            aria-label={`${subdomains.length} hosts, ${ports.length} ports, ${findings.length} findings`}
          >
            <span>H {subdomains.length}</span>
            <span>P {ports.length}</span>
            <span>F {findings.length}</span>
          </span>
          <div className="console-actions">
            <button
              type="button"
              onClick={() => setOverlay({ type: "findings" })}
              disabled={!findings.length}
            >
              Findings {findings.length}
            </button>
            <button
              type="button"
              onClick={() => setOverlay({ type: "report" })}
              disabled={!reportAvailable}
              title={
                reportAvailable
                  ? "Open assessment report"
                  : "Complete an assessment with evidence first"
              }
            >
              Open Report
            </button>
          </div>
        </div>
        {!followingOutput && (
          <button
            type="button"
            className="follow-output"
            aria-label="Scroll to latest output"
            title="Scroll to latest output"
            onClick={followLatest}
          >
            <ChevronDown size={16} aria-hidden="true" />
          </button>
        )}
        <div
          className="out"
          ref={termRef}
          role="log"
          aria-label="Assessment conversation"
          aria-live="off"
          tabIndex={0}
        >
          <div ref={transcriptContentRef} className="transcript-content">
            {stopError && (
              <div className="session-error" role="alert">
                <div>
                  <b>Stop not confirmed</b>
                  <span>
                    The assessment may still be running. Try Stop again to
                    confirm cancellation.
                  </span>
                </div>
                <button
                  type="button"
                  disabled={stopping}
                  onClick={stopOperation}
                >
                  {stopping ? "Stopping…" : "Retry Stop"}
                </button>
              </div>
            )}
            {reconnecting && (
              <div className="session-reconnect" role="status">
                Reconnecting to your assessment…
              </div>
            )}
            {error && !reconnecting && (
              <div className="session-error" role="alert">
                <div>
                  <b>Assessment interrupted</b>
                  <span>
                    RIFT did not receive a complete response. Check the target
                    scope or connection, then submit the task again.
                  </span>
                </div>
                <button type="button" onClick={() => cmdRef.current?.focus()}>
                  Return to prompt
                </button>
              </div>
            )}
            {lineCount === 0 && (
              <div className="welc">
                <div className="scope">
                  <span className="scope-dot" />
                  {target.trim() ? "SELECTED SCOPE" : "SCOPE REQUIRED"}{" "}
                  <span className="scope-target">
                    {target || "target required"}
                  </span>
                </div>
                <h2 className="wt2">What should RIFT assess?</h2>
                <div className="ws">
                  Choose a task or describe what you need. RIFT uses only the
                  tools relevant to your request. Add a target when an
                  assessment needs one.
                </div>
                <p className="welcome-hint">
                  {TASKS.length} built-in tasks · free-form terminal requests ·
                  files and evidence supported
                </p>
              </div>
            )}
            {paginatedMessages.status === "CanLoadMore" && (
              <button
                type="button"
                className="history-window-notice"
                onClick={() => paginatedMessages.loadMore(MAX_RENDERED_TURNS)}
              >
                Load earlier messages
              </button>
            )}
            {paginatedMessages.status === "LoadingMore" && (
              <p role="status">Loading earlier messages…</p>
            )}
            {visibleTurns.map((t, i) => {
              const isLast = i === visibleTurns.length - 1;
              return (
                <div
                  key={t.id ?? `${t.role}-${i}`}
                  data-message-id={t.id ?? `${t.role}-${i}`}
                  className={"turn " + t.role}
                >
                  <div className="thead">
                    <span className="who">
                      {t.role === "user" ? "›" : "RIFT"}
                    </span>
                  </div>
                  <div className="tbody">
                    {t.role === "rift" ? (
                      <HackTurnTranscript
                        items={t.items}
                        running={running && isLast}
                        cutoffMessage={
                          t.id ? savedCutoffResponses.get(t.id) : undefined
                        }
                        interrupted={
                          Boolean(
                            t.id &&
                            (interruptedResponses.has(t.id) ||
                              savedInterruptedResponses.has(t.id)),
                          ) ||
                          (isLast && Boolean(error || stoppedEarly))
                        }
                        messageId={t.id ?? String(i)}
                        actions={
                          isLast && reportAvailable ? (
                            <footer className="answer-actions">
                              <button
                                type="button"
                                onClick={() => setOverlay({ type: "report" })}
                              >
                                Open Evidence Report
                              </button>
                              <button
                                type="button"
                                className="primary"
                                onClick={downloadPdf}
                              >
                                Print / Save PDF
                              </button>
                            </footer>
                          ) : undefined
                        }
                      />
                    ) : (
                      t.items.map((item, index) =>
                        item.kind === "file" ? (
                          <div key={index} className="filerow">
                            <FilePartRenderer
                              part={item.part}
                              partIndex={index}
                              messageId={t.id ?? String(i)}
                            />
                          </div>
                        ) : item.kind === "line" ? (
                          <div key={index} className="ln utext">
                            {item.text}
                          </div>
                        ) : null,
                      )
                    )}
                  </div>
                </div>
              );
            })}
            <ToolApprovalRequests requests={pendingToolApprovals ?? []} />
          </div>
        </div>
        {uploadedFiles.length > 0 && (
          <div className="filebar">
            {uploadedFiles.map((f, i) => (
              <span
                key={draft.uploads.idOf(f) ?? i}
                className={
                  "chip" + (f.error ? " err" : f.uploading ? " up" : "")
                }
              >
                <span className="cn">{f.file.name}</span>
                {f.uploading && <span className="cs">uploading…</span>}
                {f.error && <span className="cs">failed</span>}
                <button
                  type="button"
                  className="cx"
                  onClick={() => handleRemoveFile(i)}
                  aria-label="Remove file"
                >
                  <XIcon size={10} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          aria-label="Upload files"
          onChange={handleFileUploadEvent}
        />
        {running && (
          <div className={`run-status phase-${liveActivity.kind}`}>
            <SquareTerminal
              className="run-terminal-icon"
              size={13}
              aria-hidden="true"
            />
            <span className="run-pulse" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="run-phase" aria-hidden="true">
              {liveActivity.kind === "tool"
                ? "TERMINAL ACTIVE"
                : liveActivity.kind === "thinking"
                  ? "REASONING"
                  : liveActivity.kind === "writing"
                    ? "REPORT"
                    : "SESSION"}
            </span>
            <span
              key={`${liveActivity.kind}:${liveActivity.label}`}
              className="run-copy"
            >
              <b>{liveActivity.label}</b>
              {liveActivity.detail && <code>{liveActivity.detail}</code>}
            </span>
            <span className="run-timer" aria-hidden="true">
              <LiveRunTimer />
            </span>
            <span className="run-context" aria-hidden="true">
              {liveActivity.kind === "tool" ? "terminal" : "RIFT"}
            </span>
            <button
              type="button"
              className="run-stop"
              onClick={() => stopOperation()}
              aria-label="Stop active security operation"
            >
              stop
            </button>
          </div>
        )}
        <div className="mobile-ops" aria-label="Mobile security actions">
          <button
            type="button"
            className="mobile-task-browser-trigger"
            onClick={() => setOverlay({ type: "tasks" })}
            aria-label={`Browse all ${TASKS.length} security tasks`}
          >
            Tasks <span>{TASKS.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setOverlay({ type: "report" })}
            disabled={!reportAvailable}
            title={
              reportAvailable
                ? "Open assessment report"
                : "Complete an assessment with evidence first"
            }
          >
            Open Report
          </button>
        </div>
        <div className="prompt">
          <span className="ps" aria-hidden="true">
            ›
          </span>
          <button
            type="button"
            className="k attach"
            onClick={handleAttachClick}
            title="Attach files for the agent"
            aria-label="Attach files"
          >
            <Paperclip size={12} aria-hidden="true" />
          </button>
          <textarea
            ref={cmdRef}
            rows={1}
            name="security-command"
            aria-label="Security agent command"
            value={cmd}
            onChange={(e) => setCmd(e.target.value)}
            onKeyDown={(e) => {
              if (
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                exec();
              }
            }}
            placeholder="Ask RIFT to assess the authorized scope…"
            spellCheck={false}
            autoComplete="off"
          />
          <span className="mode-badge">RIFT · high</span>
          <button
            type="button"
            className="k send"
            onClick={exec}
            disabled={
              running ||
              anyFilesUploading() ||
              (!cmd.trim() && getUploadedFileMessageParts().length === 0)
            }
            aria-label={
              running ? "Security request in progress" : "Send security request"
            }
          >
            {running ? "…" : "↵"}
          </button>
        </div>
      </main>

      <aside className="stack">
        <section className="win dossier">
          <div className="wbar">
            <span className="wt">Target</span>
            <span className="wid">DOSSIER</span>
            <span className="panel-state">READY</span>
          </div>
          <div className="dbody">
            <div className="hexrow">
              <span className="hx6 f" />
              <span className="hx6" />
              <span className="hx6" />
            </div>
            <div className="code">{resolvedIp}</div>
            <div className="sub">{rdns}</div>
            <div className="drow">
              <span className="k">&gt;HOST</span>
              <span className="v">{target}</span>
            </div>
            <div className="drow">
              <span className="k">&gt;STATUS</span>
              <span className={"v" + (resolvedIp !== "—" ? " inv" : "")}>
                {resolvedIp !== "—" ? "UP" : "—"}
              </span>
            </div>
            <div className="drow">
              <span className="k">&gt;THREAT</span>
              <span className={"v" + (critCount ? " crit" : "")}>{threat}</span>
            </div>
            <div className="dactions">
              <button
                type="button"
                onClick={() => prepareCommand("recon", "recon")}
                disabled={running}
              >
                Prepare Recon
              </button>
              <button
                type="button"
                onClick={() => prepareCommand("osint", "osint")}
                disabled={running}
              >
                Prepare OSINT
              </button>
            </div>
          </div>
        </section>

        <section className="win listwin reportwin">
          <div className="wbar">
            <span className="wt">Pentest Report</span>
            <span className="panel-state">
              {reportAvailable ? "READY" : running ? "BUILDING" : "PENDING"}
            </span>
            <button
              type="button"
              className="expand"
              onClick={() => setOverlay({ type: "report" })}
              aria-label="Open pentest report"
              disabled={!reportAvailable}
              title={
                reportAvailable
                  ? "Open pentest report"
                  : "Complete an assessment with evidence first"
              }
            >
              ⤢
            </button>
            <button
              type="button"
              className="pdf"
              onClick={downloadPdf}
              title="Print or save report as PDF"
              aria-label="Print or save report as PDF"
              disabled={!reportAvailable}
            >
              PDF
            </button>
          </div>
          <div className="rbrief">
            <div className="rstat">
              <b>{assessmentHasEvidence ? findings.length : "—"}</b>
              <i>findings</i>
            </div>
            <div className="rstat">
              <b className={critCount ? "hot" : ""}>
                {assessmentHasEvidence ? critCount : "—"}
              </b>
              <i>critical</i>
            </div>
            <div className="rstat">
              <b>{assessmentHasEvidence ? ports.length : "—"}</b>
              <i>services</i>
            </div>
            <div className="rstat">
              <b>{assessmentHasEvidence ? endpoints.length : "—"}</b>
              <i>paths</i>
            </div>
          </div>
          <div className="body">
            {!assessmentHasEvidence ? (
              <div className="lempty report-empty">
                <span>
                  No assessment evidence yet. Run an authorized task to build a
                  verified report.
                </span>
              </div>
            ) : running ? (
              <div className="lempty report-empty">
                <span>
                  Assessment in progress. The report unlocks when this run
                  finishes.
                </span>
              </div>
            ) : findings.length === 0 ? (
              <div className="lempty report-empty">
                <span>
                  Evidence captured. No verified findings were recorded in this
                  run.
                </span>
                <button
                  type="button"
                  onClick={() => setOverlay({ type: "report" })}
                >
                  Open Report →
                </button>
              </div>
            ) : null}
            {findings.slice(0, 3).map((v) => (
              <button
                type="button"
                key={"r" + v.id}
                className="nrow action"
                onClick={() => setOverlay({ type: "finding", f: v })}
              >
                <div className="nhead">
                  <span className={"ncat sev " + v.sev}>
                    {SEV_LABEL[v.sev]}
                  </span>
                  <span className="ntitle">{v.title}</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="win scan">
          <div className="wbar">
            <span className="wt">Scan</span>
            <span className="wid">{activePhase}</span>
            <button
              type="button"
              className={"panel-action" + (running ? " stop" : "")}
              onClick={() => {
                if (running) stopOperation();
                else runTarget();
              }}
            >
              {running ? "Stop" : "Run Active"}
            </button>
          </div>
          <div className="sbody">
            <div className="smeta">
              <div key={scanBig} className="big flash">
                {scanBig}
              </div>
              <div className="st">{scanLabel}</div>
              <div className="barmeter">
                {meter.map((f, i) => (
                  <i key={i} className={f ? "f" : ""} />
                ))}
              </div>
              <div className="srow">
                <span>
                  HOSTS{" "}
                  <b key={subdomains.length} className="flash">
                    {subdomains.length}
                  </b>
                </span>
                <span>
                  PATHS{" "}
                  <b key={endpoints.length} className="flash">
                    {endpoints.length}
                  </b>
                </span>
                <span>
                  CRIT{" "}
                  <b
                    key={critCount}
                    className={(critCount ? "hot" : "") + " flash"}
                  >
                    {critCount}
                  </b>
                </span>
              </div>
            </div>
          </div>
        </section>

        <section className="win surface">
          <div className="wbar">
            <span className="wt">Attack Surface</span>
            <span className={"panel-state" + (running ? " live" : "")}>
              {running ? "LIVE" : "READY"}
            </span>
          </div>
          <div className="surfwrap">
            <span className="cnr c1" />
            <span className="cnr c2" />
            <span className="cnr c3" />
            <span className="cnr c4" />
            <button
              type="button"
              key={"h" + subdomains.length}
              className="snum n1 flash"
              onClick={() => prepareCommand("subdomains", "enum")}
              disabled={running}
              aria-label="Prepare subdomain enumeration"
            >
              <i>HOSTS</i>
              {String(subdomains.length).padStart(3, "0")}
            </button>
            <button
              type="button"
              key={"p" + ports.length}
              className="snum n2 flash"
              onClick={() => prepareCommand("network-scan", "scan")}
              disabled={running}
              aria-label="Prepare port and service scan"
            >
              <i>PORTS</i>
              {String(ports.length).padStart(3, "0")}
            </button>
            <button
              type="button"
              key={"e" + endpoints.length}
              className="snum n3 flash"
              onClick={() => prepareCommand("web-vulns", "web")}
              disabled={running}
              aria-label="Prepare web exposure scan"
            >
              <i>PATHS</i>
              {String(endpoints.length).padStart(3, "0")}
            </button>
            <button
              type="button"
              key={"f" + findings.length}
              className={"snum n4 flash" + (critCount ? " hot" : "")}
              onClick={() => prepareCommand("nuclei", "nuclei")}
              disabled={running}
              aria-label="Prepare vulnerability discovery"
            >
              <i>VULNS</i>
              {String(findings.length).padStart(3, "0")}
            </button>
          </div>
        </section>

        <section className="win listwin findswin">
          <div className="wbar">
            <span className="wt">Findings</span>
            <span className="sevtally">
              <span className={"tl c" + (sevCounts.C ? " on" : "")}>
                {sevCounts.C} CRIT
              </span>
              <span className={"tl h" + (sevCounts.H ? " on" : "")}>
                {sevCounts.H} HIGH
              </span>
              <span
                className={"tl m" + (sevCounts.M + sevCounts.L ? " on" : "")}
              >
                {sevCounts.M + sevCounts.L} M/L
              </span>
            </span>
            <button
              type="button"
              className="expand"
              onClick={() => setOverlay({ type: "findings" })}
              disabled={!findings.length}
              title="Open findings"
              aria-label="Open all findings"
            >
              ⤢
            </button>
          </div>
          <div className="body">
            {findings.length === 0 && (
              <div className="lempty empty-cta">
                <span>No findings yet. Prepare an evidence-backed scan.</span>
                <button
                  type="button"
                  onClick={() => prepareCommand("nuclei", "nuclei")}
                  disabled={running}
                >
                  Prepare Vuln Scan →
                </button>
              </div>
            )}
            {findings.map((v, i) => (
              <button
                type="button"
                key={v.id}
                className="frow"
                style={{ animationDelay: i * 0.05 + "s" }}
                onClick={() => setOverlay({ type: "finding", f: v })}
              >
                <span className={"fsv " + v.sev}>{SEV_LABEL[v.sev]}</span>
                <span className="fnum">{String(i + 1).padStart(2, "0")}</span>
                <span className="ft">{v.title}</span>
                <span className="fgo">→</span>
              </button>
            ))}
          </div>
        </section>
      </aside>

      <footer className="bar">
        <span className="sg">
          <b>Shift+Tab</b> mode
        </span>
        <span className="sg">
          <b>Ctrl+B</b> tasks
        </span>
        <span className="sg">
          {running ? (
            <b>
              working · {mm}:{ss}
            </b>
          ) : (
            <b>ready</b>
          )}
        </span>
        <span className="sp" />
        <span
          className="sg"
          style={{ borderRight: 0, borderLeft: "1px solid var(--line)" }}
          title="RIFT primary · automatic fallback"
        >
          RIFT (high) · sandboxed · {target}
        </span>
      </footer>

      {overlay && (
        <div
          className={`ovl${overlay.type === "tasks" ? " task-browser-overlay" : ""}`}
          onClick={() => setOverlay(null)}
        >
          <div
            ref={overlayPanelRef}
            className={`ovlpanel${overlay.type === "tasks" ? " task-browser-panel" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              overlay.type === "tasks"
                ? "Security tasks"
                : overlay.type === "finding"
                  ? overlay.f.title
                  : overlay.type === "findings"
                    ? "Security findings"
                    : "Pentest report"
            }
            onClick={(e) => e.stopPropagation()}
          >
            {overlay.type === "tasks" && (
              <>
                <div className="ovlbar">
                  <h2 className="ovltitle">SECURITY TASKS · {TASKS.length}</h2>
                  <button
                    type="button"
                    ref={overlayCloseRef}
                    className="ovlx"
                    onClick={() => setOverlay(null)}
                    aria-label="Close security tasks"
                  >
                    Close ×
                  </button>
                </div>
                <div className="ovlbody mobile-task-browser">
                  <label className="task-filter mobile-task-filter">
                    <FileSearch size={15} aria-hidden="true" />
                    <span className="sr-only">Filter security tasks</span>
                    <input
                      type="search"
                      name="mobile-task-filter"
                      value={taskQuery}
                      onChange={(event) => setTaskQuery(event.target.value)}
                      placeholder="Search all security tasks…"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {taskQuery && (
                      <button
                        type="button"
                        onClick={() => setTaskQuery("")}
                        aria-label="Clear mobile task filter"
                      >
                        ×
                      </button>
                    )}
                  </label>
                  <div className="mobile-task-groups">
                    {filteredChain.map((group) => (
                      <section key={group.title}>
                        <header>
                          <h3>{group.title}</h3>
                          <span>{group.ops.length}</span>
                        </header>
                        <div>
                          {group.ops.map((preset) => (
                            <button
                              type="button"
                              key={preset.id}
                              className={
                                preset.id === activeOp ? "is-active" : ""
                              }
                              onClick={() => {
                                prepareTask(preset);
                                setOverlay(null);
                              }}
                              disabled={running}
                              title={preset.detail}
                            >
                              <span>
                                <b>{preset.label}</b>
                                <small>{preset.detail}</small>
                              </span>
                              <span aria-hidden="true">›</span>
                            </button>
                          ))}
                        </div>
                      </section>
                    ))}
                    {filteredChain.length === 0 && (
                      <p className="task-empty">No matching task</p>
                    )}
                  </div>
                </div>
              </>
            )}
            {overlay.type === "finding" && (
              <>
                <div className="ovlbar">
                  <span className={"fsv " + overlay.f.sev}>
                    {SEV_LABEL[overlay.f.sev]}
                  </span>
                  <h2 className="ovltitle">{overlay.f.title}</h2>
                  <button
                    type="button"
                    ref={overlayCloseRef}
                    className="ovlx"
                    onClick={() => setOverlay(null)}
                    aria-label="Close finding details"
                  >
                    ESC ×
                  </button>
                </div>
                <div className="ovlbody">
                  <div className="fsec">
                    <h4>SEVERITY</h4>
                    <p className={"sevword " + overlay.f.sev}>
                      {SEV_LABEL[overlay.f.sev]}
                    </p>
                  </div>
                  <div className="fsec">
                    <h4>EVIDENCE</h4>
                    <pre>{overlay.f.evidence}</pre>
                  </div>
                  <div className="fsec">
                    <h4>RECOMMENDATION</h4>
                    <p>{overlay.f.rec}</p>
                  </div>
                  <div className="fsec">
                    <h4>TARGET</h4>
                    <p className="mono">{target}</p>
                  </div>
                </div>
              </>
            )}
            {overlay.type === "findings" && (
              <>
                <div className="ovlbar">
                  <h2 className="ovltitle">FINDINGS · {findings.length}</h2>
                  <span className="ovltally">
                    <span className="fsv C">{sevCounts.C}</span>
                    <span className="fsv H">{sevCounts.H}</span>
                    <span className="fsv M">{sevCounts.M}</span>
                    <span className="fsv L">{sevCounts.L}</span>
                  </span>
                  <button
                    type="button"
                    ref={overlayCloseRef}
                    className="ovlx"
                    onClick={() => setOverlay(null)}
                    aria-label="Close findings"
                  >
                    ESC ×
                  </button>
                </div>
                <div className="ovlbody">
                  {findings.map((v, i) => (
                    <button
                      type="button"
                      key={v.id}
                      className="ovlfind"
                      onClick={() => setOverlay({ type: "finding", f: v })}
                    >
                      <div className="off-h">
                        <span className={"fsv " + v.sev}>
                          {SEV_LABEL[v.sev]}
                        </span>
                        <span className="off-id">
                          F-{String(i + 1).padStart(3, "0")}
                        </span>
                        <span className="off-t">{v.title}</span>
                        <span className="fgo">→</span>
                      </div>
                      <pre className="off-e">{v.evidence}</pre>
                    </button>
                  ))}
                  {!findings.length && (
                    <div className="lempty">no findings recorded</div>
                  )}
                </div>
              </>
            )}
            {overlay.type === "report" && (
              <>
                <div className="ovlbar">
                  <h2 className="ovltitle">PENTEST REPORT · {target}</h2>
                  <button
                    type="button"
                    className="pdf"
                    onClick={downloadPdf}
                    aria-label="Print or save report as PDF"
                    disabled={!reportAvailable}
                  >
                    PRINT / SAVE PDF
                  </button>
                  <button
                    type="button"
                    ref={overlayCloseRef}
                    className="ovlx"
                    onClick={() => setOverlay(null)}
                    aria-label="Close pentest report"
                  >
                    ESC ×
                  </button>
                </div>
                <div className="ovlbody report">
                  <div className="rmeta">
                    <div>
                      <span className="rk">CRITICAL</span>
                      <span className="rv hot">{sevCounts.C}</span>
                    </div>
                    <div>
                      <span className="rk">HIGH</span>
                      <span className="rv">{sevCounts.H}</span>
                    </div>
                    <div>
                      <span className="rk">MED / LOW</span>
                      <span className="rv">{sevCounts.M + sevCounts.L}</span>
                    </div>
                    <div>
                      <span className="rk">SERVICES</span>
                      <span className="rv">{ports.length}</span>
                    </div>
                  </div>
                  <h3>EXECUTIVE SUMMARY</h3>
                  <p className="rp">
                    Captured evidence for <b>{target}</b> currently records{" "}
                    {findings.length} finding{findings.length === 1 ? "" : "s"},{" "}
                    {ports.length} open service
                    {ports.length === 1 ? "" : "s"}, {subdomains.length}{" "}
                    subdomain{subdomains.length === 1 ? "" : "s"} and{" "}
                    {endpoints.length} endpoint
                    {endpoints.length === 1 ? "" : "s"}. Evidence-based posture:{" "}
                    <b>{threat}</b>.
                  </p>
                  <h3>FINDINGS</h3>
                  {findings.map((v, i) => (
                    <div key={v.id} className="rfind">
                      <div className="off-h">
                        <span className={"fsv " + v.sev}>
                          {SEV_LABEL[v.sev]}
                        </span>
                        <span className="off-id">
                          F-{String(i + 1).padStart(3, "0")}
                        </span>
                        <span className="off-t">{v.title}</span>
                      </div>
                      <pre className="off-e">{v.evidence}</pre>
                      <p className="rrec">
                        <b>Fix:</b> {v.rec}
                      </p>
                    </div>
                  ))}
                  {!findings.length && (
                    <p className="rp muted">
                      No findings recorded in this session yet.
                    </p>
                  )}
                  {!!ports.length && (
                    <>
                      <h3>OPEN SERVICES</h3>
                      {ports.map((p) => (
                        <div key={p.port} className="rport">
                          <b>
                            {p.port}/{p.proto}
                          </b>{" "}
                          {p.service}
                        </div>
                      ))}
                    </>
                  )}
                  {!!subdomains.length && (
                    <>
                      <h3>SUBDOMAINS · {subdomains.length}</h3>
                      <div className="rcols">
                        {subdomains.map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                    </>
                  )}
                  {!!endpoints.length && (
                    <>
                      <h3>ENDPOINTS · {endpoints.length}</h3>
                      <div className="rcols">
                        {endpoints.map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const CSS = `
.fui{--bg:#05070a;--ink:#edf3f6;--dim:#a2adb4;--faint:#7f8a91;--line:#27323a;--line2:#172027;--fill:#f4f8fa;--cy:#2bd4ff;--hot:#ff6262;--amb:#f0a83c;--grn:#34d399;--mono:"JetBrains Mono",ui-monospace,"SF Mono",Menlo,monospace;
  color-scheme:dark;position:fixed;inset:0;height:100dvh;background:radial-gradient(circle at 58% -10%,rgba(43,212,255,.08),transparent 36%),linear-gradient(155deg,#070b0f 0%,var(--bg) 55%,#040506 100%);color:var(--ink);font-family:var(--mono);font-size:12px;overflow:hidden;isolation:isolate;
  display:grid;grid-template-columns:216px minmax(0,1fr) 360px;grid-template-rows:48px minmax(0,1fr) 24px;grid-template-areas:"top top top" "ops term stack" "bar bar bar";gap:10px;padding:10px;-webkit-font-smoothing:antialiased}
.fui *{box-sizing:border-box}
.fui .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.fui .skip-link{position:fixed;z-index:100;top:8px;left:8px;transform:translateY(-150%);border:1px solid var(--cy);border-radius:3px;background:#071015;color:#fff;padding:8px 11px;font-size:10px;text-decoration:none;transition:transform .14s}
.fui .skip-link:focus-visible{transform:translateY(0);outline:1px solid color-mix(in srgb,var(--cy) 45%,transparent);outline-offset:1px}
.fui button,.fui input{font:inherit;touch-action:manipulation}
.fui button:focus-visible,.fui input:focus-visible{outline:1px solid color-mix(in srgb,var(--cy) 45%,transparent);outline-offset:1px}
.fui button:disabled{cursor:not-allowed;opacity:.52}
.fui ::-webkit-scrollbar{width:8px;height:8px}.fui ::-webkit-scrollbar-thumb{background:#242424}.fui ::-webkit-scrollbar-track{background:transparent}
.fui ::selection{background:#fff;color:#000}
.fui #fbg{position:fixed;inset:0;z-index:0;pointer-events:none}
.fui>*{position:relative;z-index:1;min-width:0}
.fui .win{border:1px solid var(--line);border-radius:5px;background:linear-gradient(180deg,rgba(13,17,21,.94),rgba(5,7,9,.9));box-shadow:inset 0 1px rgba(255,255,255,.025),0 12px 34px rgba(0,0,0,.18);display:flex;flex-direction:column;min-height:0;overflow:hidden}
.fui .term{border-color:#334650;box-shadow:inset 0 1px rgba(255,255,255,.035),0 0 0 1px rgba(43,212,255,.035),0 18px 48px rgba(0,0,0,.28)}
.fui .wbar{display:flex;align-items:center;height:29px;padding:0 10px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.025),rgba(255,255,255,0));flex-shrink:0;gap:8px;min-width:0}
.fui .wbar .wt{font-size:10.5px;color:var(--ink);letter-spacing:.03em;font-weight:600;white-space:nowrap}
.fui .wbar .wid{font-size:9.5px;color:var(--faint);letter-spacing:.1em;margin-left:4px;white-space:nowrap}
.fui .wbar .wc{margin-left:auto;color:var(--faint);letter-spacing:.28em;font-size:11px}
.fui .lbl{font-size:9px;letter-spacing:.18em;color:var(--dim)}
.fui .top{grid-area:top;display:flex;align-items:center;gap:16px;border:1px solid var(--line);border-radius:5px;padding:0 14px;background:linear-gradient(90deg,rgba(15,20,24,.96),rgba(5,8,10,.9));box-shadow:inset 0 1px rgba(255,255,255,.03)}
.fui .mark{display:flex;align-items:center;gap:9px;flex-shrink:0}
.fui .mark svg{width:19px;height:19px}
.fui .mark .wm{margin:0;font-weight:700;letter-spacing:.34em;font-size:14px;line-height:1}
.fui .mark .md{font-size:8.5px;letter-spacing:.24em;color:var(--dim);border:1px solid var(--line);padding:2px 6px}
.fui .bc{display:flex;align-items:center;gap:8px;font-size:10.5px;color:var(--dim);letter-spacing:.06em}
.fui .bc b{color:var(--ink);font-weight:500}.fui .bc .s{color:var(--faint)}
.fui .tfield{flex:1;max-width:560px;margin:0 auto;display:flex;align-items:center;gap:9px;height:31px;border:1px solid var(--line);border-radius:3px;padding:0 5px 0 11px;background:#020405;transition:border-color .16s,box-shadow .16s}
.fui .tfield:focus-within{border-color:#4b6671;box-shadow:0 0 0 3px rgba(43,212,255,.07)}
.fui .tfield .gt{color:var(--dim)}.fui .tfield .lb{font-size:8.5px;letter-spacing:.2em;color:var(--faint)}
.fui .tfield input{flex:1;background:none;border:none;outline:none;color:var(--ink);font-family:var(--mono);font-size:12.5px;letter-spacing:.02em}
.fui .tfield input::placeholder{color:var(--faint)}
.fui .tfield .rn{font-size:9px;letter-spacing:.14em;color:#000;background:var(--cy);border:0;border-radius:2px;min-height:23px;padding:5px 10px;cursor:pointer;font-family:var(--mono);font-weight:700;transition:background .14s,box-shadow .14s,color .14s,border-color .14s;flex-shrink:0}
.fui .tfield .rn:hover{box-shadow:0 0 12px rgba(43,212,255,.5)}
.fui .tfield .rn.busy{background:rgba(255,98,98,.09);color:var(--hot);border:1px solid rgba(255,98,98,.55)}
.fui .clock{display:flex;align-items:center;gap:14px;flex-shrink:0;font-size:10.5px;color:var(--dim);letter-spacing:.06em}
.fui .clock b{color:var(--ink);font-weight:500}
.fui .stled{width:7px;height:7px;border:1px solid var(--ink)}
.fui .stled.on{background:var(--cy);border-color:var(--cy)}@keyframes fbl{50%{opacity:.2}}
.fui .ops{grid-area:ops}
.fui .chain{flex:1;overflow:auto;padding:8px 0}
.fui .ph{padding:0 8px}
.fui .ph-h{display:flex;align-items:baseline;gap:8px;padding:9px 8px 5px}
.fui .ph-h .n{font-size:10px;font-weight:700;color:var(--faint)}
.fui .ph-h .t{font-size:9px;letter-spacing:.22em;color:var(--dim)}
.fui .ph.act .ph-h .n,.fui .ph.act .ph-h .t{color:var(--ink)}
.fui .op{display:flex;align-items:center;gap:9px;width:100%;padding:6px 10px;color:var(--dim);cursor:pointer;font-size:11px;border:1px solid transparent;background:none;text-align:left;font-family:var(--mono)}
.fui .op .mk{width:9px;height:9px;border:1px solid var(--faint);flex-shrink:0}
.fui .op:hover{color:var(--ink);border-color:var(--line)}
.fui .op.on{background:var(--fill);color:#000}.fui .op.on .mk{background:#000;border-color:#000}
.fui .kit{border-top:1px solid var(--line);padding:9px 10px;flex-shrink:0}
.fui .kit .tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}.fui .kit .tg{font-size:9px;color:var(--dim);border:1px solid var(--line);padding:2px 6px}
.fui .term{grid-area:term;scroll-margin-top:58px}
.fui .term .livetool{margin-left:6px;display:flex;align-items:center;gap:6px;font-size:9px;letter-spacing:.14em;color:var(--cy)}
.fui .mobile-stats{display:none;margin-left:auto;gap:8px;color:var(--dim);font-size:8.5px;letter-spacing:.1em}
.fui .console-actions{display:flex;align-items:center;gap:5px;margin-left:auto}
.fui .console-actions button{min-height:22px;border:1px solid var(--line);border-radius:2px;background:rgba(255,255,255,.018);color:var(--dim);padding:3px 8px;font-size:8.5px;letter-spacing:.08em;cursor:pointer;transition:color .14s,border-color .14s,background .14s}
.fui .console-actions button:hover{color:var(--cy);border-color:#3a626d;background:rgba(43,212,255,.055)}
.fui .console-actions button:last-child{color:#071015;background:var(--cy);border-color:var(--cy);font-weight:700}
.fui .livetool .ld{width:6px;height:6px;border-radius:50%;background:var(--cy);box-shadow:0 0 8px var(--cy)}
.fui .out{flex:1;overflow:auto;padding:20px 22px;line-height:1.7;white-space:pre-wrap;word-break:break-word;font-size:13px;scrollbar-gutter:stable}
.fui .ln{animation:fli .18s ease both;margin:1px 0}@keyframes fli{from{opacity:0}to{opacity:1}}
.fui .ln.user{margin-top:13px;color:#fff}.fui .ln.user .ps{color:var(--dim)}
.fui .ln.o{color:var(--ink)}.fui .ln.dim{color:var(--dim)}.fui .ln.crit{color:#fff}
.fui .cur{display:inline-block;width:8px;height:15px;background:#fff;vertical-align:-3px;animation:fbl 1s steps(1) infinite}
.fui .tcur{display:inline-block;width:7px;height:13px;background:var(--cy);vertical-align:-2px;margin-left:3px;animation:fbl .8s steps(1) infinite}
.fui .welc{padding:18px 2px;max-width:760px;margin:0 auto}
.fui .scope{display:flex;align-items:center;gap:8px;color:var(--dim);font-size:9.5px;letter-spacing:.14em;margin-bottom:24px}
.fui .scope-dot{width:6px;height:6px;background:var(--grn);box-shadow:0 0 8px rgba(52,211,153,.55);flex-shrink:0}
.fui .scope-target{margin-left:auto;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--cy);letter-spacing:.06em}
.fui .welc .wt2{margin:0;font-size:16px;letter-spacing:.18em;color:#fff;font-weight:700;text-wrap:balance}
.fui .welc .ws{max-width:650px;color:var(--dim);font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:13px;line-height:1.65;margin-top:8px;white-space:normal;text-wrap:pretty}
.fui .launch-card{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:28px;padding:18px;border:1px solid #344752;border-top-color:#477181;border-radius:5px;background:linear-gradient(110deg,rgba(43,212,255,.075),rgba(255,255,255,.015) 50%,transparent);white-space:normal;box-shadow:inset 3px 0 var(--cy)}
.fui .launch-copy{display:flex;min-width:0;flex-direction:column;gap:6px}
.fui .launch-kicker{font-size:9px;letter-spacing:.18em;color:var(--cy)}
.fui .launch-copy strong{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.35;color:#fff}
.fui .launch-command{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim);font-size:10.5px}
.fui .launch-command i{font-style:normal;color:var(--cy);margin-right:7px}
.fui .launch-action{display:flex;align-items:center;justify-content:center;gap:10px;min-height:38px;padding:8px 13px;border:1px solid var(--cy);border-radius:3px;background:var(--cy);color:#041015;font-size:9.5px;font-weight:700;letter-spacing:.08em;white-space:nowrap;cursor:pointer;transition:background .14s,box-shadow .14s,color .14s}
.fui .launch-action:hover{background:#6ce2ff;box-shadow:0 0 18px rgba(43,212,255,.2)}
.fui .workflow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px;white-space:normal}
.fui .workflow-step{display:flex;gap:10px;min-width:0;padding:11px 12px;border:1px solid var(--line2);border-radius:4px;background:rgba(255,255,255,.012)}
.fui .workflow-step>span{color:var(--cy);font-size:9px;font-variant-numeric:tabular-nums}
.fui .workflow-step div{display:flex;min-width:0;flex-direction:column;gap:3px}
.fui .workflow-step b{font-size:10px;color:var(--ink)}
.fui .workflow-step small{font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:10px;line-height:1.4;color:var(--faint)}
.fui .prompt{display:flex;align-items:center;gap:10px;height:48px;border-top:1px solid var(--line);padding:0 18px;flex-shrink:0}
.fui .prompt .ps{color:var(--dim);flex-shrink:0;font-size:12.5px}
.fui .prompt textarea{flex:1;background:none;border:none;outline:none;color:#fff;font-family:var(--mono);font-size:13.5px;caret-color:var(--cy)}
.fui .prompt textarea::placeholder{color:var(--faint)}
.fui .prompt .mode-badge{font-size:9px;color:#04070c;background:var(--cy);font-weight:700;padding:3px 8px;letter-spacing:.14em;border-radius:2px;flex-shrink:0;box-shadow:0 0 12px rgba(43,212,255,.45)}
.fui .prompt .k{font-size:9px;color:var(--dim);border:1px solid var(--line);padding:5px 9px;letter-spacing:.1em;background:none;font-family:var(--mono);cursor:pointer;transition:color .12s,border-color .12s,background .12s}
.fui .prompt .k:hover{color:#fff;border-color:#555}
.fui .prompt .k.attach{padding:5px 8px;display:flex;align-items:center;color:var(--faint)}
.fui .prompt .k.attach:hover{color:var(--cy);border-color:var(--cy)}
.fui .prompt:focus-within{border-top-color:#47575d;background:rgba(43,212,255,.018)}
.fui .mobile-ops{display:none}
.fui .filebar{display:flex;flex-wrap:wrap;gap:6px;padding:8px 18px 0;border-top:1px solid var(--line);flex-shrink:0}
.fui .chip{display:flex;align-items:center;gap:6px;font-size:10.5px;color:var(--ink);border:1px solid var(--line);padding:3px 4px 3px 8px;background:rgba(255,255,255,.02);max-width:220px}
.fui .chip .cn{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fui .chip .cs{color:var(--cy);flex-shrink:0}
.fui .chip.err .cs{color:var(--hot)}
.fui .chip.up{border-color:var(--cy)}
.fui .chip .cx{display:flex;align-items:center;background:none;border:none;color:var(--faint);cursor:pointer;padding:2px;flex-shrink:0}
.fui .chip .cx:hover{color:#fff}
.fui .filerow{margin:9px 0}
/* TOOL RUN — terminal command feel */
.fui .tool{margin:9px 0;border-left:2px solid var(--line);padding-left:11px;animation:fli .2s ease both}
.fui .tool.run{border-left-color:var(--cy)}
.fui .tcmd{font-size:12px;color:#dfe9ee;letter-spacing:.01em}
.fui .tcmd .dol{color:var(--cy);margin-right:7px;font-weight:700}
.fui .tcmd .tnm{color:var(--faint);text-transform:uppercase;font-size:9px;letter-spacing:.14em;margin-right:8px;border:1px solid var(--line);padding:1px 5px}
.fui .tool.run .tcmd{color:#fff}
.fui .tout{margin-top:5px;font-size:11.5px;color:var(--dim);line-height:1.55;white-space:pre-wrap;word-break:break-word;max-height:260px;overflow:auto;border-left:1px solid var(--line2);padding:2px 0 2px 10px;
  -webkit-mask-image:linear-gradient(180deg,#000 92%,transparent);mask-image:linear-gradient(180deg,#000 92%,transparent)}
.fui .boot{display:flex;align-items:center;gap:8px;color:var(--cy);font-size:12px}
.fui .boot .ld{width:6px;height:6px;border-radius:50%;background:var(--cy);box-shadow:0 0 8px var(--cy);animation:breathe 2.2s ease-in-out infinite}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.45}}
/* terminal syntax highlighting — real tool output gets colorized like an
   actual security scanner instead of flat grey text */
.fui .tk-cve{color:var(--hot);font-weight:700}
.fui .tk-sev-CRITICAL{color:var(--hot);font-weight:700}
.fui .tk-sev-HIGH{color:#ffb454;font-weight:700}
.fui .tk-sev-MEDIUM{color:var(--amb);font-weight:600}
.fui .tk-sev-LOW{color:var(--dim);font-weight:600}
.fui .tk-status-2{color:var(--grn)}
.fui .tk-status-3,.fui .tk-status-4{color:var(--amb)}
.fui .tk-status-5{color:var(--hot)}
.fui .tk-port{color:var(--cy)}
.fui .tk-ip{color:var(--cy);font-weight:500}
.fui .tk-url{color:var(--cy);text-decoration:underline;text-decoration-color:rgba(43,212,255,.35);text-underline-offset:2px}
.fui .tk-state{color:var(--grn)}
.fui .tk-danger{color:var(--hot);font-weight:600}
.fui .tk-good{color:var(--grn);font-weight:600}
.fui .tk-bad{color:var(--amb);font-weight:600}
/* one-shot stat flash — plays once when a number increases, then settles back
   to its normal color; signals "new data just landed" without a permanent
   blinking indicator anywhere on screen */
@keyframes flashpop{0%{text-shadow:0 0 16px currentColor;transform:scale(1.14)}100%{text-shadow:none;transform:scale(1)}}
.fui .flash{display:inline-block;animation:flashpop .6s cubic-bezier(.2,.8,.3,1)}
.fui .stack{grid-area:stack;display:flex;flex-direction:column;gap:10px;min-height:0;overflow:auto;scrollbar-gutter:stable}
.fui .panel-state{display:flex;align-items:center;gap:5px;margin-left:auto;color:var(--grn);font-size:8.5px;font-weight:700;letter-spacing:.12em}
.fui .panel-state::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor;box-shadow:0 0 7px currentColor}
.fui .panel-state.live{color:var(--cy)}
.fui .panel-action{margin-left:auto;min-height:22px;border:1px solid #3b6570;border-radius:2px;background:rgba(43,212,255,.075);color:var(--cy);padding:3px 8px;font-size:8.5px;font-weight:700;letter-spacing:.07em;cursor:pointer;transition:background .14s,border-color .14s,color .14s}
.fui .panel-action:hover{background:var(--cy);color:#041015;border-color:var(--cy)}
.fui .panel-action.stop{border-color:rgba(255,98,98,.55);background:rgba(255,98,98,.08);color:var(--hot)}
.fui .panel-action.stop:hover{background:var(--hot);border-color:var(--hot);color:#100}
.fui .dossier{flex-shrink:0}
.fui .dbody{padding:13px;position:relative}
.fui .dossier .code{font-size:27px;font-weight:500;letter-spacing:.08em;font-variant-numeric:tabular-nums;line-height:1}
.fui .dossier .sub{font-size:10px;color:var(--dim);margin-top:4px;letter-spacing:.04em}
.fui .drow{display:flex;gap:8px;font-size:11px;color:var(--dim);margin-top:7px}
.fui .drow .k{color:var(--faint);width:66px;flex-shrink:0}.fui .drow .v{color:var(--ink)}
.fui .drow .v.inv{background:var(--cy);color:#000;padding:0 5px}
.fui .drow .v.crit{color:var(--hot)}
.fui .dactions{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:12px;padding-top:10px;border-top:1px solid var(--line2)}
.fui .dactions button{min-height:30px;border:1px solid var(--line);border-radius:2px;background:rgba(255,255,255,.018);color:var(--dim);font-size:8.5px;letter-spacing:.06em;cursor:pointer;transition:color .14s,border-color .14s,background .14s}
.fui .dactions button:first-child{color:var(--cy);border-color:#34525c}
.fui .dactions button:hover{color:#fff;border-color:#53616a;background:rgba(255,255,255,.045)}
.fui .hexrow{position:absolute;top:12px;right:13px;display:flex;gap:5px}
.fui .hx6{width:15px;height:17px;border:1px solid var(--line);clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.fui .hx6.f{background:#2a2a2a}
.fui .scan{flex-shrink:0}
.fui .sbody{display:grid;grid-template-columns:88px 1fr;gap:12px;padding:12px 13px;align-items:center}
.fui #fspin{width:76px;height:76px}
.fui .smeta .big{font-size:23px;font-weight:500;font-variant-numeric:tabular-nums;letter-spacing:.04em;line-height:1}
.fui .smeta .st{font-size:9px;letter-spacing:.18em;color:var(--dim);margin-top:3px}
.fui .barmeter{display:flex;gap:2px;margin-top:11px;height:22px;align-items:flex-end}
.fui .barmeter i{flex:1;background:var(--line);height:60%;transition:height .2s,background .2s}.fui .barmeter i.f{background:var(--cy);height:100%}
.fui .srow{display:flex;justify-content:space-between;margin-top:9px;font-size:10px;color:var(--dim);letter-spacing:.04em}.fui .srow b{color:#fff;font-weight:500}.fui .srow b.hot{color:var(--hot)}
.fui .surface{flex-shrink:0}
.fui .surfwrap{position:relative;height:142px}
.fui #fblob{position:absolute;inset:0;width:100%;height:100%}
.fui .surfwrap .cnr{position:absolute;width:9px;height:9px;border-color:var(--faint);border-style:solid;border-width:0}
.fui .surfwrap .c1{top:8px;left:8px;border-left-width:1px;border-top-width:1px}
.fui .surfwrap .c2{top:8px;right:8px;border-right-width:1px;border-top-width:1px}
.fui .surfwrap .c3{bottom:8px;left:8px;border-left-width:1px;border-bottom-width:1px}
.fui .surfwrap .c4{bottom:8px;right:8px;border-right-width:1px;border-bottom-width:1px}
.fui .surfwrap .snum{position:absolute;z-index:2;min-width:54px;border:1px solid transparent;border-radius:3px;background:rgba(4,7,9,.62);padding:5px 7px;font-size:13px;color:var(--ink);letter-spacing:.06em;font-variant-numeric:tabular-nums;font-weight:600;display:flex;flex-direction:column;gap:2px;cursor:pointer;transition:color .14s,border-color .14s,background .14s}
.fui .surfwrap .snum:hover{color:var(--cy);border-color:#3b5963;background:rgba(8,16,20,.92)}
.fui .surfwrap .snum i{font-style:normal;font-size:8.5px;letter-spacing:.14em;color:var(--faint);font-weight:500}
.fui .surfwrap .snum.hot{color:var(--hot)}
.fui .surfwrap .n1{top:10px;left:12px}.fui .surfwrap .n2{top:10px;right:12px;text-align:right;align-items:flex-end}.fui .surfwrap .n3{bottom:10px;left:12px}.fui .surfwrap .n4{bottom:10px;right:12px;text-align:right;align-items:flex-end}
.fui .listwin{flex:1;min-height:92px;display:flex;flex-direction:column}
.fui .lrow{display:flex;align-items:center;gap:9px;padding:6px 12px;border-bottom:1px solid var(--line2);font-size:11px;animation:fli .2s ease both}
.fui .lrow:last-child{border-bottom:0}
.fui .lempty{color:var(--faint);font-size:10.5px;padding:12px;line-height:1.5}
.fui .empty-cta{display:flex;align-items:center;justify-content:space-between;gap:10px;white-space:normal}
.fui .empty-cta button{flex-shrink:0;border:1px solid #35515a;border-radius:2px;background:rgba(43,212,255,.05);color:var(--cy);min-height:28px;padding:5px 8px;font-size:8px;letter-spacing:.05em;cursor:pointer}
.fui .empty-cta button:hover{border-color:var(--cy);background:rgba(43,212,255,.1)}
.fui .listwin .body{flex:1;overflow:auto}
.fui .bar{grid-area:bar;border:1px solid var(--line);display:flex;align-items:center;font-size:9.5px;color:var(--dim);letter-spacing:.06em;background:rgba(0,0,0,.6)}
.fui .bar .sg{display:flex;align-items:center;gap:6px;padding:0 12px;height:100%;border-right:1px solid var(--line)}.fui .bar .sg b{color:#fff;font-weight:500}
.fui .bar .sq{width:5px;height:5px;background:var(--cy)}.fui .bar .sp{flex:1}
.fui .op:active{transform:translateY(1px)}
.fui .op,.fui .tfield input{transition:color .12s,background .12s,border-color .12s}
/* REASONING — an explicit, numbered decision trace. Cyan means active work;
   amber means risk is being evaluated. Red remains reserved for verified data. */
.fui .reason{position:relative;margin:15px 0 12px;border:1px solid var(--line);border-left:3px solid #40505a;border-radius:4px;background:linear-gradient(115deg,rgba(255,255,255,.024),rgba(255,255,255,.008));padding:0;animation:fli .2s ease both;isolation:isolate;overflow:hidden;white-space:normal}
.fui .reason+.reason{margin-top:16px}
.fui .reason .rhead{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:38px;padding:7px 11px;border-bottom:1px solid var(--line2);background:rgba(0,0,0,.18)}
.fui .reason .ridentity{display:flex;align-items:center;min-width:0;gap:8px;font-size:9.5px;letter-spacing:.16em;color:var(--ink);font-weight:700}
.fui .reason .rmk{width:7px;height:7px;border:1px solid var(--dim);transform:rotate(45deg);flex-shrink:0}
.fui .reason .rtag{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8.5px;letter-spacing:.11em;color:var(--dim);border:1px solid var(--line);padding:2px 6px;border-radius:2px;font-weight:500}
.fui .reason .rstatus{display:flex;align-items:center;gap:8px;flex-shrink:0;font-size:8.5px;letter-spacing:.1em;color:var(--faint)}
.fui .reason .rstatus b{display:flex;align-items:center;gap:5px;color:var(--grn);font-size:8.5px;letter-spacing:.12em}
.fui .reason .rstatus b::before{content:"";width:5px;height:5px;border-radius:50%;background:currentColor}
.fui .reason .rbody{display:flex;flex-direction:column;gap:0;margin:0;padding:7px 9px 9px;list-style:none;color:#b7c1c7;font-size:12.5px;line-height:1.62}
.fui .reason .rt{display:grid;grid-template-columns:30px minmax(0,1fr);gap:8px;padding:7px 8px;border-radius:3px;animation:fli .3s ease both;word-break:break-word}
.fui .reason .rt+.rt{border-top:1px solid rgba(255,255,255,.025)}
.fui .reason .rtnum{color:var(--faint);font-size:9px;font-weight:700;letter-spacing:.08em;font-variant-numeric:tabular-nums;padding-top:2px}
.fui .reason .rtcopy{min-width:0}
.fui .reason .rt.active{background:rgba(43,212,255,.07);box-shadow:inset 2px 0 var(--cy)}
.fui .reason .rt.active .rtnum{color:var(--cy)}
.fui .reason.live{border-color:#355762;border-left-color:var(--cy)}
.fui .reason.live .rmk{background:var(--cy);border-color:var(--cy);box-shadow:0 0 8px var(--cy);animation:breathe 2.2s ease-in-out infinite}
.fui .reason.live .ridentity,.fui .reason.live .rstatus b{color:var(--cy)}
.fui .reason.live .rtag{color:var(--cy);border-color:#35616d}
.fui .reason.tone-hot{border-left-color:var(--amb)}
.fui .reason.tone-hot .rtag,.fui .reason.tone-hot .rstatus b{color:var(--amb);border-color:#66512d}
.fui .reason.tone-hot.live .rmk{background:var(--amb);border-color:var(--amb);box-shadow:0 0 8px rgba(240,168,60,.6)}
.fui .reason.tone-hot .rt.active{background:rgba(240,168,60,.07);box-shadow:inset 2px 0 var(--amb)}
.fui .reason.tone-hot .rt.active .rtnum{color:var(--amb)}
@media (prefers-reduced-motion:reduce){
  .fui .reason.live .rmk,.fui .tcur,.fui .livetool .ld,.fui .boot .ld,.fui .flash{animation:none}
}
@keyframes rshim{from{background-position:200% 0}to{background-position:-200% 0}}
/* FINDINGS */
.fui .findswin .sevtally{display:flex;gap:8px;margin-left:6px}
.fui .findswin .tl{font-size:8.5px;letter-spacing:.08em;color:var(--faint)}
.fui .findswin .tl.on.c{color:var(--hot)}.fui .findswin .tl.on.h{color:#ffb454}.fui .findswin .tl.on.m{color:var(--dim)}
.fui .wbar .expand,.fui .wbar .pdf{margin-left:6px;min-height:22px;background:none;border:1px solid var(--line);border-radius:2px;color:var(--dim);font-family:var(--mono);font-size:9px;padding:2px 7px;cursor:pointer;transition:color .12s,border-color .12s,background .12s;letter-spacing:.08em}
.fui .wbar .expand{margin-left:auto}
.fui .wbar .pdf{margin-left:6px}
.fui .wbar .expand:hover,.fui .wbar .pdf:hover{color:var(--cy);border-color:var(--cy)}
.fui .wbar .expand:disabled{opacity:.35;cursor:default}
.fui .wbar .pdf{color:var(--cy);border-color:#2a4650}
.fui .frow{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:0;border-bottom:1px solid var(--line2);background:none;color:inherit;text-align:left;font-family:var(--mono);font-size:11px;cursor:pointer;animation:fli .24s ease both;transition:background .12s}
.fui .frow:last-child{border-bottom:0}
.fui .frow:hover{background:rgba(43,212,255,.06)}
.fui .frow:hover .fgo{opacity:1;transform:translateX(0)}
.fui .fsv{font-size:8.5px;letter-spacing:.06em;padding:2px 6px;flex-shrink:0;width:42px;text-align:center;border:1px solid var(--line);color:var(--dim);font-weight:700}
.fui .fsv.C{background:var(--hot);color:#000;border-color:var(--hot)}
.fui .fsv.H{background:#c8791b;color:#000;border-color:#c8791b}
.fui .fsv.M{color:#d9c34a;border-color:#6a5f20}
.fui .fsv.L{color:var(--dim);border-color:var(--line)}
.fui .frow .fnum{color:var(--faint);font-size:9.5px;flex-shrink:0}
.fui .frow .ft{color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11.5px}
.fui .frow .fgo{color:var(--cy);opacity:0;transform:translateX(-4px);transition:color .14s,opacity .14s,transform .14s;flex-shrink:0}
/* REPORT panel */
.fui .reportwin{min-height:158px;border-color:#334650;box-shadow:inset 0 2px rgba(43,212,255,.18)}
.fui .reportwin .expand{margin-left:4px}
.fui .report-empty{display:flex;align-items:center;justify-content:space-between;gap:9px;white-space:normal}
.fui .report-empty button{flex-shrink:0;min-height:28px;border:1px solid var(--cy);border-radius:2px;background:rgba(43,212,255,.07);color:var(--cy);padding:5px 8px;font-size:8px;letter-spacing:.05em;cursor:pointer;transition:background .14s,color .14s}
.fui .report-empty button:hover{background:var(--cy);color:#041015}
.fui .rbrief{display:grid;grid-template-columns:repeat(4,1fr);border-bottom:1px solid var(--line);flex-shrink:0}
.fui .rstat{padding:9px 4px;text-align:center;border-right:1px solid var(--line2)}
.fui .rstat:last-child{border-right:0}
.fui .rstat b{display:block;font-size:18px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
.fui .rstat b.hot{color:var(--hot)}
.fui .rstat i{font-style:normal;font-size:8px;letter-spacing:.1em;color:var(--faint);text-transform:uppercase}
.fui .nrow{display:block;width:100%;padding:9px 12px;border:0;border-bottom:1px solid var(--line2);background:none;color:inherit;text-align:left;font-family:var(--mono);animation:fli .24s ease both}
.fui .nrow.action{cursor:pointer}
.fui .nrow:last-child{border-bottom:0}
.fui .nrow:hover{background:rgba(255,255,255,.03)}
.fui .nhead{display:flex;align-items:center;gap:8px}
.fui .ncat{font-size:8px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--line);padding:1px 5px;color:var(--dim);flex-shrink:0}
.fui .ncat.findings{background:#fff;color:#000;border-color:#fff}
.fui .ncat.sev.C{background:var(--hot);color:#000;border-color:var(--hot)}
.fui .ncat.sev.H{background:#c8791b;color:#000;border-color:#c8791b}
.fui .ncat.sev.M{color:#d9c34a;border-color:#6a5f20}.fui .ncat.sev.L{color:var(--dim)}
.fui .ntitle{color:var(--ink);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fui .nbody{color:var(--dim);font-size:10px;line-height:1.5;margin-top:5px;opacity:.8}
.fui .nskel{height:30px;margin:9px 12px;border:1px solid var(--line2);background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent);background-size:200% 100%;animation:rshim 1.3s linear infinite}
/* The latest completed assistant response becomes the primary assessment
   artifact instead of another terminal line. */
.fui .answer-report{position:relative;margin:16px 0 4px;border:1px solid #3b515c;border-radius:6px;background:linear-gradient(145deg,rgba(43,212,255,.085),rgba(11,15,19,.96) 28%,rgba(6,8,10,.98));box-shadow:0 18px 48px rgba(0,0,0,.3),inset 0 1px rgba(255,255,255,.045);overflow:hidden;white-space:normal}
.fui .answer-report::before{content:"";position:absolute;inset:0 0 auto;height:3px;background:linear-gradient(90deg,var(--cy),rgba(43,212,255,.2),transparent 78%)}
.fui .answer-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px 18px 14px;border-bottom:1px solid var(--line);background:rgba(0,0,0,.13)}
.fui .answer-kicker{display:block;margin-bottom:5px;color:var(--cy);font-size:9px;font-weight:700;letter-spacing:.2em}
.fui .answer-head h2{margin:0;color:#fff;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:20px;line-height:1.2;letter-spacing:-.01em;text-wrap:balance}
.fui .answer-head p{max-width:460px;margin:5px 0 0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--faint);font-size:9.5px;letter-spacing:.06em}
.fui .answer-state{display:flex;align-items:center;gap:7px;flex-shrink:0;margin-top:3px;border:1px solid rgba(52,211,153,.34);border-radius:999px;padding:4px 8px;color:var(--grn);font-size:8.5px;font-weight:700;letter-spacing:.12em}
.fui .answer-state i{width:6px;height:6px;border-radius:50%;background:var(--grn);box-shadow:0 0 8px rgba(52,211,153,.7)}
.fui .answer-metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;border-bottom:1px solid var(--line)}
.fui .answer-metrics>div{display:flex;align-items:center;justify-content:space-between;gap:7px;min-width:0;padding:10px 13px;border-right:1px solid var(--line2)}
.fui .answer-metrics>div:last-child{border-right:0}
.fui .answer-metrics dt{overflow:hidden;text-overflow:ellipsis;color:var(--faint);font-size:8.5px;letter-spacing:.08em;text-transform:uppercase}
.fui .answer-metrics dd{margin:0;color:#fff;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.fui .answer-metrics dd.hot{color:var(--hot)}
.fui .answer-evidence-note{margin:0;border-bottom:1px solid var(--line);padding:11px 14px;color:var(--faint);font-size:10.5px;line-height:1.55}
.fui .answer-copy{padding:18px;color:#d9e1e5;font-family:ui-sans-serif,system-ui,-apple-system,sans-serif;font-size:14px;line-height:1.72;white-space:normal;overflow-wrap:anywhere}
.fui .answer-copy>div>*:first-child{margin-top:0}
.fui .answer-copy>div>*:last-child{margin-bottom:0}
.fui .answer-copy h1,.fui .answer-copy h2,.fui .answer-copy h3{color:#fff;text-wrap:balance}
.fui .answer-copy p,.fui .answer-copy li{color:#d9e1e5}
.fui .answer-copy pre{max-width:100%;overflow:auto;border:1px solid var(--line);border-radius:4px;background:#030506;padding:11px 12px;font-family:var(--mono);font-size:11.5px}
.fui .answer-copy code{font-family:var(--mono)}
.fui .answer-actions{display:flex;justify-content:flex-end;gap:7px;padding:10px 12px;border-top:1px solid var(--line);background:rgba(0,0,0,.18)}
.fui .answer-actions button{min-height:32px;border:1px solid #3c4b53;border-radius:3px;background:rgba(255,255,255,.02);color:var(--dim);padding:6px 10px;font-size:9px;font-weight:700;letter-spacing:.07em;cursor:pointer;transition:color .14s,border-color .14s,background .14s,box-shadow .14s}
.fui .answer-actions button:hover{color:#fff;border-color:#64747c;background:rgba(255,255,255,.05)}
.fui .answer-actions button.primary{border-color:var(--cy);background:var(--cy);color:#041015}
.fui .answer-actions button.primary:hover{background:#6ce2ff;box-shadow:0 0 16px rgba(43,212,255,.18)}
/* SPEAKER TURNS */
.fui .turn{margin-top:18px;animation:fli .22s ease both}
.fui .turn:first-child{margin-top:2px}
.fui .thead{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.fui .who{font-size:9.5px;letter-spacing:.16em;padding:2px 9px;flex-shrink:0}
.fui .turn.user .who{background:#fff;color:#000}
.fui .turn.rift .who{color:var(--cy);border:1px solid #2a4650}
.fui .turn.user .tbody{background:rgba(255,255,255,.03);border-left:2px solid #fff;padding:9px 13px;color:#fff}
.fui .turn.user .utext{color:#fff;font-size:13px;white-space:pre-wrap;word-break:break-word}
/* No spine on the turn body itself — each item (reasoning, tool) carries its
   own left rail, so there is exactly one clean rail per element and consecutive
   reasoning traces never double-up or visually stack. */
.fui .turn.rift .tbody{padding:2px 0}
.fui .turn.rift .tbody .reason:first-child{margin-top:2px}
/* OVERLAY */
.fui .ovl{position:fixed;inset:0;z-index:50;background:rgba(3,5,8,.78);backdrop-filter:blur(6px);display:flex;align-items:center;justify-content:center;padding:36px;animation:fli .16s ease both}
.fui .ovlpanel{width:min(880px,92vw);max-height:86vh;display:flex;flex-direction:column;background:#0a0b0d;border:1px solid #333;box-shadow:0 30px 90px rgba(0,0,0,.7);animation:ovlin .22s cubic-bezier(.2,.8,.2,1) both}
@keyframes ovlin{from{opacity:0;transform:translateY(14px) scale(.99)}to{opacity:1;transform:none}}
.fui .ovlbar{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid #262626;flex-shrink:0}
.fui .ovltitle{margin:0;font-size:12px;line-height:1.3;letter-spacing:.1em;color:#fff;font-weight:600}
.fui .ovltally{display:flex;gap:5px;margin-left:4px}
.fui .ovlx{margin-left:auto;background:none;border:1px solid var(--line);color:var(--dim);font-family:var(--mono);font-size:9px;letter-spacing:.14em;padding:5px 9px;cursor:pointer;transition:color .12s,border-color .12s,background .12s}
.fui .ovlx:hover{color:#fff;border-color:#666}
.fui .ovlbar .pdf{margin-left:auto;background:var(--cy);color:#000;border:0;font-weight:700;font-family:var(--mono);font-size:10px;letter-spacing:.1em;padding:6px 12px;cursor:pointer}
.fui .ovlbar .pdf:hover{box-shadow:0 0 16px rgba(43,212,255,.5)}
.fui .ovlbar .pdf+.ovlx{margin-left:10px}
.fui .ovlbody{overflow:auto;padding:20px 22px}
.fui .fsec{margin-bottom:20px}
.fui .fsec h4{font-size:9px;letter-spacing:.18em;color:var(--faint);margin:0 0 8px;font-weight:600}
.fui .fsec pre{background:#050607;border:1px solid #1e1e1e;border-left:2px solid var(--cy);padding:12px 14px;font-family:var(--mono);font-size:12px;color:#cfd8dc;white-space:pre-wrap;word-break:break-word;margin:0;line-height:1.6}
.fui .fsec p{margin:0;color:var(--ink);font-size:12.5px;line-height:1.65}
.fui .fsec p.mono{font-family:var(--mono);color:var(--cy)}
.fui .sevword{font-weight:700;letter-spacing:.1em}
.fui .sevword.C{color:var(--hot)}.fui .sevword.H{color:#ffb454}.fui .sevword.M{color:#d9c34a}.fui .sevword.L{color:var(--dim)}
.fui .ovlfind,.fui .rfind{display:block;width:100%;border:1px solid #1e1e1e;border-left:3px solid var(--line);padding:12px 14px;margin-bottom:12px;background:none;color:inherit;text-align:left;font-family:var(--mono);cursor:pointer;transition:border-color .12s,background .12s}
.fui .ovlfind:hover{border-left-color:var(--cy);background:rgba(43,212,255,.04)}
.fui .off-h{display:flex;align-items:center;gap:10px}
.fui .off-id{color:var(--faint);font-size:10px;flex-shrink:0}
.fui .off-t{color:#fff;font-size:12.5px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fui .off-e{background:#050607;border:1px solid #1a1a1a;padding:9px 11px;font-size:11px;color:var(--dim);white-space:pre-wrap;word-break:break-word;margin:9px 0 0;line-height:1.55;max-height:120px;overflow:auto}
.fui .ovlbody.report h3{font-size:10px;letter-spacing:.16em;color:var(--cy);border-bottom:1px solid #1e1e1e;padding-bottom:6px;margin:24px 0 12px}
.fui .report .rmeta{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #262626;margin-bottom:6px}
.fui .report .rmeta div{padding:12px 14px;border-right:1px solid #1e1e1e;display:flex;flex-direction:column;gap:6px}
.fui .report .rmeta div:last-child{border-right:0}
.fui .report .rk{font-size:8.5px;letter-spacing:.14em;color:var(--faint)}
.fui .report .rv{font-size:22px;font-weight:600;line-height:1}.fui .report .rv.hot{color:var(--hot)}
.fui .report .rp{font-size:12.5px;line-height:1.7;color:var(--ink)}.fui .report .rp.muted{color:var(--faint)}
.fui .report .rrec{margin:9px 0 0;font-size:11.5px;color:var(--dim);line-height:1.6}.fui .report .rrec b{color:var(--cy)}
.fui .report .rport{font-size:11.5px;color:var(--dim);padding:3px 0}.fui .report .rport b{color:#fff}
.fui .report .rcols{columns:2;font-size:11px;color:var(--dim)}.fui .report .rcols span{display:block;padding:2px 0}

@media (max-width:1240px){
  .fui{grid-template-columns:192px minmax(0,1fr) 310px;gap:8px;padding:8px}
  .fui .bc{display:none}
  .fui .stack{gap:8px}
}
@media (max-width:1100px){
  .fui{grid-template-columns:192px minmax(0,1fr);grid-template-areas:"top top" "ops term" "bar bar"}
  .fui .stack{display:none}
  .fui .mobile-stats{display:flex}
  .fui .console-actions{margin-left:0}
  .fui .term>.wbar .wc{display:none}
}
@media (max-width:760px){
  .fui{grid-template-columns:minmax(0,1fr);grid-template-rows:44px minmax(0,1fr) 22px;grid-template-areas:"top" "term" "bar";gap:6px;padding:max(6px,env(safe-area-inset-top)) max(6px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(6px,env(safe-area-inset-left))}
  .fui .ops{display:none}
  .fui .top{gap:8px;padding:0 8px}
  .fui .mark{gap:6px}
  .fui .mark .wm{font-size:12px;letter-spacing:.22em}
  .fui .mark .md{display:none}
  .fui .tfield{min-width:0;height:30px;margin:0;padding-left:8px;gap:6px}
  .fui .tfield .lb{display:none}
  .fui .tfield input{min-width:0;font-size:12px}
  .fui .tfield .rn{padding:6px 8px}
  .fui .clock>span:last-child{display:none}
  .fui .out{padding:14px 12px;font-size:12.5px}
  .fui .welc{padding-top:8px}
  .fui .launch-card{align-items:stretch;flex-direction:column;padding:15px;gap:14px}
  .fui .launch-action{width:100%;min-height:42px}
  .fui .workflow{grid-template-columns:1fr}
  .fui .workflow-step{padding:9px 10px}
  .fui .reason .rhead{align-items:flex-start;flex-direction:column;gap:7px}
  .fui .reason .rstatus{width:100%;justify-content:space-between}
  .fui .reason .rt{grid-template-columns:26px minmax(0,1fr);padding-inline:5px}
  .fui .answer-head{padding:16px 14px 12px}
  .fui .answer-head h2{font-size:18px}
  .fui .answer-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
  .fui .answer-metrics>div:nth-child(2){border-right:0}
  .fui .answer-metrics>div:nth-child(-n+2){border-bottom:1px solid var(--line2)}
  .fui .answer-copy{padding:15px 14px;font-size:13.5px}
  .fui .mobile-ops{display:flex;gap:6px;overflow-x:auto;padding:7px 10px;border-top:1px solid var(--line);scrollbar-width:none}
  .fui .mobile-ops::-webkit-scrollbar{display:none}
  .fui .mobile-ops button{flex:0 0 auto;border:1px solid var(--line);background:none;color:var(--dim);padding:7px 9px;font-family:var(--mono);font-size:9px;cursor:pointer;white-space:nowrap}
  .fui .mobile-ops button:hover{color:var(--cy);border-color:var(--cy)}
  .fui .prompt{height:56px;gap:8px;padding:0 10px}
  .fui .prompt .ps,.fui .prompt .mode-badge{display:none}
  .fui .prompt textarea{min-width:0;font-size:16px}
  .fui .prompt .k{min-height:38px;padding:7px 10px}
  .fui .prompt .k.attach{min-width:38px;justify-content:center}
  .fui .bar .sg:nth-of-type(2),.fui .bar .sg:nth-of-type(4),.fui .bar .sg:last-child{display:none}
  .fui .bar .sg{padding:0 8px}
  .fui .ovl{padding:0;align-items:stretch}
  .fui .ovlpanel{width:100%;max-height:100dvh;border-left:0;border-right:0}
  .fui .ovlbar{padding:12px;gap:8px}
  .fui .ovltitle{font-size:10.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .fui .ovlbody{padding:14px 12px}
  .fui .report .rmeta{grid-template-columns:repeat(2,1fr)}
  .fui .report .rmeta div:nth-child(2){border-right:0}
  .fui .report .rmeta div:nth-child(-n+2){border-bottom:1px solid #1e1e1e}
  .fui .report .rcols{columns:1}
}
@media (max-width:420px){
  .fui .mark .wm{display:none}
  .fui .mark svg{width:18px;height:18px}
  .fui .mobile-stats{display:none}
  .fui .console-actions button:first-child{display:none}
  .fui .console-actions button:last-child{padding-inline:6px;font-size:8px}
  .fui .scope-target{max-width:44%}
  .fui .prompt .send{min-width:58px}
  .fui .answer-head{flex-direction:column}
  .fui .answer-state{margin-top:0}
  .fui .answer-actions{display:grid;grid-template-columns:1fr}
  .fui .answer-actions button{min-height:38px}
}
@media (prefers-reduced-motion:reduce){
  .fui *{scroll-behavior:auto!important}
  .fui .ln,.fui .turn,.fui .tool,.fui .reason,.fui .frow,.fui .nrow,.fui .ovl,.fui .ovlpanel,.fui .nskel{animation:none!important}
}
`;

// Cursor-inspired terminal skin. The older rules above still cover report
// printing and data-detail surfaces; this final layer deliberately removes the
// cinematic HUD treatment in favor of one calm, high-contrast work surface.
const CURSOR_OVERRIDES = `
.fui{
  --bg:#111111;--ink:#d6d6d6;--dim:#a0a0a0;--faint:#737373;
  --line:#2a2a2a;--line2:#222222;--fill:#292929;--cy:#a38dbb;
  --hot:#ee7777;--amb:#c5a56a;--grn:#79b891;
  grid-template-columns:264px minmax(0,1fr);
  grid-template-rows:46px minmax(0,1fr) 29px;
  grid-template-areas:"top top" "ops term" "ops bar";
  gap:0;padding:0;background:var(--bg);font-size:13px;
  font-family:"JetBrains Mono","SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
  letter-spacing:0;isolation:auto;
  transition:grid-template-columns .2s cubic-bezier(.2,.8,.2,1)
}
.fui.sidebar-closed{grid-template-columns:0 minmax(0,1fr)}
.fui *{min-width:0}
.fui button,.fui input{-webkit-tap-highlight-color:rgba(163,141,187,.18)}
.fui #fbg{display:none}
.fui ::selection{background:#5c4a6d;color:#fff}
.fui ::-webkit-scrollbar{width:9px;height:9px}
.fui ::-webkit-scrollbar-thumb{border:3px solid transparent;border-radius:8px;background:#4a4a4a;background-clip:padding-box}
.fui ::-webkit-scrollbar-track{background:transparent}
.fui button:focus-visible,.fui input:focus-visible{outline:1px solid color-mix(in srgb,#a38dbb 45%,transparent);outline-offset:1px}
.fui .skip-link{border-color:#a38dbb;border-radius:2px;background:#202020;color:#fff}
.fui .win{border:0;border-radius:0;background:#121212;box-shadow:none}
.fui .top{grid-area:top;height:46px;gap:12px;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:0 14px;background:#171717;box-shadow:none}
.fui .traffic{display:flex;align-items:center;gap:7px;flex:0 0 auto}
.fui .traffic i{display:block;width:11px;height:11px;border-radius:50%;background:#3a3a3a}
.fui .traffic i:first-child{background:#ff5f57}.fui .traffic i:nth-child(2){background:#febc2e}.fui .traffic i:nth-child(3){background:#28c840}
.fui .sidebar-toggle{display:flex;align-items:center;justify-content:center;width:28px;height:28px;flex:0 0 auto;border:1px solid transparent;border-radius:3px;background:transparent;color:#777;padding:0;cursor:pointer;transition:color .16s,border-color .16s,background .16s}
.fui .sidebar-toggle:hover{border-color:#303030;background:#202020;color:#cacaca}
.fui .sidebar-toggle:focus-visible{outline:1px solid #81728e;outline-offset:1px}
.fui .mark{gap:7px}.fui .mark svg{width:16px;height:16px;opacity:.9}
.fui .mark .wm{font-size:12px;letter-spacing:.12em;font-weight:650}
.fui .mark .md{border:0;padding:0;color:#777;font-size:8px;letter-spacing:.12em}
.fui .bc.top-tab{height:30px;gap:7px;border:1px solid #323232;border-radius:4px;background:#242424;padding:0 11px;color:#9c9c9c;font-size:11.5px;letter-spacing:0}
.fui .bc.top-tab b{color:#dedede;font-weight:500}
.fui .tfield{height:31px;max-width:540px;margin:0 auto;border:1px solid #343434;border-radius:4px;background:#111;padding:0 4px 0 10px;box-shadow:none;gap:8px}
.fui .tfield:focus-within{border-color:#5a5163;box-shadow:none}
.fui .tfield .gt{color:#888}.fui .tfield .lb{color:#707070;font-size:8.5px;letter-spacing:.12em}
.fui .tfield input{font-size:12px;color:#d2d2d2;letter-spacing:0}
.fui .tfield .rn{min-height:23px;border:1px solid #414141;border-radius:3px;background:#2b2b2b;color:#d7d7d7;padding:4px 9px;font-size:9px;font-weight:500;letter-spacing:.02em;box-shadow:none}
.fui .tfield .rn:hover{border-color:#5b5b5b;background:#333;box-shadow:none}
.fui .tfield .rn.busy{border-color:#624646;background:#2a1d1d;color:#ee8b8b}
.fui .clock{gap:12px;color:#777;font-size:10px;letter-spacing:0}
.fui .clock b{color:#a8a8a8;font-variant-numeric:tabular-nums}.fui .stled{width:6px;height:6px;border:0;border-radius:50%;background:#545454}.fui .stled.on{background:#a38dbb}

.fui .ops{grid-area:ops;border-right:1px solid var(--line);background:#151515;transform:translateX(0);opacity:1;visibility:visible;transition:opacity .14s ease,transform .2s cubic-bezier(.2,.8,.2,1),visibility 0s}
.fui.sidebar-closed .ops{border-right-color:transparent;transform:translateX(-10px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .12s ease,transform .18s ease,visibility 0s .18s}
.fui .wbar{height:38px;padding:0 12px;border-bottom:1px solid var(--line);background:#171717;gap:8px}
.fui .wbar .wt{color:#d8d8d8;font-size:11.5px;font-weight:550;letter-spacing:0}
.fui .wbar .wid{color:#6f6f6f;font-size:8.5px;letter-spacing:.06em}
.fui .task-filter{display:flex;align-items:center;gap:8px;height:32px;margin:9px 10px 5px;border:1px solid #2e2e2e;border-radius:4px;background:#111;padding:0 8px;color:#666;flex:0 0 auto}
.fui .task-filter:focus-within{border-color:#4c4652}
.fui .task-filter input{flex:1;border:0;outline:0;background:transparent;color:#c8c8c8;font-size:11px}
.fui .task-filter input::placeholder{color:#666}
.fui .task-filter input::-webkit-search-cancel-button{display:none}
.fui .task-filter button{border:0;background:none;color:#777;padding:2px;cursor:pointer}
.fui .chain{padding:3px 6px 10px;scrollbar-gutter:stable;overscroll-behavior:contain}
.fui .ph{padding:0}.fui .ph+.ph{margin-top:4px}
.fui .ph-h{height:28px;padding:7px 7px 4px;gap:7px}
.fui .ph-h .t{color:#777;font-size:9px;font-weight:550;letter-spacing:.1em}
.fui .ph-h .n{margin-left:auto;color:#555;font-size:9px;font-weight:500}
.fui .ph.act .ph-h .t{color:#8f7aa5}.fui .ph.act .ph-h .n{color:#777}
.fui .op{min-height:39px;gap:8px;margin:1px 0;border:0;border-radius:4px;padding:5px 7px;color:#a9a9a9;font-size:11px;line-height:1.2}
.fui .op:hover{border:0;background:#202020;color:#e1e1e1}
.fui .op.on{background:#292929;color:#f0f0f0}
.fui .op .mk{width:2px;height:20px;border:0;border-radius:2px;background:#3b3b3b}
.fui .op.on .mk{background:#9b84b2}.fui .op:hover .mk{background:#666}
.fui .op-copy{display:flex;min-width:0;flex:1;flex-direction:column;gap:2px;text-align:left}
.fui .op-copy b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:500;color:inherit}
.fui .op-copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#686868;font-size:8.5px;font-weight:400}
.fui .op.on .op-copy small{color:#939393}
.fui .op-arrow{color:#555;font-size:14px}.fui .op.on .op-arrow{color:#a38dbb}
.fui .task-empty{margin:18px 8px;color:#666;font-size:10px;text-align:center}
.fui .ops-summary{flex:0 0 auto;border-top:1px solid var(--line);padding:10px;background:#141414}
.fui .summary-head{display:flex;align-items:center;justify-content:space-between;color:#8c8c8c;font-size:9px}
.fui .summary-head b{color:#7eaa8a;font-weight:500}
.fui .ops-summary dl{display:grid;grid-template-columns:repeat(4,1fr);margin:9px 0 0;border:1px solid #282828}
.fui .ops-summary dl div{display:flex;flex-direction:column;gap:3px;padding:7px 5px;border-right:1px solid #282828;text-align:center}
.fui .ops-summary dl div:last-child{border-right:0}
.fui .ops-summary dt{color:#636363;font-size:7px;text-transform:uppercase}.fui .ops-summary dd{margin:0;color:#bdbdbd;font-size:12px;font-variant-numeric:tabular-nums}.fui .ops-summary dd.hot{color:#ee7777}
.fui .summary-actions{display:grid;grid-template-columns:1fr 1fr;gap:5px;margin-top:7px}
.fui .summary-actions button{min-height:28px;border:1px solid #303030;border-radius:3px;background:#1b1b1b;color:#999;font-size:9px;cursor:pointer}
.fui .summary-actions button:last-child{border-color:#4a4252;color:#c0accf}.fui .summary-actions button:hover{background:#232323;color:#e4e4e4}
.fui .kit{border-top:1px solid var(--line);padding:8px 10px;background:#141414}
.fui .kit .lbl{color:#606060;font-size:8px;letter-spacing:.09em}
.fui .kit .tags{margin-top:5px;gap:4px}.fui .kit .tg{border:0;border-radius:3px;background:#202020;color:#777;padding:2px 5px;font-size:8px}

.fui .term{grid-area:term;border:0;background:#121212;box-shadow:none;scroll-margin-top:46px}
.fui .term>.wbar{background:#151515}
.fui .term>.wbar .wid{font-size:9px;letter-spacing:0}
.fui .term .livetool{margin-left:4px;color:#9b86af;font-size:9px;letter-spacing:.04em}
.fui .livetool .ld{width:5px;height:5px;background:#9b86af;box-shadow:none}
.fui .console-actions{gap:5px}.fui .console-actions button{min-height:24px;border:1px solid #303030;border-radius:3px;background:#1b1b1b;color:#8c8c8c;padding:3px 8px;font-size:9px;letter-spacing:0}
.fui .console-actions button:hover{border-color:#464646;background:#222;color:#d2d2d2}
.fui .console-actions button:last-child{border-color:#423a49;background:#201d23;color:#b9a5c7;font-weight:500}
.fui .out{padding:30px 38px 28px;color:#c9c9c9;font-size:13.5px;line-height:1.65;white-space:pre-wrap;word-break:break-word;scrollbar-gutter:stable;overscroll-behavior:contain}
.fui .welc{max-width:760px;margin:20px auto;padding:34px 0}
.fui .scope{margin-bottom:28px;color:#777;font-size:9px;letter-spacing:.08em}.fui .scope-dot{width:5px;height:5px;border-radius:50%;background:#79b891;box-shadow:none}
.fui .scope-target{color:#a38dbb;letter-spacing:0}
.fui .welc .wt2{font-size:18px;font-weight:550;letter-spacing:-.02em;text-transform:none}
.fui .welc .ws{max-width:620px;margin-top:10px;color:#999;font-family:inherit;font-size:12.5px;line-height:1.7}
.fui .launch-card{margin-top:28px;border:1px solid #333;border-radius:3px;background:#191919;padding:15px 16px;box-shadow:none}
.fui .launch-kicker{color:#837291;font-size:8px;letter-spacing:.1em}.fui .launch-copy strong{color:#d6d6d6;font-family:inherit;font-size:12.5px;font-weight:500}
.fui .launch-command{color:#777;font-size:10.5px}.fui .launch-command i{color:#a38dbb}
.fui .launch-action{min-height:32px;border:1px solid #414141;border-radius:3px;background:#262626;color:#c6c6c6;padding:6px 10px;font-size:9px;font-weight:500;letter-spacing:0}
.fui .launch-action:hover{border-color:#5a5a5a;background:#303030;box-shadow:none}
.fui .welcome-hint{margin:14px 1px 0;color:#5f5f5f;font-size:9.5px;line-height:1.5}
.fui .workflow{display:none}

.fui .turn{margin:0 0 22px;animation:none}
.fui .turn:first-child{margin-top:0}.fui .turn .thead{display:none}
.fui .turn.user .tbody{display:grid;grid-template-columns:18px minmax(0,1fr);gap:0;border:0;background:#242424;padding:11px 14px;color:#d8d8d8}
.fui .turn.user .tbody::before{content:"›";grid-column:1;color:#929292}
.fui .turn.user .tbody>*{grid-column:2}.fui .turn.user .utext{font-size:13px;color:#d8d8d8}
.fui .turn.rift .tbody{padding:0}
.fui .turn.rift .tbody .reason:first-child{margin-top:0}
.fui .reason{margin:15px 0;border:0;border-left:2px solid #5e5269;border-radius:0;background:none;padding:0 0 0 20px;overflow:visible;animation:none;isolation:auto}
.fui .reason+.reason{margin-top:20px}
.fui .reason .rhead{min-height:auto;border:0;background:none;padding:0}
.fui .reason .ridentity{gap:8px;color:#a9a9a9;font-size:12px;font-weight:550;letter-spacing:0}
.fui .reason .rmk,.fui .boot .rmk{width:6px;height:6px;border:0;background:#827394;transform:rotate(45deg);box-shadow:none}
.fui .reason .reason-time{color:#696969;font-weight:400}
.fui .reason .rbody{gap:7px;margin:0;padding:10px 0 0;color:#959595;font-size:12.5px;line-height:1.65}
.fui .reason .rt{display:block;border:0;border-radius:0;padding:0;animation:none;word-break:break-word}
.fui .reason .rt+.rt{border:0}.fui .reason .rt.active{background:none;box-shadow:none}
.fui .reason.live{border-color:#5e5269}.fui .reason.live .ridentity{color:#a9a9a9}
.fui .reason.live .rmk{border:0;background:#827394;box-shadow:none;animation:none}
.fui .reason.tone-hot{border-left-color:#5e5269}.fui .reason .rtnum,.fui .reason .rtag,.fui .reason .rstatus{display:none}
.fui .tcur{width:7px;height:13px;background:#aaa;animation:fbl .9s steps(1) infinite}
.fui .boot{display:flex;align-items:center;gap:9px;border-left:2px solid #87749b;padding-left:20px;color:#777;font-size:12px}
.fui .boot b{color:#b4a3c2;font-weight:550}.fui .boot .ld{display:none}

@keyframes terminal-enter{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:translateY(0)}}
.fui .tool{margin:14px 0;border-left:2px solid #303030;padding:0 0 0 20px;animation:terminal-enter .18s ease-out both}
.fui .tool.run{border-left-color:#303030}.fui .tcmd{color:#b7b7b7;font-size:12px}
.fui .tcmd .dol{color:#777;margin-right:8px}.fui .tcmd .tnm{border:0;background:none;color:#777;margin-right:6px;padding:0;font-size:10px;font-weight:500;letter-spacing:.03em;text-transform:none}
.fui .tool.run .tcmd{color:#d2d2d2}.fui .tout{max-height:260px;margin-top:8px;border:0;padding:0;color:#858585;font-size:11.5px;line-height:1.55;-webkit-mask-image:none;mask-image:none}
.fui .tk-url{color:#a996bc;text-decoration-color:#5d5068}.fui .tk-port,.fui .tk-ip{color:#aaa}.fui .tk-state,.fui .tk-good,.fui .tk-status-2{color:#79b891}.fui .tk-danger,.fui .tk-cve,.fui .tk-sev-CRITICAL{color:#ee7777}

.fui .answer-report{margin:20px 0 5px;border:1px solid #3a3a3a;border-top:2px solid #817092;border-radius:3px;background:#161616;box-shadow:none;overflow:hidden}
.fui .answer-report::before{display:none}.fui .answer-head{border-bottom:1px solid #2a2a2a;background:#181818;padding:17px 18px 14px}
.fui .answer-kicker{margin-bottom:5px;color:#9d88b1;font-size:8.5px;letter-spacing:.12em}.fui .answer-head h2{font-family:inherit;font-size:16px;font-weight:550;letter-spacing:-.01em}
.fui .answer-head p{margin-top:5px;color:#6f6f6f;font-size:9.5px;letter-spacing:0}.fui .answer-state{border:1px solid #35463a;border-radius:3px;color:#79b891;padding:3px 7px;font-size:8px;letter-spacing:.06em}.fui .answer-state i{width:5px;height:5px;background:#79b891;box-shadow:none}
.fui .answer-metrics{border-bottom:1px solid #2a2a2a}.fui .answer-metrics>div{border-color:#292929;padding:9px 12px}.fui .answer-metrics dt{color:#686868;font-size:8px;letter-spacing:.06em}.fui .answer-metrics dd{color:#cfcfcf;font-size:13px;font-weight:500}
.fui .answer-copy{padding:20px 18px;color:#c9c9c9;font-family:inherit;font-size:13px;line-height:1.72}.fui .answer-copy p,.fui .answer-copy li{color:#bdbdbd}.fui .answer-copy h1,.fui .answer-copy h2,.fui .answer-copy h3{color:#dedede;font-weight:600}.fui .answer-copy pre{border-color:#303030;background:#111;border-radius:3px}
.fui .answer-actions{border-top:1px solid #292929;background:#171717;padding:9px 10px}.fui .answer-actions button{border-color:#343434;background:#1d1d1d;color:#919191;font-weight:500;letter-spacing:0}.fui .answer-actions button.primary{border-color:#4b4252;background:#29232e;color:#c6b2d3}.fui .answer-actions button.primary:hover{background:#332b39;box-shadow:none}

.fui .filebar{margin:0 22px;border:1px solid #303030;border-bottom:0;background:#171717;padding:7px 9px 0}.fui .chip{border-color:#333;background:#202020}
.fui .run-status{display:flex;align-items:center;gap:8px;min-height:28px;margin:0 22px 4px;padding:0 4px;color:#777;font-size:10.5px;line-height:1;flex:0 0 auto}
.fui .run-terminal-icon{flex:0 0 auto;color:#837291}
.fui .run-pulse{display:flex;align-items:center;gap:2px;width:10px;height:10px;flex:0 0 auto}
.fui .run-pulse i{display:block;width:2px;height:8px;border-radius:1px;background:#8b7a99;opacity:.25;transform-origin:center;animation:terminal-pulse .9s steps(2,end) infinite}
.fui .run-pulse i:nth-child(2){animation-delay:.15s}.fui .run-pulse i:nth-child(3){animation-delay:.3s}
@keyframes terminal-pulse{0%,100%{opacity:.25;transform:scaleY(.45)}50%{opacity:.9;transform:scaleY(1)}}
.fui .run-copy{display:flex;align-items:center;gap:9px;min-width:0;flex:1;overflow:hidden}
.fui .run-copy b{flex:0 0 auto;color:#aaa;font-weight:500;white-space:nowrap}
.fui .run-copy code{overflow:hidden;color:#686868;font:inherit;text-overflow:ellipsis;white-space:nowrap}
.fui .run-timer{margin-left:auto;color:#8b8b8b;font-variant-numeric:tabular-nums;white-space:nowrap}
.fui .run-context{color:#5f5f5f;white-space:nowrap}
.fui .run-stop{border:0;background:transparent;color:#777;padding:3px 2px;font:inherit;cursor:pointer}
.fui .run-stop:hover{color:#d39a9a}
.fui .prompt{height:44px;margin:0 22px 10px;border:1px solid #414141;border-radius:4px;background:#151515;padding:0 8px;gap:8px}
.fui .prompt:hover{border-color:#414141;background:#151515}
.fui .prompt:focus-within{border-color:#4b4b4b;background:#151515;box-shadow:none}.fui .prompt .ps{color:#9a9a9a;font-size:15px}
.fui .prompt textarea{font-size:13px;color:#d4d4d4;caret-color:#b09bc2}.fui .prompt textarea::placeholder{color:#5f5f5f}
.fui .prompt textarea:focus,.fui .prompt textarea:focus-visible{outline:none;box-shadow:none}
.fui .prompt .k{min-height:28px;border:0;border-radius:3px;background:transparent;color:#777;padding:4px 7px;font-size:10px;letter-spacing:0}.fui .prompt .k:hover{border:0;background:#242424;color:#bdbdbd}
.fui .prompt .k.attach{padding:6px;color:#707070}.fui .prompt .k.attach:hover{border:0;color:#b09bc2}
.fui .prompt .mode-badge{border-left:1px solid #303030;border-radius:0;background:none;color:#737373;padding:2px 10px;font-size:9px;font-weight:400;letter-spacing:0;box-shadow:none}
.fui .prompt .send{min-width:28px;border:1px solid #333;background:#202020;color:#999}
.fui .mobile-ops{display:none}

.fui .stack{display:none!important}
.fui .bar{grid-area:bar;height:29px;border:0;border-top:1px solid var(--line);background:#151515;color:#6e6e6e;font-size:9.5px;letter-spacing:0}
.fui .bar .sg{gap:4px;border-color:#292929;padding:0 11px}.fui .bar .sg b{color:#9a9a9a;font-weight:550}
.fui .bar .sq{display:none}
.fui .flash{animation:none!important}

.fui .ovl{background:rgba(0,0,0,.76);backdrop-filter:blur(3px)}
.fui .ovlpanel{border:1px solid #3b3b3b;border-radius:3px;background:#151515;box-shadow:0 24px 80px rgba(0,0,0,.6)}
.fui .ovlbar{border-color:#2d2d2d;background:#181818}.fui .ovltitle{font-size:11px;letter-spacing:.03em;text-transform:none}.fui .ovlx{border-color:#343434;border-radius:3px;color:#888;letter-spacing:0}.fui .ovlbar .pdf{border:1px solid #4a4151;border-radius:3px;background:#29232e;color:#c6b2d3;font-weight:500;letter-spacing:0}
.fui .ovlbar .pdf:hover{border-color:#5a4f63;background:#332b39;box-shadow:none}
.fui .ovlfind:hover{border-left-color:#65596f;background:#1c1a1e}

@media (max-width:1100px){
  .fui{grid-template-columns:232px minmax(0,1fr);grid-template-areas:"top top" "ops term" "ops bar";gap:0;padding:0}
  .fui.sidebar-closed{grid-template-columns:0 minmax(0,1fr)}
  .fui .mark .md{display:none}.fui .clock>span:last-child{display:none}
  .fui .out{padding-inline:28px}.fui .ops-summary{display:none}
}
@media (max-width:780px){
  .fui{grid-template-columns:minmax(0,1fr);grid-template-rows:46px minmax(0,1fr) 27px;grid-template-areas:"top" "term" "bar";gap:0;padding:0}
  .fui.sidebar-closed{grid-template-columns:minmax(0,1fr)}
  .fui .ops,.fui .sidebar-toggle{display:none}.fui .top{padding-left:max(9px,env(safe-area-inset-left));padding-right:max(9px,env(safe-area-inset-right));gap:8px}.fui .traffic,.fui .mark .md,.fui .bc.top-tab{display:none}
  .fui .mark{flex:0 0 auto}.fui .tfield{max-width:none;margin:0;flex:1}.fui .clock{font-size:9px}
  .fui .out{padding:20px 14px 18px;font-size:12.5px}.fui .welc{padding:16px 2px}.fui .welc .wt2{font-size:16px}
  .fui .launch-card{align-items:stretch;flex-direction:column;gap:12px}.fui .launch-action{width:100%;min-height:36px}
  .fui .mobile-ops{display:flex;border-top:1px solid #292929;background:#151515;padding:6px 9px;gap:5px}
  .fui .mobile-ops button{min-height:30px;border-color:#303030;border-radius:3px;background:#1c1c1c;color:#888;padding:5px 8px;font-size:9px}
  .fui .run-status{margin:0 max(9px,env(safe-area-inset-right)) 3px max(9px,env(safe-area-inset-left));padding:0;gap:6px}.fui .run-context,.fui .run-copy code{display:none}
  .fui .prompt{height:46px;margin:0 max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));padding:0 6px}.fui .prompt .mode-badge{display:none}.fui .prompt textarea{font-size:16px}
  .fui .filebar{margin:0 8px}.fui .turn.user .tbody{padding:10px 11px}.fui .reason,.fui .tool{padding-left:14px}
  .fui .answer-head{padding:14px}.fui .answer-copy{padding:16px 14px;font-size:12.5px}.fui .answer-metrics{grid-template-columns:repeat(2,1fr)}
  .fui .bar .sg:nth-of-type(2),.fui .bar .sg:nth-of-type(3){display:none}.fui .bar .sg{padding:0 8px}
}
@media (max-width:460px){
  .fui .mark .wm{display:block;font-size:10px}.fui .mark svg{width:15px;height:15px}.fui .tfield .lb{display:none}.fui .tfield .rn{padding-inline:7px}
  .fui .clock{display:none}.fui .console-actions button:first-child{display:none}.fui .term>.wbar .wid{display:none}
  .fui .out{padding-inline:10px}.fui .scope{align-items:flex-start;flex-wrap:wrap}.fui .scope-target{max-width:100%;margin-left:0}
  .fui .answer-head{flex-direction:column}.fui .answer-actions{display:grid;grid-template-columns:1fr}.fui .answer-actions button{min-height:36px}
  .fui .bar .sg:last-child{overflow:hidden;max-width:62%;text-overflow:ellipsis;white-space:nowrap}
}
@media (prefers-reduced-motion:reduce){
  .fui{transition:none}.fui *{scroll-behavior:auto!important}.fui .ops,.fui .tool,.fui .tcur,.fui .reason.live .rmk,.fui .run-pulse i{animation:none!important;transition:none!important}
}
`;

// Compact workbench geometry from the supplied reference, reskinned with the
// quiet charcoal hierarchy of Cursor's terminal. Color is reserved for true
// semantic states; structure comes from typography and one-pixel separators.
const REFERENCE_OVERRIDES = `
.fui{
  --frame-x:clamp(44px,6vw,96px);--frame-y:clamp(28px,4.7vh,52px);
  --panel:#050608;--panel-2:#090b0e;--panel-3:#020305;
  --ink:#f3f6f9;--dim:#b3bdc7;--faint:#7e8993;
  --line:#1c232a;--line2:#11171d;--fill:#0e141a;
  --cy:#a8d9ff;--blue:#d1ebff;--grn:#8fa99a;--amb:#b7a47f;--hot:#be8585;
  --ui:-apple-system,BlinkMacSystemFont,"Segoe UI",ui-sans-serif,system-ui,sans-serif;
  --display:var(--ui);
  --pixel:var(--mono);
  --mono:var(--font-jetbrains-mono),"JetBrains Mono","SFMono-Regular",Consolas,Menlo,monospace;
  --scene-cloud-hi:#fff;--scene-cloud-lo:#edf7ff;
  --scene-sky-top:#fcfeff;--scene-sky-bottom:#e5f3ff;
  --scene-ridge-far:#c9ddec;--scene-ridge-mid:#7b8c9c;
  --scene-ridge-near:#263542;--scene-ground:#0c131a;
  --scene-dot-dark:rgba(9,18,27,.42);--scene-dot-light:rgba(255,255,255,.34);
  --scene-frame-edge:rgba(188,226,255,.42);--scene-frame-shadow:rgba(0,0,0,.68);
  grid-template-columns:204px minmax(0,1fr);
  grid-template-rows:64px clamp(142px,16vh,158px) minmax(0,1fr) 30px;
  grid-template-areas:"top top" "overview overview" "ops term" "bar bar";
  gap:0;padding:var(--frame-y) var(--frame-x);font-family:var(--ui);font-size:12.5px;font-variant-ligatures:none;
  background:
    radial-gradient(ellipse 19% 10% at 7% 18%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%),
    radial-gradient(ellipse 15% 8% at 83% 12%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%),
    radial-gradient(ellipse 12% 7% at 99% 27%,var(--scene-cloud-hi) 0 43%,var(--scene-cloud-lo) 44% 59%,transparent 62%),
    linear-gradient(148deg,transparent 0 50%,var(--scene-ridge-far) 50.4% 63%,transparent 63.4%) left bottom/59% 58% no-repeat,
    linear-gradient(211deg,transparent 0 49%,var(--scene-ridge-mid) 49.4% 65%,transparent 65.4%) right bottom/58% 62% no-repeat,
    linear-gradient(180deg,var(--scene-sky-top) 0,var(--scene-sky-bottom) 54%,var(--scene-ridge-far) 54% 62%,var(--scene-ridge-near) 62% 76%,var(--scene-ground) 76% 100%);
  box-sizing:border-box;letter-spacing:0;isolation:isolate
}
.fui::before,.fui::after{content:"";position:absolute;pointer-events:none}
.fui::before{inset:0;z-index:0;background:
  radial-gradient(circle,var(--scene-dot-dark) 0 1px,transparent 1.25px) 0 0/4px 4px,
  radial-gradient(circle,var(--scene-dot-light) 0 .7px,transparent 1px) 2px 2px/4px 4px;
  opacity:.34;mix-blend-mode:multiply}
.fui::after{z-index:1;inset:var(--frame-y) var(--frame-x);background:var(--panel);border:1px solid var(--scene-frame-edge);box-shadow:0 28px 72px var(--scene-frame-shadow)}
.fui>*{z-index:2}
.fui>.skip-link{z-index:100}
.fui.sidebar-closed{grid-template-columns:0 minmax(0,1fr)}
.fui .win{border:0;border-radius:0;background:var(--panel);box-shadow:none}
.fui button,.fui input{-webkit-tap-highlight-color:rgba(255,255,255,.08)}
.fui .skip-link{border-color:#33485a;border-radius:2px;background:#080c10;color:var(--ink)}
.fui button:focus-visible,.fui input:focus-visible{outline:1px solid color-mix(in srgb,var(--cy) 45%,transparent);outline-offset:1px}
.fui ::selection{background:#17344c;color:#fff}

.fui .top{grid-area:top;display:grid;grid-template-columns:minmax(220px,.75fr) minmax(420px,1.35fr);grid-template-rows:auto auto;align-content:center;column-gap:16px;row-gap:3px;height:auto;border:0;border-bottom:1px solid var(--line);padding:4px 16px;background:var(--panel-2)}
.fui .header-brand{grid-column:1;grid-row:1 / 3;align-self:center;min-width:0}
.fui .header-brand-row{display:flex;align-items:center;gap:8px;min-width:0}
.fui .header-brand p{margin:4px 0 0 34px;overflow:hidden;color:var(--faint);font-size:9.5px;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}
.fui .app-return{display:inline-flex;height:26px;align-items:center;gap:4px;border:1px solid var(--line);border-radius:2px;background:var(--panel-3);padding:0 7px;color:var(--faint);font-family:var(--mono);font-size:8px;letter-spacing:.06em;text-decoration:none;transition:border-color .16s,background .16s,color .16s}
.fui .app-return:hover{border-color:#35536b;background:#0d151c;color:#edf7ff}
.fui .app-return:focus-visible{outline:1px solid color-mix(in srgb,var(--cy) 45%,transparent);outline-offset:1px}
.fui .sidebar-toggle{display:flex;width:26px;height:26px;border:1px solid var(--line);border-radius:2px;background:var(--panel-3);color:var(--dim)}
.fui .sidebar-toggle:hover{border-color:#35536b;background:#0d151c;color:#edf7ff}
.fui .sidebar-toggle:focus-visible{outline-color:var(--cy)}
.fui .mark{gap:7px;overflow:hidden}.fui .mark svg{width:14px;height:14px;flex:0 0 auto;opacity:.94}.fui .mark .wm{overflow:hidden;margin:0;color:#fff;font-family:var(--display);font-size:12px;font-weight:600;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
.fui .bc.top-tab{height:23px;flex:0 0 auto;border:1px solid #202932;border-radius:2px;background:#05080b;padding:0 7px;color:#b6c1cb;font-family:var(--mono);font-size:9px;letter-spacing:.03em}
.fui .bc.top-tab b{color:inherit;font-weight:500}
.fui .header-capabilities{grid-column:2;grid-row:1;display:flex;align-items:center;justify-content:flex-end;gap:6px;min-width:0}
.fui .header-capabilities span{display:flex;align-items:center;gap:5px;min-height:18px;border:0;padding:0 6px;color:#7d8086;font-size:9px;white-space:nowrap}
.fui .header-capabilities svg{color:#878a90}
.fui .header-controls{grid-column:2;grid-row:2;display:flex;align-items:center;justify-content:flex-end;gap:10px;min-width:0}
.fui .tfield{width:min(100%,520px);height:27px;max-width:none;margin:0;border:1px solid var(--line);border-radius:2px;background:var(--panel-3);box-shadow:none}
.fui .tfield:focus-within{border-color:#426c8c;box-shadow:inset 1px 0 var(--cy)}
.fui .tfield input{font-family:var(--mono);font-size:12px}.fui .tfield .gt{color:var(--cy)}.fui .tfield .lb{color:var(--faint);font-family:var(--pixel);font-size:9px;letter-spacing:.04em}
.fui .tfield .rn{border:1px solid #26313a;border-radius:2px;background:#0e1318;color:#dce4eb;font-family:var(--ui)}
.fui .tfield .rn:hover{border-color:#426c8c;background:#101a22;color:#fff}
.fui .clock{display:flex;min-height:26px;gap:9px;border-left:1px solid var(--line);padding-left:10px;color:var(--faint);font-family:var(--mono);font-size:9.5px}
.fui .clock>span{display:flex;align-items:center;gap:6px;white-space:nowrap}.fui .clock b{color:#dbe2e8;font-weight:500}.fui .stled{width:5px;height:5px;border:0;border-radius:1px;background:#46515b}.fui .stled.on{background:var(--cy)}

.fui .overview{grid-area:overview;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;border-bottom:1px solid var(--line);padding:9px 16px 10px;background:var(--panel-2);overflow:hidden}
.fui .overview-card{display:flex;min-height:0;flex-direction:column;border:1px solid #192129;border-radius:2px;background:#06080b;padding:7px 10px;color:var(--ink);overflow:hidden}
.fui .overview-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:21px}
.fui .overview-card-head>div{display:flex;align-items:center;gap:7px;min-width:0}
.fui .overview-card h2{overflow:hidden;margin:0;color:#f7f9fb;font-family:var(--display);font-size:11.5px;font-weight:600;letter-spacing:-.01em;text-overflow:ellipsis;white-space:nowrap}
.fui .overview-card-head span{border:1px solid #303238;border-radius:1px;padding:2px 5px;color:#8f9298;font-family:var(--mono);font-size:9px;letter-spacing:.03em;white-space:nowrap}
.fui .overview-action{display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex:0 0 auto;border:1px solid #303238;border-radius:2px;background:#17181a;color:#85888e;padding:0;cursor:pointer;transition:border-color .16s,color .16s,background .16s}
.fui .overview-action:hover:not(:disabled){border-color:#4b4e54;background:#202124;color:#d4d5d8}
.fui .overview-metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 10px;margin:5px 0 4px}
.fui .overview-metrics div{min-width:0}.fui .overview-metrics dt{overflow:hidden;color:#7d8086;font-size:9px;line-height:1.2;text-overflow:ellipsis;white-space:nowrap}
.fui .overview-metrics dd{overflow:hidden;margin:2px 0 0;color:#edf2f6;font-family:var(--mono);font-size:13px;font-variant-numeric:tabular-nums;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
.fui .overview-metrics dd.green,.fui .overview-metrics dd.blue{color:#edf2f6}.fui .overview-metrics dd.yellow{color:var(--amb)}.fui .overview-metrics dd.hot{color:var(--hot)}
.fui .overview-progress-copy{display:flex;align-items:center;justify-content:space-between;margin-top:auto;color:#7d8086;font-size:9px}
.fui .overview-progress-copy b{color:#aeb1b7;font-family:var(--mono);font-weight:500;font-variant-numeric:tabular-nums}
.fui .overview-progress{height:2px;margin-top:4px;background:#172029;overflow:hidden}
.fui .overview-progress i{display:block;height:100%;background:var(--cy);transition:width .42s ease-out}

.fui .ops{grid-area:ops;border:0;border-right:1px solid var(--line);border-radius:0;background:var(--panel-2)}
.fui .wbar{height:30px;border-bottom:1px solid var(--line);background:var(--panel-2);padding:0 11px}
.fui .wbar .wt{color:var(--ink);font-family:var(--display);font-size:10.5px;font-weight:600;letter-spacing:.01em;text-transform:none}
.fui .wbar .wid{color:var(--faint);font-family:var(--pixel);font-size:9px;letter-spacing:.03em}
.fui .task-filter{height:28px;margin:7px 8px 4px;border:1px solid var(--line);border-radius:2px;background:var(--panel-3)}
.fui .task-filter input{font-family:var(--ui);font-size:11px}.fui .task-filter:focus-within{border-color:#4a4d53}.fui .ph.act .ph-h .t,.fui .ph.act .ph-h .n{color:#b4b6bb}
.fui .chain{padding-inline:5px}.fui .ph-h .t{font-family:var(--pixel);font-size:9.5px;letter-spacing:.04em}.fui .ph-h .n{font-family:var(--mono);font-size:9px}
.fui .op{min-height:34px;gap:7px;border-radius:2px;padding:5px 8px;font-family:var(--ui)}.fui .op:hover{background:#0e141a;color:var(--ink)}
.fui .op-copy b{font-size:11px}.fui .op-copy small{font-size:9px}.fui .op.on{background:#0e1922;color:#fff;box-shadow:inset 2px 0 var(--cy)}
.fui .op.on .mk{background:var(--cy)}.fui .op.on .op-arrow{color:var(--cy)}
.fui .ops-summary,.fui .kit{display:none}.fui .summary-head b{color:var(--grn)}
.fui .summary-actions button{border-radius:2px;background:var(--panel-3)}.fui .summary-actions button:last-child{border-color:#3a3c41;color:#bcbec2}

.fui .term{grid-area:term;border:0;border-radius:0;background:var(--panel-3);box-shadow:none}
.fui .term>.wbar{height:30px;background:var(--panel-2);padding:0}
.fui .term>.wbar .wt{align-self:stretch;display:flex;align-items:center;border-right:1px solid var(--line);box-shadow:inset 0 -1px var(--cy);padding:0 12px;color:#f3f7fa;font-family:var(--mono);font-size:10px}
.fui .term>.wbar .wt::before{content:"›_";margin-right:7px;color:var(--cy)}
.fui .term>.wbar>.wid{margin-left:9px}.fui .term .livetool,.fui .scope-target{color:#c5e5fb}
.fui .livetool .ld{border-radius:1px;background:var(--cy);box-shadow:none}.fui .scope-dot{border-radius:1px;background:var(--cy);box-shadow:none}
.fui .console-actions{align-self:stretch;margin-left:auto;gap:0}.fui .console-actions button{height:100%;min-height:0;border:0;border-left:1px solid var(--line);border-radius:0;background:transparent;color:#7a7d83;padding:0 13px;font-size:9.5px}
.fui .console-actions button:hover{border-color:var(--line);background:#0e151b;color:#f4f8fb}.fui .console-actions button:last-child{border-color:var(--line);background:transparent;color:#b2bdc7}
.fui .out{background:var(--panel-3);padding:18px 24px 18px;font-family:var(--mono);font-size:12.5px}
.fui .session-reconnect{margin:0 0 16px;padding:10px 0;color:var(--dim);font-family:var(--ui);font-size:12px;line-height:1.5}
.fui .session-error{display:flex;align-items:center;justify-content:space-between;gap:16px;margin:0 0 16px;border:1px solid #3b282a;border-left:2px solid var(--hot);background:#100708;padding:10px 12px;color:#d8a3a5}
.fui .session-error>div{display:flex;min-width:0;flex-direction:column;gap:3px}.fui .session-error b{color:#f0c4c5;font-family:var(--ui);font-size:11.5px;font-weight:600}.fui .session-error span{color:#aa8587;font-family:var(--ui);font-size:11px;line-height:1.45}
.fui .session-error button{flex:0 0 auto;border:1px solid #513538;border-radius:2px;background:#171012;padding:6px 9px;color:#d7a5a7;font-family:var(--ui);font-size:10px;cursor:pointer}.fui .session-error button:hover{border-color:#805054;background:#211315;color:#f0c4c5}
.fui .history-window-notice{margin:0 0 14px;border-left:1px solid #33424f;padding:6px 10px;color:#7f8b95;font-family:var(--mono);font-size:10px;line-height:1.45}
.fui .welc{margin:0 auto;padding:10px 0;font-family:var(--ui)}.fui .scope{margin-bottom:12px;font-family:var(--mono);font-size:10px}.fui .welc .wt2{font-family:var(--display);font-size:17px;font-weight:600}.fui .welc .ws{margin-top:7px;font-family:var(--ui);font-size:13px;line-height:1.62}.fui .launch-card{min-height:50px;margin-top:12px;padding:9px 11px}.fui .launch-command,.fui .welcome-hint{display:none}
.fui .turn.user .tbody{border:0;border-left:1px solid #3b4b59;background:transparent;padding:8px 12px}.fui .turn.user .tbody::before{color:#b9c4ce}
.fui .turn.user .utext{font-family:var(--ui)}.fui .launch-card{border:1px solid var(--line);border-left:2px solid var(--cy);border-radius:2px;background:var(--panel-2)}
.fui .launch-kicker{color:var(--cy);font-family:var(--mono)}.fui .launch-command i,.fui .tk-url{color:#b9dcf5;text-decoration-color:#46657d}
.fui .launch-action{border:1px solid #2b3944;border-radius:2px;background:#0e1419;color:#dce6ed}.fui .launch-action:hover{border-color:#426c8c;background:#101a22;color:#fff;box-shadow:none}
.fui .reason{position:relative;margin:14px 0;border:0;border-left:1px solid #29313a;background:transparent;padding:7px 12px 8px 15px}
.fui .reason::before{content:"";position:absolute;left:-1px;top:8px;width:1px;height:22px;background:#69747f;opacity:.5}
.fui .reason .rhead{min-height:22px;padding:0}.fui .reason .ridentity,.fui .reason.live .ridentity{gap:7px;color:#a4adb6;font-size:10.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.fui .reason .rmk,.fui .reason.live .rmk{width:5px;height:5px;background:#68727c}.fui .reason .reason-badge{border:0;border-radius:0;padding:0;color:#858f99;font-family:var(--mono);font-size:9px;font-weight:500;letter-spacing:.04em}
.fui .reason .reason-time{color:#89939d;font-family:var(--mono);font-size:9.5px;font-weight:400;letter-spacing:0;text-transform:none}
.fui .reason .rbody{gap:5px;padding:7px 0 0;color:#969fa8;font-family:var(--mono);font-size:12px;line-height:1.65}
.fui .reason .rt{position:relative;padding:0}.fui .reason .rt::before{display:none}
.fui .tool{margin:15px 0;border:1px solid #1b232b;border-left:2px solid #3a4650;background:#030405;padding:0;overflow:hidden;animation:none}
.fui .tool-head{display:flex;min-height:36px;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid #151b21;background:#07090c;padding:7px 10px}
.fui .tcmd{display:flex;min-width:0;flex:1;align-items:center;gap:8px;color:#dfe6ec;font-size:11.5px;line-height:1.4}
.fui .tcmd .dol{flex:0 0 auto;margin:0;color:var(--cy);font-size:13px;font-weight:600}
.fui .tcmd .tnm{flex:0 0 auto;margin:0;border:0;background:none;padding:0;color:#9ba7b2;font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
.fui .tool-command{min-width:0;overflow:hidden;color:#eef3f7;font-family:var(--mono);text-overflow:ellipsis;white-space:nowrap}
.fui .tool-state{display:inline-flex;min-width:72px;flex:0 0 auto;align-items:center;justify-content:flex-end;gap:6px;color:#9da7b0;font-family:var(--mono);font-size:9.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap}
.fui .tool-state i{width:6px;height:6px;border-radius:1px;background:#69737c}
.fui .tool-output{background:#010203}.fui .tool-output-head{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #11171c;padding:5px 11px;color:#74808a;font-family:var(--mono);font-size:8.5px;font-weight:600;letter-spacing:.08em}
.fui .tout{max-height:320px;margin:0;border:0;background:#010203;padding:10px 12px;color:#bac4cd;font-size:11.5px;line-height:1.62;white-space:pre-wrap;word-break:break-word;-webkit-mask-image:none;mask-image:none}
.fui .tool.tool-complete .tool-state{color:#aab4bd}.fui .tool.tool-failed{border-left-color:var(--hot)}.fui .tool.tool-failed .tool-state{color:var(--hot)}.fui .tool.tool-failed .tool-state i{background:var(--hot)}
.fui .tool.tool-denied{border-left-color:var(--amb)}.fui .tool.tool-denied .tool-state{color:var(--amb)}.fui .tool.tool-denied .tool-state i{background:var(--amb)}
.fui .tool.tool-waiting{border-left-color:var(--amb)}.fui .tool.tool-waiting .tool-state{color:var(--amb)}.fui .tool.tool-waiting .tool-state i{background:var(--amb);animation:term-blink 1s steps(1,end) infinite}
.fui .tool.tool-stopped{border-left-color:#776262}.fui .tool.tool-stopped .tool-state{color:#bd9d9d}.fui .tool.tool-stopped .tool-state i{background:#9f8080}
.fui .tool.tool-interrupted{border-left-color:#303943}.fui .tool.tool-interrupted .tool-state{color:#8a949e}.fui .tool.tool-interrupted .tool-state i{background:#59636c}
.fui .tool-error{border-top:1px solid #382426;background:#100708;padding:9px 12px;color:#e3a3a3;font-family:var(--mono);font-size:11px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.fui.is-running .tool.run{border-color:#294963;border-left-color:var(--cy);background:#050b11;padding:0;box-shadow:inset 0 1px rgba(168,217,255,.08);animation:terminal-enter .16s ease-out both}
.fui .tool.run .tool-head{background:#06101a}.fui .tool.run .tool-state,.fui .tool.run .tcmd .tnm{color:var(--cy)}.fui .tool.run .tool-state i{background:var(--cy);box-shadow:0 0 10px rgba(168,217,255,.35);animation:term-blink 1s steps(1,end) infinite}
.fui .tk-url,.fui .tk-port,.fui .tk-ip{color:#b8dcfa}.fui .tk-state,.fui .tk-good,.fui .tk-status-2{color:#d2dae1}.fui .tk-sev-HIGH{color:var(--amb)}
.fui .answer-report{border:1px solid #28323c;border-top:2px solid #edf3f7;border-radius:2px;background:#07090c}
.fui .answer-head{background:#0a0d10}.fui .answer-kicker{color:var(--cy);font-family:var(--mono);font-size:9.5px}.fui .answer-head h2{font-family:var(--display);font-size:17px}.fui .answer-copy{font-family:var(--ui);font-size:13.5px}.fui .answer-state{border-color:#35424d;border-radius:2px;color:#c5ced6;font-size:9px}.fui .answer-state i{background:#d8e1e8}
.fui .answer-metrics dt{font-size:9px}.fui .answer-metrics dd{font-size:14px}
.fui .answer-actions button{border-radius:2px;background:var(--panel-3)}.fui .answer-actions button.primary{border-color:#33485a;background:#101820;color:#e7eef4}.fui .answer-actions button.primary:hover{border-color:#507595;background:#132431;color:#fff}

.fui .filebar{margin:0;border-color:var(--line);background:var(--panel-2)}
.fui .run-status{position:relative;display:grid;grid-template-columns:auto auto auto minmax(0,1fr) auto auto auto;align-items:center;gap:9px;min-height:38px;margin:0;border-top:1px solid var(--line);border-bottom:1px solid var(--line2);background:#050608;box-shadow:inset 1px 0 #4e5963;padding:5px 11px;color:#8d98a2;overflow:hidden}
.fui .run-terminal-icon{color:#a4afb8}.fui .run-pulse{width:12px;height:16px}.fui .run-pulse i{height:12px;background:#78838d}
.fui .run-phase{border:1px solid #26303a;border-radius:1px;background:#0d1217;padding:3px 6px;color:#a5afb8;font-family:var(--mono);font-size:9px;font-weight:600;letter-spacing:.04em;white-space:nowrap}
.fui .run-status.phase-tool{border-top-color:#294963;background:#050b11;box-shadow:inset 2px 0 var(--cy)}
.fui .run-status.phase-tool .run-terminal-icon,.fui .run-status.phase-tool .run-phase,.fui .run-status.phase-tool .run-context{color:var(--cy)}
.fui .run-status.phase-tool .run-phase{border-color:#294963;background:#08131d}.fui .run-status.phase-tool .run-pulse i{background:var(--cy);box-shadow:0 0 8px rgba(168,217,255,.25)}
.fui .run-copy{display:flex;min-width:0;flex-direction:column;align-items:flex-start;gap:3px;overflow:hidden;animation:run-phase-in .15s ease-out both}
@keyframes run-phase-in{from{opacity:.38;transform:translateY(2px)}to{opacity:1;transform:none}}
.fui .run-copy b{overflow:hidden;width:100%;color:#eef3f7;font-family:var(--ui);font-size:11px;font-weight:550;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
.fui .run-copy code{overflow:hidden;width:100%;color:#8c98a3;font-family:var(--mono);font-size:9.5px;line-height:1.15;text-overflow:ellipsis;white-space:nowrap}
.fui .run-timer{margin-left:0;color:#b2bcc5;font-family:var(--mono);font-size:10px}.fui .run-context{color:#89949e;font-family:var(--mono);font-size:9px;letter-spacing:.04em;text-transform:uppercase}
.fui .run-stop{min-width:42px;min-height:28px;border:1px solid #3a2828;background:#151010;padding:4px 6px;color:#9d7777;font-size:9px;letter-spacing:.06em;text-transform:uppercase}.fui .run-stop:hover{border-color:#704242;background:#211313;color:#e5a4a4}
.fui.is-running .term>.wbar{box-shadow:inset 0 -1px var(--cy)}.fui.is-running .term .livetool{color:var(--cy)}
.fui .prompt{height:42px;margin:0;border:0;border-top:1px solid var(--line);border-radius:0;background:var(--panel-3);padding:0 11px}
.fui .prompt:hover{border-color:var(--line);background:var(--panel-3)}.fui .prompt:focus-within{border-color:#263948;background:var(--panel-3);box-shadow:inset 1px 0 var(--cy)}
.fui .prompt textarea{font-family:var(--mono);font-size:13px;caret-color:var(--cy)}.fui .prompt .k{border-radius:2px;font-family:var(--ui);font-size:10px}.fui .prompt .k.attach:hover{color:var(--cy)}
.fui .prompt .mode-badge{font-size:10px}
.fui .prompt .send{border-radius:2px;border-color:#2c3d4b;background:#0f171e;color:#dce8f0}.fui .prompt .send:hover:not(:disabled){border-color:#4e7696;background:#122330;color:#fff}
.fui .bar{grid-area:bar;height:30px;border:0;border-top:1px solid var(--line);background:var(--panel-2);padding:0 13px;font-family:var(--mono);font-size:9.5px}
.fui .bar .sg{height:100%;border-color:var(--line);padding:0 10px}.fui .bar .sg:first-child{color:#c0cad3;box-shadow:inset 0 -1px var(--cy)}.fui .bar .sg:last-child{max-width:45%;overflow:hidden;white-space:nowrap}
.fui .reason.live,.fui .reason.tone-hot{border-left-color:#29313a}.fui .reason.live .rmk{background:#68727c}
.fui .ovlpanel{border-color:var(--line);border-radius:0;background:var(--panel-2)}.fui .ovlbar .pdf,.fui .ovlx{border-radius:0}
.fui .ovlbar .pdf{border-color:#33485a;background:#0f171e;color:#dbe8f1}.fui .ovlbar .pdf:hover{border-color:#507595;background:#132431;color:#fff}.fui .ovlfind:hover{border-left-color:var(--cy);background:#0c141b}
.fui .task-browser-overlay{align-items:flex-end;padding:0}
.fui .task-browser-panel{width:min(720px,100%);max-height:min(88dvh,820px);border-radius:14px 14px 0 0}
.fui .mobile-task-browser{padding:12px 14px max(18px,env(safe-area-inset-bottom));overscroll-behavior:contain}
.fui .mobile-task-filter{height:44px;margin:0 0 14px;border-color:#2c3944;background:#05080b;padding-inline:12px}
.fui .mobile-task-filter input{font-size:16px}.fui .mobile-task-filter button{display:flex;min-width:44px;min-height:44px;align-items:center;justify-content:center}
.fui .mobile-task-groups{display:grid;gap:16px}
.fui .mobile-task-groups section>header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line);padding:0 2px 7px}
.fui .mobile-task-groups h3{margin:0;color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:.08em}.fui .mobile-task-groups header>span{color:var(--faint);font-family:var(--mono);font-size:10px}
.fui .mobile-task-groups section>div{display:grid;gap:5px;padding-top:6px}
.fui .mobile-task-groups section button{display:flex;min-height:52px;width:100%;align-items:center;justify-content:space-between;gap:12px;border:1px solid var(--line);border-radius:4px;background:var(--panel-3);padding:8px 11px;color:var(--dim);text-align:left}
.fui .mobile-task-groups section button>span:first-child{display:flex;min-width:0;flex-direction:column;gap:3px}.fui .mobile-task-groups section button b{color:var(--ink);font-size:11.5px;font-weight:550}.fui .mobile-task-groups section button small{overflow:hidden;color:var(--faint);font-size:10px;text-overflow:ellipsis;white-space:nowrap}
.fui .mobile-task-groups section button.is-active{border-color:#456982;background:#0e1922}.fui .mobile-task-groups section button.is-active>span:last-child{color:var(--cy)}

/* RIFT PANDA — an original pixel operator. Black-and-white anatomy carries
   the character; ice blue is reserved for its eyes, R tag and live terminal. */
  position:absolute;z-index:4;
  background:none;color:inherit;cursor:pointer;overflow:visible;user-select:none;touch-action:manipulation;
  filter:drop-shadow(2px 3px 0 rgba(0,0,0,.58)) drop-shadow(0 12px 16px rgba(0,0,0,.38));
  transition:filter .18s ease-out
}
@media (hover:hover) and (pointer:fine){
}

@media (max-width:980px),(max-height:620px){
}
@media (min-width:981px) and (max-width:1240px) and (min-height:621px){
}

@media (max-width:1240px){
  .fui{--frame-x:clamp(28px,3.5vw,44px);--frame-y:24px;grid-template-columns:200px minmax(0,1fr);grid-template-rows:62px 148px minmax(0,1fr) 30px}
  .fui.sidebar-closed{grid-template-columns:0 minmax(0,1fr)}
  .fui .top{grid-template-columns:minmax(220px,.78fr) minmax(410px,1.3fr);padding-inline:14px;column-gap:14px}
  .fui .overview{gap:9px;padding:8px 14px 9px}.fui .overview-card{padding:7px 9px}.fui .overview-metrics{gap:4px 8px}
  .fui .header-brand p{margin-left:34px}.fui .header-capabilities{gap:3px}.fui .header-capabilities span{padding-inline:4px}
  .fui .bar{height:30px}
}
@media (max-width:980px){
  .fui{--frame-x:14px;--frame-y:14px;grid-template-columns:188px minmax(0,1fr);grid-template-rows:60px 142px minmax(0,1fr) 28px}
  .fui.sidebar-closed{grid-template-columns:0 minmax(0,1fr)}
  .fui .top{grid-template-columns:minmax(205px,.8fr) 1fr;padding:6px 11px;column-gap:10px}.fui .header-capabilities span:nth-child(2){display:none}
  .fui .overview{gap:7px;padding:7px 10px 8px}.fui .overview-card{padding:6px 8px}.fui .overview-card h2{font-size:11px}.fui .overview-metrics dd{font-size:12px}
  .fui .clock>span:last-child{display:none}.fui .out{padding-inline:21px}.fui .bar{height:28px}
}
@media (max-height:700px) and (min-width:781px){
  .fui{--frame-y:10px;grid-template-rows:58px 132px minmax(0,1fr) 28px}.fui .overview{padding-block:6px 7px}.fui .overview-metrics{margin-block:4px 3px}.fui .bar{height:28px}
}
@media (max-width:780px){
  .fui,.fui.sidebar-closed{--frame-x:0px;--frame-y:0px;grid-template-columns:minmax(0,1fr);grid-template-rows:calc(52px + env(safe-area-inset-top)) 112px minmax(0,1fr) 28px;grid-template-areas:"top" "overview" "term" "bar";padding:0;background:var(--panel)}
  .fui::before{display:none}.fui::after{inset:0;border:0;box-shadow:none}
  .fui .top{display:grid;grid-template-columns:auto minmax(0,1fr);grid-template-rows:1fr;gap:8px;padding:env(safe-area-inset-top) max(9px,env(safe-area-inset-right)) 0 max(9px,env(safe-area-inset-left))}.fui .header-brand{grid-column:1;grid-row:1}.fui .header-brand-row{gap:7px}.fui .header-brand p,.fui .header-capabilities,.fui .bc.top-tab{display:none}
  .fui .sidebar-toggle{display:none}.fui .app-return{width:44px;height:44px;justify-content:center;padding:0}.fui .app-return span{display:none}.fui .mark .wm{font-size:10.5px}.fui .mark svg{width:14px;height:14px}
  .fui .header-controls{grid-column:2;grid-row:1;gap:6px}.fui .tfield{width:100%;height:44px}.fui .tfield .rn{min-width:44px;min-height:42px}.fui .clock{display:none}
  .fui .overview{grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:6px 7px 7px}.fui .overview-card{padding:6px}.fui .overview-card-head{min-height:20px}.fui .overview-card h2{font-size:9.5px}.fui .overview-card-head span,.fui .overview-action{display:none}
  .fui .overview-metrics{grid-template-columns:repeat(2,minmax(0,1fr));gap:4px;margin:5px 0 3px}.fui .overview-metrics div:nth-child(n+3){display:none}.fui .overview-metrics dt{font-size:8.5px}.fui .overview-metrics dd{margin-top:2px;font-size:11px}.fui .overview-progress-copy{font-size:8.5px}.fui .overview-progress{height:3px;margin-top:3px}
  .fui .ops{display:none}.fui .term{border:0}.fui .term>.wbar{height:44px}.fui .out{padding:16px 14px;font-size:13px}.fui .run-status{grid-template-columns:auto auto minmax(0,1fr) auto auto;gap:7px;min-height:44px;padding:5px 8px}.fui .run-phase,.fui .run-context,.fui .run-copy code{display:none}.fui .run-copy{display:block}.fui .run-stop{min-width:44px;min-height:44px}.fui .prompt{height:54px;margin:0 max(8px,env(safe-area-inset-right)) max(8px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left))}.fui .prompt .k{min-width:44px;min-height:44px}.fui .mobile-ops{border-color:var(--line);background:var(--panel-2);padding-inline:max(9px,env(safe-area-inset-left)) max(9px,env(safe-area-inset-right))}.fui .mobile-ops button{min-height:44px;border-radius:3px;font-size:10px}.fui .mobile-task-browser-trigger span{margin-left:6px;color:var(--cy);font-variant-numeric:tabular-nums}.fui .task-browser-panel .ovlbar{min-height:52px;padding-left:max(14px,env(safe-area-inset-left))}.fui .task-browser-panel .ovlx{min-width:44px;min-height:44px}
  .fui .bar{height:28px;padding:0}.fui .bar .sg{padding:0 8px}
}
@media (max-width:460px){
  .fui .mark .wm{max-width:42px}.fui .tfield .lb{display:none}.fui .tfield .rn{padding-inline:7px}.fui .out{padding-inline:10px}
  .fui .overview-card:nth-child(2) .overview-action{display:none}.fui .overview-progress-copy span{max-width:62px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
@media (pointer:coarse){
  .fui .op,.fui .run-stop{min-height:44px}
}
@media (prefers-contrast:more){
  .fui{--ink:#fff;--dim:#d1d2d5;--faint:#aeb1b7;--line:#5a5d63}.fui::before{opacity:.28}.fui::after{background:#08090b}
}
@media (forced-colors:active){
}
@media (prefers-reduced-motion:reduce){
}
`;

const PRODUCT_TYPOGRAPHY = `
.fui{--ui:var(--font-cursor-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);--display:var(--ui);font-family:var(--ui);font-size:var(--rift-type-body);font-weight:400;line-height:1.5;letter-spacing:0}
.fui :is(.ops,.top,.bar,.ovlbar,.launch-card,.overview){font-family:var(--ui);letter-spacing:0}
.fui :is(.app-return,.bc.top-tab,.header-capabilities span,.header-brand p,.bar,.ovltitle,.mode-badge,.mobile-ops button){font-family:var(--ui);font-size:var(--rift-type-caption);font-weight:400;letter-spacing:0;text-transform:none}
.fui :is(.wm,.wt2,.off-t,.ovltitle){font-family:var(--ui);font-weight:500;letter-spacing:0}
.fui .mark .wm{font-family:var(--ui);font-size:var(--rift-type-body);font-weight:500;letter-spacing:0}
.fui .welc .wt2{font-family:var(--ui);font-size:var(--rift-type-title);font-weight:500;line-height:1.35;letter-spacing:-.012em}
.fui .overview-card h2,.fui .wbar .wt{font-family:var(--ui);font-size:var(--rift-type-label);font-weight:500;letter-spacing:0}
.fui .overview-metrics dt,.fui .overview-progress-copy{font-family:var(--ui);font-size:var(--rift-type-caption);font-weight:400;letter-spacing:0}
.fui .ph-h .t{font-family:var(--ui);font-size:var(--rift-type-caption);font-weight:500;letter-spacing:0}
.fui .op-copy b,.fui .mobile-task-groups section button b{font-family:var(--ui);font-size:var(--rift-type-label);font-weight:400;letter-spacing:0}
.fui .op-copy small,.fui .mobile-task-groups section button small{font-family:var(--ui);font-size:var(--rift-type-caption);font-weight:400;letter-spacing:0}
.fui :is(.ops button,.launch-action,.answer-actions button,.prompt .k){font-family:var(--ui);font-size:var(--rift-type-label);font-weight:400;letter-spacing:0}
`;

// One neutral interaction surface; colored focus must not revive from the
// older themed workbench layers above. Keyboard focus stays visible.
const WORKBENCH_REFINEMENT = `
.fui{--frame-x:0px;--frame-y:0px;--panel:#000000;--panel-2:#080808;--panel-3:#111111;--line:#303030;--ink:#eeeeee;--dim:#a6a6a6;--faint:#838383;--cy:#c9c9c9;background:#000;padding:0;grid-template-columns:236px minmax(0,1fr);grid-template-rows:104px auto minmax(0,1fr) 30px}
.fui::before,.fui::after{display:none}
.fui .top{padding:8px 20px;background:#080808;column-gap:24px}
.fui .header-brand p{font-size:11px}.fui .header-capabilities{display:none}.fui .header-controls{grid-row:1 / 3}.fui .header-brand{grid-row:1 / 3}
.fui .app-return,.fui .sidebar-toggle{border:0;border-radius:7px;background:transparent;color:#aaa;font-size:11px;height:30px}.fui .app-return:hover,.fui .sidebar-toggle:hover{background:#252525;color:#fff}
.fui .tfield{height:36px;border-radius:8px;border-color:#343434;background:#111}.fui .tfield input{font-family:var(--ui);font-size:13px}.fui .tfield .rn{border-radius:5px;background:#303030;border:0;color:#eee}
.fui .overview{padding:12px 20px;gap:12px;background:#000}.fui .overview-card{padding:10px 12px;border:1px solid #2b2b2b;border-radius:9px;background:#080808}.fui .overview-card h2{font-size:12px}.fui .overview-card-head span{border:0;background:#252525;border-radius:4px;color:#aaa}
.fui .ops{background:#080808;border-right:1px solid #2b2b2b}.fui .op{border:0;border-radius:7px;margin:2px 8px;width:calc(100% - 16px);padding:9px 10px}.fui .op:hover{background:#242424}.fui .op.sel{background:#2b2b2b;box-shadow:none;border:0}.fui .op-copy b{font-weight:500}.fui .op-copy small{line-height:1.5;color:#929292}
.fui .task-filter{margin:10px 12px;border-radius:7px;background:#111;border-color:#303030}.fui .task-filter input{font-size:12px}.fui .wbar{background:transparent;border-color:#2b2b2b;padding:0 16px}
.fui .term{background:#000}.fui .out{padding:22px 26px}.fui .prompt{margin:10px 20px 16px;border:1px solid #3a3a3a;border-radius:12px;background:#090909;padding:12px;transition:border-color .16s ease,background .16s ease;box-shadow:none}.fui .prompt:hover{border-color:#494949;background:#090909}.fui .prompt textarea{font-family:var(--ui);font-size:14px;line-height:1.6;caret-color:#eee}.fui .prompt .send{border-radius:7px;background:#e7e7e7;color:#181818;border:0}.fui .prompt .send:hover:not(:disabled){background:#fff;color:#000}
.fui .prompt:focus-within,.fui .tfield:focus-within,.fui .task-filter:focus-within{border-color:#616161;box-shadow:none;outline:none;background:#111}
.fui :is(input,textarea):focus,.fui :is(input,textarea):focus-visible{outline:none!important;box-shadow:none!important}
.fui button:focus-visible,.fui a:focus-visible{outline:1px solid #b5b5b5;outline-offset:2px;box-shadow:none}
.fui .bar{background:#080808;border-color:#303030}.fui .bar .sg:first-child{box-shadow:none}.fui .clock{color:#999;border:0}.fui .ovlpanel{border-radius:12px;border-color:#383838;background:#080808}.fui ::selection{background:#444;color:#fff}

.fui .out{background:#000;color:#ededed;font-family:var(--ui);font-size:14px;line-height:1.7;scroll-behavior:auto;overflow-anchor:none}
.fui .term{position:relative}.fui .follow-output{position:absolute;z-index:10;right:24px;top:46px;border:1px solid #363636;border-radius:50%;width:34px;height:34px;display:grid;place-items:center;padding:0;background:#171717;color:#eee;font:500 12px var(--ui);cursor:pointer;box-shadow:0 4px 16px #0008}
.fui .overview{background:#000}.fui .overview-card{border-color:#222}.fui .overview-metrics{gap:7px 14px}.fui .overview-metrics dt{font:400 11px var(--ui);color:#969696}.fui .overview-metrics dd{font:500 12px var(--ui);color:#e9e9e9}.fui .overview-progress,.fui .overview-progress-copy{display:none}
.fui .tool{border:1px solid #252525;border-radius:8px;background:#080808;margin:12px 0}.fui .tool-head{background:transparent;padding:10px 12px}.fui .tool-command{font:12px/1.5 var(--mono);color:#bdbdbd}.fui .tnm,.fui .tool-state{font:500 11px var(--ui);letter-spacing:0;text-transform:none;color:#a8a8a8}
.fui .tool-output-head{display:flex;justify-content:space-between;padding:9px 12px;border-top:1px solid #202020;font:400 12px var(--ui);letter-spacing:0;color:#a3a3a3;cursor:pointer}.fui .tool-output-head:hover{color:#eee}.fui .tout{font:12px/1.65 var(--mono);background:#000;color:#bcbcbc;border:0;max-height:240px;padding:12px;margin:0}
.fui .reason{border:0;border-radius:6px;background:transparent;padding:0;margin:12px 0;color:#a8a8a8}.fui .rhead{padding:7px 0;cursor:pointer;font:500 12px var(--ui);color:#999}.fui .rbody{font:13px/1.7 var(--ui);color:#aaa;padding:6px 0 8px 16px}.fui .rbody .rt{margin:0 0 10px}.fui .reason-badge,.fui .rtag{display:none}.fui .reason .ridentity{font:500 12px var(--ui);letter-spacing:0;text-transform:none;color:#a8a8a8}.fui .reason .reason-time{font:400 11px var(--ui);color:#818181}
.fui .answer-report{background:transparent;border:0;border-radius:0;box-shadow:none}.fui .answer-head{background:transparent;padding:14px 0;border-bottom:1px solid #202020}.fui .answer-copy{padding:16px 0;font:400 14px/1.75 var(--ui);color:#ededed;max-width:78ch}.fui .answer-copy pre{background:#0a0a0a;border:1px solid #292929;border-radius:8px;color:#dedede;max-width:100%;overflow:auto}
.fui .answer-copy :not(pre)>code{background:#1a1a1a;color:#dedede;border:0;border-radius:4px;padding:2px 5px;font:12px/1.6 var(--mono)}
.fui .answer-copy pre code{color:inherit;background:transparent;border:0}
.fui .overview-metrics dd{font-variant-numeric:tabular-nums}
.fui .overview-card-head h2{font-weight:550;color:#e3e7e4}
.fui .overview-card-head span{font-size:10px;letter-spacing:.02em}
.fui .overview-action:disabled{opacity:.35}
.fui .tbody,.fui .ln{font-family:var(--ui)}.fui .turn.user{background:#0c0c0c;border-radius:8px;padding:12px 14px;margin:12px 0 24px}
.fui .op-copy b{font:500 13px var(--ui)}.fui .op-copy small{font:400 11px/1.45 var(--ui)}.fui .mark .wm{font:500 14px var(--ui)}.fui .header-brand p{font-size:11px;color:#888}.fui .welc{background:transparent;border-color:#252525}.fui .welc .wt2{font:500 22px/1.35 var(--ui)}.fui .welc .ws{font:400 14px/1.7 var(--ui);color:#aaa}
.fui .run-status,.fui .bar{background:#080808;border-color:#252525;box-shadow:none}.fui .run-copy b{font:500 12px var(--ui)}.fui .bar{font:11px var(--ui)}
@media(max-width:800px){.fui{grid-template-columns:200px minmax(0,1fr);grid-template-rows:104px auto minmax(0,1fr) 30px}.fui .top{padding:8px 12px;grid-template-columns:1fr;grid-template-rows:30px 36px}.fui .header-brand{grid-row:1}.fui .header-controls{grid-column:1;grid-row:2}.fui .overview{padding:8px;gap:6px}.fui .overview-card{padding:8px}.fui .prompt{margin:8px}.fui .out{padding:16px}}
@media(max-width:600px){.fui{grid-template-columns:minmax(0,1fr);grid-template-rows:104px auto minmax(0,1fr) 30px}.fui .ops{display:none}.fui .overview-card:last-child{display:none}.fui .overview{grid-template-columns:1fr 1fr}}

.fui .prompt{height:auto;min-height:48px}
.fui .prompt textarea{display:block;min-width:0;min-height:24px;max-height:144px;padding:0;resize:none;overflow-y:auto}
@media(max-width:800px){.fui .prompt textarea{font-size:16px}}

/* Both sidebar states use the current two-row header's intrinsic height.
   An absent overview must not retain the old mobile 112px track. */
.fui,.fui.sidebar-closed{grid-template-rows:auto auto minmax(0,1fr) 30px}

.fui .overview-panel{grid-area:overview;min-width:0;border-bottom:1px solid #252525;background:#080808}
.fui .overview-toggle{display:flex;align-items:center;gap:12px;min-height:34px;padding:4px 20px;list-style:none;cursor:pointer;color:#aaa;font:400 12px/1.4 var(--ui);user-select:none}
.fui .overview-toggle::-webkit-details-marker{display:none}
.fui .overview-toggle:hover{background:#141414;color:#eee}
.fui .overview-toggle:focus-visible{outline:2px solid #aaa;outline-offset:-3px}
.fui .overview-counts{margin-left:auto;color:#888;font-variant-numeric:tabular-nums}
.fui .overview-toggle>svg{flex-shrink:0}
.fui .overview-panel[open]>.overview-toggle>svg{transform:rotate(180deg)}
.fui .overview-panel .overview{padding:4px 12px 8px;gap:8px;border:0}
.fui .overview-panel .overview-card{padding:8px 10px}
.fui .overview-panel .overview-metrics{gap:4px 10px}
@media(max-width:600px){.fui .overview-toggle{padding-inline:12px;gap:8px;font-size:11px}.fui .overview-panel .overview{padding-inline:8px}}
`;
