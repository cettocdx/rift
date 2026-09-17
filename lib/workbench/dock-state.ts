import {
  isSidebarFile,
  isSidebarNotes,
  isSidebarProxy,
  isSidebarSharedFiles,
  isSidebarTerminal,
  isSidebarWebSearch,
  type SidebarContent,
} from "@/types/chat";

export type DockTabKind =
  | "activity"
  | "content"
  | "browser"
  | "preview"
  | "terminal"
  | "review"
  | "files";
export type DockPlacement = "right" | "bottom";

/** Store selected snapshots here, never subscribe this state to live output chunks. */
export interface DockTab {
  id: string;
  kind: DockTabKind;
  title: string;
  content?: SidebarContent;
  url?: string;
}

export interface DockState {
  tabs: DockTab[];
  activeTabId: string | null;
  visible: boolean;
  placement: DockPlacement;
  maximized: boolean;
}

export type DockAction =
  | { type: "open"; tab: DockTab }
  | { type: "select"; id: string }
  | { type: "close"; id: string }
  | { type: "hide" }
  | { type: "show" }
  | { type: "placement"; placement: DockPlacement }
  | { type: "maximize"; maximized?: boolean }
  | {
      type: "update";
      id: string;
      updates: Partial<Pick<DockTab, "title" | "content" | "url">>;
    }
  | { type: "clear" };

const SINGLETON_KINDS = new Set<DockTabKind>([
  "activity",
  "files",
  "terminal",
  "preview",
  "review",
]);

export function createInitialDockState(): DockState {
  return {
    tabs: [],
    activeTabId: null,
    visible: false,
    placement: "right",
    maximized: false,
  };
}

/** Pure UI state only. Closing a tab never executes terminal or network cleanup. */
export function dockReducer(state: DockState, action: DockAction): DockState {
  switch (action.type) {
    case "open": {
      const tab = SINGLETON_KINDS.has(action.tab.kind)
        ? { ...action.tab, id: action.tab.kind }
        : action.tab;
      if (!tab.id) return state;
      const existing = state.tabs.findIndex((item) => item.id === tab.id);
      return {
        ...state,
        tabs:
          existing < 0
            ? [...state.tabs, tab]
            : state.tabs.map((item, index) =>
                index === existing ? { ...item, ...tab } : item,
              ),
        activeTabId: tab.id,
        visible: true,
      };
    }
    case "select":
      return state.tabs.some((tab) => tab.id === action.id)
        ? { ...state, activeTabId: action.id, visible: true }
        : state;
    case "close": {
      const index = state.tabs.findIndex((tab) => tab.id === action.id);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== action.id);
      const activeTabId =
        state.activeTabId === action.id
          ? ((tabs[index] ?? tabs[index - 1])?.id ?? null)
          : state.activeTabId;
      return {
        ...state,
        tabs,
        activeTabId: tabs.length ? activeTabId : null,
        visible: tabs.length > 0 && state.visible,
        maximized: tabs.length > 0 && state.maximized,
      };
    }
    case "hide":
      return state.visible ? { ...state, visible: false } : state;
    case "show":
      return state.tabs.length
        ? {
            ...state,
            visible: true,
            activeTabId: state.activeTabId ?? state.tabs[0].id,
          }
        : dockReducer(state, {
            type: "open",
            tab: { id: "activity", kind: "activity", title: "Activity" },
          });
    case "placement":
      return { ...state, placement: action.placement };
    case "maximize":
      return { ...state, maximized: action.maximized ?? !state.maximized };
    case "update":
      return state.tabs.some((tab) => tab.id === action.id)
        ? {
            ...state,
            tabs: state.tabs.map((tab) =>
              tab.id === action.id ? { ...tab, ...action.updates } : tab,
            ),
          }
        : state;
    case "clear":
      // Placement is a layout preference; transcript snapshots belong to a chat.
      return { ...createInitialDockState(), placement: state.placement };
  }
}

/** Build a stable content tab at the explicit open gesture, not on each stream chunk. */
export function openContentTab(content: SidebarContent): DockTab {
  let title = "Activity detail";
  let fallback = "detail";
  if (isSidebarFile(content)) {
    title = content.path.split(/[\\/]/).filter(Boolean).pop() || "File";
    fallback = `file:${content.path}`;
  } else if (isSidebarProxy(content)) {
    title = `Proxy · ${content.proxyAction}`;
    fallback = `proxy:${content.proxyAction}:${content.command}`;
  } else if (isSidebarTerminal(content)) {
    title = content.command.trim() || "Terminal output";
    fallback = `terminal:${content.session ?? content.command}`;
  } else if (isSidebarWebSearch(content)) {
    title = content.query.trim() || "Search results";
    fallback = `search:${content.query}`;
  } else if (isSidebarNotes(content)) {
    title = content.affectedTitle || "Notes";
    fallback = `notes:${content.action}:${content.newNoteId ?? content.affectedTitle ?? ""}`;
  } else if (isSidebarSharedFiles(content)) {
    title = "Shared files";
    fallback = `shared:${JSON.stringify(content.requestedPaths)}`;
  }
  const toolCallId = "toolCallId" in content && content.toolCallId;
  return {
    id:
      typeof toolCallId === "string" && toolCallId
        ? `content:${toolCallId}`
        : `content:fallback:${fallback}`,
    kind: "content",
    title,
    content,
  };
}
