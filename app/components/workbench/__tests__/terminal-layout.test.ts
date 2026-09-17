import {
  addTerminalToLayout,
  closeTerminalInLayout,
  createInitialTerminalLayout,
  parseTerminalLayout,
  selectTerminalInLayout,
  splitTerminalLayout,
} from "../terminal-layout";

describe("Workbench terminal layout", () => {
  it("adds, selects, splits and closes independent terminal tabs", () => {
    const initial = createInitialTerminalLayout("terminal-one");
    const added = addTerminalToLayout(initial, "terminal-two", "claude");
    expect(added.tabs.map((tab) => tab.clientTerminalId)).toEqual([
      "terminal-one",
      "terminal-two",
    ]);
    expect(added.activeId).toBe("terminal-two");
    expect(added.tabs[1].profile).toBe("claude");

    const selected = selectTerminalInLayout(added, "terminal-one");
    expect(selected.activeId).toBe("terminal-one");
    const split = splitTerminalLayout(
      selected,
      "right",
      "terminal-three",
      "codex",
    );
    expect(split.split).toEqual({
      direction: "right",
      secondaryId: "terminal-three",
    });
    expect(split.tabs).toHaveLength(3);
    expect(split.tabs[2].profile).toBe("codex");

    const vertical = splitTerminalLayout(split, "down", "terminal-four");
    expect(vertical.split).toEqual({
      direction: "down",
      secondaryId: "terminal-three",
    });
    expect(vertical.tabs).toHaveLength(3);

    const swapped = selectTerminalInLayout(vertical, "terminal-three");
    expect(swapped.activeId).toBe("terminal-three");
    expect(swapped.split?.secondaryId).toBe("terminal-one");

    const closed = closeTerminalInLayout(swapped, "terminal-three");
    expect(closed.activeId).toBe("terminal-one");
    expect(closed.split).toBeNull();
    expect(closed.tabs.map((tab) => tab.clientTerminalId)).toEqual([
      "terminal-one",
      "terminal-two",
    ]);
  });

  it("restores a valid session layout and rejects unsafe terminal ids", () => {
    const restored = parseTerminalLayout(
      JSON.stringify({
        version: 1,
        tabs: [
          { clientTerminalId: "terminal-safe", label: "Terminal 1" },
          { clientTerminalId: "../bad", label: "Bad" },
          {
            clientTerminalId: "terminal-safe-2",
            label: "Terminal 2",
            profile: "grok",
          },
        ],
        activeId: "terminal-safe",
        split: { direction: "right", secondaryId: "terminal-safe-2" },
        nextOrdinal: 3,
      }),
    );

    expect(restored?.tabs).toEqual([
      {
        clientTerminalId: "terminal-safe",
        label: "Terminal 1",
        profile: "shell",
      },
      {
        clientTerminalId: "terminal-safe-2",
        label: "Terminal 2",
        profile: "grok",
      },
    ]);
    expect(restored?.split).toEqual({
      direction: "right",
      secondaryId: "terminal-safe-2",
    });
    expect(parseTerminalLayout("not json")).toBeNull();
  });

  it("persists an intentionally empty layout after the final terminal closes", () => {
    const initial = createInitialTerminalLayout("terminal-only");
    const closed = closeTerminalInLayout(initial, "terminal-only");
    expect(closed.tabs).toEqual([]);
    expect(closed.activeId).toBe("");
    expect(closed.split).toBeNull();
    expect(parseTerminalLayout(JSON.stringify(closed))).toEqual(closed);
    const started = addTerminalToLayout(closed, "terminal-new", "shell");
    expect(started.tabs).toHaveLength(1);
    expect(started.activeId).toBe("terminal-new");
    expect(started.tabs[0].label).toBe("Terminal 2");
    expect(
      splitTerminalLayout(closed, "right", "terminal-split").activeId,
    ).toBe("terminal-split");
  });

  it("does not treat malformed persisted tabs as an intentionally empty layout", () => {
    expect(
      parseTerminalLayout(
        JSON.stringify({
          version: 1,
          tabs: [{ clientTerminalId: "../bad" }],
          activeId: "",
          split: null,
        }),
      ),
    ).toBeNull();
    expect(
      parseTerminalLayout(
        JSON.stringify({
          version: 1,
          tabs: [],
          activeId: "terminal-missing",
          split: null,
        }),
      ),
    ).toBeNull();
  });

  it("falls back to zsh when a persisted profile is not allowlisted", () => {
    const restored = parseTerminalLayout(
      JSON.stringify({
        version: 1,
        tabs: [
          {
            clientTerminalId: "terminal-profile",
            label: "Terminal 1",
            profile: "rm-everything",
          },
        ],
        activeId: "terminal-profile",
        split: null,
        nextOrdinal: 2,
      }),
    );
    expect(restored?.tabs[0].profile).toBe("shell");
  });
});
