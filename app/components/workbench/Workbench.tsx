"use client";

import { RootShellPresence } from "@/app/components/RootShellPresence";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Files,
  GitBranch,
  Menu,
  PanelLeft,
  PanelRight,
  Plus,
  Save,
  Search,
  Settings,
  Terminal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { RiftBrandLockup } from "@/components/icons/rift-brand-lockup";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useHydrated } from "@/app/hooks/useHydrated";
import {
  getWorkspaceModeLabel,
  ProTitlebarModelMenu,
} from "@/app/components/pro/ProTitlebarModelMenu";
import { openCommandPalette } from "@/lib/utils/command-palette";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import { getEffectiveBuildModel } from "@/types/chat";
import { useWorkbench } from "./WorkbenchProvider";
import { useWorkbenchActivity } from "./WorkbenchActivity";
import { WorkbenchChanges } from "./WorkbenchChanges";
import { WorkbenchExplorer } from "./WorkbenchExplorer";
import { WorkbenchTerminalPanel } from "./WorkbenchTerminalPanel";

import {
  WorkbenchMobileNavigationContext,
  useOptionalMobileNavigation,
  type WorkbenchMobileSurface,
} from "./WorkbenchMobileNavigation";

const MOBILE_SURFACE_LABELS: Record<WorkbenchMobileSurface, string> = {
  agent: "Agent",
  terminal: "Terminal",
  files: "Files",
  changes: "Changes",
  editor: "Editor",
};

