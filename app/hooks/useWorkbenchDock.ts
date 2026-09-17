"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { v4 as uuid } from "uuid";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  createInitialDockState,
  dockReducer,
  openContentTab,
  type DockTab,
  type DockTabKind,
} from "@/lib/workbench/dock-state";
import {
  OPEN_AGENT_ACTIVITY_EVENT,
  OPEN_WORKBENCH_EVENT,
} from "@/lib/workbench/events";
import type { SidebarContent } from "@/types/chat";

export function useWorkbenchDock(chatId: string, enabled: boolean) {
  const global = useGlobalState();
  const {
    sidebarOpen,
    sidebarContent,
    buildPreviewOpen,
    buildPreviewUrl,
    terminalDockOpen,
    setSidebarOpen,
    setSidebarContent,
    setBuildPreviewOpen,
    setTerminalDockOpen,
  } = global;
  const [state, dispatch] = useReducer(
    dockReducer,
    undefined,
    createInitialDockState,
  );
  const [agentSelection, setAgentSelection] = useState<{
    chatId: string;
    id: string | null;
  }>({ chatId, id: null });
  const selectedAgent =
    agentSelection.chatId === chatId ? agentSelection.id : null;
  const selectAgent = useCallback(
    (id: string | null) => setAgentSelection({ chatId, id }),
    [chatId],
  );
  const stateRef = useRef(state);
  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);
  const previousChat = useRef(chatId);

  const syncLegacy = useCallback(
    (tab: DockTab | undefined) => {
      setSidebarOpen(!!tab && ["activity", "content"].includes(tab.kind));
      if (tab?.kind === "activity") setSidebarContent(null);
      if (tab?.content) setSidebarContent(tab.content);
      setBuildPreviewOpen(tab?.kind === "preview");
      setTerminalDockOpen(tab?.kind === "terminal");
    },
    [
      setSidebarOpen,
      setSidebarContent,
      setBuildPreviewOpen,
      setTerminalDockOpen,
    ],
  );

  const open = useCallback(
    (tab: DockTab) => {
      dispatch({ type: "open", tab });
      syncLegacy(tab);
    },
    [syncLegacy],
  );
  const openKind = useCallback(
    (kind: Exclude<DockTabKind, "content">) => {
      if (kind === "preview" && !buildPreviewUrl) return;
      if (
        kind === "browser" &&
        stateRef.current.tabs.filter((tab) => tab.kind === "browser").length >=
          7
      )
        return;
      if (kind === "terminal")
        dispatch({ type: "placement", placement: "right" });
      open({
        id: kind === "browser" ? uuid() : kind,
        kind,
        title: {
          activity: "Activity",
          browser: "New tab",
          preview: "Preview",
          terminal: "Terminal",
          files: "Files",
          review: "Review",
        }[kind],
        ...(kind === "preview" ? { url: buildPreviewUrl ?? undefined } : {}),
      });
    },
    [buildPreviewUrl, open],
  );
  const openContent = useCallback(
    (content: SidebarContent) => open(openContentTab(content)),
    [open],
  );
  const hide = useCallback(() => {
    dispatch({ type: "hide" });
    syncLegacy(undefined);
  }, [syncLegacy]);
  const select = useCallback(
    (id: string) => {
      const tab = stateRef.current.tabs.find((item) => item.id === id);
      if (!tab) return;
      dispatch({ type: "select", id });
      syncLegacy(tab);
    },
    [syncLegacy],
  );
  const close = useCallback(
    (id: string) => {
      const next = dockReducer(stateRef.current, { type: "close", id });
      dispatch({ type: "close", id });
      syncLegacy(
        next.visible
          ? next.tabs.find((tab) => tab.id === next.activeTabId)
          : undefined,
      );
    },
    [syncLegacy],
  );
  const toggle = useCallback(() => {
    if (stateRef.current.visible) hide();
    else {
      const next = dockReducer(stateRef.current, { type: "show" });
      dispatch({ type: "show" });
      syncLegacy(next.tabs.find((tab) => tab.id === next.activeTabId));
    }
  }, [hide, syncLegacy]);

  // Legacy entry points remain usable. Content updates for the same tool only
  // update its snapshot; they never steal focus from another tab.
  const lastContent = useRef<string | null>(null);
  const wasSidebarOpen = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    const tab = sidebarContent
      ? openContentTab(sidebarContent)
      : { id: "activity", kind: "activity" as const, title: "Activity" };
    if (sidebarOpen) {
      if (!wasSidebarOpen.current || lastContent.current !== tab.id)
        dispatch({ type: "open", tab });
    }
    // Update already-open background tabs too, without activating them.
    if (tab.content)
      dispatch({
        type: "update",
        id: tab.id,
        updates: { content: tab.content },
      });
    wasSidebarOpen.current = sidebarOpen;
    lastContent.current = tab.id;
  }, [enabled, sidebarOpen, sidebarContent]);
  useEffect(() => {
    if (enabled && buildPreviewOpen && buildPreviewUrl)
      dispatch({
        type: "open",
        tab: {
          id: "preview",
          kind: "preview",
          title: "Preview",
          url: buildPreviewUrl,
        },
      });
  }, [enabled, buildPreviewOpen, buildPreviewUrl]);
  useEffect(() => {
    if (!enabled) return;
    if (terminalDockOpen) {
      dispatch({ type: "placement", placement: "right" });
      dispatch({
        type: "open",
        tab: { id: "terminal", kind: "terminal", title: "Terminal" },
      });
      setBuildPreviewOpen(false);
      setSidebarOpen(false);
    } else if (
      stateRef.current.visible &&
      stateRef.current.tabs.find(
        (tab) => tab.id === stateRef.current.activeTabId,
      )?.kind === "terminal"
    ) {
      // The global shortcut closes the active terminal pane too, while keeping
      // its tab and live session available for the next open gesture.
      dispatch({ type: "hide" });
    }
  }, [enabled, terminalDockOpen, setBuildPreviewOpen, setSidebarOpen]);

  useEffect(() => {
    if (previousChat.current === chatId) return;
    previousChat.current = chatId;
    dispatch({ type: "clear" });
    lastContent.current = null;
    wasSidebarOpen.current = false;
  }, [chatId]);
  useEffect(() => {
    if (!enabled) return;
    const onAgent = (
      event: WindowEventMap[typeof OPEN_AGENT_ACTIVITY_EVENT],
    ) => {
      selectAgent(event.detail?.toolCallId ?? null);
      openKind("activity");
    };
    const onOpen = (event: WindowEventMap[typeof OPEN_WORKBENCH_EVENT]) =>
      openKind(event.detail.kind);
    const onContent = (event: Event) =>
      openContent((event as CustomEvent<SidebarContent>).detail);
    const maximize = () => dispatch({ type: "maximize" });
    window.addEventListener(OPEN_AGENT_ACTIVITY_EVENT, onAgent);
    window.addEventListener(OPEN_WORKBENCH_EVENT, onOpen);
    window.addEventListener("rift:open-workbench-content", onContent);
    window.addEventListener("rift:hide-workbench", hide);
    window.addEventListener("rift:maximize-workbench", maximize);
    return () => {
      window.removeEventListener(OPEN_AGENT_ACTIVITY_EVENT, onAgent);
      window.removeEventListener(OPEN_WORKBENCH_EVENT, onOpen);
      window.removeEventListener("rift:open-workbench-content", onContent);
      window.removeEventListener("rift:hide-workbench", hide);
      window.removeEventListener("rift:maximize-workbench", maximize);
    };
  }, [enabled, hide, openContent, openKind, selectAgent]);
  return {
    state,
    dispatch,
    openKind,
    openContent,
    select,
    close,
    hide,
    toggle,
    selectedAgent,
    selectAgent,
  };
}

export type WorkbenchDockController = ReturnType<typeof useWorkbenchDock>;
