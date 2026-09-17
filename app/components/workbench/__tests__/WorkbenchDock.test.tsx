import React, { useReducer, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkbenchDock } from "../WorkbenchDock";
import type { WorkbenchDockController } from "@/app/hooks/useWorkbenchDock";
import type { CreateSubagentDraft } from "../../agent-activity";
import type { ChatStatus, SidebarContent } from "@/types/chat";
import {
  createInitialDockState,
  dockReducer,
  openContentTab,
  type DockAction,
  type DockTab,
  type DockTabKind,
} from "@/lib/workbench/dock-state";

const mockCounts: Record<string, { mounted: number; unmounted: number }> = {};
const mockQueueMessage = jest.fn(() => ({ accepted: true, id: "queued-test" }));
const mockSubmitMessage = jest.fn();
const mockOpenKind = jest.fn();
const mockOpenContent = jest.fn();
const mockSelectAgent = jest.fn();
const mockHide = jest.fn();
const mockDispatch = jest.fn();
let mockLiveContent: SidebarContent | null = null;
let mockChatMode = "agent";

const editedFile: SidebarContent = {
  path: "/project/app.ts",
  content: "new line",
  originalContent: "old line",
  modifiedContent: "new line",
  action: "editing",
  toolCallId: "write-one",
};

type BodyProps = {
  sidebarContent?: SidebarContent | null;
  active?: boolean;
  initialUrl?: string;
  selectedSubagentToolCallId?: string | null;
  onSelectSubagent?: (id: string) => void;
  onSelectExecution?: (content: SidebarContent) => void;
  onCreateSubagent?: (draft: CreateSubagentDraft) => void;
};

// Keep the real dock, reducer, menu and live-content resolution. Heavy panel
// bodies are lifetime-observable fixtures: no native webview, model or PTY.
jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => unknown) => {
    const source = loader.toString();
    const kind = source.includes("AgentActivityPanel")
      ? "activity"
      : source.includes("ComputerSidebar")
        ? "content"
        : source.includes("BuildPreviewPanel")
          ? "preview"
          : source.includes("WorkbenchBrowser")
            ? "browser"
            : "files";
    return function PanelFixture(props: BodyProps) {
      const ReactModule = require("react") as typeof React;
      ReactModule.useEffect(() => {
        mockCounts[kind] ??= { mounted: 0, unmounted: 0 };
        mockCounts[kind].mounted += 1;
        return () => {
          mockCounts[kind].unmounted += 1;
        };
      }, []);
      return (
        <div data-testid={`${kind}-body`} data-active={String(props.active)}>
          {kind === "browser" && (
            <input
              aria-label="Browser address"
              defaultValue={props.initialUrl}
            />
          )}
          {kind === "preview" && (
            <input aria-label="Preview note" defaultValue="" />
          )}
          {kind === "content" && (
            <output data-testid="resolved-content">
              {JSON.stringify(props.sidebarContent)}
            </output>
          )}
          {kind === "activity" && (
            <>
              <output aria-label="Selected agent">
                {props.selectedSubagentToolCallId ?? "none"}
              </output>
              <button onClick={() => props.onSelectSubagent?.("agent-one")}>
                Inspect agent
              </button>
              <button onClick={() => props.onSelectExecution?.(editedFile)}>
                Inspect edited file
              </button>
              {props.onCreateSubagent && (
                <button
                  onClick={() =>
                    props.onCreateSubagent?.({
                      name: "Verifier",
                      role: "reviewer",
                      task: "Check the changed file",
                    })
                  }
                >
                  Create agent
                </button>
              )}
              <textarea aria-label="Agent notes" />
              <textarea
                aria-label="Editor with its own Escape handler"
                onKeyDown={(event) => {
                  if (event.key === "Escape") event.preventDefault();
                }}
              />
            </>
          )}
        </div>
      );
    };
  },
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({
    selectedModel: "gpt-5.6-sol",
    chatMode: mockChatMode,
    queueMessage: mockQueueMessage,
  }),
}));
jest.mock("@/app/contexts/LiveSidebarContent", () => ({
  useLiveSidebarContent: () => mockLiveContent,
}));
jest.mock("@/lib/pricing/model-price", () => ({
  formatModelPrice: () => ({ input: "$1", output: "$2" }),
}));
jest.mock("@/lib/utils/submit-message", () => ({
  submitChatMessage: (message: string) => mockSubmitMessage(message),
}));