function Root({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const [mobileSurface, setMobileSurface] =
    useState<WorkbenchMobileSurface>("agent");

  return (
    <WorkbenchMobileNavigationContext
      value={{ surface: mobileSurface, setSurface: setMobileSurface }}
    >
      <div className="contents" data-workbench-color-scheme="adaptive">
        <div
          data-pro-workbench
          data-rift-workspace
          data-workbench-surface="graphite"
          data-mobile-workbench-surface={mobileSurface}
          data-terminal-fullscreen={state.terminalFullscreen || undefined}
          className="pro-shell relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-workbench-canvas text-[13px] text-workbench-text"
        >
          <RootShellPresence kind="pro" />
          <RootShellPresence kind="workspace" />
          <div
            className="pro-shell-bg pointer-events-none absolute inset-0"
            aria-hidden
          />
          {children}
        </div>
      </div>
    </WorkbenchMobileNavigationContext>
  );
}

function Titlebar() {
  const router = useRouter();
  const { openSettings } = useSettingsNavigation();
  const { state, actions } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const { initializeNewChat, closeSidebar } = useGlobalState();
  const { goHome } = useChatNavigation();
  const activeDocument = state.activePath
    ? state.documents[state.activePath]
    : null;
  const dirty = Boolean(
    activeDocument && activeDocument.content !== activeDocument.savedContent,
  );

  const newChat = () => {
    if (!actions.confirmNavigation()) return;
    closeSidebar();
    initializeNewChat();
    goHome();
  };

  const buttonClass =
    "flex size-7 items-center justify-center rounded-md text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <>
      <header
        data-testid="workbench-mobile-titlebar"
        data-rift-native-titlebar="workbench-mobile"
        data-tauri-drag-region
        aria-hidden={state.terminalFullscreen}
        className={`pro-titlebar relative z-20 h-12 shrink-0 items-center border-b border-workbench-border bg-workbench-canvas px-1.5 lg:hidden ${
          state.terminalFullscreen ? "hidden" : "flex"
        }`}
      >
        <button
          type="button"
          onClick={() => {
            if (actions.confirmNavigation()) router.push("/");
          }}
          aria-label="Back to RIFT home"
          title="Back to RIFT home"
          className="flex size-11 touch-manipulation items-center justify-center rounded-md text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none motion-reduce:transition-none"
        >
          <ArrowLeft aria-hidden className="size-4" />
        </button>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-2">
          <RiftBrandLockup
            markSize={23}
            textSize={14}
            gap={7}
            markClassName="opacity-90"
            textClassName="text-workbench-text"
          />
          <span aria-hidden className="text-workbench-faint">
            /
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-workbench-muted">
            {mobileNavigation
              ? MOBILE_SURFACE_LABELS[mobileNavigation.surface]
              : "Workspace"}
          </span>
        </div>
        <span aria-hidden className="size-11 shrink-0" />
      </header>

      <header
        data-testid="workbench-titlebar"
        data-rift-native-titlebar="workbench"
        data-tauri-drag-region
        aria-hidden={state.terminalFullscreen}
        className={`pro-titlebar relative z-20 h-[35px] shrink-0 items-center gap-2 border-b border-workbench-border bg-workbench-canvas px-2.5 pl-[58px] md:pl-[72px] ${
          state.terminalFullscreen ? "hidden" : "hidden lg:flex"
        }`}
      >
        <button
          type="button"
          onClick={actions.toggleSidebar}
          aria-label="Toggle workspace sidebar"
          aria-pressed={state.sidebarOpen}
          title="Toggle workspace sidebar (⌘B)"
          className={buttonClass}
        >
          <PanelLeft className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            if (actions.confirmNavigation()) router.push("/");
          }}
          aria-label="Back to RIFT home"
          title="Back to RIFT home"
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
        >
          <ArrowLeft aria-hidden className="size-3.5" />
          <span className="hidden text-[13px] font-medium md:inline">Home</span>
        </button>

        <div className="flex min-w-0 items-center gap-2">
          <RiftBrandLockup
            markSize={23}
            textSize={14}
            gap={8}
            markClassName="opacity-90"
            textClassName="hidden text-foreground sm:inline"
          />
          <span className="hidden text-muted-foreground/35 sm:inline">/</span>
          <span className="max-w-[220px] truncate font-mono text-[12px] text-muted-foreground">
            {state.activePath || "agent workbench"}
          </span>
          <ProTitlebarModelMenu />
        </div>

        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => openCommandPalette()}
            aria-label="Open command palette"
            title="Command palette (⌘K)"
            className={buttonClass}
          >
            <Search className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            title="New chat (⌘N)"
            className={buttonClass}
          >
            <Plus className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void actions.saveActiveDocument()}
            disabled={!dirty || activeDocument?.status !== "ready"}
            aria-label="Save active file"
            title="Save active file (⌘S)"
            className={buttonClass}
          >
            <Save className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={actions.toggleBottomPanel}
            aria-label="Toggle terminal panel"
            aria-pressed={state.bottomPanelOpen}
            title="Toggle terminal panel (⌘J)"
            className={`${buttonClass} ${
              state.bottomPanelOpen
                ? "bg-workbench-active text-workbench-text"
                : ""
            }`}
          >
            <Terminal className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={actions.toggleAgentPane}
            aria-label="Toggle agent pane"
            aria-pressed={state.agentPaneOpen}
            title="Toggle agent pane"
            className={`${buttonClass} hidden lg:flex ${
              state.agentPaneOpen
                ? "bg-workbench-active text-workbench-text"
                : ""
            }`}
          >
            <PanelRight className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => openSettings()}
            aria-label="Settings"
            title="Settings (⌘,)"
            className={buttonClass}
          >
            <Settings className="size-3.5" />
          </button>
        </div>
      </header>
    </>
  );
}

function Body({ children }: { children: ReactNode }) {
  return (
    <div
      data-pro-workbench-body
      className="relative z-10 flex min-h-0 min-w-0 flex-1 overscroll-contain"
    >
      <div className="pro-workspace flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {children}
      </div>
    </div>
  );
}

