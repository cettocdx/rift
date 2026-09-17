"use client";

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type RefObject,
  type SetStateAction,
} from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import {
  FolderCode,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  PanelBottom,
  PanelRight,
  Plus,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { RiftAgentConsole } from "@/app/components/terminal/RiftAgentConsole";
import { useHasRiftAgentConsoleProvider } from "@/app/components/terminal/RiftAgentConsoleContext";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { WithTooltip } from "@/components/ui/with-tooltip";
import {
  MAX_WORKBENCH_TERMINALS_PER_WORKSPACE,
  WORKBENCH_TERMINAL_PROFILES_ENDPOINT,
  WORKBENCH_TERMINAL_PROFILES,
  isWorkbenchTerminalProfile,
  type WorkbenchInteractiveTerminalSummary,
  type WorkbenchTerminalProfile,
  type WorkbenchTerminalProfileCapabilities,
  type WorkbenchTerminalProfileCapability,
  workbenchTerminalSessionEndpoint,
} from "@/lib/workbench/interactive-terminal-contract";
import type { WorkbenchInteractiveTerminalConnection } from "./WorkbenchActivity";
import { useWorkbench, useWorkbenchRequestHeaders } from "./WorkbenchProvider";
import {
  addTerminalToLayout,
  closeTerminalInLayout,
  createClientTerminalId,
  createInitialTerminalLayout,
  parseTerminalLayout,
  selectTerminalInLayout,
  splitTerminalLayout,
  type WorkbenchTerminalLayout,
} from "./terminal-layout";
import { clearWorkbenchTerminalScrollback } from "./terminal-scrollback";
import { isTauriEnvironment } from "@/app/hooks/useTauri";
import { useDesktopWorkspaceAccess } from "@/app/hooks/useDesktopWorkspaceAccess";
import {
  closeDesktopProfileTerminalTab,
  listDesktopTerminalProfiles,
} from "@/app/services/desktop-profile-terminal";

type TerminalView = "terminal" | "agent";

function terminalConnectionDescription(
  connection: WorkbenchInteractiveTerminalConnection | undefined,
) {
  if (connection === "connected") return "Connected";
  if (connection === "connecting") return "Connecting";
  if (connection === "reconnecting") return "Reconnecting";
  if (connection === "restarting") return "Restarting";
  if (connection === "error") return "Connection issue";
  if (connection === "exited") return "Process exited";
  return "Starting terminal";
}

type ProfileCheck =
  | { status: "loading"; error: null }
  | { status: "error"; error: string }
  | {
      status: "ready";
      error: null;
      backend: WorkbenchTerminalProfileCapabilities["backend"];
      profiles: WorkbenchTerminalProfileCapability[];
    };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseProfileCapabilities(
  value: unknown,
): WorkbenchTerminalProfileCapabilities {
  const body = asRecord(value);
  if (
    !body ||
    (body.backend !== "local" && body.backend !== "remote") ||
    !Array.isArray(body.profiles)
  ) {
    throw new Error("The CLI profile service returned an invalid response.");
  }

  const parsed = body.profiles.map((value) => {
    const capability = asRecord(value);
    if (
      !capability ||
      !isWorkbenchTerminalProfile(capability.profile) ||
      typeof capability.available !== "boolean" ||
      typeof capability.runtimeLabel !== "string" ||
      (capability.unavailableReason !== null &&
        typeof capability.unavailableReason !== "string")
    ) {
      throw new Error("The CLI profile service returned an invalid response.");
    }
    return capability as WorkbenchTerminalProfileCapability;
  });

  if (
    parsed.length !== WORKBENCH_TERMINAL_PROFILES.length ||
    WORKBENCH_TERMINAL_PROFILES.some(
      ({ id }) => parsed.filter(({ profile }) => profile === id).length !== 1,
    )
  ) {
    throw new Error("The CLI profile service returned an invalid response.");
  }

  return { backend: body.backend, profiles: parsed };
}

async function profileResponseError(response: Response) {
  try {
    const payload = asRecord(await response.json());
    if (typeof payload?.error === "string") return payload.error;
    if (typeof payload?.message === "string") return payload.message;
  } catch {
    // The status text below is still more useful than a JSON parsing error.
  }
  return `CLI profile detection failed (${response.status}).`;
}

const WorkbenchInteractiveTerminal = dynamic(
  () =>
    import("./WorkbenchInteractiveTerminal").then(
      (module) => module.WorkbenchInteractiveTerminal,
    ),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center px-3 text-[11px] text-workbench-faint">
        Starting workspace terminal…
      </div>
    ),
  },
);

function terminalLayoutStorageKey(
  requestHeaders: Readonly<Record<string, string>>,
) {
  const scope = Object.entries(requestHeaders)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
  return `rift:workbench:terminal-layout:v1:${encodeURIComponent(scope)}`;
}