const browser: DockTab = {
  id: "browser-one",
  kind: "browser",
  title: "Browser",
  url: "https://example.test",
};
const preview: DockTab = { id: "preview", kind: "preview", title: "Preview" };
const activity: DockTab = {
  id: "activity",
  kind: "activity",
  title: "Activity",
};

function Harness({
  initialTabs = [browser, preview, activity],
  activeId = initialTabs[0]?.id,
  executions = [],
  status = "ready",
}: {
  initialTabs?: DockTab[];
  activeId?: string;
  executions?: SidebarContent[];
  status?: ChatStatus;
}) {
  const [state, baseDispatch] = useReducer(dockReducer, undefined, () => ({
    ...createInitialDockState(),
    tabs: initialTabs,
    activeTabId: activeId ?? null,
    visible: true,
  }));
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const dispatch = (action: DockAction) => {
    mockDispatch(action);
    baseDispatch(action);
  };
  const controller: WorkbenchDockController = {
    state,
    dispatch,
    selectedAgent,
    selectAgent: (value) => {
      mockSelectAgent(value);
      setSelectedAgent(value);
    },
    openKind: (kind: Exclude<DockTabKind, "content">) => {
      mockOpenKind(kind);
      dispatch({
        type: "open",
        tab: {
          id: kind === "browser" ? `browser-${state.tabs.length}` : kind,
          kind,
          title:
            kind === "browser"
              ? "New browser"
              : kind[0].toUpperCase() + kind.slice(1),
        },
      });
    },
    openContent: (content) => {
      mockOpenContent(content);
      dispatch({ type: "open", tab: openContentTab(content) });
    },
    select: (id) => dispatch({ type: "select", id }),
    close: (id) => dispatch({ type: "close", id }),
    hide: () => {
      mockHide();
      dispatch({ type: "hide" });
    },
    toggle: () => dispatch({ type: state.visible ? "hide" : "show" }),
  };
  return (
    <>
      <textarea aria-label="Chat composer" data-rift-composer />
      <button
        aria-controls="rift-build-tool-pane"
        onClick={() => dispatch({ type: "show" })}
      >
        Reopen workspace
      </button>
      <div
        data-testid="dock-container"
        hidden={!state.visible}
        inert={!state.visible}
      >
        <WorkbenchDock
          controller={controller}
          messages={[]}
          executions={executions}
          allExecutions={executions}
          todos={[]}
          status={status}
          chatId="chat-one"
        />
      </div>
    </>
  );
}

beforeAll(() => {
  // jsdom omits CSS.escape. Hex escaping is valid for the identifiers used here.
  if (!global.CSS)
    Object.defineProperty(global, "CSS", { value: {}, configurable: true });
  if (!CSS.escape)
    CSS.escape = (value: string) =>
      value.replace(
        /[^a-zA-Z0-9_-]/g,
        (character) => `\\${character.codePointAt(0)!.toString(16)} `,
      );
  Element.prototype.scrollIntoView ??= jest.fn();
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  for (const key of Object.keys(mockCounts)) delete mockCounts[key];
  mockLiveContent = null;
  mockChatMode = "agent";
});