function ActivityRail() {
  const { state, actions } = useWorkbench();
  const { terminal } = useWorkbenchActivity();
  const activityClass =
    "relative flex h-10 w-full items-center justify-center border-l-2 text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none focus-visible:bg-muted disabled:cursor-not-allowed disabled:opacity-30";

  return (
    <nav
      aria-label="Workbench activity"
      aria-hidden={state.terminalFullscreen}
      className={`w-10 shrink-0 flex-col border-r border-workbench-border bg-workbench-canvas ${
        state.terminalFullscreen ? "hidden lg:hidden" : "hidden lg:flex"
      }`}
    >
      <button
        type="button"
        onClick={() => actions.selectSidebarView("explorer")}
        aria-label="Explorer"
        aria-pressed={state.sidebarView === "explorer" && state.sidebarOpen}
        title="Explorer"
        className={`${activityClass} ${
          state.sidebarView === "explorer" && state.sidebarOpen
            ? "border-workbench-muted bg-workbench-active text-workbench-text"
            : "border-transparent"
        }`}
      >
        <Files className="size-4" strokeWidth={1.7} />
      </button>
      <button
        type="button"
        onClick={() => actions.selectSidebarView("changes")}
        aria-label="Changes"
        aria-pressed={state.sidebarView === "changes" && state.sidebarOpen}
        title="Changes"
        className={`${activityClass} ${
          state.sidebarView === "changes" && state.sidebarOpen
            ? "border-workbench-muted bg-workbench-active text-workbench-text"
            : "border-transparent"
        }`}
      >
        <GitBranch className="size-4" strokeWidth={1.7} />
        {state.git.status?.fileStatus.length ? (
          <span className="absolute right-0.5 top-0.5 min-w-4 rounded-md bg-workbench-active px-0.5 text-center font-mono text-[11px] text-[var(--pro-text-secondary)]">
            {Math.min(state.git.status.fileStatus.length, 99)}
            {state.git.truncated ? "+" : ""}
          </span>
        ) : null}
      </button>
      <div className="mt-auto border-t border-workbench-border">
        <button
          type="button"
          onClick={actions.toggleBottomPanel}
          aria-label="Terminal panel"
          aria-pressed={state.bottomPanelOpen}
          title="Terminal panel (⌘J)"
          className={`${activityClass} ${
            state.bottomPanelOpen
              ? "border-workbench-muted bg-workbench-active text-workbench-text"
              : "border-transparent"
          }`}
        >
          <Terminal className="size-4" strokeWidth={1.7} />
          {terminal?.isExecuting ? (
            <span className="absolute right-1 top-1 size-1.5 rounded-full bg-workbench-success" />
          ) : null}
        </button>
        <button
          type="button"
          onClick={actions.toggleAgentPane}
          aria-label="Agent pane"
          aria-pressed={state.agentPaneOpen}
          title="Agent pane"
          className={`${activityClass} ${
            state.agentPaneOpen
              ? "border-workbench-muted bg-workbench-active text-workbench-text"
              : "border-transparent"
          }`}
        >
          <Bot className="size-4" strokeWidth={1.7} />
        </button>
      </div>
    </nav>
  );
}

