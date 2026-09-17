import {
  SHORTCUTS,
  formatChord,
  getShortcut,
  isEditableShortcutTarget,
  matchShortcut,
  shortcutFires,
  shortcutsForScope,
} from "../registry";

const event = (
  key: string,
  options: {
    shift?: boolean;
    meta?: boolean;
    ctrl?: boolean;
    alt?: boolean;
  } = {},
) => ({
  key,
  metaKey: options.meta ?? true,
  ctrlKey: options.ctrl ?? false,
  shiftKey: options.shift ?? false,
  altKey: options.alt ?? false,
});

describe("shortcut registry", () => {
  const originalPlatform = navigator.platform;
  const setPlatform = (value: string) =>
    Object.defineProperty(navigator, "platform", { configurable: true, value });
  beforeEach(() => setPlatform("MacIntel"));
  afterAll(() => setPlatform(originalPlatform));

  it.each(["n", "k"])("preserves macOS Control-%s text editing", (key) => {
    const shortcut = getShortcut(
      key === "n" ? "new-session" : "command-palette-k",
    );
    expect(
      shortcutFires(shortcut, event(key, { meta: false, ctrl: true }), true),
    ).toBe(false);
    expect(shortcutFires(shortcut, event(key), true)).toBe(true);
  });

  it.each(["Win32", "Linux x86_64"])(
    "uses Control instead of Meta on %s",
    (platform) => {
      setPlatform(platform);
      expect(
        matchShortcut(
          getShortcut("new-session"),
          event("n", { meta: false, ctrl: true }),
        ),
      ).toBe(true);
      expect(matchShortcut(getShortcut("new-session"), event("n"))).toBe(false);
    },
  );

  it("leaves combined Control-Command chords to the system", () => {
    expect(
      matchShortcut(getShortcut("new-session"), event("n", { ctrl: true })),
    ).toBe(false);
  });
  it("keeps ids unique and every chord documented", () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    SHORTCUTS.forEach((shortcut) => {
      expect(getShortcut(shortcut.id)).toBe(shortcut);
      expect(shortcut.label.length).toBeGreaterThan(0);
      // The defect this closes: one chord in the product had no rule about
      // firing while you type, so the behaviour was whatever the handler
      // happened to do.
      expect(["allow", "block"]).toContain(shortcut.inInput);
    });
  });

  it("gives each surface the chords it handles and no others", () => {
    const pro = shortcutsForScope("pro").map((shortcut) => shortcut.id);
    const workspace = shortcutsForScope("workspace").map(
      (shortcut) => shortcut.id,
    );

    expect(pro).toContain("command-palette-k");
    expect(pro).toContain("terminal-dock");
    expect(pro).not.toContain("chat-search");
    expect(pro).not.toContain("workspace-bottom-panel");

    expect(workspace).toContain("workspace-bottom-panel");
    expect(workspace).toContain("workspace-terminal-fullscreen");
    expect(workspace).not.toContain("terminal-dock");

    expect(shortcutsForScope("standard")).toContainEqual(
      expect.objectContaining({ id: "chat-search" }),
    );
  });

  it("matches shift in both directions", () => {
    const bottomPanel = getShortcut("workspace-bottom-panel");
    const fullscreen = getShortcut("workspace-terminal-fullscreen");

    expect(matchShortcut(bottomPanel, event("j"))).toBe(true);
    // Without an exact shift comparison, maximizing the terminal also toggles
    // the panel shut on the way through.
    expect(matchShortcut(bottomPanel, event("J", { shift: true }))).toBe(false);
    expect(matchShortcut(fullscreen, event("J", { shift: true }))).toBe(true);
    expect(matchShortcut(fullscreen, event("j"))).toBe(false);
  });

  it("requires the modifier and rejects alt", () => {
    const settings = getShortcut("settings");
    expect(
      matchShortcut(settings, event(",", { meta: false, ctrl: false })),
    ).toBe(false);
    expect(
      matchShortcut(settings, event(",", { meta: false, ctrl: true })),
    ).toBe(false);
    expect(matchShortcut(settings, event(",", { alt: true }))).toBe(false);
  });

  it("applies the declared input rule uniformly", () => {
    expect(shortcutFires(getShortcut("settings"), event(","), true)).toBe(
      false,
    );
    expect(shortcutFires(getShortcut("settings"), event(","), false)).toBe(
      true,
    );
    // Reaching for a shell mid-sentence is the reason this chord exists.
    expect(shortcutFires(getShortcut("terminal-dock"), event("j"), true)).toBe(
      true,
    );
    expect(shortcutFires(getShortcut("toggle-sidebar"), event("b"), true)).toBe(
      false,
    );
  });

  it("formats chords for both platforms", () => {
    expect(formatChord({ mod: true, key: "k" }, true)).toBe("⌘K");
    expect(formatChord({ mod: true, key: "k" }, false)).toBe("Ctrl+K");
    expect(formatChord({ mod: true, shift: true, key: "p" }, true)).toBe("⌘⇧P");
    expect(formatChord({ mod: true, shift: true, key: "p" }, false)).toBe(
      "Ctrl+Shift+P",
    );
    expect(formatChord({ mod: true, key: "," }, true)).toBe("⌘,");
  });

  it("treats editors and terminals as typing surfaces", () => {
    document.body.innerHTML = `
      <textarea id="composer"></textarea>
      <div class="monaco-editor"><span id="glyph"></span></div>
      <div data-workbench-interactive-terminal><span id="cell"></span></div>
      <button id="plain"></button>
    `;
    expect(isEditableShortcutTarget(document.getElementById("composer"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.getElementById("glyph"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.getElementById("cell"))).toBe(
      true,
    );
    expect(isEditableShortcutTarget(document.getElementById("plain"))).toBe(
      false,
    );
    expect(isEditableShortcutTarget(null)).toBe(false);
  });
});
