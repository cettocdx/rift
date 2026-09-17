"use client";

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import { chatIdFromPathname } from "@/lib/navigation/chat-routes";
import {
  useTerminalDockPresentation,
  type TerminalDockView,
} from "@/app/hooks/useTerminalDockPresentation";
import { useAuth } from "@/app/hooks/useAuth";
import { useConversationQueue } from "@/app/hooks/useConversationQueue";
import type { ActiveOperation } from "@/lib/operations/operations";
import {
  type ChatMode,
  type ChatPurpose,
  type ActiveProjectContext,
  type SelectedModel,
  type SidebarContent,
  type QueuedMessage,
  type QueueBehavior,
  type SandboxPreference,
  DEFAULT_IMAGE_MODEL,
  getEffectiveBuildModel,
  isChatMode,
  resolveBuildReasoningEffort,
  resolveChatModeForPurpose,
  resolveMediaModel,
  type ReasoningEffort,
} from "@/types/chat";
import { isAgentMode } from "@/lib/utils/mode-helpers";
import {
  isExecutionTargetAvailable,
  availableLocalRunners,
} from "@/lib/chat/execution-target";
import type { Todo } from "@/types";
import {
  mergeTodos as mergeTodosUtil,
  computeReplaceAssistantTodos,
} from "@/lib/utils/todo-utils";
import type { UploadedFileState } from "@/types/file";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSandboxPreference } from "@/app/hooks/useSandboxPreference";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { resolveSubscriptionTier } from "@/lib/auth/entitlements";
import { isMockBillingEnabled, getMockTier } from "@/lib/billing/mock-billing";
import { chatSidebarStorage } from "@/lib/utils/sidebar-storage";
import type { Id } from "@/convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { SubscriptionTier } from "@/types";
import { toast } from "sonner";
import {
  readChatMode,
  writeChatMode,
  readSelectedModel,
  writeSelectedModel,
  readBuildReasoningEfforts,
  writeBuildReasoningEfforts,
  type BuildReasoningEffortPreferences,
  cleanupExpiredDrafts,
  markHasAuthenticatedBefore,
} from "@/lib/utils/client-storage";
import { LiveSidebarContentProvider } from "@/app/contexts/LiveSidebarContent";

interface GlobalStateType {
  // File upload state
  uploadedFiles: UploadedFileState[];
  setUploadedFiles: (files: UploadedFileState[]) => void;
  addUploadedFile: (file: UploadedFileState) => void;
  removeUploadedFile: (index: number) => void;
  updateUploadedFile: (
    index: number,
    updates: Partial<UploadedFileState>,
  ) => void;

  // Token tracking function
  getTotalTokens: () => number;

  // File upload status tracking
  isUploadingFiles: boolean;

  // Chat mode state
  chatMode: ChatMode;
  setChatMode: (mode: ChatMode) => void;

  // Chat purpose state (dedicated Hack / app builder / image generator).
  // Orthogonal to chatMode: purpose picks the persona + system prompt + model,
  // chatMode picks the execution path. Set by the sidebar mode launcher.
  chatPurpose: ChatPurpose;
  setChatPurpose: (purpose: ChatPurpose) => void;

  // Project selected for this chat. This is optimistic client context only;
  // every server execution validates ownership/type and treats the persisted
  // chat binding as authoritative.
  activeProject: ActiveProjectContext | null;
  setActiveProject: (project: ActiveProjectContext | null) => void;

  // Active operation (operation mode) — set by the Arsenal launcher on launch
  activeOperation: ActiveOperation | null;
  setActiveOperation: (op: ActiveOperation | null) => void;

  // Computer sidebar state (right side)
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sidebarContent: SidebarContent | null;
  setSidebarContent: (content: SidebarContent | null) => void;

  // Build mode live preview (embedded dev-server iframe pane)
  buildPreviewUrl: string | null;
  setBuildPreviewUrl: (url: string | null) => void;
  buildPreviewOpen: boolean;
  /** Bottom terminal dock, toggled with the workspace shortcut. */
  terminalDockOpen: boolean;
  terminalDockView: TerminalDockView;
  setTerminalDockView: (view: TerminalDockView) => void;
  setTerminalDockOpen: (open: boolean) => void;
  toggleTerminalDock: () => void;
  setBuildPreviewOpen: (open: boolean) => void;

  // Chat sidebar state (left side)
  chatSidebarOpen: boolean;
  setChatSidebarOpen: (open: boolean) => void;

  // Todos state
  todos: Todo[];
  setTodos: (todos: Todo[]) => void;
  mergeTodos: (todos: Todo[]) => void;
  replaceAssistantTodos: (todos: Todo[], sourceMessageId?: string) => void;

  // UI state
  isTodoPanelExpanded: boolean;
  setIsTodoPanelExpanded: (expanded: boolean) => void;

