import {
  createInitialDockState,
  dockReducer,
  openContentTab,
  type DockTab,
} from "../dock-state";
import {
  OPEN_AGENT_ACTIVITY_EVENT,
  OPEN_WORKBENCH_EVENT,
  openAgentActivity,
  openWorkbench,
} from "../events";

const browser = (id: string): DockTab => ({
  id,
  kind: "browser",
  title: "Browser",
  url: "https://example.test",
});
const file = (toolCallId = "write-1") => ({
  path: "/root/project/app.ts",
  content: "const a = 1",
  action: "editing" as const,
  toolCallId,
});

describe("workbench dock state", () => {
  it("starts hidden without retained content", () => {
    expect(createInitialDockState()).toEqual({
      tabs: [],
      activeTabId: null,
      visible: false,
      placement: "right",
      maximized: false,
    });
  });

  it("opens content and activates it, then reuses its stable tool identity", () => {
    const tab = openContentTab(file());
    const first = dockReducer(createInitialDockState(), { type: "open", tab });
    const second = dockReducer(first, {
      type: "open",
      tab: openContentTab({ ...file(), content: "new snapshot" }),
    });
    expect(second.tabs).toHaveLength(1);
    expect(second).toMatchObject({ activeTabId: tab.id, visible: true });
    expect(second.tabs[0].content).toMatchObject({ content: "new snapshot" });
    expect(first.tabs[0].content).toMatchObject({ content: "const a = 1" });
  });

  it.each(["activity", "files", "terminal", "preview", "review"] as const)(
    "keeps %s singleton even if callers supply distinct IDs",
    (kind) => {
      let state = dockReducer(createInitialDockState(), {
        type: "open",
        tab: { id: "first", kind, title: kind },
      });
      state = dockReducer(state, {
        type: "open",
        tab: { id: "second", kind, title: "Updated" },
      });
      expect(state.tabs).toEqual([{ id: kind, kind, title: "Updated" }]);
      expect(state.activeTabId).toBe(kind);
    },
  );

  it("keeps multiple browser instances with the same URL distinct", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: browser("browser-a"),
    });
    state = dockReducer(state, { type: "open", tab: browser("browser-b") });
    expect(state.tabs).toHaveLength(2);
    state = dockReducer(state, { type: "select", id: "browser-a" });
    expect(state.activeTabId).toBe("browser-a");
  });

  it("hides without discarding tabs, selected content, placement, or maximized state", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: openContentTab(file()),
    });
    state = dockReducer(state, { type: "placement", placement: "bottom" });
    state = dockReducer(state, { type: "maximize" });
    const hidden = dockReducer(state, { type: "hide" });
    expect(hidden).toEqual({ ...state, visible: false });
    expect(dockReducer(hidden, { type: "show" })).toEqual(state);
  });

  it("selecting a hidden tab shows the dock, while unknown IDs are ignored", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: browser("a"),
    });
    state = dockReducer(state, { type: "hide" });
    expect(dockReducer(state, { type: "select", id: "missing" })).toBe(state);
    expect(dockReducer(state, { type: "select", id: "a" })).toMatchObject({
      visible: true,
      activeTabId: "a",
    });
  });

  it("closes only the requested tab, choosing the right neighbor then the left", () => {
    let state = createInitialDockState();
    for (const id of ["a", "b", "c"])
      state = dockReducer(state, { type: "open", tab: browser(id) });
    state = dockReducer(state, { type: "select", id: "b" });
    state = dockReducer(state, { type: "close", id: "b" });
    expect(state.activeTabId).toBe("c");
    state = dockReducer(state, { type: "close", id: "c" });
    expect(state.activeTabId).toBe("a");
    state = dockReducer(state, { type: "close", id: "a" });
    expect(state).toMatchObject({
      tabs: [],
      visible: false,
      activeTabId: null,
      maximized: false,
    });
  });

  it("closing a background tab does not steal selection or unhide the dock", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: browser("a"),
    });
    state = dockReducer(state, { type: "open", tab: browser("b") });
    state = dockReducer(state, { type: "hide" });
    state = dockReducer(state, { type: "close", id: "a" });
    expect(state).toMatchObject({ activeTabId: "b", visible: false });
    expect(dockReducer(state, { type: "close", id: "missing" })).toBe(state);
  });

  it("metadata updates do not activate tabs, reveal hidden content, or mutate earlier state", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: browser("a"),
    });
    state = dockReducer(state, { type: "hide" });
    const next = dockReducer(state, {
      type: "update",
      id: "a",
      updates: { title: "Documentation", url: "https://example.test/docs" },
    });
    expect(next).toMatchObject({ activeTabId: "a", visible: false });
    expect(next.tabs[0]).toMatchObject({
      title: "Documentation",
      url: "https://example.test/docs",
    });
    expect(state.tabs[0].title).toBe("Browser");
  });

  it("clears conversation-owned state while retaining the user's dock placement", () => {
    let state = dockReducer(createInitialDockState(), {
      type: "open",
      tab: openContentTab(file()),
    });
    state = dockReducer(state, { type: "placement", placement: "bottom" });
    state = dockReducer(state, { type: "maximize", maximized: true });
    expect(dockReducer(state, { type: "clear" })).toEqual({
      ...createInitialDockState(),
      placement: "bottom",
    });
  });

  it("opens a usable Activity tab when an empty dock is shown", () => {
    expect(
      dockReducer(createInitialDockState(), { type: "show" }),
    ).toMatchObject({
      visible: true,
      activeTabId: "activity",
      tabs: [{ id: "activity", kind: "activity", title: "Activity" }],
    });
  });

  it("derives file, terminal, search, proxy, notes and shared-file titles with stable fallbacks", () => {
    expect(openContentTab(file())).toMatchObject({
      id: "content:write-1",
      title: "app.ts",
      kind: "content",
    });
    expect(
      openContentTab({ path: "C:\\project\\main.ts", content: "" }).title,
    ).toBe("main.ts");
    const untracked = { path: "/root/app.ts", content: "old" };
    expect(openContentTab(untracked).id).toBe(
      openContentTab({ ...untracked, content: "new" }).id,
    );
    expect(
      openContentTab({
        command: "pnpm test",
        output: "",
        isExecuting: false,
        toolCallId: "",
      }).title,
    ).toBe("pnpm test");
    expect(
      openContentTab({
        proxyAction: "list_requests",
        command: "proxy",
        output: "",
        isExecuting: false,
        toolCallId: "p",
      }).title,
    ).toBe("Proxy · list_requests");
    expect(
      openContentTab({
        query: "API docs",
        results: [],
        isSearching: false,
        toolCallId: "s",
      }).title,
    ).toBe("API docs");
    expect(
      openContentTab({
        action: "list",
        notes: [],
        totalCount: 0,
        isExecuting: false,
        toolCallId: "n",
      }).title,
    ).toBe("Notes");
    expect(
      openContentTab({
        requestedPaths: ["app.ts"],
        files: [],
        isExecuting: false,
        toolCallId: "f",
      }).title,
    ).toBe("Shared files");
  });
});

describe("typed dock intents", () => {
  it("dispatches the requested agent group identity", () => {
    const listener = jest.fn();
    window.addEventListener(OPEN_AGENT_ACTIVITY_EVENT, listener);
    openAgentActivity({ toolCallId: "agent-1" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { toolCallId: "agent-1" } }),
    );
    window.removeEventListener(OPEN_AGENT_ACTIVITY_EVENT, listener);
  });
  it("dispatches the requested workspace surface", () => {
    const listener = jest.fn();
    window.addEventListener(OPEN_WORKBENCH_EVENT, listener);
    openWorkbench({ kind: "terminal" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { kind: "terminal" } }),
    );
    window.removeEventListener(OPEN_WORKBENCH_EVENT, listener);
  });
});
