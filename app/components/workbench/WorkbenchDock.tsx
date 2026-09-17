"use client";
import { useAuth } from "@/app/hooks/useAuth";
import { getAccountPricingMargin } from "@/lib/billing/account-pricing";

import { getMaxTokensForSubscription } from "@/lib/token-limits";

import dynamic from "next/dynamic";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  ChevronsRight,
  List,
  File,
  FileDiff,
  Folder,
  Globe,
  Maximize2,
  Minimize2,
  PanelBottom,
  PanelRight,
  Plus,
  SquareTerminal,
  UsersRound,
  X,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
  CommandEmpty,
} from "@/components/ui/command";
import { useLiveSidebarContent } from "@/app/contexts/LiveSidebarContent";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { getEffectiveBuildModel } from "@/types/chat";
import { formatModelPrice } from "@/lib/pricing/model-price";
import { submitChatMessage } from "@/lib/utils/submit-message";
import { resolveLiveSidebarContent } from "@/lib/workbench/live-content";
import {
  getPerFileDiffStats,
  buildSubagentPrompt,
  canCreateSubagentInMode,
  type AgentActivityMessage,
} from "../agent-activity";
import type { WorkbenchDockController } from "@/app/hooks/useWorkbenchDock";
import type { ChatStatus, SidebarContent, Todo } from "@/types/chat";
import styles from "./WorkbenchDock.module.css";
import { WorkbenchConversationChanges } from "./WorkbenchConversationChanges";
import { WorkbenchBoundary } from "./WorkbenchBoundary";

const Activity = dynamic(() =>
  import("../AgentActivityPanel").then((module) => module.AgentActivityPanel),
);
const Detail = dynamic(() =>
  import("../ComputerSidebar").then((module) => module.ComputerSidebarBase),
);
const Preview = dynamic(() =>
  import("../BuildPreviewPanel").then((module) => module.BuildPreviewPanel),
);
const Browser = dynamic(() =>
  import("./WorkbenchBrowser").then((module) => module.WorkbenchBrowser),
);
const Files = dynamic(() =>
  import("../pro/HomeWorkspacePane").then((module) => module.HomeWorkspacePane),
);

const icons = {
  activity: UsersRound,
  content: File,
  browser: Globe,
  preview: Globe,
  terminal: SquareTerminal,
  files: Folder,
  review: FileDiff,
};

function ContentTab({
  content,
  messages,
  executions,
  onOpen,
  onClose,
}: {
  content: SidebarContent;
  messages: AgentActivityMessage[];
  executions: readonly SidebarContent[];
  onOpen: (content: SidebarContent) => void;
  onClose: () => void;
}) {
  const live = useLiveSidebarContent();
  const resolved = useMemo(
    () => resolveLiveSidebarContent(content, live),
    [content, live],
  );
  return (
    <Detail
      embedded
      sidebarOpen
      sidebarContent={resolved}
      messages={messages}
      navigationExecutions={executions}
      onNavigate={onOpen}
      closeSidebar={onClose}
    />
  );
}