function Sidebar({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const mobileSidebarVisible =
    mobileNavigation?.surface === "files" ||
    mobileNavigation?.surface === "changes";

  if (!state.sidebarOpen && !mobileSidebarVisible) return null;

  return (
    <aside
      id="workbench-mobile-sidebar"
      data-workbench-mobile-sidebar
      aria-hidden={
        state.terminalFullscreen ||
        (!mobileSidebarVisible && !state.sidebarOpen)
      }
      className={`pro-sidebar h-full min-w-0 flex-1 shrink-0 overflow-hidden bg-workbench-panel lg:w-[232px] lg:flex-none lg:border-r lg:border-workbench-border ${
        state.terminalFullscreen
          ? "hidden lg:hidden"
          : `${mobileSidebarVisible ? "flex" : "hidden"} ${
              state.sidebarOpen ? "lg:block" : "lg:hidden"
            }`
      }`}
    >
      {children}
    </aside>
  );
}

function SidebarContent() {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const visibleView =
    mobileNavigation?.surface === "changes"
      ? "changes"
      : mobileNavigation?.surface === "files"
        ? "explorer"
        : state.sidebarView;

  return visibleView === "changes" ? (
    <WorkbenchChanges />
  ) : (
    <WorkbenchExplorer />
  );
}

function EditorGroup({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const mobileGroupVisible = mobileNavigation
    ? mobileNavigation.surface === "terminal" ||
      mobileNavigation.surface === "editor"
    : state.bottomPanelOpen;

  return (
    <main
      data-terminal-fullscreen={state.terminalFullscreen || undefined}
      className={`pro-main min-h-0 flex-1 flex-col overflow-hidden bg-workbench-canvas ${
        state.terminalFullscreen
          ? "flex min-w-0"
          : `min-w-0 lg:min-w-[300px] lg:flex ${
              mobileGroupVisible ? "flex" : "hidden"
            }`
      }`}
    >
      {children}
    </main>
  );
}

function EditorPane({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const mobileEditorVisible = mobileNavigation?.surface === "editor";
  return (
    <div
      aria-hidden={state.terminalFullscreen}
      className={
        state.terminalFullscreen
          ? "hidden lg:hidden"
          : `${mobileEditorVisible ? "flex" : "hidden"} min-h-0 min-w-0 flex-1 flex-col lg:flex`
      }
    >
      {children}
    </div>
  );
}

function BottomPanel({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const mobileTerminalVisible = mobileNavigation
    ? mobileNavigation.surface === "terminal"
    : state.bottomPanelOpen;

  return (
    <section
      id="workbench-mobile-terminal"
      aria-label="Workbench terminal"
      aria-hidden={
        !state.terminalFullscreen &&
        !mobileTerminalVisible &&
        !state.bottomPanelOpen
      }
      data-terminal-fullscreen={state.terminalFullscreen || undefined}
      className={
        state.terminalFullscreen
          ? "flex min-h-0 flex-1 flex-col bg-workbench-terminal"
          : `min-h-0 flex-1 flex-col bg-workbench-terminal ${
              mobileTerminalVisible ? "flex" : "hidden"
            } ${
              state.bottomPanelOpen
                ? "lg:flex lg:h-[clamp(190px,32vh,360px)] lg:flex-none lg:border-t lg:border-workbench-border"
                : "lg:hidden"
            }`
      }
    >
      {children}
    </section>
  );
}

function AgentTerminal() {
  return <WorkbenchTerminalPanel />;
}

function AgentPane({ children }: { children: ReactNode }) {
  const { state } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const mobileAgentVisible = mobileNavigation
    ? mobileNavigation.surface === "agent"
    : !state.bottomPanelOpen;

  return (
    <section
      id="workbench-mobile-agent"
      data-workbench-agent-pane
      aria-label="RIFT agent"
      aria-hidden={state.terminalFullscreen}
      className={`min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-workbench-canvas lg:min-w-[360px] lg:max-w-[540px] lg:flex-none lg:basis-[40%] lg:border-l lg:border-workbench-border ${
        state.terminalFullscreen
          ? "hidden lg:hidden"
          : `${mobileAgentVisible ? "flex" : "hidden"} ${
              state.agentPaneOpen ? "lg:flex" : "lg:hidden"
            }`
      }`}
    >
      {children}
    </section>
  );
}

const MOBILE_PRIMARY_SURFACES: Array<{
  surface: WorkbenchMobileSurface;
  label: string;
  icon: typeof Bot;
  controls: string;
}> = [
  {
    surface: "agent",
    label: "Agent",
    icon: Bot,
    controls: "workbench-mobile-agent",
  },
  {
    surface: "terminal",
    label: "Terminal",
    icon: Terminal,
    controls: "workbench-mobile-terminal",
  },
  {
    surface: "files",
    label: "Files",
    icon: Files,
    controls: "workbench-mobile-sidebar",
  },
  {
    surface: "changes",
    label: "Changes",
    icon: GitBranch,
    controls: "workbench-mobile-sidebar",
  },
];

function MobileNavigation() {
  const mobileNavigation = useOptionalMobileNavigation();
  const { openSettings } = useSettingsNavigation();
  const { state, actions } = useWorkbench();
  const { initializeNewChat, closeSidebar } = useGlobalState();
  const { goHome } = useChatNavigation();
  const activeDocument = state.activePath
    ? state.documents[state.activePath]
    : null;
  const dirty = Boolean(
    activeDocument && activeDocument.content !== activeDocument.savedContent,
  );

  if (!mobileNavigation) return null;

  const selectSurface = (surface: WorkbenchMobileSurface) => {
    mobileNavigation.setSurface(surface);

    if (surface === "files") {
      actions.selectSidebarView("explorer");
    } else if (surface === "changes") {
      actions.selectSidebarView("changes");
    } else if (surface === "terminal") {
      actions.openBottomPanel();
    } else if (!state.agentPaneOpen) {
      actions.toggleAgentPane();
    }
  };

  const newChat = () => {
    if (!actions.confirmNavigation()) return;
    closeSidebar();
    initializeNewChat();
    goHome();
  };

  const mobileControlClass =
    "flex min-h-11 min-w-0 touch-manipulation flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[10.5px] font-medium leading-none transition-colors duration-(--duration-hover) focus-visible:outline-none motion-reduce:transition-none";
  const menuItemClass =
    "min-h-11 cursor-pointer rounded-md px-3 text-[13px] text-workbench-muted focus:bg-workbench-hover focus:text-workbench-text";

  return (
    <nav
      data-workbench-mobile-navigation
      aria-label="Mobile workspace surfaces"
      aria-hidden={state.terminalFullscreen}
      className={`relative z-20 w-full min-w-0 shrink-0 grid-cols-5 gap-2 border-t border-workbench-border bg-workbench-canvas px-2 pt-1.5 lg:hidden ${
        state.terminalFullscreen ? "hidden" : "grid"
      }`}
      style={{
        paddingBottom: "max(env(safe-area-inset-bottom), 0.375rem)",
      }}
    >
      {MOBILE_PRIMARY_SURFACES.map((item) => {
        const active =
          mobileNavigation.surface === item.surface ||
          (item.surface === "files" && mobileNavigation.surface === "editor");
        const Icon = item.icon;
        return (
          <button
            key={item.surface}
            type="button"
            data-workbench-mobile-control
            data-mobile-surface-target={item.surface}
            aria-controls={item.controls}
            aria-current={active ? "page" : undefined}
            aria-pressed={active}
            onClick={() => selectSurface(item.surface)}
            className={`${mobileControlClass} ${
              active
                ? "bg-workbench-active text-workbench-text"
                : "text-workbench-muted hover:bg-workbench-hover hover:text-workbench-text"
            }`}
          >
            <Icon aria-hidden className="size-4" strokeWidth={1.7} />
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-workbench-mobile-control
            aria-label="More workspace actions"
            className={`${mobileControlClass} text-workbench-muted hover:bg-workbench-hover hover:text-workbench-text data-[state=open]:bg-workbench-active data-[state=open]:text-workbench-text`}
          >
            <Menu aria-hidden className="size-4" strokeWidth={1.7} />
            <span>More</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="pro-dropdown w-[320px] max-w-[calc(100vw-16px)] border-workbench-border bg-workbench-panel p-1.5 shadow-xl"
        >
          <DropdownMenuLabel className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-workbench-faint">
            Workspace actions
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem
              onSelect={() => openCommandPalette()}
              className={menuItemClass}
            >
              <Search aria-hidden />
              Search and commands
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={newChat} className={menuItemClass}>
              <Plus aria-hidden />
              New chat
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!dirty || activeDocument?.status !== "ready"}
              onSelect={() => void actions.saveActiveDocument()}
              className={menuItemClass}
            >
              <Save aria-hidden />
              Save active file
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => openSettings()}
              className={menuItemClass}
            >
              <Settings aria-hidden />
              Settings
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator className="bg-workbench-border" />
          <DropdownMenuLabel className="px-3 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-workbench-faint">
            Desktop split layout
          </DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuCheckboxItem
              checked={state.sidebarOpen}
              onCheckedChange={() => actions.toggleSidebar()}
              className={menuItemClass}
            >
              <PanelLeft aria-hidden />
              Files sidebar
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={state.bottomPanelOpen}
              onCheckedChange={() => actions.toggleBottomPanel()}
              className={menuItemClass}
            >
              <Terminal aria-hidden />
              Terminal split
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={state.agentPaneOpen}
              onCheckedChange={() => actions.toggleAgentPane()}
              className={menuItemClass}
            >
              <PanelRight aria-hidden />
              Agent split
            </DropdownMenuCheckboxItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </nav>
  );
}

function StatusBar() {
  const hydrated = useHydrated();
  const { state, meta } = useWorkbench();
  const { terminal, interactiveTerminal } = useWorkbenchActivity();
  const { chatMode, selectedModel } = useGlobalState();
  const buildModel = getEffectiveBuildModel(selectedModel);
  const activeDocument = state.activePath
    ? state.documents[state.activePath]
    : null;
  const dirty = Boolean(
    activeDocument && activeDocument.content !== activeDocument.savedContent,
  );
  const cliLabel = terminal?.isExecuting
    ? "runner active"
    : interactiveTerminal === "connected"
      ? "CLI connected"
      : interactiveTerminal === "error"
        ? "CLI issue"
        : interactiveTerminal === "exited"
          ? "CLI exited"
          : interactiveTerminal === "restarting"
            ? "CLI restarting"
            : "CLI connecting";
  const cliHasIssue =
    interactiveTerminal === "error" || interactiveTerminal === "exited";

  return (
    <footer
      aria-hidden={state.terminalFullscreen}
      className={`pro-status-bar relative z-20 h-[22px] shrink-0 items-center gap-2 border-t border-workbench-border bg-workbench-canvas px-2.5 font-mono text-[11px] text-workbench-muted ${
        state.terminalFullscreen ? "hidden" : "hidden lg:flex"
      }`}
    >
      <RiftBrandLockup
        markSize={13}
        textSize={11}
        gap={4}
        markClassName="text-foreground/75"
        textClassName="text-[var(--pro-text-secondary)]"
      />
      {state.git.status ? (
        <span className="flex min-w-0 items-center gap-1">
          <GitBranch className="size-3" />
          <span className="max-w-28 truncate">
            {state.git.status.currentBranch || "detached"}
          </span>
          {state.git.status.fileStatus.length ? (
            <span className="text-[var(--pro-text-muted)]">
              {state.git.status.fileStatus.length} change
              {state.git.status.fileStatus.length === 1 ? "" : "s"}
              {state.git.truncated ? "+" : ""}
            </span>
          ) : null}
        </span>
      ) : null}
      {state.activePath ? (
        <span className="hidden min-w-0 items-center gap-1.5 border-l border-workbench-border pl-2 sm:flex">
          <span className="max-w-52 truncate">{state.activePath}</span>
          {activeDocument?.status === "saving" ? (
            <span className="text-[var(--pro-text-muted)]">saving</span>
          ) : dirty ? (
            <span className="text-[var(--pro-text-muted)]">modified</span>
          ) : null}
        </span>
      ) : null}
      <span className="ml-auto hidden md:inline">{meta.workspaceLabel}</span>
      <span className="hidden border-l border-workbench-border pl-2 md:inline">
        {getWorkspaceModeLabel(hydrated ? chatMode : "ask")} /{" "}
        {hydrated ? buildModel.model : "GPT-5.6 Sol"}
      </span>
      <span
        data-workbench-cli-status
        className={`border-l border-workbench-border pl-2 font-medium ${
          cliHasIssue ? "text-workbench-error" : "text-workbench-muted"
        }`}
      >
        {cliLabel}
      </span>
    </footer>
  );
}

export const Workbench = {
  Root,
  Titlebar,
  Body,
  ActivityRail,
  Sidebar,
  SidebarContent,
  EditorGroup,
  EditorPane,
  BottomPanel,
  AgentTerminal,
  AgentPane,
  MobileNavigation,
  StatusBar,
};
