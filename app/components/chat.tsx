"use client";
import { findSavedPreview } from "@/lib/preview/preview-evidence";
import { createDispatchReceiptMetadata } from "@/lib/chat/dispatch-receipt";

import { readApprovalMode } from "@/app/hooks/useApprovalMode";
import { ToolApprovalRequests } from "./ToolApprovalRequests";
import { ChatApprovalContext } from "@/app/contexts/ChatApprovalContext";
import { PlanQuestions, DockedQuestionContext } from "./PlanQuestions";
import { pendingPlanQuestion } from "@/lib/chat/plan-questions";

import { prepareMessagesForAgentReplay } from "@/lib/chat/agent-replay";
import { retainedTodos } from "@/lib/chat/retained-todos";
import { restoreExecutionTarget } from "@/lib/chat/execution-target";

import { type UseChatHelpers } from "@ai-sdk/react";
import {
  useRetainedChat,
  useRetainedChatMessageCount,
} from "@/app/hooks/useRetainedChat";
import { useChatViewState } from "@/app/contexts/ChatViewStateContext";
import { DefaultChatTransport } from "ai";
import dynamic from "next/dynamic";
import {
  useRef,
  useEffect,
  useLayoutEffect,
  useState,
  useReducer,
  useCallback,
  useMemo,
  type RefObject,
} from "react";
import { useQuery, usePaginatedQuery, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { FileDetails } from "@/types/file";
import { Messages } from "./Messages";
import { ChatInput } from "./ChatInput";
import {
  AgentWorkingTray,
  useMobileAgentActivity,
} from "./ChatInput/AgentWorkingTray";
import { extractSubagentsFromMessages } from "./agent-activity";
import { openAgentActivity } from "@/lib/workbench/events";
import type { RateLimitWarningData } from "./RateLimitWarning";
import { BuildPreviewPanel } from "./BuildPreviewPanel";
import { buildLiveProgressPresentation } from "@/lib/chat/live-progress";
import { MobileToolDialog } from "./MobileToolDialog";
import ChatHeader from "./ChatHeader";
import Footer from "./Footer";
import { useMessageScroll } from "../hooks/useMessageScroll";
import { useChatHandlers } from "../hooks/useChatHandlers";
import { usePublishRiftAgentConsole } from "./terminal/RiftAgentConsoleContext";
import { useNewChatMessage } from "../hooks/useNewChatMessage";
import { useGlobalState } from "../contexts/GlobalState";
import { useInputApi } from "../contexts/InputContext";
import { useFileUpload } from "../hooks/useFileUpload";
import { useDocumentDragAndDrop } from "../hooks/useDocumentDragAndDrop";
import { DragDropOverlay } from "./DragDropOverlay";
import { normalizeMessages } from "@/lib/utils/message-processor";
import { ChatSDKError } from "@/lib/errors";
import { fetchWithErrorHandlers, convertToUIMessages } from "@/lib/utils";
import {
  fetchAgentLongStream,
  preloadAgentLongTransport,
  resumeAgentLongStream,
} from "@/lib/chat/agent-long-transport";
import {
  LEGACY_DESKTOP_AGENT_UPDATE_MESSAGE,
  isLegacyDesktopAgentClient,
  shouldUseAgentLongForAgent,
} from "@/lib/chat/agent-routing";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import {
  AGENT_LONG_REPLAY_EDGE_PART_TYPE,
  stripAgentLongHeartbeatPartsFromMessages,
} from "@/lib/chat/agent-long-heartbeat";
import { toast } from "sonner";
import type { Todo, ChatMessage, ChatMode } from "@/types";
import {
  coerceSelectedModel,
  coerceChatPurpose,
  isChatMode,
  resolveChatModeForPurpose,
} from "@/types/chat";
import type { ContextUsageData } from "./ContextUsageIndicator";
import { shouldTreatAsMerge } from "@/lib/utils/todo-utils";
import { v4 as uuidv4 } from "uuid";
import { useIsMobile } from "@/hooks/use-mobile";
import { useParams, usePathname, useRouter } from "next/navigation";
import { ConvexErrorBoundary } from "./ConvexErrorBoundary";
import { useAutoResume } from "../hooks/useAutoResume";
import { usePersistedChatMessages } from "../hooks/usePersistedChatMessages";
import { mergeFileMetadataReceipt } from "@/lib/chat/file-metadata-receipts";
import { useAutoContinue } from "../hooks/useAutoContinue";
import { useLatestRef } from "../hooks/useLatestRef";
import {
  useDataStreamDispatch,
  useDataStreamState,
  DataStreamProvider,
} from "./DataStreamProvider";
import { newChatDraftId } from "@/lib/composer/draft-id";
import { removeDraft } from "@/lib/utils/client-storage";
import { parseRateLimitWarning } from "@/lib/utils/parse-rate-limit-warning";
import Loading from "@/components/ui/loading";
import { AppLaunchComplete } from "@/components/launch/AppLaunchProvider";

import { HackingSuggestions } from "./HackingSuggestions";
import { useProShell } from "./pro/ProShellContext";
import { useResizableSplit } from "./pro/useResizableSplit";
import { useWorkbenchDock } from "@/app/hooks/useWorkbenchDock";
import { useWorkbenchTitlebarInset } from "@/app/hooks/useWorkbenchTitlebarInset";
import dockStyles from "./workbench/WorkbenchDock.module.css";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { ProEmptyHero } from "./pro/ProEmptyHero";
import { StudioDiscovery } from "./studio/StudioDiscovery";
import { WorkbenchTerminalActivityBridge } from "./workbench/WorkbenchActivity";
import { WindowTitle } from "./pro/WindowTitle";
import { WorkbenchBoundary } from "./workbench/WorkbenchBoundary";
import { projectContextFromChat } from "@/lib/projects/client-project-context";
import { AgentRunSummaryBar } from "./AgentRunSummaryBar";
import { FileRefProvider } from "./file-ref-context";
import { extractAllSidebarContent } from "@/lib/utils/sidebar-utils";
import { getCurrentRunMessages, getCurrentRunTodos } from "./agent-activity";
import { readActiveGoalRequestContext } from "@/lib/composer/browser-goal-store";
import { prepareWorkingFileRequest } from "@/lib/composer/working-file-request";
import { onChatCommand } from "@/lib/utils/chat-command-events";
import { extractMessageText } from "@/lib/utils/message-utils";
import {
  hasInterruptedPersistedResponse,
  INTERRUPTED_RESPONSE_MESSAGE,
} from "@/lib/chat/interrupted-response";
import {
  chatRouteKey,
  shouldPromoteNewChatRoute,
} from "@/lib/chat/new-chat-lifecycle";
import { resolveMediaRequest } from "@/lib/ai/media-intent";

// The computer pane pulls in Monaco, Shiki, image/file viewers, and the agent
// activity tree. Most chats never open it, so keep that substantial dependency
// graph out of the initial chat bundle and fetch it only on first use.
const ComputerSidebar = dynamic(() =>
  import("./ComputerSidebar").then((module) => module.ComputerSidebar),
);

const WorkbenchDock = dynamic(() =>
  import("./workbench/WorkbenchDock").then((module) => module.WorkbenchDock),
);

// --- Streaming ephemeral state reducer ---
// Consolidates high-frequency streaming state updates into a single dispatch
// to avoid cascading re-renders from multiple independent useState calls.
interface StreamingEphemeralState {
  uploadStatus: { message: string; isUploading: boolean } | null;
  summarizationStatus: {
    status: "started" | "completed";
    message: string;
  } | null;
  rateLimitWarning: RateLimitWarningData | null;
  contextUsage: ContextUsageData;
}

type StreamingAction =
  | {
      type: "SET_UPLOAD_STATUS";
      payload: StreamingEphemeralState["uploadStatus"];
    }
  | {
      type: "SET_SUMMARIZATION_STATUS";
      payload: StreamingEphemeralState["summarizationStatus"];
    }
  | {
      type: "SET_RATE_LIMIT_WARNING";
      payload: StreamingEphemeralState["rateLimitWarning"];
    }
  | { type: "SET_CONTEXT_USAGE"; payload: ContextUsageData }
  | { type: "RESET_ON_FINISH" };

const initialStreamingState: StreamingEphemeralState = {
  uploadStatus: null,
  summarizationStatus: null,
  rateLimitWarning: null,
  contextUsage: { usedTokens: 0, maxTokens: 0 },
};

function streamingReducer(
  state: StreamingEphemeralState,
  action: StreamingAction,
): StreamingEphemeralState {
  switch (action.type) {
    case "SET_UPLOAD_STATUS":
      if (state.uploadStatus === action.payload) return state;
      return { ...state, uploadStatus: action.payload };
    case "SET_SUMMARIZATION_STATUS":
      if (state.summarizationStatus === action.payload) return state;
      return { ...state, summarizationStatus: action.payload };
    case "SET_RATE_LIMIT_WARNING":
      return { ...state, rateLimitWarning: action.payload };
    case "SET_CONTEXT_USAGE":
      return { ...state, contextUsage: action.payload };
    case "RESET_ON_FINISH":
      if (state.uploadStatus === null && state.summarizationStatus === null)
        return state;
      return {
        ...state,
        uploadStatus: null,
        summarizationStatus: null,
      };
    default:
      return state;
  }
}

// Renderless component that isolates dataStream state subscriptions
// (useAutoResume + useAutoContinue) from the Chat component.
// Without this boundary, Chat subscribes to DataStreamStateContext
// through these hooks and re-renders on every stream chunk.
function StreamEffects({
  autoResume,
  serverMessages,
  resumeStream,
  stopReader,
  setMessages,
  status,
  error,
  chatMode,
  chatPurpose,
  sendMessage,
  hasManuallyStoppedRef,
  todos,
  temporaryChatsEnabled,
  sandboxPreference,
  selectedModel,
  resetRef,
  hasActiveStream,
  preserveReaderOnUnmount,
}: {
  autoResume: boolean;
  serverMessages: ChatMessage[];
  resumeStream: UseChatHelpers<ChatMessage>["resumeStream"];
  stopReader: () => void | Promise<void>;
  setMessages: UseChatHelpers<ChatMessage>["setMessages"];
  status: UseChatHelpers<ChatMessage>["status"];
  error: UseChatHelpers<ChatMessage>["error"];
  chatMode: string;
  chatPurpose: string;
  sendMessage: (
    message?: { text: string } | any,
    options?: { body?: Record<string, unknown> },
  ) => void | Promise<void>;
  hasManuallyStoppedRef: RefObject<boolean>;
  todos: Todo[];
  temporaryChatsEnabled: boolean;
  sandboxPreference: string;
  selectedModel: string;
  resetRef: RefObject<(() => void) | null>;
  hasActiveStream: boolean | undefined;
  preserveReaderOnUnmount?: boolean;
}) {
  const recoveryPending = useAutoResume({
    autoResume,
    initialMessages: serverMessages,
    resumeStream,
    stopReader,
    hasManuallyStoppedRef,
    setMessages,
    status,
    error,
    hasActiveStream,
    preserveReaderOnUnmount,
  });

  const { resetAutoContinueCount } = useAutoContinue({
    enabled: !preserveReaderOnUnmount,
    // A subscriber replacement is not a completed agent run.
    status: recoveryPending ? "streaming" : status,
    error,
    chatMode,
    chatPurpose,
    sendMessage,
    hasManuallyStoppedRef,
    todos,
    temporaryChatsEnabled,
    sandboxPreference,
    selectedModel,
  });

  // Expose resetAutoContinueCount to parent via ref (avoids state coupling)
  useEffect(() => {
    resetRef.current = resetAutoContinueCount;
  }, [resetRef, resetAutoContinueCount]);

  return null;
}

export const Chat = ({ autoResume }: { autoResume: boolean }) => (
  <DataStreamProvider>
    <ChatSession autoResume={autoResume} />
  </DataStreamProvider>
);

const ChatSession = ({ autoResume }: { autoResume: boolean }) => {
  const params = useParams();
  const pathname = usePathname();
  const routeChatId = params?.id as string | undefined;
  const router = useRouter();
  const isMobile = useIsMobile();
  const [chatId, setChatId] = useState<string>(() => routeChatId || uuidv4());
  const retainedView = useChatViewState(chatId);
  const initialView = useMemo(() => ({ ...retainedView }), [retainedView]);
  const retainedMessageCount = useRetainedChatMessageCount(chatId);
  const { setDataStream, setIsAutoResuming, setIsReplaying } =
    useDataStreamDispatch();
  const { isReplaying } = useDataStreamState();
  const [streamingState, dispatchStreaming] = useReducer(streamingReducer, {
    ...initialStreamingState,
    contextUsage:
      initialView.contextUsage ?? initialStreamingState.contextUsage,
    rateLimitWarning: initialView.rateLimitWarning ?? null,
  });
  const { uploadStatus, summarizationStatus, rateLimitWarning, contextUsage } =
    streamingState;

  const { inputRef } = useInputApi();
  const {
    chatMode,
    setChatMode,
    chatPurpose,
    setChatPurpose,
    activeProject,
    setActiveProject,
    sidebarOpen,
    sidebarContent,
    setSidebarOpen,
    setSidebarContent,
    buildPreviewOpen,
    buildPreviewUrl,
    setBuildPreviewOpen,
    setBuildPreviewUrl,
    terminalDockOpen,
    toggleTerminalDock,
    chatSidebarOpen,
    setChatSidebarOpen,
    initializeChat,
    mergeTodos,
    setTodos,
    replaceAssistantTodos,
    temporaryChatsEnabled,
    setTemporaryChatsEnabled,
    setChatReset,
    hasUserDismissedRateLimitWarning,
    setHasUserDismissedRateLimitWarning,
    messageQueue,
    removeQueuedMessage,
    claimQueuedMessage,
    activeQueueChatId,
    setActiveQueueChat,
    queueBehavior,
    todos,
    sandboxPreference,
    setSandboxPreference,
    selectedModel,
    setSelectedModel,
    reasoningEffort,
    setReasoningEffort,
    subscription,
    desktopBridgeActive,
  } = useGlobalState();
  const { enabled: proShell } = useProShell();

  useEffect(() => {
    if (chatMode === "agent") preloadAgentLongTransport();
  }, [chatMode]);

  const { goChat, goHome, replaceChatUrl } = useChatNavigation();
  // Auxiliary panes open only through an explicit user action.
  const showBuildPreview = buildPreviewOpen && !!buildPreviewUrl;
  const agentActivityOpen =
    sidebarOpen && sidebarContent === null && !showBuildPreview;
  // The preview and Agent Activity share one pane. The window strip owns the
  // way INTO the preview (its toggle is gated on this flag, not on which
  // surface holds the slot, so the preview is never a one-way door); the
  // preview surface itself keeps only the way back to the activity panel.
  const canShowBuildPreview = !!buildPreviewUrl;
  const handleShowAgentActivity = useCallback(() => {
    setBuildPreviewOpen(false);
    setSidebarContent(null);
    setSidebarOpen(true);
  }, [setBuildPreviewOpen, setSidebarContent, setSidebarOpen]);

  const handleToggleAgentActivity = useCallback(() => {
    if (agentActivityOpen) {
      setSidebarOpen(false);
      return;
    }
    setBuildPreviewOpen(false);
    setSidebarContent(null);
    setSidebarOpen(true);
  }, [
    agentActivityOpen,
    setBuildPreviewOpen,
    setSidebarContent,
    setSidebarOpen,
  ]);
  const chatSurfaceRef = useRef<HTMLDivElement>(null);

  const dock = useWorkbenchDock(chatId, isMobile === false);
  useMobileAgentActivity({
    enabled: isMobile === true,
    onSelectAgent: dock.selectAgent,
    onOpenActivity: handleShowAgentActivity,
  });
  const handleSelectCollaborator = useCallback((toolCallId: string) => {
    openAgentActivity({ toolCallId });
  }, []);
  // The window title/actions are siblings of this chat. Publish the actual
  // pane width so their strip ends at the conversation/dock divider, including
  // the intermediate widths of a resize or opening transition.
  const toolPaneElementRef = useWorkbenchTitlebarInset(
    isMobile === false &&
      dock.state.visible &&
      dock.state.placement === "right",
  );
  const [dockHeight, setDockHeight] = useState(340);
  const dockDrag = useRef<{ y: number; height: number; max: number } | null>(
    null,
  );
  const [bottomResizing, setBottomResizing] = useState(false);
  const {
    ratio: toolPaneRatio,
    isResizing: isToolPaneResizing,
    handleProps: resizeHandleProps,
  } = useResizableSplit(
    isMobile === false &&
      dock.state.visible &&
      dock.state.placement === "right" &&
      !dock.state.maximized,
  );

  // Track whether this is an existing chat (prop-driven initially, flips after first completion)
  const [isExistingChat, setIsExistingChat] = useState<boolean>(!!routeChatId);
  const wasNewChatRef = useRef(!routeChatId);
  const projectContextReadyRef = useRef(!routeChatId);
  const pendingNewChatResetRef = useRef(false);
  const shouldFetchMessages = isExistingChat;
  // A newly started run stays on / until completion, but its durable state
  // must already be observed for wake/reconnect and offline final hydration.
  const [submittedPersistentChatId, setSubmittedPersistentChatId] = useState<
    string | null
  >(null);
  const shouldObservePersistedRun =
    shouldFetchMessages || submittedPersistentChatId === chatId;
  const currentChatIdRef = useLatestRef(chatId);

  // Refs to avoid stale closures in callbacks
  const isExistingChatRef = useLatestRef(isExistingChat);
  const chatModeRef = useLatestRef(chatMode);
  const subscriptionRef = useLatestRef(subscription);
  const desktopBridgeReadyRef = useLatestRef(desktopBridgeActive);

  // Chat purpose (security / app builder / image). Sent with every request; the
  // backend swaps the model + system prompt accordingly. Mirrors the reactive
  // global state (set by the sidebar mode launcher, restored from the chat row
  // when reopening a saved chat) so the streaming transport reads the latest.
  const chatPurposeRef = useLatestRef(chatPurpose);
  const activeProjectRef = useLatestRef(activeProject);

  // Suppress transient "Chat Not Found" while server creates the chat
  const [awaitingServerChat, setAwaitingServerChat] = useState<boolean>(false);

  // Store file metadata separately from AI SDK message state (for temporary chats)
  const [tempChatFileDetails, setTempChatFileDetails] = useState<
    Map<string, FileDetails[]>
  >(() => initialView.files ?? new Map());

  // Title streamed mid-response so the header updates before Convex persists it
  const [streamedTitle, setStreamedTitle] = useState<string | null>(
    () => initialView.title ?? null,
  );

  const temporaryChatsEnabledRef = useLatestRef(temporaryChatsEnabled);
  // Use global state ref so streaming callback reads latest value
  const hasUserDismissedWarningRef = useLatestRef(
    hasUserDismissedRateLimitWarning,
  );
  // Use ref for todos to avoid stale closures in auto-send
  const todosRef = useLatestRef(todos);
  // Use ref for sandbox preference to avoid stale closures in auto-send
  const sandboxPreferenceRef = useLatestRef(sandboxPreference);
  // Use ref for model selection to avoid stale closures in auto-send
  const selectedModelRef = useLatestRef(selectedModel);
  // Reasoning is remembered per Build model and must remain fresh for queued,
  // regenerate, and auto-continue requests that share this transport.
  const reasoningEffortRef = useLatestRef(reasoningEffort);

  const getCurrentExecutionMode = useCallback(
    () =>
      resolveChatModeForPurpose({
        purpose: chatPurposeRef.current,
        selectedModel: selectedModelRef.current,
        fallbackMode: chatModeRef.current,
      }),
    [chatModeRef, chatPurposeRef, selectedModelRef],
  );

  // Ensure we only initialize mode from server once per chat id
  const hasInitializedModeFromChatRef = useRef(false);
  // Track whether sandbox preference has been initialized from chat for this chat id
  const hasInitializedSandboxRef = useRef(false);
  // Track whether the stored sandbox connection was validated (stale connections unlock the selector)
  const hasInitializedModelRef = useRef(false);
  // Snapshot of the last picker values successfully persisted to the chat doc.
  // Seeded after init from chatData; subsequent picker toggles trigger a debounced patch.
  const persistedPrefsRef = useRef<{ model: string; mode: string } | null>(
    null,
  );

  // Sync local chat state from URL (single source of truth).
  //
  // Guarded so it acts only on an actual URL change. React re-runs mounted
  // effects with unchanged dependencies whenever the subtree is torn down and
  // restored (StrictMode's double-invoke, and a suspend/resume during submit),
  // and this body is not idempotent: on "/" it mints a fresh chat id. That is
  // how a sent message used to vanish — the transcript held the user's message
  // for a moment, the effect re-ran, `useChat` was rebound to a brand-new id,
  // and the screen fell back to the empty new-chat state while the run carried
  // on server-side under the original id, reachable only from Recent.
  const lastSyncedRouteRef = useRef<string | null>(
    chatRouteKey(pathname, routeChatId),
  );
  useEffect(() => {
    const routeKey = chatRouteKey(pathname, routeChatId);
    if (lastSyncedRouteRef.current === routeKey) return;
    lastSyncedRouteRef.current = routeKey;
    // Preview ownership is conversation-scoped. This effect also runs for
    // browser Back/Forward transitions, which bypass the explicit navigation
    // helpers that normally clear the prior chat's iframe.
    setBuildPreviewOpen(false);
    setBuildPreviewUrl(null);
    setStreamedTitle(initialView.title ?? null);
    if (routeChatId) {
      projectContextReadyRef.current = false;
      setChatId(routeChatId);
      setIsExistingChat(true);
    } else {
      // Navigated to "/" (new chat) — reset to fresh state
      if (!pendingNewChatResetRef.current) {
        setActiveProject(null);
        setChatPurpose(pathname.startsWith("/studio") ? "image" : "app");
      }
      projectContextReadyRef.current = true;
      setChatId(uuidv4());
      setIsExistingChat(false);
      wasNewChatRef.current = true;
    }
    pendingNewChatResetRef.current = false;
  }, [
    pathname,
    routeChatId,
    setActiveProject,
    setBuildPreviewOpen,
    setBuildPreviewUrl,
    setChatPurpose,
    initialView,
  ]);

  // Use paginated query to load messages in batches of 14
  const paginatedMessages = usePaginatedQuery(
    api.messages.getMessagesByChatId,
    shouldObservePersistedRun ? { chatId } : "skip",
    {
      initialNumItems: Math.max(
        14,
        initialView.loadedMessageCount ?? 14,
        retainedMessageCount,
      ),
    },
  );

  // Get chat data to retrieve title when loading existing chat
  const currentCreditBalance = useQuery(
    api.extraUsage.getExtraUsageSettings,
    {},
  );
  useEffect(() => {
    if (
      (currentCreditBalance?.balancePoints ?? 0) > 0 &&
      rateLimitWarning?.warningType === "token-bucket" &&
      !rateLimitWarning.cutOff
    ) {
      dispatchStreaming({ type: "SET_RATE_LIMIT_WARNING", payload: null });
    }
  }, [currentCreditBalance?.balancePoints, rateLimitWarning]);
  const pendingToolApprovals = useQuery(api.approvals.pending, { chatId });
  const hideWorkbench = dock.hide;
  const approvalContext = useMemo(
    () => ({
      toolCallIds: (pendingToolApprovals ?? []).flatMap((request) =>
        request.toolCallId ? [request.toolCallId] : [],
      ),
      onReview: () => {
        setSidebarOpen(false);
        hideWorkbench();
        requestAnimationFrame(() => {
          const card = document.querySelector<HTMLElement>(
            '[aria-label="Action awaiting approval"]',
          );
          card?.scrollIntoView({ block: "center", behavior: "instant" });
          card
            ?.querySelector<HTMLButtonElement>("button")
            ?.focus({ preventScroll: true });
        });
      },
    }),
    [pendingToolApprovals, setSidebarOpen, hideWorkbench],
  );
  const fetchedChatData = useQuery(
    api.chats.getChatByIdFromClient,
    shouldObservePersistedRun ? { id: chatId } : "skip",
  );
  // Preserve the known title/project while the live subscription reattaches.
  // An explicit null still wins: revoked/deleted chats must not use cached data.
  const chatData =
    fetchedChatData === undefined ? initialView.chatData : fetchedChatData;

  // Query local sandbox connections only when we need to validate a non-E2B sandbox_type
  const storedSandboxType = (chatData as any)?.sandbox_type as
    | string
    | undefined;
  const needsConnectionValidation =
    !!storedSandboxType &&
    storedSandboxType !== "e2b" &&
    storedSandboxType !== "tauri" &&
    !hasInitializedSandboxRef.current;
  const localConnections = useQuery(
    api.localSandbox.listConnections,
    needsConnectionValidation ? undefined : "skip",
  );

  // Prefer the mid-stream title — the server seeds chatData.title with the
  // user's first message before generation completes, which would otherwise
  // flicker into the header on abort.
  const chatTitle = streamedTitle ?? chatData?.title ?? null;
  const activeTriggerRunRef = useLatestRef(
    (chatData as any)?.active_trigger_run_id as string | undefined,
  );

  // Convert paginated Convex messages to UI format for useChat and useAutoResume
  // Messages come from server in descending order (newest first from pagination); reverse for chronological order
  const serverMessages: ChatMessage[] = useMemo(
    () =>
      paginatedMessages.results?.length
        ? convertToUIMessages([...paginatedMessages.results].reverse())
        : [],
    [paginatedMessages.results],
  );

  // State to prevent double-processing of queue
  // Ref to track when "Send Now" is actively processing to prevent auto-processing interference
  const isSendingNowRef = useRef(false);
  // Ref to track if user manually stopped - prevents auto-processing until new message submitted
  const hasManuallyStoppedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const agentLongResumeAbortControllerRef = useRef<AbortController | null>(
    null,
  );
  const isChatMountedRef = useRef(true);

  // Ref for setMessages — needed by DefaultChatTransport which is created before useChat returns
  const setMessagesRef = useRef<(messages: any[]) => void>(() => {});
  const getRetainedMessagesRef = useRef(() => messagesRef.current);
  const registerResumeAbortRef = useRef<(abort: () => void) => () => void>(
    () => () => {},
  );
  const registerRequestContextRef = useRef<
    (body: Record<string, unknown>) => void
  >(() => {});

  // Default transport (OpenRouter) - stored in ref since it's created before useChat
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      fetch: async (input, init) => {
        const resumeTriggerStream = async () => {
          const readMessages = getRetainedMessagesRef.current;
          const writeMessages = setMessagesRef.current;
          const rememberRequest = registerRequestContextRef.current;
          const controller = new AbortController();
          agentLongResumeAbortControllerRef.current = controller;
          const unregister = registerResumeAbortRef.current(() =>
            controller.abort(),
          );
          // From here until the producer's replay-edge marker, everything that
          // arrives is history: paint it, do not type it.
          setIsReplaying(true);

          try {
            const response = await resumeAgentLongStream(
              typeof input === "string" ? input : input.toString(),
              { ...init, signal: controller.signal },
              (runId) => {
                const current = readMessages();
                const replayBase = prepareMessagesForAgentReplay(
                  current,
                  runId,
                );
                if (replayBase !== current) writeMessages(replayBase);
              },
              rememberRequest,
            );
            if (response.status === 204 || !response.ok) unregister();
            return response;
          } catch (error) {
            unregister();
            throw error;
          }
        };

        // Derive Studio mode from the model as a transport-level safeguard.
        // This closes the effect-timing window where a restored video picker
        // could otherwise reach the bounded /api/chat route as Ask mode.
        let bodyMode: ChatMode | null = null;
        let persistentRequestChatId: string | null = null;
        if (typeof init?.body === "string") {
          try {
            const requestBody = JSON.parse(init.body) as {
              mode?: unknown;
              chatId?: unknown;
              temporary?: unknown;
            };
            const isTemporary =
              typeof requestBody.temporary === "boolean"
                ? requestBody.temporary
                : !isExistingChatRef.current &&
                  temporaryChatsEnabledRef.current;
            if (!isTemporary && typeof requestBody.chatId === "string") {
              persistentRequestChatId = requestBody.chatId;
            }
            bodyMode =
              typeof requestBody.mode === "string" &&
              isChatMode(requestBody.mode)
                ? requestBody.mode
                : null;
          } catch {
            bodyMode = null;
          }
        }
        const observeSubmittedRun = () => {
          if (
            persistentRequestChatId &&
            currentChatIdRef.current === persistentRequestChatId &&
            isChatMountedRef.current
          ) {
            setSubmittedPersistentChatId(persistentRequestChatId);
          }
        };
        const mode = bodyMode ?? getCurrentExecutionMode();
        const isTauri = isTauriEnvironment();
        if (isLegacyDesktopAgentClient({ mode, isTauri })) {
          throw new ChatSDKError(
            "forbidden:chat",
            LEGACY_DESKTOP_AGENT_UPDATE_MESSAGE,
          );
        }
        const useTriggerAgent = shouldUseAgentLongForAgent({
          mode,
          subscription: subscriptionRef.current,
          isTauri,
        });
        if (useTriggerAgent) {
          // useChat reuses this fetch for both POST sendMessages and GET
          // reconnectToStream — dispatch on method.
          if (init?.method === "GET") {
            return resumeTriggerStream();
          }
          observeSubmittedRun();
          return fetchAgentLongStream(init);
        }
        // Reconnect for legacy "agent-long" chats normalised to "agent" mode on
        // load — prepareReconnectToStreamRequest already pointed at the resume
        // URL, so route based on the URL (not on ref state) to be resilient to
        // stale refs.
        if (
          init?.method === "GET" &&
          (typeof input === "string" ? input : input.toString()).includes(
            "/api/agent-long/resume",
          )
        ) {
          return resumeTriggerStream();
        }
        if (init?.method !== "GET") observeSubmittedRun();
        return fetchWithErrorHandlers(input, init);
      },
      prepareReconnectToStreamRequest: ({ id, api }) => {
        // Use the agent-long resume endpoint when there is a stored trigger run
        // (covers legacy "agent-long" chats normalised to "agent" on load) OR
        // when the current run is using Trigger.dev for agent mode.
        const useTriggerAgent = shouldUseAgentLongForAgent({
          mode: getCurrentExecutionMode(),
          subscription: subscriptionRef.current,
          isTauri: isTauriEnvironment(),
        });
        if (useTriggerAgent || !!activeTriggerRunRef.current) {
          return {
            api: `/api/agent-long/resume?chatId=${encodeURIComponent(id)}`,
          };
        }
        return { api: `${api}/${id}/stream` };
      },
      prepareSendMessagesRequest: async ({ id, messages, body }) => {
        // Capture the session owner before asynchronous working-file preflight.
        const rememberRequest = registerRequestContextRef.current;
        const requestProjectId = projectContextReadyRef.current
          ? activeProjectRef.current?.id
          : undefined;
        const {
          messages: normalizedMessages,
          lastMessage,
          hasChanges,
        } = normalizeMessages(messages as ChatMessage[]);
        if (hasChanges && body?.__riftRetainedContinuation !== true) {
          setMessagesRef.current(normalizedMessages);
        }

        const isTemporaryChat =
          body?.__riftRetainedContinuation === true
            ? body.temporary === true
            : !isExistingChatRef.current && temporaryChatsEnabledRef.current;

        const stripUrlsFromMessages = (msgs: ChatMessage[]): ChatMessage[] => {
          const messagesWithoutHeartbeats =
            stripAgentLongHeartbeatPartsFromMessages(msgs);
          return messagesWithoutHeartbeats.map((msg) => {
            if (!msg.parts || msg.parts.length === 0) return msg;
            const strippedParts = msg.parts.map((part: any) => {
              if (part.type === "file" && "url" in part) {
                const { url, ...partWithoutUrl } = part;
                return partWithoutUrl;
              }
              return part;
            });
            return {
              ...msg,
              parts: strippedParts,
            };
          });
        };

        const messagesToSend = isTemporaryChat
          ? normalizedMessages
          : lastMessage;
        const messagesWithoutUrls = stripUrlsFromMessages(messagesToSend);
        if (body?.__riftRetainedContinuation === true) {
          const { __riftRetainedContinuation: _clientOnly, ...context } = body;
          return {
            body: { ...context, chatId: id, messages: messagesWithoutUrls },
          };
        }
        const latestRequestText = extractMessageText(
          lastMessage.at(-1)?.parts ?? [],
        );
        const requestedSelection = coerceSelectedModel(
          typeof body?.selectedModel === "string"
            ? body.selectedModel
            : selectedModelRef.current,
        );
        const mediaRequest = resolveMediaRequest({
          purpose: chatPurposeRef.current,
          prompt: latestRequestText,
          selectedModel: requestedSelection,
        });
        const requestMode = resolveChatModeForPurpose({
          purpose: chatPurposeRef.current,
          selectedModel: mediaRequest.selectedModel,
          fallbackMode:
            typeof body?.mode === "string" && isChatMode(body.mode)
              ? body.mode
              : chatModeRef.current,
        });

        const requestBody = {
          chatId: id,
          messages: messagesWithoutUrls,
          purpose: chatPurposeRef.current,
          ...body,
          mode: requestMode,
          selectedModel: mediaRequest.selectedModel,
          reasoningEffort:
            chatPurposeRef.current === "app"
              ? reasoningEffortRef.current
              : undefined,
          approvalMode: readApprovalMode(),
          activeGoal: readActiveGoalRequestContext(id),
          workingFile:
            chatPurposeRef.current === "app"
              ? await prepareWorkingFileRequest(
                  id,
                  desktopBridgeReadyRef.current,
                )
              : undefined,
          projectId: requestProjectId,
        };
        rememberRequest(requestBody);
        return { body: requestBody };
      },
    }),
  );

  const {
    messages,
    sendMessage,
    setMessages,
    status: sdkStatus,
    stop,
    error,
    regenerate,
    resumeStream,
    retainedDataStream,
    retentionEnabled,
    retainedContinuationPending,
    registerResumeAbort,
    getRetainedMessages,
    registerRequestContext,
    stopRetainedReader,
  } = useRetainedChat({
    id: chatId,
    messages: serverMessages,
    // Throttle the streamed-token render coalescing window. 150ms made the UI
    // lag the server by up to a full frame-batch; 50ms (Trigger's realtime
    // guidance) shows the first token sooner and streams smoother. MessageItem
    // memoization keeps per-tick render cost bounded.
    experimental_throttle: 50,
    generateId: () => uuidv4(),

    transport: transportRef.current,

    onData: (dataPart) => {
      setDataStream((ds) => (ds ? [...ds, dataPart] : []));
      switch (dataPart.type) {
        case AGENT_LONG_REPLAY_EDGE_PART_TYPE: {
          // History is over; from the next chunk on, words are really new.
          setIsReplaying(false);
          break;
        }
        case "data-upload-status": {
          const uploadData = dataPart.data as {
            message: string;
            isUploading: boolean;
          };
          dispatchStreaming({
            type: "SET_UPLOAD_STATUS",
            payload: uploadData.isUploading ? uploadData : null,
          });
          break;
        }
        case "data-summarization": {
          const summaryData = dataPart.data as {
            status: "started" | "completed";
            message: string;
          };
          dispatchStreaming({
            type: "SET_SUMMARIZATION_STATUS",
            payload: summaryData.status === "started" ? summaryData : null,
          });
          break;
        }
        case "data-rate-limit-warning": {
          const rawData = dataPart.data as Record<string, unknown>;
          const parsed = parseRateLimitWarning(rawData, {
            hasUserDismissed: hasUserDismissedWarningRef.current,
          });
          if (parsed) {
            dispatchStreaming({
              type: "SET_RATE_LIMIT_WARNING",
              payload: parsed,
            });
          }
          break;
        }
        case "data-file-metadata": {
          const fileData = dataPart.data as {
            messageId: string;
            fileDetails: FileDetails[];
          };
          // Merge into parallel state (outside AI SDK control)
          // Completion receipts can correct earlier per-file metadata.
          setTempChatFileDetails((previous) =>
            mergeFileMetadataReceipt(
              previous,
              fileData.messageId,
              fileData.fileDetails,
            ),
          );
          break;
        }
        case "data-context-usage": {
          const usage = dataPart.data as ContextUsageData;
          dispatchStreaming({ type: "SET_CONTEXT_USAGE", payload: usage });
          break;
        }
        case "data-title": {
          const titleData = dataPart.data as { chatTitle?: string };
          if (titleData?.chatTitle) {
            setStreamedTitle(titleData.chatTitle);
          }
          break;
        }
        case "data-sandbox-fallback": {
          const fallbackData = dataPart.data as {
            occurred: boolean;
            reason: "connection_unavailable" | "no_local_connections";
            requestedPreference: string;
            actualSandbox: string;
            actualSandboxName?: string;
          };

          // Skip fallback notifications for Tauri — the server-side health check
          // hits its own localhost, not the user's desktop, so it consistently
          // reports false disconnects. The frontend already validated Tauri availability.
          if (fallbackData.requestedPreference === "tauri") {
            break;
          }

          // Update sandbox preference to match actual sandbox used
          setSandboxPreference(fallbackData.actualSandbox);

          // Show toast notification
          const message =
            fallbackData.reason === "no_local_connections"
              ? `Local sandbox unavailable. Using ${fallbackData.actualSandboxName || "Cloud"}.`
              : `Selected sandbox disconnected. Switched to ${fallbackData.actualSandboxName || "Cloud"}.`;
          toast.info(message, { duration: 5000 });
          break;
        }
      }
    },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName === "todo_write" && toolCall.input) {
        const todoInput = toolCall.input as { merge?: boolean; todos: Todo[] };
        if (!todoInput.todos) return;
        // Determine last assistant message id to stamp/replace.
        // Read via ref to avoid closing over the streaming messages array.
        const currentMessages = messagesRef.current;
        let lastAssistantId: string | undefined;
        for (let i = currentMessages.length - 1; i >= 0; i--) {
          if (currentMessages[i].role === "assistant") {
            lastAssistantId = currentMessages[i].id;
            break;
          }
        }

        const treatAsMerge = shouldTreatAsMerge(
          todoInput.merge,
          todoInput.todos,
        );

        if (!treatAsMerge) {
          // Fresh plan creation: replace assistant todos with new ones, stamp with current assistant id if present.
          replaceAssistantTodos(todoInput.todos, lastAssistantId);
        } else {
          // Partial update: merge
          mergeTodos(todoInput.todos);
        }
      }
    },
    onFinish: ({ isAbort, isDisconnect, isError }) => {
      agentLongResumeAbortControllerRef.current = null;
      if (!isChatMountedRef.current) return;
      setIsAutoResuming(false);
      setAwaitingServerChat(false);
      dispatchStreaming({ type: "RESET_ON_FINISH" });

      // A new chat starts on the current page so its optimistic user message
      // and live transport remain mounted. Promoting the URL before the stream
      // finishes crosses from /(chat)/page.tsx to /(chat)/c/[id]/page.tsx,
      // remounting Chat and severing the active Agent subscription. Only move
      // to the durable route after a genuinely successful response; failures
      // stay in place with the user's message and the Retry/Reconnect actions.
      const isTemporaryChat =
        !isExistingChatRef.current && temporaryChatsEnabledRef.current;
      if (
        shouldPromoteNewChatRoute({
          isExistingChat: isExistingChatRef.current,
          isTemporaryChat,
          isAbort,
          isDisconnect,
          isError,
        })
      ) {
        // The transport is terminal and its output has been persisted, so the
        // route-level Chat remount is now safe.
        replaceChatUrl(chatId);
        removeDraft(newChatDraftId(chatPurposeRef.current));
        setIsExistingChat(true);
      }
    },
    onError: (error) => {
      agentLongResumeAbortControllerRef.current = null;
      if (!isChatMountedRef.current) return;
      setIsAutoResuming(false);
      setAwaitingServerChat(false);
      dispatchStreaming({ type: "RESET_ON_FINISH" });
      if (error instanceof ChatSDKError) {
        const errorMessage =
          typeof error.cause === "string" ? error.cause : error.message;
        if (error.type !== "rate_limit" || isMobile) {
          toast.error(errorMessage);
        }
      } else if (isMobile && error.name !== "AbortError") {
        toast.error(error.message || "An error occurred.");
      }
    },
  });

  // Keep refs in sync so closures read latest values
  const status =
    sdkStatus === "ready" && retainedContinuationPending
      ? "submitted"
      : sdkStatus;
  const collaboratorTray = useMemo(() => {
    const agents = extractSubagentsFromMessages(messages, status, {
      currentRunOnly: true,
    });
    const turnIndex = messages.findLastIndex(
      (message) => message.role === "user",
    );
    const runKey = JSON.stringify([
      chatId,
      messages[turnIndex]?.id ?? turnIndex,
    ]);
    return (
      <AgentWorkingTray
        agents={agents}
        runKey={runKey}
        onSelectAgent={handleSelectCollaborator}
      />
    );
  }, [chatId, messages, status, handleSelectCollaborator]);
  setMessagesRef.current = setMessages;
  messagesRef.current = messages;
  getRetainedMessagesRef.current = getRetainedMessages;
  registerResumeAbortRef.current = registerResumeAbort;
  registerRequestContextRef.current = registerRequestContext;

  // Restore presentation before paint. Commands/continuations are deliberately
  // not replayed; the retained SDK stream is already doing the actual work.
  const restoredViewRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (restoredViewRef.current === chatId) return;
    restoredViewRef.current = chatId;
    const prefs = initialView.preferences;
    if (prefs) {
      setChatMode(prefs.chatMode);
      setChatPurpose(prefs.chatPurpose);
      setSelectedModel(prefs.selectedModel);
      setReasoningEffort(prefs.reasoningEffort);
      setSandboxPreference(prefs.sandboxPreference);
      setActiveProject(prefs.activeProject);
      setTodos(retainedTodos(getRetainedMessages(), prefs.todos));
      hasInitializedModeFromChatRef.current = true;
      hasInitializedSandboxRef.current = true;
      hasInitializedModelRef.current = true;
      projectContextReadyRef.current = true;
    }
    setDataStream(retainedDataStream);
    for (const part of retainedDataStream) {
      if (part.type === "data-title" && part.data?.chatTitle)
        setStreamedTitle(part.data.chatTitle);
      if (part.type === "data-context-usage")
        dispatchStreaming({ type: "SET_CONTEXT_USAGE", payload: part.data });
      if (part.type === "data-file-metadata") {
        const { messageId, fileDetails } = part.data as {
          messageId: string;
          fileDetails: FileDetails[];
        };
        setTempChatFileDetails((previous) =>
          mergeFileMetadataReceipt(previous, messageId, fileDetails),
        );
      }
    }
  }, [
    chatId,
    initialView,
    retainedDataStream,
    getRetainedMessages,
    setActiveProject,
    setChatMode,
    setChatPurpose,
    setDataStream,
    setSandboxPreference,
    setSelectedModel,
    setReasoningEffort,
    setTodos,
  ]);

  useLayoutEffect(() => {
    retainedView.chatData = chatData;
    retainedView.title = streamedTitle;
    retainedView.loadedMessageCount = messages.length;
    retainedView.files = tempChatFileDetails;
    retainedView.contextUsage = contextUsage;
    retainedView.rateLimitWarning = rateLimitWarning;
    retainedView.preferences = {
      chatMode,
      chatPurpose,
      selectedModel,
      reasoningEffort,
      sandboxPreference,
      activeProject,
      todos,
    };
  }, [
    retainedView,
    chatData,
    streamedTitle,
    messages.length,
    tempChatFileDetails,
    contextUsage,
    rateLimitWarning,
    chatMode,
    chatPurpose,
    selectedModel,
    reasoningEffort,
    sandboxPreference,
    activeProject,
    todos,
  ]);

  // Register the latest result for the Preview control without moving focus
  // or changing the conversation width as streamed results arrive.
  const lastExposedPreviewUrl = useMemo(
    () => findSavedPreview([...messages].reverse())?.url ?? null,
    [messages],
  );
  useEffect(() => {
    if (lastExposedPreviewUrl) setBuildPreviewUrl(lastExposedPreviewUrl);
  }, [lastExposedPreviewUrl, setBuildPreviewUrl]);

  const isBuildAgentRunLive =
    chatPurpose === "app" &&
    chatMode === "agent" &&
    (status === "streaming" || status === "submitted");

  // The one-line "what is happening right now" headline for the idle grid.
  const previewStatusLine = useMemo(() => {
    if (!isBuildAgentRunLive) return null;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role !== "assistant") continue;
      return buildLiveProgressPresentation(
        (message.parts ?? []) as Parameters<
          typeof buildLiveProgressPresentation
        >[0],
      ).title;
    }
    return "Starting the build";
  }, [isBuildAgentRunLive, messages]);

  const abortAgentLongResume = useCallback(() => {
    const resumeController = agentLongResumeAbortControllerRef.current;
    agentLongResumeAbortControllerRef.current = null;
    resumeController?.abort();
  }, []);

  const stopWithAgentLongResumeAbort = useCallback(() => {
    const stopping = stop();
    abortAgentLongResume();
    return stopping;
  }, [abortAgentLongResume, stop]);

  const reconnectWithVisibleStatus = useCallback(async () => {
    setIsAutoResuming(true);
    try {
      await resumeStream();
    } finally {
      setIsAutoResuming(false);
    }
  }, [resumeStream, setIsAutoResuming]);

  useEffect(() => {
    isChatMountedRef.current = true;
    return () => {
      isChatMountedRef.current = false;
    };
  }, [abortAgentLongResume]);

  // The replay flag is cleared by the producer's edge marker. If the marker
  // never comes -- a resume that returned 204, an error, a stream that ended
  // inside its own replay -- the turn's end clears it, and a ceiling clears it
  // regardless, so the next genuinely live turn is never painted as history.
  useEffect(() => {
    if (status === "ready" || status === "error") setIsReplaying(false);
  }, [setIsReplaying, status]);
  useEffect(() => {
    if (!isReplaying) return;
    const timer = setTimeout(() => setIsReplaying(false), 15_000);
    return () => clearTimeout(timer);
  }, [isReplaying, setIsReplaying]);

  const hasActiveStream =
    !!chatData?.active_stream_id || !!chatData?.active_trigger_run_id;
  const interruptedResponseError = useMemo(
    () =>
      hasInterruptedPersistedResponse({
        isExistingChat,
        chatLoaded: chatData !== undefined,
        hasActiveStream,
        status,
        hasClientError: error !== undefined,
        messages,
        canceledAt: chatData?.canceled_at ?? null,
        lastRunError: chatData?.last_run_error,
      })
        ? new Error(chatData?.last_run_error || INTERRUPTED_RESPONSE_MESSAGE)
        : null,
    [chatData, error, hasActiveStream, isExistingChat, messages, status],
  );

  // Ref (not state) so the Convex sync effect only fires when paginatedMessages.results
  // changes, not on status transitions — avoiding the stale-data overwrite on stream stop.

  // Ref bridge: StreamEffects exposes resetAutoContinueCount here
  const resetAutoContinueRef = useRef<(() => void) | null>(null);
  const resetAutoContinueCount = useCallback(() => {
    resetAutoContinueRef.current?.();
  }, []);

  // Register a reset function with global state so initializeNewChat can call it
  useEffect(() => {
    const reset = () => {
      pendingNewChatResetRef.current = true;
      // A fresh SDK session starts empty. Clearing the old instance here would
      // erase the retained conversation while its background run still works.
      setChatId(uuidv4());
      setIsExistingChat(false);
      wasNewChatRef.current = true;
      setTodos([]);
      setStreamedTitle(null);
      setAwaitingServerChat(false);
      projectContextReadyRef.current = true;
      dispatchStreaming({ type: "RESET_ON_FINISH" });
      dispatchStreaming({
        type: "SET_CONTEXT_USAGE",
        payload: { usedTokens: 0, maxTokens: 0 },
      });
      // Clear DataStreamProvider state so stale parts from the previous chat
      // don't feed into useAutoResume/useAutoContinue in the next conversation.
      setDataStream([]);
      setIsAutoResuming(false);
      setHasUserDismissedRateLimitWarning(false);
      resetAutoContinueCount();
    };
    setChatReset(reset);
    return () => setChatReset(null);
  }, [
    resetAutoContinueCount,
    setChatReset,
    setDataStream,
    setHasUserDismissedRateLimitWarning,
    setIsAutoResuming,
    setMessages,
    setTodos,
  ]);

  // Reset the one-time initializer when chat changes (must come before chatData effect to handle cached data)
  useEffect(() => {
    hasInitializedModeFromChatRef.current = !!initialView.preferences;
    hasInitializedSandboxRef.current = !!initialView.preferences;
    hasInitializedModelRef.current = !!initialView.preferences;
    persistedPrefsRef.current = null;
  }, [chatId, initialView]);

  // Set chat title and load todos when chat data is loaded
  useEffect(() => {
    // Only process when we intend to fetch for an existing chat
    if (!shouldFetchMessages) {
      return;
    }

    const dataId = (chatData as any)?.id as string | undefined;
    // Ignore when no data or data is stale (doesn't match current chatId)
    if (!chatData || dataId !== chatId) {
      return;
    }

    // Load todos from the chat data if they exist.
    if (chatData.todos) {
      // setTodos signature expects Todo[], so derive the new array first
      const nextTodos: Todo[] = (() => {
        const incoming: Todo[] = chatData.todos as Todo[];
        if (!incoming || incoming.length === 0) return [] as Todo[];

        // Split by assistant attribution
        const incomingAssistant: Todo[] = incoming.filter((t: Todo) =>
          Boolean(t.sourceMessageId),
        );
        const incomingManual: Todo[] = incoming.filter(
          (t: Todo) => !t.sourceMessageId,
        );

        const prevManual: Todo[] = [];
        // We can't access previous value directly here without functional setter.
        // Fallback: since server is source of truth, treat incoming manual todos as updates only for ids we already have.
        // The actual merge of manual todos will be handled elsewhere when tool updates come in.

        // Build manual map from previous
        // Replace assistant todos entirely with incoming assistant todos and keep incoming manual ones as-is
        return [...incomingAssistant, ...incomingManual] as Todo[];
      })();

      setTodos(retainedTodos(getRetainedMessages(), nextTodos));
    } else {
      setTodos(retainedTodos(getRetainedMessages(), []));
    }
    // Server has responded for this chat id; stop suppressing not-found state
    setAwaitingServerChat(false);
    // Initialize mode from server once per chat id (only for existing chats)
    if (!hasInitializedModeFromChatRef.current && isExistingChat) {
      hasInitializedModeFromChatRef.current = true;
      const slug = (chatData as any).default_model_slug;
      if (slug === "ask" || slug === "agent") {
        setChatMode(slug);
      } else if (slug === "agent-long") {
        // Legacy chats stored as agent-long map to agent mode
        setChatMode("agent");
      }
      // Legacy Security chats now open the single dedicated, premium-gated
      // Hack Workbench rather than recreating the retired Security chat UI.
      const restoredPurpose = coerceChatPurpose((chatData as any).purpose);
      if (restoredPurpose === "security") {
        router.replace(`/hack?session=${encodeURIComponent(chatId)}`);
        return;
      }
      setChatPurpose(restoredPurpose);
      setActiveProject(projectContextFromChat(chatData as any));
      projectContextReadyRef.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatData, setTodos, shouldFetchMessages, isExistingChat, chatId]);

  // Preserve the selected machine even while it is disconnected. Availability
  // affects whether a run can start; it must never change where it will run.
  useEffect(() => {
    if (hasInitializedSandboxRef.current || !isExistingChat) return;
    const dataId = (chatData as any)?.id as string | undefined;
    if (!chatData || dataId !== chatId) return;
    setSandboxPreference(
      restoreExecutionTarget(
        storedSandboxType,
        sandboxPreference,
        wasNewChatRef.current,
      ),
    );
    hasInitializedSandboxRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatData, isExistingChat, chatId]);

  // Initialize model selection from chat data
  useEffect(() => {
    if (hasInitializedModelRef.current || !isExistingChat) return;
    const dataId = (chatData as any)?.id as string | undefined;
    if (!chatData || dataId !== chatId) return;
    const savedModel = (chatData as any).selected_model as string | undefined;
    hasInitializedModelRef.current = true;
    const coerced = coerceSelectedModel(savedModel ?? null);
    if (coerced) {
      setSelectedModel(coerced);
    }
  }, [chatData, isExistingChat, chatId, setSelectedModel]);

  // Persist picker preferences (model + mode) when the user toggles them.
  // Debounced so quick toggles don't spam Convex; baseline is seeded from the
  // chat's stored values so the post-init render doesn't trigger a no-op write.
  const updateChatPreferences = useMutation(api.chats.updateChatPreferences);
  useEffect(() => {
    if (!isExistingChat || !chatData) return;
    const dataId = (chatData as any).id as string | undefined;
    if (dataId !== chatId) return;
    if (
      !hasInitializedModelRef.current ||
      !hasInitializedModeFromChatRef.current
    ) {
      return;
    }

    if (persistedPrefsRef.current === null) {
      const savedModel = (chatData as any).selected_model as string | undefined;
      const savedMode = (chatData as any).default_model_slug as
        | string
        | undefined;
      persistedPrefsRef.current = {
        model: savedModel ?? selectedModel,
        mode: savedMode ?? chatMode,
      };
    }

    const last = persistedPrefsRef.current;
    if (last.model === selectedModel && last.mode === chatMode) return;

    // `cancelled` guards both branches: clearTimeout cancels before the
    // request fires, and the flag prevents an in-flight request from writing
    // its (stale) snapshot to persistedPrefsRef after the user has already
    // navigated to a different chat or toggled again.
    let cancelled = false;
    const handle = setTimeout(() => {
      if (cancelled) return;
      const snapshot = { model: selectedModel, mode: chatMode };
      void updateChatPreferences({
        id: chatId,
        selectedModel,
        mode: chatMode,
      })
        .then(() => {
          if (cancelled) return;
          persistedPrefsRef.current = snapshot;
        })
        .catch(() => {
          // Silent — picker state in memory is still correct; backend will
          // re-persist on next send via updateChat.
        });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    selectedModel,
    chatMode,
    isExistingChat,
    chatId,
    chatData,
    updateChatPreferences,
  ]);

  usePersistedChatMessages({
    serverMessages,
    messagesRef,
    setMessages,
    status,
    enabled: shouldObservePersistedRun,
  });

  const { scrollRef, contentRef, scrollToBottom, isAtBottom } =
    useMessageScroll(retainedView, messages.length > 0 || isExistingChat);

  // File upload with drag and drop support
  const {
    isDragOver,
    showDragOverlay,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  } = useFileUpload(chatMode);

  // Handle instant scroll to bottom when first loading existing chat messages.
  // Only runs once per chat — pagination (which prepends older messages and
  // increases messages.length) must NOT re-trigger this.
  const hasScrolledToBottomRef = useRef(initialView.scroll !== undefined);
  useEffect(() => {
    hasScrolledToBottomRef.current = initialView.scroll !== undefined;
  }, [chatId, initialView]);
  useEffect(() => {
    if (
      isExistingChat &&
      messages.length > 0 &&
      !hasScrolledToBottomRef.current
    ) {
      hasScrolledToBottomRef.current = true;
      scrollToBottom({ instant: true, force: true });
    }
  }, [messages.length, scrollToBottom, isExistingChat]);

  // Re-arm sticky scroll whenever a new user message is appended at the tail.
  // Stop+send flows (Send Now, stop-and-send) mutate the DOM mid-stream which
  // knocks use-stick-to-bottom out of "at bottom" state, so we force-scroll on
  // the new user message to resume following the next generation. Keyed on
  // tail-id (not length) so pagination prepends don't trigger a scroll jump.
  const lastMessage = messages[messages.length - 1];
  const lastId = lastMessage?.id;
  const lastRole = lastMessage?.role;
  const prevLastIdRef = useRef<string | undefined>(lastId);
  useEffect(() => {
    const prevLastId = prevLastIdRef.current;
    prevLastIdRef.current = lastId;
    if (lastId && lastId !== prevLastId && lastRole === "user") {
      scrollToBottom({ force: true });
    }
  }, [lastId, lastRole, scrollToBottom]);

  useLayoutEffect(() => {
    setActiveQueueChat(chatId);
  }, [chatId, setActiveQueueChat]);

  // Document-level drag and drop listeners encapsulated in a hook
  useDocumentDragAndDrop({
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
  });

  // Automatic queue processing - send next queued message when ready
  useEffect(() => {
    if (
      status === "ready" &&
      !retainedContinuationPending &&
      activeQueueChatId === chatId &&
      messageQueue.length > 0 &&
      !isSendingNowRef.current &&
      !hasManuallyStoppedRef.current &&
      queueBehavior === "queue"
    ) {
      const nextMessage = messageQueue[0];
      const attempt = nextMessage && claimQueuedMessage(nextMessage.id);
      if (!attempt) return;
      try {
        const sending = sendMessage(
          {
            id: nextMessage.id,
            role: "user",
            parts: [
              ...(nextMessage.files ?? []),
              { type: "text", text: nextMessage.text },
            ] as any,
            metadata: { createdAt: nextMessage.timestamp },
          },
          {
            metadata: createDispatchReceiptMetadata(attempt),
            body: {
              mode: getCurrentExecutionMode(),
              todos: todosRef.current,
              temporary: temporaryChatsEnabledRef.current,
              sandboxPreference: sandboxPreferenceRef.current,
              selectedModel: selectedModelRef.current,
              purpose: chatPurposeRef.current,
            },
          },
        );
        // SDK completion is not acceptance. This only retires an attempt that
        // failed before reaching the observed transport boundary.
        void Promise.resolve(sending).then(attempt.failed, attempt.failed);
      } catch {
        attempt.failed();
      }
    }
  }, [
    status,
    retainedContinuationPending,
    messageQueue,
    activeQueueChatId,
    chatId,
    claimQueuedMessage,
    sendMessage,
    queueBehavior,
    chatPurposeRef,
    getCurrentExecutionMode,
    todosRef,
    temporaryChatsEnabledRef,
    sandboxPreferenceRef,
    selectedModelRef,
  ]);

  // Chat handlers
  const {
    handleSubmit,
    handleStop,
    handleRegenerate,
    handleRetry,
    handleEditMessage,
    handleSendNow,
    handleContinue,
  } = useChatHandlers({
    chatId,
    messages,
    sendMessage,
    stop: stopWithAgentLongResumeAbort,
    regenerate,
    setMessages,
    isExistingChat,
    status,
    isSendingNowRef,
    hasManuallyStoppedRef,
    onStopCallback: () => {
      dispatchStreaming({ type: "RESET_ON_FINISH" });
    },
    resetAutoContinueCount,
    retryError: error || interruptedResponseError || undefined,
  });

  usePublishRiftAgentConsole(
    lastSyncedRouteRef.current === chatRouteKey(pathname, routeChatId) &&
      (!routeChatId || routeChatId === chatId)
      ? { chatId, messages, status }
      : null,
    {
      submit: (text, isCurrent) =>
        handleSubmit({ preventDefault() {} } as React.FormEvent, {
          input: text,
          source: "console",
          isCurrent,
        }),
      stop: handleStop,
    },
  );

  useNewChatMessage({
    ready:
      pathname === "/" &&
      lastSyncedRouteRef.current === chatRouteKey(pathname, routeChatId) &&
      !isExistingChat &&
      messages.length === 0 &&
      chatPurpose === "app" &&
      status === "ready",
    onSubmit: async (event, submission) => {
      await handleSubmit(event, submission);
    },
  });

  const handleScrollToBottom = () => scrollToBottom({ force: true });

  // Rate limit warning dismiss handler
  const handleDismissRateLimitWarning = () => {
    dispatchStreaming({ type: "SET_RATE_LIMIT_WARNING", payload: null });
    setHasUserDismissedRateLimitWarning(true);
  };

  // Branch chat handler
  const branchChatMutation = useMutation(api.messages.branchChat);

  const handleBranchMessage = useCallback(
    async (messageId: string) => {
      try {
        const newChatId = await branchChatMutation({ messageId });
        if (!newChatId) {
          toast.error("That message is no longer available to branch.");
          return;
        }
        initializeChat(newChatId);
        goChat(newChatId);
      } catch (error) {
        console.error("Failed to branch chat:", error);
        toast.error("Failed to branch chat. Please try again.");
      }
    },
    [branchChatMutation, goChat, initializeChat],
  );

  useEffect(
    () =>
      onChatCommand((action) => {
        const lastAssistant = [...messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (!lastAssistant) {
          toast.info("No completed RIFT output is available yet");
          return;
        }

        if (action === "fork") {
          void handleBranchMessage(lastAssistant.id);
          return;
        }

        const text = extractMessageText(lastAssistant.parts ?? []);
        if (!text.trim()) {
          toast.info("The latest RIFT output has no copyable text");
          return;
        }
        void navigator.clipboard
          .writeText(text)
          .then(() => toast.success("Latest RIFT output copied"))
          .catch(() => toast.error("Could not copy the latest output"));
      }),
    [handleBranchMessage, messages],
  );

  // Auto-send message after forking a shared chat
  const autoSendFiredRef = useRef(false);
  useEffect(() => {
    if (autoSendFiredRef.current) return;
    try {
      const pendingChatId = sessionStorage.getItem("autoSendChatId");
      if (pendingChatId !== chatId) return;
    } catch {
      return;
    }
    // Wait for chat to be ready with draft input loaded. Read the composer
    // text from the ref (not a reactive value) so this component does not
    // re-render on every keystroke.
    if (status !== "ready" || !inputRef.current.trim()) return;
    // Wait for server messages to be loaded (forked chat has messages)
    if (!isExistingChat || messages.length === 0) return;

    autoSendFiredRef.current = true;
    sessionStorage.removeItem("autoSendChatId");
    // Trigger submit with a synthetic event
    handleSubmit(new Event("submit") as unknown as React.FormEvent);
  }, [chatId, status, inputRef, isExistingChat, messages.length, handleSubmit]);

  const hasMessages = messages.length > 0;
  const showChatLayout = hasMessages || isExistingChat;
  const currentRunMessages = useMemo(
    () => getCurrentRunMessages(messages),
    [messages],
  );
  const currentRunTodos = useMemo(
    () => getCurrentRunTodos(todos, currentRunMessages),
    [currentRunMessages, todos],
  );
  const activityExecutions = useMemo(
    () => extractAllSidebarContent(currentRunMessages as any[]),
    [currentRunMessages],
  );
  const navigationExecutions = useMemo(
    () => extractAllSidebarContent(messages as any[]),
    [messages],
  );

  // UI-level temporary chat flag
  const isTempChat = !isExistingChat && temporaryChatsEnabled;

  const pendingQuestion = useMemo(
    () => pendingPlanQuestion(messages),
    [messages],
  );

  // Get branched chat info directly from chatData (no additional query needed)
  const branchedFromChatId = chatData?.branched_from_chat_id;
  const branchedFromChatTitle = (chatData as any)?.branched_from_title;

  // Check if we tried to load an existing chat but it doesn't exist or doesn't belong to user
  const isChatNotFound =
    isExistingChat &&
    chatData === null &&
    shouldFetchMessages &&
    !awaitingServerChat;

  const surface = (
    <ConvexErrorBoundary>
      <AppLaunchComplete />
      {proShell ? (
        <WorkbenchTerminalActivityBridge chatId={chatId} messages={messages} />
      ) : null}
      <StreamEffects
        key={chatId}
        autoResume={autoResume}
        serverMessages={serverMessages}
        resumeStream={resumeStream}
        stopReader={stopRetainedReader}
        setMessages={setMessages}
        status={status}
        error={error}
        chatMode={chatMode}
        chatPurpose={chatPurpose}
        sendMessage={sendMessage}
        hasManuallyStoppedRef={hasManuallyStoppedRef}
        todos={todos}
        temporaryChatsEnabled={temporaryChatsEnabled}
        sandboxPreference={sandboxPreference}
        selectedModel={selectedModel}
        resetRef={resetAutoContinueRef}
        hasActiveStream={chatData === undefined ? undefined : hasActiveStream}
        preserveReaderOnUnmount={retentionEnabled}
      />
      <div
        ref={chatSurfaceRef}
        data-rift-chat-root
        className="flex min-h-0 flex-1 w-full flex-col bg-transparent overflow-x-hidden"
      >
        <div
          data-rift-dock-placement={dock.state.placement}
          data-rift-dock-visible={
            isMobile === false && dock.state.visible ? "true" : "false"
          }
          data-rift-dock-maximized={dock.state.maximized ? "true" : "false"}
          data-rift-dock-resizing={
            isToolPaneResizing || bottomResizing ? "true" : "false"
          }
          className={`flex min-h-0 flex-1 min-w-0 relative ${isMobile === false && dock.state.placement === "bottom" ? "flex-col" : ""}`}
        >
          {/* Left side - Chat content */}
          <div
            data-rift-conversation-column
            className="flex min-h-0 flex-col flex-1 min-w-0"
            inert={
              isMobile === false && dock.state.visible && dock.state.maximized
            }
            style={
              isMobile === false && dock.state.visible && dock.state.maximized
                ? { display: "none" }
                : undefined
            }
          >
            {/* Unified Header */}
            {!proShell && (
              <ChatHeader
                hasMessages={hasMessages}
                hasActiveChat={isExistingChat}
                chatTitle={chatTitle}
                id={chatId}
                chatData={chatData}
                chatSidebarOpen={chatSidebarOpen}
                isExistingChat={isExistingChat}
                isChatNotFound={isChatNotFound}
                branchedFromChatTitle={branchedFromChatTitle}
              />
            )}

            {/* Chat interface */}
            <div
              data-rift-chat-surface
              className="bg-transparent flex flex-col flex-1 relative min-h-0"
            >
              {/* The window strip's title. Rendered from here because this is
                  where the live title exists; it portals into the strip. */}
              <WindowTitle
                title={chatTitle ?? (chatPurpose === "image" ? "Studio" : null)}
                badge={activeProject?.name}
              />
              {!isChatNotFound && (showChatLayout || isMobile === false) ? (
                <AgentRunSummaryBar
                  panelDestination={
                    isMobile === false ? "workspace" : "activity"
                  }
                  todos={currentRunTodos}
                  toolExecutions={activityExecutions}
                  messages={currentRunMessages}
                  status={status}
                  panelOpen={
                    isMobile === false ? dock.state.visible : agentActivityOpen
                  }
                  onTogglePanel={
                    isMobile === false ? dock.toggle : handleToggleAgentActivity
                  }
                  onOpenBrowser={
                    isMobile === false
                      ? () => dock.openKind("browser")
                      : undefined
                  }
                  onToggleTerminal={
                    isMobile === false
                      ? () =>
                          dock.state.visible &&
                          dock.state.activeTabId === "terminal"
                            ? dock.hide()
                            : dock.openKind("terminal")
                      : toggleTerminalDock
                  }
                  terminalOpen={terminalDockOpen}
                  // Only offered once a preview can actually be shown, so the
                  // control is never a button that does nothing.
                  onTogglePreview={
                    canShowBuildPreview
                      ? () =>
                          isMobile === false
                            ? dock.state.visible &&
                              dock.state.activeTabId === "preview"
                              ? dock.hide()
                              : dock.openKind("preview")
                            : setBuildPreviewOpen(!buildPreviewOpen)
                      : undefined
                  }
                  previewOpen={buildPreviewOpen}
                />
              ) : null}
              {/* Messages area */}
              {isChatNotFound ? (
                <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 min-h-0">
                  <div className="w-full max-w-full sm:max-w-[768px] sm:min-w-[390px] flex flex-col items-center space-y-8">
                    <div className="text-center">
                      <h1 className="text-2xl font-bold text-foreground mb-2">
                        Chat Not Found
                      </h1>
                      <p className="text-muted-foreground">
                        This chat doesn&apos;t exist or you don&apos;t have
                        permission to view it.
                      </p>
                      <button
                        type="button"
                        onClick={goHome}
                        className="mt-6 inline-flex items-center gap-2 border border-primary/60 bg-primary/10 px-5 py-2.5 font-mono text-sm uppercase tracking-widest text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                      >
                        Start new session
                        <span aria-hidden>▸</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : showChatLayout ? (
                <DockedQuestionContext.Provider
                  value={pendingQuestion?.key ?? null}
                >
                  <FileRefProvider toolExecutions={activityExecutions}>
                    <Messages
                      codePresentationView={retainedView}
                      scrollRef={scrollRef as RefObject<HTMLDivElement | null>}
                      contentRef={
                        contentRef as RefObject<HTMLDivElement | null>
                      }
                      messages={messages}
                      setMessages={setMessages}
                      onRegenerate={handleRegenerate}
                      onRetry={handleRetry}
                      onContinue={handleContinue}
                      onReconnect={reconnectWithVisibleStatus}
                      onEditMessage={handleEditMessage}
                      onBranchMessage={handleBranchMessage}
                      status={status}
                      error={error || interruptedResponseError}
                      paginationStatus={paginatedMessages.status}
                      loadMore={paginatedMessages.loadMore}
                      isTemporaryChat={isTempChat}
                      isMobile={isMobile}
                      tempChatFileDetails={tempChatFileDetails}
                      finishReason={chatData?.finish_reason}
                      uploadStatus={uploadStatus}
                      summarizationStatus={summarizationStatus}
                      mode={chatMode ?? (chatData as any)?.default_model_slug}
                      chatPurpose={chatPurpose}
                      chatTitle={chatTitle}
                      branchedFromChatId={branchedFromChatId}
                      branchedFromChatTitle={branchedFromChatTitle}
                      stoppedByUserRef={hasManuallyStoppedRef}
                      isAwaitingApproval={!!pendingToolApprovals?.length}
                      runFooter={
                        <>
                          <ToolApprovalRequests
                            requests={pendingToolApprovals ?? []}
                          />
                        </>
                      }
                    />
                  </FileRefProvider>
                </DockedQuestionContext.Provider>
              ) : (
                <div
                  data-rift-empty-stage
                  className={`relative flex min-h-0 flex-1 flex-col bg-transparent ${
                    proShell ? "overflow-y-auto" : "overflow-hidden"
                  }`}
                >
                  {/* Background is the global RiftBackdrop (mounted in layout) */}
                  <div
                    className={`relative z-10 flex min-h-0 flex-1 flex-col items-center px-4 ${
                      proShell && chatPurpose === "image"
                        ? "justify-start pb-10 pt-7 sm:px-6"
                        : proShell && chatPurpose === "app"
                          ? "justify-center pb-[12vh] pt-8 sm:px-6"
                          : proShell
                            ? "justify-center pb-[12vh] pt-8 sm:px-6"
                            : "justify-center pb-[14vh]"
                    }`}
                  >
                    <div
                      data-rift-empty-content
                      className={`flex w-full max-w-full flex-col items-center ${
                        proShell && chatPurpose === "image"
                          ? "sm:max-w-[1080px] rift-studio-start"
                          : proShell && chatPurpose === "app"
                            ? "sm:min-w-[390px] sm:max-w-[660px]"
                            : proShell
                              ? "sm:min-w-[390px] sm:max-w-[660px]"
                              : "sm:min-w-[390px] sm:max-w-[768px]"
                      }`}
                    >
                      <div className="w-full text-center">
                        {temporaryChatsEnabled ? (
                          <>
                            <h1 className="text-3xl font-bold text-foreground mb-2">
                              Temporary Chat
                            </h1>
                            <p className="text-muted-foreground max-w-md mx-auto px-4 py-3">
                              This chat won&apos;t appear in history, use or
                              update RIFT&apos;s memory, or be used to train
                              models. This chat will be deleted when you refresh
                              the page.
                            </p>
                          </>
                        ) : proShell ? (
                          <ProEmptyHero />
                        ) : (
                          <HackingSuggestions />
                        )}
                      </div>

                      {/* Centered input (desktop only) */}
                      {!isMobile && (
                        <div className="w-full">
                          <ChatInput
                            accessory={collaboratorTray}
                            onSubmit={handleSubmit}
                            onStop={handleStop}
                            onSendNow={handleSendNow}
                            status={status}
                            isCentered={true}
                            hasMessages={hasMessages}
                            isAtBottom={isAtBottom}
                            onScrollToBottom={handleScrollToBottom}
                            isNewChat={!isExistingChat}
                            chatId={chatId}
                            rateLimitWarning={
                              rateLimitWarning ? rateLimitWarning : undefined
                            }
                            onDismissRateLimitWarning={
                              handleDismissRateLimitWarning
                            }
                            contextUsage={contextUsage}
                          />
                        </div>
                      )}
                      {proShell && chatPurpose === "image" ? (
                        <div className="rift-studio-discovery">
                          <StudioDiscovery hideHeading />
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {/* Footer - only show when user is not logged in */}
                  <div className="relative z-10 flex-shrink-0">
                    <Footer />
                  </div>
                </div>
              )}

              {pendingQuestion && !isChatNotFound && (
                <div
                  className="shrink-0 min-w-0 px-3 sm:px-4"
                  data-ui="question-dock"
                >
                  <div className="mx-auto w-full max-w-[760px] min-w-0">
                    <PlanQuestions
                      key={pendingQuestion.key}
                      data={pendingQuestion.data}
                    />
                  </div>
                </div>
              )}
              {/* Chat Input - Bottom placement (also for mobile new chats) */}
              {(hasMessages || isExistingChat || isMobile) &&
                !isChatNotFound && (
                  <ChatInput
                    accessory={collaboratorTray}
                    onSubmit={handleSubmit}
                    onStop={handleStop}
                    onSendNow={handleSendNow}
                    status={status}
                    hasMessages={hasMessages}
                    isAtBottom={isAtBottom}
                    onScrollToBottom={handleScrollToBottom}
                    isNewChat={!isExistingChat}
                    chatId={chatId}
                    rateLimitWarning={
                      rateLimitWarning ? rateLimitWarning : undefined
                    }
                    onDismissRateLimitWarning={handleDismissRateLimitWarning}
                    contextUsage={contextUsage}
                  />
                )}
            </div>
          </div>

          {/* Desktop right pane — resizable in Pro Lab */}
          {isMobile === false && (
            <>
              <div
                data-rift-tool-pane-resizer
                data-resizing={
                  isToolPaneResizing || bottomResizing ? "true" : "false"
                }
                role="separator"
                tabIndex={dock.state.visible && !dock.state.maximized ? 0 : -1}
                aria-orientation={
                  dock.state.placement === "right" ? "vertical" : "horizontal"
                }
                aria-label="Resize workspace panel"
                aria-controls="rift-build-tool-pane"
                className={
                  dock.state.placement === "right"
                    ? "pro-resize-handle shrink-0"
                    : dockStyles.bottomResizer
                }
                style={
                  !dock.state.visible || dock.state.maximized
                    ? { display: "none" }
                    : undefined
                }
                {...(dock.state.placement === "right"
                  ? resizeHandleProps
                  : {
                      "aria-valuemin": 180,
                      "aria-valuemax": 700,
                      "aria-valuenow": dockHeight,
                      onPointerDown: (
                        event: React.PointerEvent<HTMLDivElement>,
                      ) => {
                        if (event.button !== 0) return;
                        event.preventDefault();
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dockDrag.current = {
                          y: event.clientY,
                          height: dockHeight,
                          max: Math.max(
                            180,
                            (event.currentTarget.parentElement?.clientHeight ??
                              800) - 160,
                          ),
                        };
                        setBottomResizing(true);
                      },
                      onPointerMove: (
                        event: React.PointerEvent<HTMLDivElement>,
                      ) => {
                        const drag = dockDrag.current;
                        if (drag)
                          setDockHeight(
                            Math.max(
                              180,
                              Math.min(
                                drag.max,
                                drag.height + drag.y - event.clientY,
                              ),
                            ),
                          );
                      },
                      onPointerUp: () => {
                        dockDrag.current = null;
                        setBottomResizing(false);
                      },
                      onPointerCancel: () => {
                        dockDrag.current = null;
                        setBottomResizing(false);
                      },
                      onKeyDown: (
                        event: React.KeyboardEvent<HTMLDivElement>,
                      ) => {
                        if (
                          !["ArrowUp", "ArrowDown", "Home", "End"].includes(
                            event.key,
                          )
                        )
                          return;
                        event.preventDefault();
                        const max = Math.max(
                          180,
                          (event.currentTarget.parentElement?.clientHeight ??
                            800) - 160,
                        );
                        setDockHeight((value) =>
                          event.key === "Home"
                            ? 180
                            : event.key === "End"
                              ? max
                              : Math.min(
                                  max,
                                  Math.max(
                                    180,
                                    value +
                                      (event.key === "ArrowUp" ? 20 : -20),
                                  ),
                                ),
                        );
                      },
                      onDoubleClick: () => setDockHeight(340),
                    })}
              />
              <div
                ref={toolPaneElementRef}
                id="rift-build-tool-pane"
                data-rift-tool-pane
                className={dockStyles.container}
                data-visible={dock.state.visible}
                data-placement={dock.state.placement}
                inert={!dock.state.visible}
                aria-hidden={!dock.state.visible}
                style={
                  dock.state.placement === "right"
                    ? {
                        width: dock.state.visible
                          ? dock.state.maximized
                            ? "100%"
                            : `${toolPaneRatio * 100}%`
                          : 0,
                      }
                    : {
                        height: dock.state.visible
                          ? dock.state.maximized
                            ? "100%"
                            : dockHeight
                          : 0,
                        width: "100%",
                      }
                }
              >
                {dock.state.tabs.length > 0 && (
                  <WorkbenchBoundary>
                    <WorkbenchDock
                      controller={dock}
                      messages={messages}
                      executions={activityExecutions}
                      allExecutions={navigationExecutions}
                      historyTodos={todos}
                      todos={currentRunTodos}
                      status={status}
                      chatId={chatId}
                      title={chatTitle ?? undefined}
                      previewStatusLine={previewStatusLine}
                    />
                  </WorkbenchBoundary>
                )}
              </div>
            </>
          )}

          {/* Drag and Drop Overlay - covers main content area only (excludes sidebars) */}
          <DragDropOverlay
            isVisible={showDragOverlay}
            isDragOver={isDragOver}
          />
        </div>

        {/* Mobile Build live preview (full-screen overlay, takes priority) */}
        {isMobile && showBuildPreview && (
          <MobileToolDialog
            backgroundRef={chatSurfaceRef}
            label="Live Preview"
            description="Full-screen live app preview. Press Escape to close."
            onClose={() => setBuildPreviewOpen(false)}
            contentClassName="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-background p-2 shadow-none"
          >
            <div className="h-full w-full">
              <BuildPreviewPanel
                statusLine={previewStatusLine}
                building={isBuildAgentRunLive && !buildPreviewUrl}
                onShowActivity={handleShowAgentActivity}
                chatId={chatId}
                title={chatTitle ?? undefined}
              />
            </div>
          </MobileToolDialog>
        )}

        {/* Mobile Computer Sidebar */}
        {isMobile && sidebarOpen && !showBuildPreview && (
          <MobileToolDialog
            backgroundRef={chatSurfaceRef}
            label="RIFT computer"
            description="Full-screen agent activity and computer panel. Press Escape to close."
            onClose={() => setSidebarOpen(false)}
            contentClassName="top-0 left-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 items-center justify-center gap-0 overflow-hidden rounded-none border-0 bg-background p-4 shadow-none"
          >
            <div className="w-full max-w-4xl h-full">
              <WorkbenchBoundary>
                <ComputerSidebar
                  selectedSubagentToolCallId={dock.selectedAgent}
                  onSelectSubagent={dock.selectAgent}
                  messages={messages}
                  currentRunMessages={currentRunMessages}
                  currentRunExecutions={activityExecutions}
                  navigationExecutions={navigationExecutions}
                  currentRunTodos={currentRunTodos}
                  status={status}
                />
              </WorkbenchBoundary>
            </div>
          </MobileToolDialog>
        )}
      </div>
    </ConvexErrorBoundary>
  );
  return (
    <ChatApprovalContext.Provider value={approvalContext}>
      {surface}
    </ChatApprovalContext.Provider>
  );
};