describe("WorkbenchDock navigation and persistence", () => {
  it("finds an existing tab by typing and restores the picker trigger on Escape", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "Add workspace tab" });
    await user.click(trigger);
    const search = await screen.findByRole("combobox", {
      name: "Find workspace tab or tool",
    });
    expect(search).toHaveFocus();
    await user.type(search, "Preview");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mockOpenKind).not.toHaveBeenCalled();
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mockHide).not.toHaveBeenCalled();
  });

  it("shows an open-tab overview without losing panel drafts or remounting bodies", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const browserPanel = screen.getByRole("tabpanel", { name: "Browser" });
    const address = screen.getByRole("textbox", { name: "Browser address" });
    await user.clear(address);
    await user.type(address, "https://draft.example");
    const trigger = screen.getByRole("button", { name: "Show open tabs" });
    await user.click(trigger);
    const overview = screen.getByRole("region", { name: "Workspace overview" });
    expect(overview).toBeVisible();
    expect(browserPanel).not.toBeVisible();
    await user.click(
      within(overview).getByRole("button", { name: "Switch to Browser" }),
    );
    expect(
      screen.queryByRole("region", { name: "Workspace overview" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Browser address" }),
    ).toHaveValue("https://draft.example");
    expect(mockCounts.browser).toEqual({ mounted: 1, unmounted: 0 });
    await user.click(trigger);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(mockHide).not.toHaveBeenCalled();
  });

  it("offers only implemented add-menu destinations and activates the requested panel", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    screen.getByRole("button", { name: "Add workspace tab" }).focus();
    await user.keyboard("{Enter}");
    expect(
      await screen.findByRole("option", { name: "Changes" }),
    ).toBeInTheDocument();
    for (const name of ["Terminal", "Browser", "Files", "Activity"])
      expect(
        within(screen.getByRole("group", { name: "Tools" })).getByRole(
          "option",
          { name },
        ),
      ).toBeInTheDocument();
    expect(
      screen.queryByRole("option", { name: "Sidechat" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(screen.getByRole("group", { name: "Tools" })).getByRole("option", {
        name: "Files",
      }),
    );
    expect(mockOpenKind).toHaveBeenCalledWith("files");
    expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "Files" })).not.toHaveAttribute(
      "inert",
    );
  });

  it("selects and focuses tabs with arrows, Home and End", async () => {
    render(<Harness />);
    const first = screen.getByRole("tab", { name: "Browser" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    const second = screen.getByRole("tab", { name: "Preview" });
    await waitFor(() => expect(second).toHaveFocus());
    expect(second).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(second, { key: "End" });
    const last = screen.getByRole("tab", { name: "Activity" });
    await waitFor(() => expect(last).toHaveFocus());
    fireEvent.keyDown(last, { key: "ArrowRight" });
    await waitFor(() => expect(first).toHaveFocus());
    fireEvent.keyDown(first, { key: "ArrowLeft" });
    await waitFor(() => expect(last).toHaveFocus());
    fireEvent.keyDown(last, { key: "Home" });
    await waitFor(() => expect(first).toHaveFocus());
  });

  it("closes the active tab with Delete and moves selection and focus to its neighbor", async () => {
    render(<Harness activeId="preview" />);
    const selected = screen.getByRole("tab", { name: "Preview" });
    selected.focus();
    fireEvent.keyDown(selected, { key: "Delete" });
    expect(
      screen.queryByRole("tab", { name: "Preview" }),
    ).not.toBeInTheDocument();
    const neighbor = screen.getByRole("tab", { name: "Activity" });
    await waitFor(() => expect(neighbor).toHaveFocus());
    expect(neighbor).toHaveAttribute("aria-selected", "true");
  });

  it("closing a background tab preserves selection and returns focus to the selected tab", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Close Preview tab" }));
    const selected = screen.getByRole("tab", { name: "Browser" });
    expect(selected).toHaveAttribute("aria-selected", "true");
    await waitFor(() => expect(selected).toHaveFocus());
  });

  it("keeps browser and preview instances and user input across tab and layout changes", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const browserBody = screen.getByTestId("browser-body");
    const previewBody = screen.getByTestId("preview-body");
    const address = screen.getByLabelText("Browser address");
    fireEvent.change(address, {
      target: { value: "https://example.test/draft" },
    });
    await user.click(screen.getByRole("tab", { name: "Preview" }));
    const note = screen.getByLabelText("Preview note");
    fireEvent.change(note, { target: { value: "Unsaved preview state" } });
    expect(browserBody.closest('[role="tabpanel"]')).toHaveAttribute("hidden");
    expect(browserBody.closest('[role="tabpanel"]')).toHaveAttribute("inert");
    await user.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(mockDispatch).toHaveBeenCalledWith({ type: "maximize" });
    await user.click(screen.getByRole("button", { name: "Add workspace tab" }));
    await user.click(
      within(screen.getByRole("group", { name: "Layout" })).getByRole(
        "option",
        { name: "Dock panel below" },
      ),
    );
    expect(mockDispatch).toHaveBeenCalledWith({
      type: "placement",
      placement: "bottom",
    });
    expect(
      screen.getByRole("button", { name: "Restore panel" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add workspace tab" }));
    expect(
      within(screen.getByRole("group", { name: "Layout" })).getByRole(
        "option",
        { name: "Dock panel on right" },
      ),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("tab", { name: "Browser" }));
    expect(address).toHaveValue("https://example.test/draft");
    expect(note).toHaveValue("Unsaved preview state");
    expect(screen.getByTestId("browser-body")).toBe(browserBody);
    expect(screen.getByTestId("preview-body")).toBe(previewBody);
    expect(mockCounts.browser).toEqual({ mounted: 1, unmounted: 0 });
    expect(mockCounts.preview).toEqual({ mounted: 1, unmounted: 0 });
  });

  it("hides and makes all bodies inert without unmounting opened content", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const bodies = screen.getAllByRole("tabpanel", { hidden: true });
    await user.click(
      screen.getByRole("button", { name: "Hide workspace panel" }),
    );
    expect(mockHide).toHaveBeenCalledTimes(1);
    for (const body of bodies) expect(body).toHaveAttribute("inert");
    expect(screen.getByTestId("dock-container")).toHaveAttribute("hidden");
    await user.click(screen.getByRole("button", { name: "Reopen workspace" }));
    expect(screen.getByRole("tab", { name: "Browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(mockCounts.browser).toEqual({ mounted: 1, unmounted: 0 });
  });

  it("links accessible tabs and panels even when stable content identity contains spaces or selector characters", async () => {
    const unusual: DockTab = {
      ...browser,
      id: 'file:/project/a b["quoted"].ts',
      title: "Special file",
    };
    render(<Harness initialTabs={[unusual, activity]} />);
    const tab = screen.getByRole("tab", { name: "Special file" });
    const controlId = tab.getAttribute("aria-controls")!;
    expect(controlId).not.toMatch(/\s/);
    expect(document.getElementById(controlId)).toHaveAttribute(
      "role",
      "tabpanel",
    );
    expect(
      screen.getByRole("tabpanel", { name: "Special file" }),
    ).toHaveAttribute("aria-labelledby", tab.id);
    fireEvent.keyDown(screen.getByRole("tab", { name: "Activity" }), {
      key: "Home",
    });
    await waitFor(() => expect(tab).toHaveFocus());
  });

  it("does not hide the dock when a nested editor has already handled Escape", () => {
    render(<Harness initialTabs={[activity]} />);
    const editor = screen.getByLabelText("Editor with its own Escape handler");
    editor.focus();
    fireEvent.keyDown(editor, { key: "Escape" });
    expect(mockHide).not.toHaveBeenCalled();
    expect(editor).toHaveFocus();
  });

  it("does not dismiss an editable textarea on Escape", () => {
    render(<Harness initialTabs={[activity]} />);
    const notes = screen.getByLabelText("Agent notes");
    notes.focus();
    fireEvent.keyDown(notes, { key: "Escape" });
    expect(mockHide).not.toHaveBeenCalled();
  });

  it("returns focus to the panel toggle after Escape hides the dock", async () => {
    render(<Harness />);
    const tab = screen.getByRole("tab", { name: "Browser" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "Escape" });
    expect(mockHide).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reopen workspace" }),
      ).toHaveFocus(),
    );
    expect(screen.getByTestId("dock-container")).toHaveAttribute("hidden");
  });

  it("returns focus outside the dock when its last tab is closed", async () => {
    render(<Harness initialTabs={[browser]} />);
    const tab = screen.getByRole("tab", { name: "Browser" });
    tab.focus();
    fireEvent.keyDown(tab, { key: "Delete" });
    expect(
      screen.queryByRole("tab", { name: "Browser" }),
    ).not.toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reopen workspace" }),
      ).toHaveFocus(),
    );
    expect(screen.getByTestId("dock-container")).toHaveAttribute("hidden");
  });

  it("disables adding an eighth browser without disabling the other destinations", async () => {
    const user = userEvent.setup();
    const tabs = Array.from({ length: 7 }, (_, index) => ({
      ...browser,
      id: `browser-${index}`,
    }));
    render(<Harness initialTabs={tabs} />);
    screen.getByRole("button", { name: "Add workspace tab" }).focus();
    await user.keyboard("{Enter}");
    const item = within(screen.getByRole("group", { name: "Tools" })).getByRole(
      "option",
      { name: "Browser" },
    );
    expect(item).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByRole("group", { name: "Tools" })).getByRole("option", {
        name: "Terminal",
      }),
    ).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(mockOpenKind).not.toHaveBeenCalled();
  });

  it("keeps panel IDs distinct when the same tab exists in two dock instances", () => {
    render(
      <>
        <Harness initialTabs={[browser]} />
        <Harness initialTabs={[browser]} />
      </>,
    );
    const tabs = screen.getAllByRole("tab", { name: "Browser" });
    expect(tabs[0].id).not.toBe(tabs[1].id);
    const ids = tabs.map((tab) => tab.getAttribute("aria-controls"));
    expect(ids[0]).not.toBe(ids[1]);
    for (const tab of tabs)
      expect(
        document.getElementById(tab.getAttribute("aria-controls")!),
      ).toHaveAttribute("aria-labelledby", tab.id);
  });
});