  // Subscription state
  subscription: SubscriptionTier;
  /** Paid plan or a current authenticated prepaid balance; server revalidates. */
  hasPaidContext: boolean;
  isCheckingProPlan: boolean;
  /** True only after the current user's entitlement set has been resolved. */
  isSubscriptionReady: boolean;

  // Rate limit warning dismissal state
  hasUserDismissedRateLimitWarning: boolean;
  setHasUserDismissedRateLimitWarning: (dismissed: boolean) => void;

  // Message queue state (for Agent mode)
  activeQueueChatId: string | null;
  /** Bind queue consumers to a chat without deleting another chat's queue. */
  setActiveQueueChat: (chatId: string | null) => void;
  messageQueue: QueuedMessage[];
  queueMessage: ReturnType<typeof useConversationQueue>["queueMessage"];
  removeQueuedMessage: (id: string) => void;
  claimQueuedMessage: ReturnType<
    typeof useConversationQueue
  >["claimQueuedMessage"];
  clearQueue: () => void;

  // Queue behavior preference
  queueBehavior: QueueBehavior;
  setQueueBehavior: (behavior: QueueBehavior) => void;

  // Sandbox preference (for Agent mode)
  sandboxPreference: SandboxPreference;
  setSandboxPreference: (preference: SandboxPreference) => void;

  // Desktop bridge active (Centrifugo-based desktop sandbox)
  desktopBridgeActive: boolean;

  // Whether a local sandbox (desktop or remote) is available
  hasLocalSandbox: boolean;
  isSelectedSandboxAvailable: boolean;
  localExecutionTargets: Array<{ value: SandboxPreference; label: string }>;

  // The sandbox preference to use for free agent mode (desktop or first remote connection ID)
  defaultLocalSandboxPreference: SandboxPreference | null;

  // Model selection
  selectedModel: SelectedModel;
  setSelectedModel: (model: SelectedModel) => void;
  /** Current model-aware Build reasoning preference. */
  reasoningEffort: ReasoningEffort;
  setReasoningEffort: (effort: ReasoningEffort) => void;

  // Utility methods
  clearUploadedFiles: () => void;
  openSidebar: (content: SidebarContent) => void;
  updateSidebarContent: (updates: Partial<SidebarContent>) => void;
  closeSidebar: () => void;
  toggleChatSidebar: () => void;
  initializeChat: (chatId: string, fromRoute?: boolean) => void;
  initializeNewChat: (
    purpose?: ChatPurpose,
    project?: ActiveProjectContext | null,
  ) => void;

  // Temporary chats preference
  temporaryChatsEnabled: boolean;
  setTemporaryChatsEnabled: (enabled: boolean) => void;

  // Team pricing dialog state
  teamPricingDialogOpen: boolean;
  setTeamPricingDialogOpen: (open: boolean) => void;

  // Team welcome dialog state
  teamWelcomeDialogOpen: boolean;
  setTeamWelcomeDialogOpen: (open: boolean) => void;

  // PentestGPT migration confirm dialog state
  migrateFromPentestgptDialogOpen: boolean;
  setMigrateFromPentestgptDialogOpen: (open: boolean) => void;

  // Register a chat reset function that will be invoked on initializeNewChat
  setChatReset: (fn: (() => void) | null) => void;
}

const GlobalStateContext = createContext<GlobalStateType | undefined>(
  undefined,
);

interface GlobalStateProviderProps {
  children: ReactNode;
}