export function WorkbenchTerminalPanel({
  compact = false,
  onRequestClose,
  onToggleFullscreen,
  hostFullscreen = false,
  view: controlledView,
  onViewChange,
}: {
  /** Docked surfaces collapse to a single row of chrome. */
  compact?: boolean;
  /** Lets a host (the dock) own what the close button means. */
  onRequestClose?: () => void;
  /** Lets a host own what full screen means. */
  onToggleFullscreen?: () => void;
  /** Reflects the host's full-screen state on the button. */
  hostFullscreen?: boolean;
  /** An account-scoped host can retain the selected view through reload. */
  view?: TerminalView;
  onViewChange?: (view: TerminalView) => void;
} = {}) {
  const isDesktopTerminal = isTauriEnvironment();
  const hasConsole = useHasRiftAgentConsoleProvider();
  const [localView, updateActiveView] = useState<TerminalView>(() =>
    compact && hasConsole ? "agent" : "terminal",
  );
  const activeView =
    controlledView === "agent" && !hasConsole
      ? "terminal"
      : (controlledView ?? localView);
  const [shellStarted, setShellStarted] = useState(
    () => !compact || !hasConsole || activeView === "terminal",
  );
  const setActiveView = useCallback(
    (view: TerminalView) => {
      if (view === "terminal") setShellStarted(true);
      updateActiveView(view);
      onViewChange?.(view);
    },
    [onViewChange],
  );
  const views: readonly TerminalView[] =
    hasConsole || activeView === "agent" ? ["agent", "terminal"] : ["terminal"];
  const [launchProfile, setLaunchProfile] =
    useState<WorkbenchTerminalProfile>("shell");
  const [pendingCliProfile, setPendingCliProfile] =
    useState<WorkbenchTerminalProfile | null>(null);
  const [layoutState, setLayoutState] = useState<{
    storageKey: string;
    layout: WorkbenchTerminalLayout | null;
  } | null>(null);
  const [sessions, setSessions] = useState<
    Record<string, WorkbenchInteractiveTerminalSummary | null>
  >({});
  const [connections, setConnections] = useState<
    Record<string, WorkbenchInteractiveTerminalConnection>
  >({});
  const [panelNotice, setPanelNotice] = useState<string | null>(null);
  const [terminalFocusRequest, setTerminalFocusRequest] = useState<{
    clientTerminalId: string | null;
    sequence: number;
  }>({ clientTerminalId: null, sequence: 0 });
  const [profileCheckVersion, setProfileCheckVersion] = useState(0);
  const [profileCheck, setProfileCheck] = useState<ProfileCheck>({
    status: "loading",
    error: null,
  });
  const [selectedDesktopGrantId, setSelectedDesktopGrantId] = useState<
    string | null
  >(null);
  const viewTabId = useId();
  const terminalTabListRef = useRef<HTMLDivElement>(null);
  const terminalViewRef = useRef<HTMLButtonElement>(null);
  const agentViewRef = useRef<HTMLButtonElement>(null);
  const terminalFocusIntentHandledRef = useRef(false);
  const startTerminalRef = useRef<HTMLButtonElement>(null);
  const [emptyFocusRequest, setEmptyFocusRequest] = useState(0);
  const handledEmptyFocusRef = useRef(0);
  const requestHeaders = useWorkbenchRequestHeaders();
  const searchParams = useSearchParams();
  const requestHeadersRef = useRef(requestHeaders);
  const storageKey = useMemo(
    () => terminalLayoutStorageKey(requestHeaders),
    [requestHeaders],
  );
  const { state, actions } = useWorkbench();
  const desktopAccess = useDesktopWorkspaceAccess();
  const writableDesktopGrants = useMemo(
    () =>
      desktopAccess.grants.filter(
        (grant) => grant.writable && grant.kind !== "file" && !!grant.rootPath,
      ),
    [desktopAccess.grants],
  );
  const activeDesktopGrant = useMemo(
    () =>
      writableDesktopGrants.find(
        (grant) => grant.grantId === selectedDesktopGrantId,
      ) ??
      writableDesktopGrants[0] ??
      null,
    [selectedDesktopGrantId, writableDesktopGrants],
  );
  const openBottomPanel = actions.openBottomPanel;
  const visibleView: TerminalView = state.terminalFullscreen
    ? "terminal"
    : activeView;
  const terminalFocusIntent = searchParams.get("terminal") === "focus";
  const layout =
    layoutState?.storageKey === storageKey ? layoutState.layout : null;
  const setLayout = useCallback<
    Dispatch<SetStateAction<WorkbenchTerminalLayout | null>>
  >(
    (update) => {
      setLayoutState((current) => {
        const currentLayout =
          current?.storageKey === storageKey ? current.layout : null;
        const nextLayout =
          typeof update === "function" ? update(currentLayout) : update;
        return { storageKey, layout: nextLayout };
      });
    },
    [storageKey],
  );

  const requestTerminalFocus = useCallback((clientTerminalId: string) => {
    setTerminalFocusRequest((current) => ({
      clientTerminalId,
      sequence: current.sequence + 1,
    }));
  }, []);

  const profileCapability = useCallback(
    (profile: WorkbenchTerminalProfile) =>
      profileCheck.status === "ready"
        ? profileCheck.profiles.find(
            (candidate) => candidate.profile === profile,
          )
        : undefined,
    [profileCheck],
  );

  useEffect(() => {
    requestHeadersRef.current = requestHeaders;
  }, [requestHeaders]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const restored = parseTerminalLayout(
        window.sessionStorage.getItem(storageKey),
      );
      setLayoutState({
        storageKey,
        layout: restored ?? createInitialTerminalLayout(),
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [storageKey]);

  useEffect(() => {
    const controller = new AbortController();
    const loadProfiles = isDesktopTerminal
      ? listDesktopTerminalProfiles()
      : fetch(WORKBENCH_TERMINAL_PROFILES_ENDPOINT, {
          method: "GET",
          cache: "no-store",
          headers: requestHeadersRef.current,
          signal: controller.signal,
        }).then(async (response) => {
          if (!response.ok) {
            throw new Error(await profileResponseError(response));
          }
          return parseProfileCapabilities(await response.json());
        });

    void loadProfiles
      .then((capabilities) => {
        if (controller.signal.aborted) return;
        setProfileCheck({
          status: "ready",
          error: null,
          ...capabilities,
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProfileCheck({
          status: "error",
          error:
            error instanceof Error
              ? error.message
              : "CLI profile detection failed.",
        });
      });

    return () => controller.abort();
  }, [isDesktopTerminal, profileCheckVersion, storageKey]);

  useEffect(() => {
    if (!layout) return;
    window.sessionStorage.setItem(storageKey, JSON.stringify(layout));
  }, [layout, storageKey]);

  useEffect(() => {
    if (
      layout?.tabs.length !== 0 ||
      visibleView !== "terminal" ||
      emptyFocusRequest === handledEmptyFocusRef.current
    )
      return;
    const frame = window.requestAnimationFrame(() => {
      handledEmptyFocusRef.current = emptyFocusRequest;
      startTerminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [layout, visibleView, emptyFocusRequest]);

  useEffect(() => {
    if (!terminalFocusIntent) {
      terminalFocusIntentHandledRef.current = false;
      return;
    }
    if (!layout || terminalFocusIntentHandledRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      terminalFocusIntentHandledRef.current = true;
      setActiveView("terminal");
      openBottomPanel();
      if (layout.tabs.length === 0) setEmptyFocusRequest((value) => value + 1);
      else requestTerminalFocus(layout.activeId);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    layout,
    openBottomPanel,
    requestTerminalFocus,
    terminalFocusIntent,
    setActiveView,
  ]);

  const selectView = (
    view: TerminalView,
    ref: RefObject<HTMLButtonElement | null>,
  ) => {
    setActiveView(view);
    window.requestAnimationFrame(() => ref.current?.focus());
  };

  const handleViewKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: TerminalView,
  ) => {
    if (
      state.terminalFullscreen &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      event.preventDefault();
      return;
    }

    const viewRef = (view: TerminalView) => {
      if (view === "terminal") return terminalViewRef;
      return agentViewRef;
    };

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const currentIndex = views.indexOf(current);
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const next =
        views[(currentIndex + direction + views.length) % views.length];
      selectView(next, viewRef(next));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectView(views[0], viewRef(views[0]));
    } else if (event.key === "End") {
      event.preventDefault();
      selectView(views[views.length - 1], viewRef(views[views.length - 1]));
    }
  };

  const focusTerminalTab = useCallback((clientTerminalId: string) => {
    const tab = Array.from(
      terminalTabListRef.current?.querySelectorAll<HTMLButtonElement>(
        "[data-terminal-tab]",
      ) ?? [],
    ).find((candidate) => candidate.dataset.terminalTab === clientTerminalId);
    window.requestAnimationFrame(() => tab?.focus());
  }, []);

  // Keep the selected session visible without scrolling the chat or the page.
  // This also covers opening a split from the menu, which retains menu focus.
  useEffect(() => {
    if (visibleView !== "terminal" || !layout?.activeId) return;
    const frame = window.requestAnimationFrame(() => {
      const list = terminalTabListRef.current;
      const tab = Array.from(
        list?.querySelectorAll<HTMLElement>("[data-terminal-tab]") ?? [],
      ).find((candidate) => candidate.dataset.terminalTab === layout.activeId);
      if (!list || !tab) return;
      const viewport = list.getBoundingClientRect();
      const item = tab.getBoundingClientRect();
      if (item.left < viewport.left)
        list.scrollLeft += item.left - viewport.left;
      else if (item.right > viewport.right)
        list.scrollLeft += item.right - viewport.right;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [layout?.activeId, visibleView]);

  const selectTerminal = useCallback(
    (clientTerminalId: string) => {
      setActiveView("terminal");
      setLayout((current) =>
        current ? selectTerminalInLayout(current, clientTerminalId) : current,
      );
    },
    [setLayout, setActiveView],
  );

  const activateCliProfile = useCallback(
    (profile: WorkbenchTerminalProfile) => {
      const capability = profileCapability(profile);
      if (
        profile === "shell"
          ? capability?.available === false
          : !capability?.available
      ) {
        setPendingCliProfile(null);
        const reason =
          capability?.unavailableReason ??
          (profileCheck.status === "loading"
            ? "RIFT is still checking installed CLI profiles."
            : profileCheck.status === "error"
              ? profileCheck.error
              : "This CLI profile is unavailable.");
        setPanelNotice(reason);
        return;
      }
      if (profile !== "shell" && isDesktopTerminal && !activeDesktopGrant) {
        setPendingCliProfile(null);
        setLaunchProfile(profile);
        setPanelNotice(
          "Choose a writable workspace folder before launching a local CLI.",
        );
        return;
      }
      if (!layout) {
        setLaunchProfile(profile);
        setPendingCliProfile(profile);
        setPanelNotice("Preparing the terminal layout…");
        return;
      }

      setPendingCliProfile(null);
      setLaunchProfile(profile);
      setPanelNotice(null);
      setActiveView("terminal");
      openBottomPanel();

      const reusable = layout.tabs.find(
        (tab) =>
          tab.profile === profile &&
          connections[tab.clientTerminalId] !== "error" &&
          connections[tab.clientTerminalId] !== "exited",
      );
      if (reusable) {
        selectTerminal(reusable.clientTerminalId);
        requestTerminalFocus(reusable.clientTerminalId);
        return;
      }

      if (layout.tabs.length >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE) {
        setPanelNotice(
          `Close a terminal before launching ${capability?.runtimeLabel ?? "Shell"}; this workspace already has ${MAX_WORKBENCH_TERMINALS_PER_WORKSPACE} terminals.`,
        );
        return;
      }

      const clientTerminalId = createClientTerminalId();
      setLayout((current) =>
        current
          ? addTerminalToLayout(current, clientTerminalId, profile)
          : createInitialTerminalLayout(clientTerminalId, profile),
      );
      requestTerminalFocus(clientTerminalId);
    },
    [
      connections,
      activeDesktopGrant,
      isDesktopTerminal,
      layout,
      openBottomPanel,
      profileCapability,
      profileCheck,
      requestTerminalFocus,
      selectTerminal,
      setLayout,
      setActiveView,
    ],
  );

  useEffect(() => {
    if (!pendingCliProfile || !layout) return;
    const frame = window.requestAnimationFrame(() =>
      activateCliProfile(pendingCliProfile),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [activateCliProfile, layout, pendingCliProfile]);

  const addTerminal = useCallback(() => {
    const clientTerminalId = createClientTerminalId();
    setActiveView("terminal");
    setLayout((current) =>
      current
        ? addTerminalToLayout(current, clientTerminalId, launchProfile)
        : createInitialTerminalLayout(clientTerminalId, launchProfile),
    );
    focusTerminalTab(clientTerminalId);
  }, [focusTerminalTab, launchProfile, setLayout, setActiveView]);

  const splitTerminal = useCallback(
    (direction: "right" | "down") => {
      const clientTerminalId = createClientTerminalId();
      setActiveView("terminal");
      setLayout((current) =>
        current
          ? splitTerminalLayout(
              current,
              direction,
              clientTerminalId,
              launchProfile,
            )
          : createInitialTerminalLayout(clientTerminalId, launchProfile),
      );
    },
    [launchProfile, setLayout, setActiveView],
  );

  const closeTerminal = useCallback(
    (clientTerminalId: string) => {
      const remoteSession = sessions[clientTerminalId];
      if (layout?.tabs.length === 1 && layout.activeId === clientTerminalId) {
        setEmptyFocusRequest((value) => value + 1);
      }
      setPanelNotice(null);
      setLayout((current) =>
        current ? closeTerminalInLayout(current, clientTerminalId) : current,
      );
      setSessions((current) => {
        const next = { ...current };
        delete next[clientTerminalId];
        return next;
      });
      setConnections((current) => {
        const next = { ...current };
        delete next[clientTerminalId];
        return next;
      });
      // Let the terminal's unmount cleanup flush first, then remove the
      // tab-scoped replay buffer so a deliberately closed tab cannot return.
      window.setTimeout(
        () => clearWorkbenchTerminalScrollback(clientTerminalId),
        0,
      );

      if (isDesktopTerminal) {
        // Close by tab identity even when its first attach/spawn is in flight.
        void closeDesktopProfileTerminalTab(clientTerminalId).catch(() => {
          setPanelNotice("The terminal process could not be closed.");
        });
        return;
      }
      if (!remoteSession) return;
      void fetch(workbenchTerminalSessionEndpoint(remoteSession.id), {
        method: "DELETE",
        cache: "no-store",
        headers: requestHeaders,
        keepalive: true,
      })
        .then((response) => {
          if (!response.ok && response.status !== 404) {
            throw new Error("Terminal process could not be closed.");
          }
        })
        .catch(() => {
          setPanelNotice(
            "The tab closed, but its remote process may remain until the workspace lease expires.",
          );
        });
    },
    [isDesktopTerminal, layout, requestHeaders, sessions, setLayout],
  );

  const handleTerminalTabKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, clientTerminalId: string) => {
      if (!layout) return;
      const currentIndex = layout.tabs.findIndex(
        (tab) => tab.clientTerminalId === clientTerminalId,
      );
      if (currentIndex < 0) return;
      let nextIndex: number | null = null;
      if (event.key === "ArrowLeft") {
        nextIndex =
          (currentIndex - 1 + layout.tabs.length) % layout.tabs.length;
      } else if (event.key === "ArrowRight") {
        nextIndex = (currentIndex + 1) % layout.tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = layout.tabs.length - 1;
      } else if (event.key === "Delete") {
        event.preventDefault();
        closeTerminal(clientTerminalId);
        return;
      }
      if (nextIndex === null) return;
      event.preventDefault();
      const nextId = layout.tabs[nextIndex].clientTerminalId;
      selectTerminal(nextId);
      focusTerminalTab(nextId);
    },
    [closeTerminal, focusTerminalTab, layout, selectTerminal],
  );

  const handleSessionChange = useCallback(
    (
      clientTerminalId: string,
      session: WorkbenchInteractiveTerminalSummary | null,
    ) => {
      setSessions((current) => {
        if (current[clientTerminalId] === session) return current;
        return { ...current, [clientTerminalId]: session };
      });
    },
    [],
  );

  const handleConnectionChange = useCallback(
    (
      clientTerminalId: string,
      connection: WorkbenchInteractiveTerminalConnection,
    ) => {
      setConnections((current) =>
        current[clientTerminalId] === connection
          ? current
          : { ...current, [clientTerminalId]: connection },
      );
    },
    [],
  );

  const viewTabClass =
    "relative flex h-[35px] shrink-0 items-center whitespace-nowrap [@media(pointer:coarse)]:h-11 gap-1.5 border-b px-2.5 text-[12px] transition-colors duration-(--duration-hover) motion-reduce:transition-none focus-visible:outline-none focus-visible:bg-muted";
  const controlClass =
    "flex size-6 [@media(pointer:coarse)]:size-11 shrink-0 items-center justify-center rounded text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text disabled:cursor-not-allowed disabled:opacity-30 focus-visible:outline-none focus-visible:bg-workbench-hover";
  const effectiveFullscreen = onToggleFullscreen
    ? hostFullscreen
    : state.terminalFullscreen;
  const menuItemClass = "text-[12px] [@media(pointer:coarse)]:min-h-11";
  const atTerminalLimit =
    (layout?.tabs.length ?? 0) >= MAX_WORKBENCH_TERMINALS_PER_WORKSPACE;
  const selectedProfileCapability = profileCapability(launchProfile);
  const selectedProfileAvailable =
    launchProfile === "shell"
      ? selectedProfileCapability?.available !== false
      : selectedProfileCapability?.available === true;
  const selectedProfileLaunchable =
    selectedProfileAvailable &&
    (launchProfile === "shell" || !isDesktopTerminal || !!activeDesktopGrant);
  const profileCheckLabel =
    profileCheck.status === "loading"
      ? "Checking CLI profiles…"
      : profileCheck.status === "error"
        ? "CLI profile check unavailable"
        : profileCheck.backend === "local"
          ? "Local CLI launchers checked"
          : "Sandbox shell only";
  const toggleFullscreen = () => {
    // A docked panel has no workspace panes to hide; its host owns what
    // "full screen" means, so defer to it when one is supplied.
    if (onToggleFullscreen) {
      onToggleFullscreen();
      return;
    }
    actions.toggleTerminalFullscreen();
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-workbench-terminal">
      <header
        className={`flex h-[35px] [@media(pointer:coarse)]:h-11 shrink-0 items-center bg-workbench-panel px-1.5 ${
          compact ? "" : "border-b border-workbench-border"
        }`}
      >
        <Terminal
          aria-hidden
          className={`${compact ? "hidden" : "mx-1"} size-3.5 shrink-0 text-muted-foreground/75`}
        />
        <div
          role="tablist"
          aria-label="Workbench terminal views"
          className="flex h-[35px] shrink-0 [@media(pointer:coarse)]:h-11"
        >
          {views.includes("agent") && (
            <button
              ref={agentViewRef}
              id={`${viewTabId}-agent-tab`}
              type="button"
              role="tab"
              aria-selected={visibleView === "agent"}
              aria-controls={`${viewTabId}-agent-panel`}
              tabIndex={visibleView === "agent" ? 0 : -1}
              onClick={() => setActiveView("agent")}
              onKeyDown={(event) => handleViewKeyDown(event, "agent")}
              className={`${viewTabClass} ${visibleView === "agent" ? "border-workbench-muted text-workbench-text" : "border-transparent text-muted-foreground hover:text-foreground/80"}`}
            >
              RIFT console
            </button>
          )}
          <button
            ref={terminalViewRef}
            id={`${viewTabId}-terminal-tab`}
            type="button"
            role="tab"
            aria-selected={visibleView === "terminal"}
            aria-controls={`${viewTabId}-terminal-panel`}
            tabIndex={visibleView === "terminal" ? 0 : -1}
            onClick={() => setActiveView("terminal")}
            onKeyDown={(event) => handleViewKeyDown(event, "terminal")}
            className={`${viewTabClass} ${
              visibleView === "terminal"
                ? "border-workbench-muted text-workbench-text"
                : "border-transparent text-muted-foreground hover:text-foreground/80"
            }`}
          >
            Terminal
          </button>
        </div>

        <span className="ml-auto" />
        <WithTooltip
          side="bottomRight"
          delayDuration={300}
          display={effectiveFullscreen ? "Restore size" : "Full screen"}
          trigger={
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={
                effectiveFullscreen
                  ? "Exit full-screen terminal"
                  : "Open full-screen terminal"
              }
              aria-pressed={effectiveFullscreen}
              aria-keyshortcuts="Meta+Shift+J Control+Shift+J"
              title={
                effectiveFullscreen
                  ? "Restore workspace (⌘⇧J)"
                  : "Full-screen terminal (⌘⇧J)"
              }
              className={controlClass}
            >
              {effectiveFullscreen ? (
                <Minimize2 aria-hidden className="size-3.5" />
              ) : (
                <Maximize2 aria-hidden className="size-3.5" />
              )}
            </button>
          }
        />
        <button
          type="button"
          onClick={onRequestClose ?? actions.closeBottomPanel}
          aria-label="Hide terminal panel"
          title="Hide terminal panel (⌘J)"
          className={controlClass}
        >
          <X aria-hidden className="size-3" />
        </button>
      </header>

      <span className="sr-only" role="status" aria-live="polite">
        {effectiveFullscreen
          ? "Full-screen terminal active."
          : "Workspace layout active."}
      </span>

      {visibleView === "terminal" ? (
        <div className="flex h-8 [@media(pointer:coarse)]:h-11 shrink-0 items-center border-b border-workbench-border bg-workbench-terminal px-1.5">
          <div
            ref={terminalTabListRef}
            role="tablist"
            aria-label="Terminal sessions"
            className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {layout?.tabs.map((tab) => {
              const selected = layout.activeId === tab.clientTerminalId;
              const connection = connections[tab.clientTerminalId];
              const terminalSession = sessions[tab.clientTerminalId];
              const actualProfile = terminalSession?.profile ?? tab.profile;
              const profileFellBack =
                terminalSession?.profileAvailable === false ||
                (terminalSession?.profile !== undefined &&
                  terminalSession.profile !== tab.profile);
              const profileLabel = profileFellBack
                ? "Shell fallback"
                : WORKBENCH_TERMINAL_PROFILES.find(
                    (profile) => profile.id === actualProfile,
                  )?.shortLabel;
              const connectionDescription =
                terminalConnectionDescription(connection);
              const descriptionId = `${viewTabId}-${tab.clientTerminalId}-status`;
              return (
                <Fragment key={tab.clientTerminalId}>
                  <button
                    type="button"
                    role="tab"
                    data-terminal-session-tab
                    data-terminal-tab={tab.clientTerminalId}
                    data-terminal-connection={connection ?? "starting"}
                    aria-selected={selected}
                    aria-controls={`${viewTabId}-${tab.clientTerminalId}-panel`}
                    aria-describedby={descriptionId}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => selectTerminal(tab.clientTerminalId)}
                    onKeyDown={(event) =>
                      handleTerminalTabKeyDown(event, tab.clientTerminalId)
                    }
                    className={`group flex h-6 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:items-center shrink-0 items-baseline gap-2 rounded px-2 text-[11px] transition-colors duration-(--duration-hover) motion-reduce:transition-none focus-visible:outline-none ${
                      selected
                        ? "bg-workbench-hover text-workbench-text"
                        : "text-workbench-faint hover:bg-workbench-control hover:text-workbench-text"
                    }`}
                  >
                    <span className="font-medium">{tab.label}</span>
                    <span
                      aria-hidden
                      className="text-[9.5px] font-normal text-workbench-faint"
                    >
                      {profileLabel}
                    </span>
                    {connection === "error" || connection === "exited" ? (
                      <span
                        aria-hidden
                        className="text-[9.5px] font-normal text-workbench-error"
                      >
                        {connection === "error" ? "Issue" : "Exited"}
                      </span>
                    ) : null}
                    {layout.split?.secondaryId === tab.clientTerminalId ? (
                      <span className="text-[9px] uppercase tracking-wider text-workbench-faint">
                        split
                      </span>
                    ) : null}
                  </button>
                  <span
                    id={descriptionId}
                    className="sr-only"
                  >{`${profileLabel ?? "Shell"}. ${connectionDescription}.`}</span>
                </Fragment>
              );
            })}
          </div>
          <div
            role="toolbar"
            aria-label="Terminal layout controls"
            className="ml-1 flex shrink-0 items-center gap-0.5 border-l border-workbench-border pl-1.5"
          >
            {compact ? (
              <>
                <button
                  type="button"
                  onClick={addTerminal}
                  disabled={
                    !layout || atTerminalLimit || !selectedProfileLaunchable
                  }
                  aria-label="New terminal"
                  title={`New ${WORKBENCH_TERMINAL_PROFILES.find((profile) => profile.id === launchProfile)?.label ?? "terminal"}`}
                  className={controlClass}
                >
                  <Plus aria-hidden className="size-3.5" />
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Terminal actions"
                      title="Terminal actions"
                      className={controlClass}
                    >
                      <MoreHorizontal aria-hidden className="size-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="w-56 max-w-[calc(100vw-16px)]"
                  >
                    <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">
                      Open terminal
                    </DropdownMenuLabel>
                    {WORKBENCH_TERMINAL_PROFILES.map((profile) => {
                      const capability = profileCapability(profile.id);
                      const checking =
                        profile.id !== "shell" &&
                        profileCheck.status === "loading";
                      const unavailable =
                        capability?.available === false ||
                        (profile.id !== "shell" &&
                          profileCheck.status === "error");
                      return (
                        <DropdownMenuItem
                          key={profile.id}
                          disabled={checking || unavailable}
                          title={capability?.unavailableReason ?? undefined}
                          onSelect={() => activateCliProfile(profile.id)}
                          className={menuItemClass}
                        >
                          <Terminal aria-hidden />
                          {profile.label}
                          {checking
                            ? " · checking"
                            : unavailable
                              ? " · unavailable"
                              : ""}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuItem
                      onSelect={() => {
                        setProfileCheck({ status: "loading", error: null });
                        setProfileCheckVersion((version) => version + 1);
                      }}
                      disabled={profileCheck.status === "loading"}
                      className={menuItemClass}
                    >
                      <RefreshCw aria-hidden />
                      Refresh CLI profiles
                    </DropdownMenuItem>
                    {isDesktopTerminal ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onSelect={() =>
                            void desktopAccess.requestAccess(true)
                          }
                          disabled={desktopAccess.busyAction === "write"}
                          className={menuItemClass}
                        >
                          <FolderCode aria-hidden />
                          Choose workspace folder
                        </DropdownMenuItem>
                        {writableDesktopGrants.length > 1
                          ? writableDesktopGrants.map((grant) => (
                              <DropdownMenuItem
                                key={grant.grantId}
                                onSelect={() => {
                                  setSelectedDesktopGrantId(grant.grantId);
                                  setPanelNotice(null);
                                }}
                                className={menuItemClass}
                              >
                                {grant.name}
                              </DropdownMenuItem>
                            ))
                          : null}
                      </>
                    ) : null}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => splitTerminal("right")}
                      disabled={!layout || !selectedProfileLaunchable}
                      className={menuItemClass}
                    >
                      <PanelRight aria-hidden />
                      Split terminal right
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => splitTerminal("down")}
                      disabled={!layout || !selectedProfileLaunchable}
                      className={menuItemClass}
                    >
                      <PanelBottom aria-hidden />
                      Split terminal down
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() => layout && closeTerminal(layout.activeId)}
                      disabled={!layout?.tabs.length}
                      className={menuItemClass}
                    >
                      <Trash2 aria-hidden />
                      Close active terminal
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <>
                {isDesktopTerminal && writableDesktopGrants.length > 1 ? (
                  <select
                    value={activeDesktopGrant?.grantId ?? ""}
                    onChange={(event) => {
                      setSelectedDesktopGrantId(event.target.value);
                      setPanelNotice(null);
                    }}
                    aria-label="Terminal workspace"
                    className="h-6 max-w-[132px] rounded border border-workbench-border-strong bg-workbench-control px-1.5 text-[10px] text-workbench-text outline-none"
                  >
                    {writableDesktopGrants.map((grant) => (
                      <option key={grant.grantId} value={grant.grantId}>
                        {grant.name}
                      </option>
                    ))}
                  </select>
                ) : null}
                {isDesktopTerminal ? (
                  <button
                    type="button"
                    onClick={() => void desktopAccess.requestAccess(true)}
                    disabled={desktopAccess.busyAction === "write"}
                    aria-label={
                      activeDesktopGrant
                        ? "Choose another terminal workspace folder"
                        : "Choose terminal workspace folder"
                    }
                    title={
                      activeDesktopGrant
                        ? `Workspace: ${activeDesktopGrant.name}. Choose another folder`
                        : "Choose a writable workspace folder"
                    }
                    className={controlClass}
                  >
                    <FolderCode aria-hidden className="size-3.5" />
                  </button>
                ) : null}
                <label
                  className="sr-only"
                  htmlFor={`${viewTabId}-launch-profile`}
                >
                  New terminal profile
                </label>
                <select
                  id={`${viewTabId}-launch-profile`}
                  value={launchProfile}
                  onChange={(event) => {
                    if (isWorkbenchTerminalProfile(event.target.value)) {
                      activateCliProfile(event.target.value);
                    }
                  }}
                  aria-label="New terminal profile"
                  aria-describedby={`${viewTabId}-profile-status`}
                  title={
                    selectedProfileCapability?.available
                      ? `Launch ${selectedProfileCapability.runtimeLabel}`
                      : (selectedProfileCapability?.unavailableReason ??
                        "Choose the profile used by new and split terminals")
                  }
                  className="h-6 max-w-[104px] rounded border border-workbench-border-strong bg-workbench-control px-1.5 text-[10px] text-workbench-text outline-none"
                >
                  {WORKBENCH_TERMINAL_PROFILES.map((profile) => {
                    const capability = profileCapability(profile.id);
                    const checking =
                      profile.id !== "shell" &&
                      profileCheck.status === "loading";
                    const unavailable =
                      capability?.available === false ||
                      (profile.id !== "shell" &&
                        profileCheck.status === "error");
                    return (
                      <option
                        key={profile.id}
                        value={profile.id}
                        disabled={checking || unavailable}
                        title={capability?.unavailableReason ?? undefined}
                      >
                        {profile.label}
                        {checking
                          ? " - checking"
                          : unavailable
                            ? " - unavailable"
                            : ""}
                      </option>
                    );
                  })}
                </select>
                <span
                  id={`${viewTabId}-profile-status`}
                  data-terminal-profile-status
                  title={
                    profileCheck.status === "error" ? profileCheck.error : ""
                  }
                  className={
                    profileCheck.status === "error"
                      ? "max-w-32 truncate px-1 text-[9.5px] text-workbench-error"
                      : "sr-only"
                  }
                >
                  {profileCheckLabel}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setProfileCheck({ status: "loading", error: null });
                    setProfileCheckVersion((version) => version + 1);
                  }}
                  disabled={profileCheck.status === "loading"}
                  aria-label="Refresh CLI profile detection"
                  aria-busy={profileCheck.status === "loading"}
                  title={
                    profileCheck.status === "error"
                      ? profileCheck.error
                      : "Refresh installed CLI profiles"
                  }
                  className={controlClass}
                >
                  <RefreshCw
                    aria-hidden
                    className={`size-3 ${
                      profileCheck.status === "loading"
                        ? "motion-safe:animate-spin"
                        : ""
                    }`}
                  />
                </button>
                <button
                  type="button"
                  onClick={addTerminal}
                  disabled={
                    !layout || atTerminalLimit || !selectedProfileLaunchable
                  }
                  aria-label="New terminal"
                  title={
                    atTerminalLimit
                      ? `Terminal limit reached (${MAX_WORKBENCH_TERMINALS_PER_WORKSPACE})`
                      : !selectedProfileLaunchable
                        ? (selectedProfileCapability?.unavailableReason ??
                          (isDesktopTerminal && !activeDesktopGrant
                            ? "Choose a writable workspace folder first."
                            : "This CLI profile is unavailable."))
                        : "New terminal"
                  }
                  className={controlClass}
                >
                  <Plus aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => splitTerminal("right")}
                  disabled={!layout || !selectedProfileLaunchable}
                  aria-label="Split terminal right"
                  title="Split terminal right"
                  className={controlClass}
                >
                  <PanelRight aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => splitTerminal("down")}
                  disabled={!layout || !selectedProfileLaunchable}
                  aria-label="Split terminal down"
                  title="Split terminal down"
                  className={controlClass}
                >
                  <PanelBottom aria-hidden className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => layout && closeTerminal(layout.activeId)}
                  disabled={!layout?.tabs.length}
                  aria-label="Close active terminal"
                  title="Close active terminal (Delete on a terminal tab)"
                  className={controlClass}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </button>{" "}
              </>
            )}
          </div>
        </div>
      ) : null}

      {panelNotice ? (
        <div
          role="alert"
          className="shrink-0 border-b border-workbench-error-border bg-workbench-error-surface px-3 py-1 text-[10px] text-workbench-error"
        >
          {panelNotice}
        </div>
      ) : null}

      {visibleView === "terminal" &&
      isDesktopTerminal &&
      launchProfile !== "shell" &&
      !activeDesktopGrant ? (
        <div className="flex shrink-0 items-center gap-3 border-b border-workbench-border bg-workbench-panel px-3 py-2 text-[10.5px] text-workbench-muted">
          <span className="min-w-0 flex-1">
            {desktopAccess.error ??
              "Choose a workspace folder to run Claude Code, Codex, or Grok locally."}
          </span>
          <button
            type="button"
            onClick={() => void desktopAccess.requestAccess(true)}
            disabled={desktopAccess.busyAction === "write"}
            className="inline-flex h-7 shrink-0 items-center rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-workbench-text transition-colors hover:bg-workbench-hover disabled:cursor-wait disabled:opacity-50 focus-visible:outline-none"
          >
            {desktopAccess.busyAction === "write"
              ? "Opening…"
              : "Choose workspace folder"}
          </button>
        </div>
      ) : null}

      <div
        id={`${viewTabId}-terminal-panel`}
        role="tabpanel"
        aria-labelledby={`${viewTabId}-terminal-tab`}
        className={
          visibleView === "terminal"
            ? "relative min-h-0 flex-1 overflow-hidden"
            : "hidden"
        }
      >
        {layout?.tabs.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-[13px] text-workbench-muted">
            <p>No terminal is running.</p>
            <button
              type="button"
              ref={startTerminalRef}
              onClick={addTerminal}
              disabled={!selectedProfileLaunchable}
              className="min-h-9 rounded-md border border-workbench-border px-3 py-1.5 text-workbench-text transition-colors hover:bg-workbench-hover disabled:opacity-40 [@media(pointer:coarse)]:min-h-11"
            >
              Start terminal
            </button>
          </div>
        ) : (shellStarted || visibleView === "terminal") && layout ? (
          <div
            className={`relative flex h-full min-h-0 min-w-0 ${
              layout.split?.direction === "down" ? "flex-col" : "flex-row"
            }`}
          >
            {layout.tabs.map((tab) => {
              const isPrimary = tab.clientTerminalId === layout.activeId;
              const isSecondary =
                tab.clientTerminalId === layout.split?.secondaryId;
              const isVisible = isPrimary || isSecondary;
              return (
                <div
                  key={tab.clientTerminalId}
                  id={`${viewTabId}-${tab.clientTerminalId}-panel`}
                  role="tabpanel"
                  aria-label={tab.label}
                  aria-hidden={!isVisible}
                  className={
                    isVisible
                      ? `relative min-h-0 min-w-0 flex-1 ${
                          isSecondary
                            ? layout.split?.direction === "down"
                              ? "border-t border-workbench-border"
                              : "border-l border-workbench-border"
                            : ""
                        }`
                      : "pointer-events-none invisible absolute inset-0"
                  }
                >
                  <WorkbenchInteractiveTerminal
                    compact={compact}
                    clientTerminalId={tab.clientTerminalId}
                    label={tab.label}
                    profile={tab.profile}
                    autoFocus={visibleView === "terminal" && isPrimary}
                    focusRequest={
                      terminalFocusRequest.clientTerminalId ===
                      tab.clientTerminalId
                        ? terminalFocusRequest.sequence
                        : 0
                    }
                    publishActivity={isPrimary}
                    desktopWorkspaceGrant={
                      isDesktopTerminal ? activeDesktopGrant : null
                    }
                    onSessionChange={handleSessionChange}
                    onConnectionChange={handleConnectionChange}
                  />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center px-3 text-[11px] text-workbench-faint">
            Restoring terminal layout…
          </div>
        )}
      </div>
      {views.includes("agent") && (
        <div
          id={`${viewTabId}-agent-panel`}
          role="tabpanel"
          aria-labelledby={`${viewTabId}-agent-tab`}
          className={visibleView === "agent" ? "min-h-0 flex-1" : "hidden"}
        >
          <RiftAgentConsole />
        </div>
      )}
    </div>
  );
}