export function WorkbenchDock({
  controller,
  messages,
  executions,
  allExecutions,
  historyTodos,
  todos,
  status,
  chatId,
  title,
  previewStatusLine,
}: {
  controller: WorkbenchDockController;
  messages: AgentActivityMessage[];
  executions: readonly SidebarContent[];
  allExecutions: readonly SidebarContent[];
  todos: readonly Todo[];
  historyTodos?: readonly Todo[];
  status: ChatStatus;
  chatId: string;
  title?: string;
  previewStatusLine?: string | null;
}) {
  const {
    state,
    dispatch,
    select,
    close,
    hide,
    openKind,
    openContent,
    selectedAgent,
    selectAgent,
  } = controller;
  const root = useRef<HTMLDivElement>(null);
  const [overviewChat, setOverviewChat] = useState<string | null>(null);
  const overviewOpen = overviewChat === chatId;
  const overviewTrigger = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (overviewOpen) {
      // WebKit does not focus buttons on pointer click. Move into the shelf so
      // Escape and keyboard navigation work immediately after opening it.
      root.current
        ?.querySelector<HTMLButtonElement>(
          "[data-workspace-overview] li button",
        )
        ?.focus();
    }
  }, [overviewOpen]);
  const closeOverview = () => {
    setOverviewChat(null);
    requestAnimationFrame(() => overviewTrigger.current?.focus());
  };
  const revealTab = (id: string) => {
    setOverviewChat(null);
    select(id);
  };
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerInput = useRef<HTMLInputElement>(null);
  const [previewToolbar, setPreviewToolbar] = useState<HTMLDivElement | null>(
    null,
  );
  const previewActive =
    !overviewOpen &&
    state.tabs.some(
      (tab) => tab.id === state.activeTabId && tab.kind === "preview",
    );
  const tabStrip = useRef<HTMLDivElement>(null);
  const keyboardNavigation = useRef(false);
  useLayoutEffect(() => {
    const strip = tabStrip.current;
    if (!strip || !state.visible) return;
    // Measure the wrapper, not just the role=tab button: its sibling close
    // control must stay reachable too. Never scroll an ancestor/document.
    const selected = strip.querySelector<HTMLElement>(
      '[role="tab"][aria-selected="true"]',
    )?.parentElement;
    if (!selected) return;
    let disposed = false;
    const reveal = (behavior: ScrollBehavior) => {
      if (disposed || strip.clientWidth <= 0) return;
      const viewport = strip.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      const left = viewport.left + strip.clientLeft;
      const right = left + strip.clientWidth;
      const delta =
        tab.width > strip.clientWidth
          ? // Extremely narrow docks cannot fit a full tab; keep close visible.
            tab.right - right
          : tab.left < left
            ? tab.left - left
            : tab.right > right
              ? tab.right - right
              : 0;
      const target = Math.max(
        0,
        Math.min(
          strip.scrollWidth - strip.clientWidth,
          strip.scrollLeft + delta,
        ),
      );
      if (Math.abs(target - strip.scrollLeft) > 0.5)
        strip.scrollTo({ left: target, behavior });
    };
    reveal(
      keyboardNavigation.current ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    );
    keyboardNavigation.current = false;
    const onResize = () => reveal("auto");
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(onResize);
    observer?.observe(strip);
    observer?.observe(selected);
    window.addEventListener("resize", onResize);
    return () => {
      disposed = true;
      observer?.disconnect();
      window.removeEventListener("resize", onResize);
    };
  }, [
    state.activeTabId,
    state.visible,
    state.tabs,
    state.placement,
    state.maximized,
  ]);
  const dockId = useId();
  const tabDomId = (id: string) => `${dockId}-tab-${encodeURIComponent(id)}`;
  const bodyDomId = (id: string) => `${dockId}-body-${encodeURIComponent(id)}`;
  const hidePanel = () => {
    hide();
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>(
          'button[aria-controls="rift-build-tool-pane"]',
        )
        ?.focus(),
    );
  };
  const {
    selectedModel,
    subscription,
    chatPurpose,
    hasPaidContext,
    chatMode,
    queueMessage,
  } = useGlobalState();
  const { user: pricingUser } = useAuth();
  const changes = useMemo(
    () => getPerFileDiffStats(allExecutions),
    [allExecutions],
  );
  const browserCount = state.tabs.filter(
    (tab) => tab.kind === "browser",
  ).length;
  const focusTab = (id: string) =>
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[role="tab"][data-tab-id="${CSS.escape(id)}"]`,
        )
        ?.focus({ preventScroll: true }),
    );
  const closeTab = (id: string) => {
    const index = state.tabs.findIndex((tab) => tab.id === id);
    const neighbor = state.tabs[index + 1] ?? state.tabs[index - 1];
    close(id);
    if (state.activeTabId !== id && state.activeTabId)
      focusTab(state.activeTabId);
    else if (neighbor) focusTab(neighbor.id);
    else
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>(
            'button[aria-controls="rift-build-tool-pane"]',
          )
          ?.focus(),
      );
  };
  const navigateTabs = (event: KeyboardEvent, index: number) => {
    let next: number | null = null;
    if (event.key === "ArrowRight") next = (index + 1) % state.tabs.length;
    if (event.key === "ArrowLeft")
      next = (index + state.tabs.length - 1) % state.tabs.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = state.tabs.length - 1;
    if (event.key === "Delete") {
      event.preventDefault();
      keyboardNavigation.current = true;
      closeTab(state.tabs[index].id);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      keyboardNavigation.current = true;
      revealTab(state.tabs[next].id);
      focusTab(state.tabs[next].id);
    }
  };
  return (
    <div
      ref={root}
      className={styles.dock}
      data-ui="workbench-dock"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !(
            event.target instanceof HTMLElement &&
            event.target.closest(
              'input, textarea, [contenteditable="true"], [role="combobox"]',
            )
          )
        ) {
          event.stopPropagation();
          if (overviewOpen) closeOverview();
          else hidePanel();
        }
      }}
    >
      <header className={styles.toolbar} data-preview-toolbar={previewActive}>
        <div
          ref={tabStrip}
          className={styles.tabs}
          role="tablist"
          aria-label="Workspace tabs"
        >
          {state.tabs.map((tab, index) => {
            const Icon = icons[tab.kind];
            const active = state.activeTabId === tab.id;
            return (
              <div className={styles.tab} data-active={active} key={tab.id}>
                <button
                  role="tab"
                  type="button"
                  data-tab-id={tab.id}
                  id={tabDomId(tab.id)}
                  aria-label={tab.title}
                  aria-selected={active}
                  aria-controls={bodyDomId(tab.id)}
                  tabIndex={active ? 0 : -1}
                  onClick={() => revealTab(tab.id)}
                  onKeyDown={(event) => navigateTabs(event, index)}
                  title={tab.title}
                >
                  <Icon aria-hidden />
                  <span>{tab.title}</span>
                </button>
                <button
                  className={styles.closeTab}
                  type="button"
                  aria-label={`Close ${tab.title} tab`}
                  title={`Close ${tab.title}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => closeTab(tab.id)}
                >
                  <X aria-hidden />
                </button>
              </div>
            );
          })}
        </div>
        <div
          ref={setPreviewToolbar}
          className={styles.previewToolbar}
          hidden={!previewActive}
        />
        <div className={styles.controls}>
          <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Add workspace tab"
                title="Open tabs and tools"
              >
                <Plus aria-hidden />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className={styles.addMenu}
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                pickerInput.current?.focus();
              }}
              onEscapeKeyDown={(event) => event.stopPropagation()}
            >
              <Command loop label="Find workspace tab or tool">
                <CommandInput
                  ref={pickerInput}
                  className="focus-visible:outline-none"
                  aria-label="Find workspace tab or tool"
                  placeholder="Find a tab or tool…"
                />
                <CommandList>
                  <CommandEmpty>No matching tabs or tools.</CommandEmpty>
                  <CommandGroup heading="Open tabs">
                    {state.tabs.map((tab) => {
                      const Icon = icons[tab.kind];
                      return (
                        <CommandItem
                          key={tab.id}
                          value={`tab ${tab.id}`}
                          keywords={[
                            tab.title,
                            tab.kind,
                            tab.content && "path" in tab.content
                              ? tab.content.path
                              : "",
                            tab.url ?? "",
                          ]}
                          onSelect={() => {
                            revealTab(tab.id);
                            setPickerOpen(false);
                          }}
                        >
                          <Icon aria-hidden strokeWidth={1.6} />
                          <span className={styles.pickerLabel}>
                            {tab.title}
                          </span>
                          {state.activeTabId === tab.id && (
                            <span className={styles.pickerCurrent}>
                              Current
                            </span>
                          )}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                  <CommandGroup heading="Tools">
                    {(
                      [
                        ["files", "Files", Folder],
                        ["terminal", "Terminal", SquareTerminal],
                        ["browser", "Browser", Globe],
                        ["review", "Changes", FileDiff],
                        ["activity", "Activity", UsersRound],
                      ] as const
                    ).map(([kind, label, Icon]) => (
                      <CommandItem
                        key={kind}
                        value={`tool ${label}`}
                        disabled={kind === "browser" && browserCount >= 7}
                        onSelect={() => {
                          setOverviewChat(null);
                          openKind(kind);
                          setPickerOpen(false);
                        }}
                      >
                        <Icon aria-hidden strokeWidth={1.6} />
                        {label}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  <CommandGroup heading="Layout">
                    <CommandItem
                      onSelect={() => {
                        dispatch({
                          type: "placement",
                          placement:
                            state.placement === "right" ? "bottom" : "right",
                        });
                        setPickerOpen(false);
                      }}
                    >
                      <PanelBottom aria-hidden strokeWidth={1.6} />
                      {state.placement === "right"
                        ? "Dock panel below"
                        : "Dock panel on right"}
                    </CommandItem>
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
          <button
            type="button"
            className={styles.iconButton}
            aria-label={state.maximized ? "Restore panel" : "Expand panel"}
            title={state.maximized ? "Restore panel" : "Expand panel"}
            onClick={() => dispatch({ type: "maximize" })}
          >
            {state.maximized ? <Minimize2 /> : <Maximize2 />}
          </button>
          <button
            type="button"
            ref={overviewTrigger}
            className={styles.iconButton}
            aria-label={overviewOpen ? "Show selected panel" : "Show open tabs"}
            aria-expanded={overviewOpen}
            aria-controls={`${dockId}-overview`}
            title={overviewOpen ? "Show selected panel" : "Open tabs"}
            onClick={() => setOverviewChat(overviewOpen ? null : chatId)}
          >
            {overviewOpen ? <ChevronsRight /> : <List />}
          </button>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Hide workspace panel"
            title="Hide panel"
            onClick={hidePanel}
          >
            <PanelRight />
          </button>
        </div>
      </header>
      <div className={styles.bodies}>
        {overviewOpen && (
          <section
            id={`${dockId}-overview`}
            className={styles.overview}
            aria-label="Workspace overview"
            data-workspace-overview
          >
            <div className={styles.overviewHeading}>
              <h3>Open tabs</h3>
              <button
                type="button"
                className={styles.iconButton}
                aria-label="Return to selected panel"
                onClick={closeOverview}
              >
                <ChevronsRight aria-hidden />
              </button>
            </div>
            <ul aria-label="Open workspace tabs">
              {state.tabs.map((tab) => {
                const Icon = icons[tab.kind];
                return (
                  <li key={tab.id} data-active={state.activeTabId === tab.id}>
                    <button
                      type="button"
                      aria-label={`Switch to ${tab.title}`}
                      aria-current={
                        state.activeTabId === tab.id ? "page" : undefined
                      }
                      title={tab.title}
                      onClick={() => revealTab(tab.id)}
                    >
                      <Icon aria-hidden />
                      <span>{tab.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <h3 className={styles.overviewSection}>Workspace</h3>
            <ul aria-label="Workspace tools">
              {(
                [
                  ["review", "Changes", FileDiff],
                  ["browser", "Browser", Globe],
                  ["terminal", "Terminal", SquareTerminal],
                  ["files", "Files", Folder],
                  ["activity", "Activity", UsersRound],
                ] as const
              ).map(([kind, label, Icon]) => (
                <li key={kind}>
                  <button
                    type="button"
                    disabled={kind === "browser" && browserCount >= 7}
                    onClick={() => {
                      setOverviewChat(null);
                      openKind(kind);
                    }}
                  >
                    <Icon aria-hidden />
                    <span>{label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {state.tabs.map((tab) => {
          const active =
            state.visible && !overviewOpen && state.activeTabId === tab.id;
          return (
            <section
              key={tab.id}
              id={bodyDomId(tab.id)}
              role="tabpanel"
              aria-labelledby={tabDomId(tab.id)}
              hidden={overviewOpen || state.activeTabId !== tab.id}
              inert={!active}
              className={styles.tabBody}
            >
              <WorkbenchBoundary>
                {tab.kind === "activity" && (
                  <Activity
                    todos={todos}
                    historyTodos={historyTodos}
                    toolExecutions={executions}
                    messages={messages}
                    status={status}
                    selectedSubagentToolCallId={selectedAgent}
                    onSelectSubagent={selectAgent}
                    onSelectExecution={openContent}
                    contextWindowTokens={getMaxTokensForSubscription(
                      subscription,
                      {
                        model: selectedModel,
                        purpose: chatPurpose,
                        hasPaidContext,
                      },
                    )}
                    modelPrice={formatModelPrice(
                      getEffectiveBuildModel(selectedModel).providerKey,
                      getAccountPricingMargin({ email: pricingUser?.email }),
                    )}
                    onCreateSubagent={
                      canCreateSubagentInMode(chatMode)
                        ? (draft) => {
                            const prompt = buildSubagentPrompt(draft);
                            if (
                              status === "streaming" ||
                              status === "submitted"
                            )
                              return queueMessage(prompt).accepted;
                            else submitChatMessage(prompt);
                          }
                        : undefined
                    }
                  />
                )}
                {tab.kind === "content" && tab.content && (
                  <ContentTab
                    content={tab.content}
                    messages={messages}
                    executions={allExecutions}
                    onOpen={openContent}
                    onClose={() => closeTab(tab.id)}
                  />
                )}
                {tab.kind === "browser" && (
                  <Browser
                    initialUrl={tab.url}
                    active={active}
                    onTitleChange={(next) => {
                      if (next !== tab.title)
                        dispatch({
                          type: "update",
                          id: tab.id,
                          updates: { title: next },
                        });
                    }}
                  />
                )}
                {tab.kind === "preview" && (
                  <Preview
                    toolbarTarget={active ? previewToolbar : null}
                    embedded
                    active={active}
                    chatId={chatId}
                    title={title}
                    statusLine={previewStatusLine}
                    onShowActivity={() => openKind("activity")}
                  />
                )}
                {tab.kind === "files" && (
                  <Files onClose={() => closeTab(tab.id)} loadOnOpen />
                )}
                {tab.kind === "terminal" && (
                  <div
                    data-rift-terminal-host
                    data-active={active ? "true" : "false"}
                    data-maximized={state.maximized ? "true" : "false"}
                    className={styles.terminalHost}
                  />
                )}
                {tab.kind === "review" && (
                  <WorkbenchConversationChanges
                    changes={changes}
                    onOpen={openContent}
                  />
                )}
              </WorkbenchBoundary>
            </section>
          );
        })}
      </div>
    </div>
  );
}