export const GlobalStateProvider: React.FC<GlobalStateProviderProps> = ({
  children,
}) => {
  const {
    user,
    loading: authLoading,
    isAuthenticated,
    entitlements,
    entitlementsReady,
  } = useAuth();
  const isMobile = useIsMobile();
  const prevIsMobile = useRef(isMobile);
  const shownReferralRewardNotificationsRef = useRef(new Set<string>());
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFileState[]>([]);
  const [chatMode, setChatMode] = useState<ChatMode>(() => {
    const saved = readChatMode();
    if (!isChatMode(saved)) return "ask";
    return saved;
  });
  // Purpose is initialized from the ?purpose= URL param for deep-links; the
  // sidebar mode launcher updates it for new chats, and reopening a saved chat
  // restores it from the chat row.
  const [chatPurpose, setChatPurpose] = useState<ChatPurpose>(() => {
    if (typeof window === "undefined") return "app";
    const requestedPurpose = new URLSearchParams(window.location.search).get(
      "purpose",
    );
    // Security is available only at /hack. The normal chat shell always starts
    // in Build unless an explicit Image deep-link was requested.
    return requestedPurpose === "image" ? "image" : "app";
  });
  const [activeProject, setActiveProject] =
    useState<ActiveProjectContext | null>(null);
  const [activeOperation, setActiveOperation] =
    useState<ActiveOperation | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarContent, setSidebarContent] = useState<SidebarContent | null>(
    null,
  );
  // Build mode live preview: the running dev-server URL exposed by the agent
  // (expose_preview tool) and whether the embedded preview pane is open.
  const [buildPreviewUrl, setBuildPreviewUrl] = useState<string | null>(null);
  const [buildPreviewOpen, setBuildPreviewOpen] = useState(false);
  const pathname = usePathname();
  const {
    open: terminalDockOpen,
    setOpen: setTerminalDockOpen,
    view: terminalDockView,
    setView: setTerminalDockView,
    toggle: toggleTerminalDock,
  } = useTerminalDockPresentation(
    authLoading ? undefined : (user?.id ?? null),
    pathname,
  );

  // Route -> overlay teardown. The tool inspector and agent-activity pane
  // are bound to one conversation, but they lived in this shared context and
  // nothing closed them when the route changed, so the
  // previous chat's tool output rendered inside the next one.
  //
  // The subtlety this has to respect: a brand-new chat gets its durable URL
  // (`/` -> `/c/<id>`) only AFTER its first run succeeds. That is the SAME
  // conversation being promoted, not navigation to a different one -- tearing
  // its state down there wipes the agent activity and the preview the user just
  // produced, the moment the run finishes. So the teardown fires only when the
  // chat identity actually changes, never on the promotion of a new chat, and
  // it no longer touches the build preview at all (initializeChat /
  // initializeNewChat own the preview and clear it correctly on real
  // navigation).
  const lastTeardownPathRef = useRef<string | null>(null);
  const lastChatIdRef = useRef<string | null>(null);
  useEffect(() => {
    const chatId = chatIdFromPathname(pathname);
    const previousPath = lastTeardownPathRef.current;
    const previousChatId = lastChatIdRef.current;
    lastTeardownPathRef.current = pathname;
    lastChatIdRef.current = chatId;

    // First commit: nothing to tear down.
    if (previousPath === null) return;
    if (previousPath === pathname) return;

    // Promotion of a new chat: the previous view had no chat id and the new
    // one is that same conversation's durable route. Its state is exactly what
    // the user just created, so leave it.
    if (previousChatId === null && chatId !== null) return;

    setSidebarOpen(false);
    setSidebarContent(null);
    setActiveOperation(null);
    // Terminal presentation owns its route teardown and Settings suspension.
  }, [pathname]);

  // Persist chat mode preference to localStorage on change
  useEffect(() => {
    writeChatMode(chatMode);
  }, [chatMode]);

  useEffect(() => {
    if (user) {
      markHasAuthenticatedBefore();
    }
  }, [user]);

  // Referral attribution ran through a a removed endpoint that has been
  // removed; referral rewards are deferred with the billing/teams rework.

  const unreadReferralRewardNotifications = useQuery(
    api.referrals.getUnreadRewardNotifications,
    user ? {} : "skip",
  );
  const markReferralRewardNotificationsSeen = useMutation(
    api.referrals.markRewardNotificationsSeen,
  );

  useEffect(() => {
    if (!user || !unreadReferralRewardNotifications?.length) return;

    const notifications = unreadReferralRewardNotifications.filter(
      (notification) =>
        !shownReferralRewardNotificationsRef.current.has(notification.rewardId),
    );
    if (notifications.length === 0) return;

    for (const notification of notifications) {
      shownReferralRewardNotificationsRef.current.add(notification.rewardId);
    }

    const totalDollars = notifications.reduce(
      (sum, notification) => sum + notification.amountDollars,
      0,
    );
    const amountLabel = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: Number.isInteger(totalDollars) ? 0 : 2,
    }).format(totalDollars);
    const rewardIds = notifications.map(
      (notification) => notification.rewardId,
    );

    toast.success("Referral reward added", {
      description: `You earned ${amountLabel} in extra usage credits.`,
    });
    void markReferralRewardNotificationsSeen({ rewardIds }).catch(() => {
      // The toast is non-critical; the next app load can retry marking it seen.
    });
  }, [
    markReferralRewardNotificationsSeen,
    unreadReferralRewardNotifications,
    user,
  ]);

  // Initialize chat sidebar state
  // Claude-Code-style: the sidebar is persistent (open by default) on desktop so
  // chats + the user account live in it; mobile stays collapsed behind the menu.
  const [chatSidebarOpen, setChatSidebarOpen] = useState(() =>
    isMobile ? false : true,
  );
  const [todos, setTodos] = useState<Todo[]>([]);
  const [isTodoPanelExpanded, setIsTodoPanelExpanded] = useState(false);
  const mergeTodos = useCallback((newTodos: Todo[]) => {
    setTodos((currentTodos) => mergeTodosUtil(currentTodos, newTodos));
  }, []);
  const replaceAssistantTodos = useCallback(
    (incoming: Todo[], sourceMessageId?: string) => {
      setTodos((current) =>
        computeReplaceAssistantTodos(current, incoming, sourceMessageId),
      );
    },
    [],
  );
  const [subscription, setSubscription] = useState<SubscriptionTier>("free");
  const setSubscriptionWithNormalize = useCallback((tier: SubscriptionTier) => {
    setSubscription(tier);
  }, []);
  const [isCheckingProPlan, setIsCheckingProPlan] = useState(false);
  const contextBalance = useQuery(
    api.extraUsage.getExtraUsageSettings,
    user && subscription === "free" ? {} : "skip",
  );
  const hasPaidContext =
    subscription !== "free" || (contextBalance?.balancePoints ?? 0) > 0;
  const entitlementResolutionKey = useMemo(() => {
    if (!entitlementsReady) return null;
    if (!isAuthenticated) return "anonymous";
    if (!user) return null;

    return `${user.id}:${[...entitlements].sort().join("|")}`;
  }, [entitlements, entitlementsReady, isAuthenticated, user]);
  const [resolvedSubscriptionKey, setResolvedSubscriptionKey] = useState<
    string | null
  >(null);
  const isSubscriptionReady =
    !authLoading &&
    entitlementResolutionKey !== null &&
    resolvedSubscriptionKey === entitlementResolutionKey &&
    !isCheckingProPlan;
  const chatResetRef = useRef<(() => void) | null>(null);
  const desktopEntitlementRefreshUserRef = useRef<string | null>(null);

  // Rate limit warning dismissal state (persists across chat switches)
  const [
    hasUserDismissedRateLimitWarning,
    setHasUserDismissedRateLimitWarning,
  ] = useState(false);

  // Keep follow-ups through route changes, isolated by chat and signed-in owner.
  const {
    activeQueueChatId,
    setActiveQueueChat,
    messageQueue,
    queueMessage,
    removeQueuedMessage,
    claimQueuedMessage,
    clearQueue,
  } = useConversationQueue(authLoading ? undefined : (user?.id ?? null));

  // Queue behavior preference (persisted to localStorage)
  const [queueBehavior, setQueueBehaviorState] = useState<QueueBehavior>(() => {
    if (typeof window === "undefined") return "queue";
    const saved = localStorage.getItem("queue-behavior");
    if (saved === "queue" || saved === "stop-and-send") {
      return saved;
    }
    return "queue"; // Default: queue after current message completes
  });

  // Tauri detection + sandbox preference (co-located in a custom hook)
  const { sandboxPreference, setSandboxPreference, desktopBridgeActive } =
    useSandboxPreference(!!user, !authLoading, user?.id);

  // Check for available local sandbox connections
  const localConnections = useQuery(
    api.localSandbox.listConnections,
    user ? {} : "skip",
  );
  const executableLocalConnections = useMemo(
    () => availableLocalRunners(localConnections ?? []),
    [localConnections],
  );
  const hasLocalSandbox = executableLocalConnections.length > 0;
  const isSelectedSandboxAvailable = isExecutionTargetAvailable(
    sandboxPreference,
    executableLocalConnections,
  );
  const localExecutionTargets = useMemo(
    () =>
      executableLocalConnections.map((connection) => ({
        value: connection.connectionId,
        label: connection.name,
      })),
    [executableLocalConnections],
  );

  const defaultLocalSandboxPreference =
    useMemo<SandboxPreference | null>(() => {
      const firstRemote = executableLocalConnections.find(
        (connection) => !connection.isDesktop,
      );
      if (firstRemote) return firstRemote.connectionId;
      return null;
    }, [executableLocalConnections]);

  // Persist queue behavior to localStorage
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("queue-behavior", queueBehavior);
    }
  }, [queueBehavior]);

  // Model selection — RIFT tier ids (Lite/Pro/Max) are mode-agnostic;
  // the active model is resolved server-side via resolveTierToProviderKey.
  const [selectedModel, setSelectedModelRaw] = useState<SelectedModel>(() => {
    const saved = readSelectedModel();
    return saved ?? "auto";
  });
  const [buildReasoningEfforts, setBuildReasoningEfforts] =
    useState<BuildReasoningEffortPreferences>(() =>
      readBuildReasoningEfforts(),
    );

  const effectiveBuildModel = getEffectiveBuildModel(selectedModel);
  const reasoningEffort = resolveBuildReasoningEffort(
    effectiveBuildModel.id,
    buildReasoningEfforts[effectiveBuildModel.id],
  );

  // Persist model preference to localStorage (single key, shared across modes).
  useEffect(() => {
    writeSelectedModel(selectedModel);
  }, [selectedModel]);

  useEffect(() => {
    writeBuildReasoningEfforts(buildReasoningEfforts);
  }, [buildReasoningEfforts]);

  // Media Studio uses the selected model to choose its execution path. Repair
  // stale persisted combinations (notably a video model saved with Ask mode)
  // before the next request is submitted.
  useEffect(() => {
    if (chatPurpose === "image" && !resolveMediaModel(selectedModel)) {
      setSelectedModelRaw(DEFAULT_IMAGE_MODEL);
      if (chatMode !== "ask") setChatMode("ask");
      return;
    }

    const resolvedMode = resolveChatModeForPurpose({
      purpose: chatPurpose,
      selectedModel,
      fallbackMode: chatMode,
    });
    if (resolvedMode !== chatMode) {
      setChatMode(resolvedMode);
    }
  }, [chatMode, chatPurpose, selectedModel]);

  const setSelectedModelState = useCallback((model: SelectedModel) => {
    setSelectedModelRaw(model);
  }, []);

  const setReasoningEffortState = useCallback(
    (effort: ReasoningEffort) => {
      const model = getEffectiveBuildModel(selectedModel);
      const normalized = resolveBuildReasoningEffort(model.id, effort);
      setBuildReasoningEfforts((current) => ({
        ...current,
        [model.id]: normalized,
      }));
    },
    [selectedModel],
  );

  // Initialize temporary chats from URL parameter
  const [temporaryChatsEnabled, setTemporaryChatsEnabled] = useState(() => {
    if (typeof window === "undefined") return false;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("temporary-chat") === "true";
  });
  // Initialize team pricing dialog from URL hash
  const [teamPricingDialogOpen, setTeamPricingDialogOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.location.hash === "#team-pricing-seat-selection";
  });

  // Initialize team welcome dialog from URL parameter
  const [teamWelcomeDialogOpen, setTeamWelcomeDialogOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get("team-welcome") === "true";
  });

  // Initialize PentestGPT migration confirm dialog from URL parameter
  const [migrateFromPentestgptDialogOpen, setMigrateFromPentestgptDialogOpen] =
    useState(() => {
      if (typeof window === "undefined") return false;
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get("confirm-migrate-pentestgpt") === "true";
    });

  useEffect(() => {
    // Save state on desktop
    chatSidebarStorage.save(chatSidebarOpen, isMobile ?? false);

    // Close sidebar when transitioning from desktop to mobile
    if (!prevIsMobile.current && isMobile && chatSidebarOpen) {
      setChatSidebarOpen(false);
    }

    prevIsMobile.current = isMobile;
  }, [chatSidebarOpen, isMobile]);

  // Cleanup expired drafts on app initialization (once per session)
  useEffect(() => {
    cleanupExpiredDrafts();
  }, []); // Empty dependency array = runs once on mount

  // Derive the subscription tier only after Convex resolves the entitlement
  // query. The resolution key prevents a stale tier from being presented as
  // ready during the render before this effect commits the matching tier.
  useEffect(() => {
    if (!entitlementResolutionKey) return;

    if (!user) {
      setSubscription("free");
      setResolvedSubscriptionKey(entitlementResolutionKey);
      desktopEntitlementRefreshUserRef.current = null;
      return;
    }

    // Mock billing: a locally-persisted tier takes precedence over server
    // entitlements so upgrades reflect immediately during local testing.
    if (isMockBillingEnabled()) {
      const mockTier = getMockTier();
      if (mockTier) {
        setSubscriptionWithNormalize(mockTier);
        setResolvedSubscriptionKey(entitlementResolutionKey);
        return;
      }
    }

    setSubscriptionWithNormalize(resolveSubscriptionTier(entitlements));
    setResolvedSubscriptionKey(entitlementResolutionKey);
  }, [
    entitlementResolutionKey,
    entitlements,
    setSubscriptionWithNormalize,
    user,
  ]);

  // Desktop sessions are created through a separate OAuth transfer flow. Older
  // desktop sessions may be unscoped, so refresh once to pull server
  // entitlements from the user's organization before showing them as free.
  useEffect(() => {
    const refreshDesktopEntitlements = async () => {
      if (!user || typeof window === "undefined" || !isTauriEnvironment()) {
        return;
      }

      const currentEntitlements = Array.isArray(entitlements)
        ? entitlements
        : [];
      if (resolveSubscriptionTier(currentEntitlements) !== "free") {
        return;
      }

      const url = new URL(window.location.href);
      if (url.searchParams.get("refresh") === "entitlements") {
        return;
      }

      if (desktopEntitlementRefreshUserRef.current === user.id) {
        return;
      }
      desktopEntitlementRefreshUserRef.current = user.id;

      setIsCheckingProPlan(true);
      try {
        const response = await fetch("/api/entitlements", {
          credentials: "include",
        });
        if (!response.ok) return;

        const data = await response.json();
        setSubscriptionWithNormalize(
          resolveSubscriptionTier(
            Array.isArray(data.entitlements) ? data.entitlements : [],
          ),
        );
      } catch {
        // Keep the token-derived tier; this is only a best-effort desktop heal.
      } finally {
        setIsCheckingProPlan(false);
      }
    };

    refreshDesktopEntitlements();
  }, [user, entitlements, setSubscriptionWithNormalize]);

  // Refresh entitlements only when explicitly requested via URL param
  useEffect(() => {
    const refreshFromUrl = async () => {
      if (!user) {
        setSubscriptionWithNormalize("free");
        setIsCheckingProPlan(false);
        return;
      }

      if (typeof window === "undefined") return;

      const url = new URL(window.location.href);
      const shouldRefresh = url.searchParams.get("refresh") === "entitlements";
      if (!shouldRefresh) return;

      setIsCheckingProPlan(true);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch("/api/entitlements", {
          credentials: "include",
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          const tier = data.subscription as SubscriptionTier | undefined;
          setSubscription(
            tier === "ultra" ||
              tier === "team" ||
              tier === "pro-plus" ||
              tier === "pro"
              ? tier
              : "free",
          );
        } else {
          if (response.status === 401) {
            if (typeof window !== "undefined") {
              const { clientLogout } = await import("@/lib/utils/logout");
              clientLogout();
              return;
            }
          }
          setSubscriptionWithNormalize("free");
        }
      } catch {
        setSubscriptionWithNormalize("free");
      } finally {
        setIsCheckingProPlan(false);
        // Remove the refresh param to avoid repeated refreshes
        url.searchParams.delete("refresh");
        window.history.replaceState({}, "", url.toString());
      }
    };

    refreshFromUrl();
  }, [user, setSubscriptionWithNormalize]);

  // Listen for URL changes to sync temporary chat state
  useEffect(() => {
    const handleUrlChange = () => {
      if (typeof window === "undefined") return;
      const urlParams = new URLSearchParams(window.location.search);
      const urlTemporaryEnabled = urlParams.get("temporary-chat") === "true";

      // Only update state if it differs from URL to avoid infinite loops
      if (temporaryChatsEnabled !== urlTemporaryEnabled) {
        setTemporaryChatsEnabled(urlTemporaryEnabled);
      }
    };

    // Listen for popstate events (browser back/forward)
    window.addEventListener("popstate", handleUrlChange);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
    };
  }, [temporaryChatsEnabled]);

  // Listen for hash changes to sync team pricing dialog state
  useEffect(() => {
    const handleHashChange = () => {
      if (typeof window === "undefined") return;
      const shouldOpen =
        window.location.hash === "#team-pricing-seat-selection";

      // Only update state if it differs to avoid infinite loops
      if (teamPricingDialogOpen !== shouldOpen) {
        setTeamPricingDialogOpen(shouldOpen);
      }
    };

    // Listen for hash changes
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("popstate", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("popstate", handleHashChange);
    };
  }, [teamPricingDialogOpen]);

  // Listen for URL changes to sync team welcome dialog state
  useEffect(() => {
    const handleUrlChange = () => {
      if (typeof window === "undefined") return;
      const urlParams = new URLSearchParams(window.location.search);
      const shouldOpen = urlParams.get("team-welcome") === "true";

      // Only update state if it differs to avoid infinite loops
      if (teamWelcomeDialogOpen !== shouldOpen) {
        setTeamWelcomeDialogOpen(shouldOpen);
      }
    };

    // Listen for popstate events (browser back/forward)
    window.addEventListener("popstate", handleUrlChange);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
    };
  }, [teamWelcomeDialogOpen]);

  // Listen for URL changes to sync PentestGPT migration confirm dialog state
  useEffect(() => {
    const handleUrlChange = () => {
      if (typeof window === "undefined") return;
      const urlParams = new URLSearchParams(window.location.search);
      const shouldOpen = urlParams.get("confirm-migrate-pentestgpt") === "true";

      if (migrateFromPentestgptDialogOpen !== shouldOpen) {
        setMigrateFromPentestgptDialogOpen(shouldOpen);
      }
    };

    window.addEventListener("popstate", handleUrlChange);

    return () => {
      window.removeEventListener("popstate", handleUrlChange);
    };
  }, [migrateFromPentestgptDialogOpen]);

  // These five are in the context value, so a fresh identity on every render
  // would defeat the memo below and re-render all 57 consumers anyway. Each
  // only calls a setter, so each has a stable empty dependency list.
  const clearUploadedFiles = useCallback(() => {
    setUploadedFiles([]);
  }, []);

  // Calculate total tokens from all files that have tokens
  const getTotalTokens = useCallback((): number => {
    return uploadedFiles.reduce((total, file) => {
      return file.tokens ? total + file.tokens : total;
    }, 0);
  }, [uploadedFiles]);

  // Check if any files are currently uploading or have errors
  const isUploadingFiles = uploadedFiles.some(
    (file) => file.uploading || file.error,
  );

  const addUploadedFile = useCallback((file: UploadedFileState) => {
    setUploadedFiles((prev) => [...prev, file]);
  }, []);

  const removeUploadedFile = useCallback((index: number) => {
    setUploadedFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateUploadedFile = useCallback(
    (index: number, updates: Partial<UploadedFileState>) => {
      setUploadedFiles((prev) =>
        prev.map((file, i) => (i === index ? { ...file, ...updates } : file)),
      );
    },
    [],
  );

  const initializeChat = useCallback((chatId: string, _fromRoute?: boolean) => {
    // Don't clear input here - let ChatInput restore draft automatically
    // setInput("");  // Removed - ChatInput will handle draft restoration
    setTodos([]);
    setIsTodoPanelExpanded(false);
    // Navigating to an existing chat means we're no longer in temporary chat mode
    setTemporaryChatsEnabled(false);
    // Prevent a project from the previous chat leaking into the first request
    // made while the destination chat is still rehydrating. Its persisted
    // binding is restored by Chat once Convex returns the destination row.
    setActiveProject(null);
    // A preview URL belongs to the conversation that exposed it. Keeping the
    // previous iframe open while the destination chat hydrates can show an
    // unrelated app as if it were part of the newly selected conversation.
    setBuildPreviewOpen(false);
    setBuildPreviewUrl(null);
  }, []);

  const initializeNewChat = useCallback(
    (
      purpose: ChatPurpose = "app",
      project: ActiveProjectContext | null = null,
    ) => {
      // The new chat binds its own ID when it mounts. Retain queued follow-ups
      // for any run that the user is leaving in the background.
      setActiveQueueChat(null);
      // Allow chat component to reset its local state immediately
      if (chatResetRef.current) {
        chatResetRef.current();
      }
      setTodos([]);
      setIsTodoPanelExpanded(false);
      // New conversations never inherit the prior run's sandbox preview.
      setBuildPreviewOpen(false);
      setBuildPreviewUrl(null);

      // Set the purpose/project for the new chat and force the matching
      // execution path. Studio images use Ask, while videos need the durable
      // Agent worker and may be retained as the user's selected model.
      setChatPurpose(purpose);
      setActiveProject(project);
      if (purpose === "app") {
        setChatMode("agent");
      } else if (purpose === "image") {
        if (!resolveMediaModel(selectedModel)) {
          setSelectedModelRaw(DEFAULT_IMAGE_MODEL);
          setChatMode("ask");
          return;
        }
        setChatMode(
          resolveChatModeForPurpose({
            purpose,
            selectedModel,
            fallbackMode: "ask",
          }),
        );
      }
    },
    [selectedModel, setActiveQueueChat],
  );

  const setChatReset = useCallback((fn: (() => void) | null) => {
    chatResetRef.current = fn;
  }, []);

  const openSidebar = useCallback((content: SidebarContent) => {
    setSidebarContent(content);
    setSidebarOpen(true);
    window.dispatchEvent(
      new CustomEvent("rift:open-workbench-content", { detail: content }),
    );
  }, []);

  const updateSidebarContent = useCallback(
    (updates: Partial<SidebarContent>) => {
      setSidebarContent((current) => {
        if (current) {
          return { ...current, ...updates } as SidebarContent;
        }
        return current;
      });
    },
    [],
  );

  const closeSidebar = useCallback(() => {
    setSidebarOpen(false);
    setSidebarContent(null);
  }, []);

  const toggleChatSidebar = useCallback(() => {
    setChatSidebarOpen((prev: boolean) => !prev);
  }, []);

  // Custom setter for temporary chats that also updates URL
  const setTemporaryChatsEnabledWithUrl = useCallback((enabled: boolean) => {
    setTemporaryChatsEnabled(enabled);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (enabled) {
        url.searchParams.set("temporary-chat", "true");
      } else {
        url.searchParams.delete("temporary-chat");
      }
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  // Custom setter for team welcome dialog that also updates URL
  const setTeamWelcomeDialogOpenWithUrl = useCallback((open: boolean) => {
    setTeamWelcomeDialogOpen(open);

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (!open) {
        // Remove the param when dialog is closed
        url.searchParams.delete("team-welcome");
        window.history.replaceState({}, "", url.toString());
      }
    }
  }, []);

  // Custom setter for PentestGPT migration confirm dialog that also updates URL
  const setMigrateFromPentestgptDialogOpenWithUrl = useCallback(
    (open: boolean) => {
      setMigrateFromPentestgptDialogOpen(open);

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        if (open) {
          url.searchParams.set("confirm-migrate-pentestgpt", "true");
        } else {
          url.searchParams.delete("confirm-migrate-pentestgpt");
        }
        window.history.replaceState({}, "", url.toString());
      }
    },
    [],
  );

  /*
   * Memoised, and that matters more here than anywhere else in the app.
   *
   * This was a plain object literal, so the provider handed every consumer a
   * new context value on every one of its own renders. `useGlobalState` is
   * read by 57 non-test files — the composer, the sidebar, the message list,
   * the workbench — so a single unrelated state change in here re-rendered all
   * of them. The value is the same data either way; the identity is the whole
   * point.
   */
  const value: GlobalStateType = useMemo(
    () => ({
      uploadedFiles,
      setUploadedFiles,
      addUploadedFile,
      removeUploadedFile,
      updateUploadedFile,
      getTotalTokens,
      isUploadingFiles,
      chatMode,
      setChatMode,
      chatPurpose,
      setChatPurpose,
      activeProject,
      setActiveProject,
      activeOperation,
      setActiveOperation,
      sidebarOpen,
      setSidebarOpen,
      sidebarContent,
      setSidebarContent,
      buildPreviewUrl,
      setBuildPreviewUrl,
      buildPreviewOpen,
      terminalDockOpen,
      terminalDockView,
      setTerminalDockView,
      setTerminalDockOpen,
      toggleTerminalDock,
      setBuildPreviewOpen,
      chatSidebarOpen,
      setChatSidebarOpen,
      todos,
      setTodos,
      mergeTodos,
      replaceAssistantTodos,

      isTodoPanelExpanded,
      setIsTodoPanelExpanded,

      subscription,
      hasPaidContext,
      isCheckingProPlan,
      isSubscriptionReady,

      clearUploadedFiles,
      openSidebar,
      updateSidebarContent,
      closeSidebar,
      toggleChatSidebar,
      initializeChat,
      initializeNewChat,

      temporaryChatsEnabled,
      setTemporaryChatsEnabled: setTemporaryChatsEnabledWithUrl,

      teamPricingDialogOpen,
      setTeamPricingDialogOpen,

      teamWelcomeDialogOpen,
      setTeamWelcomeDialogOpen: setTeamWelcomeDialogOpenWithUrl,

      migrateFromPentestgptDialogOpen,
      setMigrateFromPentestgptDialogOpen:
        setMigrateFromPentestgptDialogOpenWithUrl,

      setChatReset,

      hasUserDismissedRateLimitWarning,
      setHasUserDismissedRateLimitWarning,

      activeQueueChatId,
      setActiveQueueChat,
      messageQueue,
      queueMessage,
      removeQueuedMessage,
      claimQueuedMessage,
      clearQueue,

      queueBehavior,
      setQueueBehavior: setQueueBehaviorState,

      sandboxPreference,
      setSandboxPreference,
      desktopBridgeActive,
      hasLocalSandbox,
      isSelectedSandboxAvailable,
      localExecutionTargets,
      defaultLocalSandboxPreference,

      selectedModel,
      setSelectedModel: setSelectedModelState,
      reasoningEffort,
      setReasoningEffort: setReasoningEffortState,
    }),
    [
      uploadedFiles,
      setUploadedFiles,
      addUploadedFile,
      removeUploadedFile,
      updateUploadedFile,
      getTotalTokens,
      isUploadingFiles,
      chatMode,
      setChatMode,
      chatPurpose,
      setChatPurpose,
      activeProject,
      setActiveProject,
      activeOperation,
      setActiveOperation,
      sidebarOpen,
      setSidebarOpen,
      sidebarContent,
      setSidebarContent,
      buildPreviewUrl,
      setBuildPreviewUrl,
      buildPreviewOpen,
      terminalDockOpen,
      terminalDockView,
      setTerminalDockView,
      setTerminalDockOpen,
      toggleTerminalDock,
      setBuildPreviewOpen,
      chatSidebarOpen,
      setChatSidebarOpen,
      todos,
      setTodos,
      mergeTodos,
      replaceAssistantTodos,
      isTodoPanelExpanded,
      setIsTodoPanelExpanded,
      subscription,
      hasPaidContext,
      isCheckingProPlan,
      isSubscriptionReady,
      clearUploadedFiles,
      openSidebar,
      updateSidebarContent,
      closeSidebar,
      toggleChatSidebar,
      initializeChat,
      initializeNewChat,
      temporaryChatsEnabled,
      setTemporaryChatsEnabledWithUrl,
      teamPricingDialogOpen,
      setTeamPricingDialogOpen,
      teamWelcomeDialogOpen,
      setTeamWelcomeDialogOpenWithUrl,
      migrateFromPentestgptDialogOpen,
      setMigrateFromPentestgptDialogOpenWithUrl,
      setChatReset,
      hasUserDismissedRateLimitWarning,
      setHasUserDismissedRateLimitWarning,
      activeQueueChatId,
      setActiveQueueChat,
      messageQueue,
      queueMessage,
      removeQueuedMessage,
      claimQueuedMessage,
      clearQueue,
      queueBehavior,
      setQueueBehaviorState,
      sandboxPreference,
      setSandboxPreference,
      desktopBridgeActive,
      hasLocalSandbox,
      isSelectedSandboxAvailable,
      localExecutionTargets,
      defaultLocalSandboxPreference,
      selectedModel,
      setSelectedModelState,
      reasoningEffort,
      setReasoningEffortState,
    ],
  );

  return (
    <GlobalStateContext.Provider value={value}>
      <LiveSidebarContentProvider>{children}</LiveSidebarContentProvider>
    </GlobalStateContext.Provider>
  );
};

export const useGlobalState = (): GlobalStateType => {
  const context = useContext(GlobalStateContext);
  if (context === undefined) {
    throw new Error("useGlobalState must be used within a GlobalStateProvider");
  }
  return context;
};