describe("WorkbenchDock content actions", () => {
  it("opens the actual changed execution from Review and distinguishes an unknown diff", async () => {
    const user = userEvent.setup();
    const unknown: SidebarContent = {
      ...editedFile,
      path: "/project/unknown.ts",
      toolCallId: "write-two",
      diffUnavailable: true,
    };
    render(
      <Harness
        initialTabs={[{ id: "review", kind: "review", title: "Review" }]}
        executions={[editedFile, unknown]}
      />,
    );
    const review = screen.getByRole("region", { name: "Review changes" });
    expect(within(review).getByText("Diff unavailable")).toBeInTheDocument();
    await user.click(
      within(review).getByRole("button", {
        name: "Review /project/app.ts",
        exact: true,
      }),
    );
    await user.click(
      within(review).getByRole("button", {
        name: "Open /project/app.ts in editor",
      }),
    );
    expect(mockOpenContent).toHaveBeenCalledWith(editedFile);
    expect(screen.getByRole("tab", { name: "app.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      JSON.parse(screen.getByTestId("resolved-content").textContent!),
    ).toEqual(editedFile);
  });

  it("shows an honest empty Review rather than inventing repository changes", () => {
    render(
      <Harness
        initialTabs={[{ id: "review", kind: "review", title: "Review" }]}
      />,
    );
    expect(screen.getByText("No changes yet")).toBeInTheDocument();
    expect(
      screen.getByText("Files edited in this conversation will appear here."),
    ).toBeInTheDocument();
  });

  it("resolves matching live output but does not replace a selected file with another tool's output", () => {
    mockLiveContent = { ...editedFile, content: "live completed output" };
    const view = render(<Harness initialTabs={[openContentTab(editedFile)]} />);
    expect(
      JSON.parse(screen.getByTestId("resolved-content").textContent!).content,
    ).toBe("live completed output");
    mockLiveContent = {
      ...editedFile,
      toolCallId: "unrelated-tool",
      content: "unrelated output",
    };
    view.rerender(<Harness initialTabs={[openContentTab(editedFile)]} />);
    expect(
      JSON.parse(screen.getByTestId("resolved-content").textContent!),
    ).toEqual(editedFile);
  });

  it("wires agent selection and explicit activity execution navigation", async () => {
    const user = userEvent.setup();
    render(<Harness initialTabs={[activity]} />);
    await user.click(screen.getByRole("button", { name: "Inspect agent" }));
    expect(mockSelectAgent).toHaveBeenCalledWith("agent-one");
    expect(screen.getByLabelText("Selected agent")).toHaveTextContent(
      "agent-one",
    );
    await user.click(
      screen.getByRole("button", { name: "Inspect edited file" }),
    );
    expect(mockOpenContent).toHaveBeenCalledWith(editedFile);
    expect(screen.getByRole("tab", { name: "app.ts" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("queues agent creation during streaming and submits only when idle", async () => {
    const user = userEvent.setup();
    const view = render(
      <Harness initialTabs={[activity]} status="streaming" />,
    );
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    expect(mockQueueMessage).toHaveBeenCalledWith(
      expect.stringContaining("Verifier"),
    );
    expect(mockSubmitMessage).not.toHaveBeenCalled();
    view.rerender(<Harness initialTabs={[activity]} status="ready" />);
    await user.click(screen.getByRole("button", { name: "Create agent" }));
    expect(mockSubmitMessage).toHaveBeenCalledWith(
      expect.stringContaining("Check the changed file"),
    );
    mockChatMode = "ask";
    view.rerender(<Harness initialTabs={[activity]} />);
    expect(
      screen.queryByRole("button", { name: "Create agent" }),
    ).not.toBeInTheDocument();
  });
});

describe("WorkbenchDock selected tab reveal", () => {
  let stripWidth = 200;
  let resizeObservers: Array<{ callback: () => void; disconnected: boolean }>;
  let originalResizeObserver: typeof ResizeObserver;
  let originalScrollTo: typeof HTMLElement.prototype.scrollTo;
  let scroll: jest.Mock;

  beforeEach(() => {
    stripWidth = 200;
    resizeObservers = [];
    originalResizeObserver = global.ResizeObserver;
    originalScrollTo = HTMLElement.prototype.scrollTo;
    global.ResizeObserver = class {
      entry: { callback: () => void; disconnected: boolean };
      constructor(callback: () => void) {
        this.entry = { callback, disconnected: false };
        resizeObservers.push(this.entry);
      }
      observe() {}
      unobserve() {}
      disconnect() {
        this.entry.disconnected = true;
      }
    } as unknown as typeof ResizeObserver;
    scroll = jest.fn(function (this: HTMLElement, options: ScrollToOptions) {
      this.scrollLeft = options.left ?? this.scrollLeft;
    });
    HTMLElement.prototype.scrollTo = scroll;
    jest
      .spyOn(Element.prototype, "clientWidth", "get")
      .mockImplementation(function (this: Element) {
        return this.getAttribute("role") === "tablist" ? stripWidth : 0;
      });
    jest
      .spyOn(Element.prototype, "scrollWidth", "get")
      .mockImplementation(function (this: Element) {
        return this.getAttribute("role") === "tablist"
          ? this.children.length * 120
          : 0;
      });
    jest
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        let left = 100;
        let width = 0;
        if (this.getAttribute("role") === "tablist") width = stripWidth;
        else {
          const strip = this.closest<HTMLElement>('[role="tablist"]');
          const wrapper =
            this.parentElement?.getAttribute("role") === "tablist"
              ? this
              : this.parentElement;
          if (strip && wrapper) {
            left +=
              Array.from(strip.children).indexOf(wrapper) * 120 -
              strip.scrollLeft;
            width = this.getAttribute("role") === "tab" ? 90 : 120;
          }
        }
        return {
          x: left,
          y: 40,
          left,
          right: left + width,
          top: 40,
          bottom: 68,
          width,
          height: 28,
          toJSON: () => ({}),
        };
      });
  });
  afterEach(() => {
    jest.restoreAllMocks();
    global.ResizeObserver = originalResizeObserver;
    HTMLElement.prototype.scrollTo = originalScrollTo;
  });

  it("reveals externally selected content including its close button without stealing focus or scrolling the document", () => {
    const documentScroll = jest
      .spyOn(window, "scrollTo")
      .mockImplementation(() => {});
    const scrollIntoView = jest
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(() => {});
    render(<Harness initialTabs={[activity, browser, preview]} />);
    const composer = screen.getByRole("textbox", { name: "Chat composer" });
    composer.focus();
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect edited file" }),
    );
    const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
    const selected = screen.getByRole("tab", { name: "app.ts" }).parentElement!;
    expect(strip.scrollLeft).toBe(280);
    expect(selected.getBoundingClientRect().left).toBeGreaterThanOrEqual(
      strip.getBoundingClientRect().left,
    );
    expect(selected.getBoundingClientRect().right).toBeLessThanOrEqual(
      strip.getBoundingClientRect().right,
    );
    expect(
      within(selected).getByRole("button", { name: "Close app.ts tab" }),
    ).toBeVisible();
    expect(scroll).toHaveBeenLastCalledWith({ left: 280, behavior: "smooth" });
    expect(composer).toHaveFocus();
    expect(documentScroll).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("reveals new browser tabs created through the add menu", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Add workspace tab" }));
    await user.click(
      within(screen.getByRole("group", { name: "Tools" })).getByRole("option", {
        name: "Browser",
      }),
    );
    const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
    expect(screen.getByRole("tab", { name: "New browser" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(strip.scrollLeft).toBe(280);
  });

  it("reveals keyboard-selected tabs immediately even when motion is enabled", () => {
    render(
      <Harness
        initialTabs={[activity, browser, preview]}
        activeId="activity"
      />,
    );
    const first = screen.getByRole("tab", { name: "Activity" });
    fireEvent.keyDown(first, { key: "End" });
    expect(scroll).toHaveBeenLastCalledWith({ left: 160, behavior: "auto" });
  });

  it("reveals on resize and reopen with reduced motion and keeps keyboard focus scrolling contained", async () => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    jest
      .spyOn(window, "matchMedia")
      .mockReturnValue({ ...media, matches: true });
    const focus = jest.spyOn(HTMLElement.prototype, "focus");
    render(<Harness activeId="activity" />);
    const strip = screen.getByRole("tablist", { name: "Workspace tabs" });
    expect(strip.scrollLeft).toBe(160);
    expect(scroll).toHaveBeenLastCalledWith({ left: 160, behavior: "auto" });
    stripWidth = 150;
    act(() =>
      resizeObservers
        .filter((entry) => !entry.disconnected)
        .forEach((entry) => entry.callback()),
    );
    expect(strip.scrollLeft).toBe(210);
    fireEvent.click(
      screen.getByRole("button", { name: "Hide workspace panel" }),
    );
    strip.scrollLeft = 0;
    act(() =>
      resizeObservers
        .filter((entry) => !entry.disconnected)
        .forEach((entry) => entry.callback()),
    );
    expect(strip.scrollLeft).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Reopen workspace" }));
    expect(strip.scrollLeft).toBe(210);
    const selected = screen.getByRole("tab", { name: "Activity" });
    fireEvent.keyDown(selected, { key: "Home" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Browser" })).toHaveFocus(),
    );
    expect(strip.scrollLeft).toBe(0);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });
});
