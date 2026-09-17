import {
  WORKBENCH_EDITOR_THEMES,
  WORKBENCH_EDITOR_THEME_NAMES,
  WORKBENCH_TERMINAL_THEMES,
  resolveWorkbenchColorScheme,
  workbenchEditorThemeName,
} from "../workbench-theme";

describe("Workbench theme contract", () => {
  it("uses light only for an explicitly resolved light theme", () => {
    expect(resolveWorkbenchColorScheme("light")).toBe("light");
    expect(resolveWorkbenchColorScheme("dark")).toBe("dark");
    expect(resolveWorkbenchColorScheme("system")).toBe("dark");
    expect(resolveWorkbenchColorScheme(undefined)).toBe("dark");
  });

  it("selects matching Monaco theme names", () => {
    expect(workbenchEditorThemeName("light")).toBe(
      WORKBENCH_EDITOR_THEME_NAMES.light,
    );
    expect(workbenchEditorThemeName("dark")).toBe(
      WORKBENCH_EDITOR_THEME_NAMES.dark,
    );
    expect(WORKBENCH_EDITOR_THEMES.light.base).toBe("vs");
    expect(WORKBENCH_EDITOR_THEMES.dark.base).toBe("vs-dark");
  });

  it("provides complete, distinct Monaco and xterm palettes for both modes", () => {
    expect(WORKBENCH_EDITOR_THEMES.light.colors["editor.background"]).toBe(
      "#ffffff",
    );
    expect(WORKBENCH_EDITOR_THEMES.dark.colors["editor.background"]).toBe(
      "#181818",
    );
    expect(WORKBENCH_EDITOR_THEMES.dark.colors["editor.foreground"]).toBe(
      "#f0f0f0",
    );
    expect(WORKBENCH_TERMINAL_THEMES.light.background).toBe("#fbfbfb");
    expect(WORKBENCH_TERMINAL_THEMES.dark.background).toBe("#141414");
    expect(WORKBENCH_TERMINAL_THEMES.light.foreground).not.toBe(
      WORKBENCH_TERMINAL_THEMES.dark.foreground,
    );
    expect(WORKBENCH_TERMINAL_THEMES.light.cursorAccent).toBe(
      WORKBENCH_TERMINAL_THEMES.light.background,
    );
    expect(WORKBENCH_TERMINAL_THEMES.dark.cursorAccent).toBe(
      WORKBENCH_TERMINAL_THEMES.dark.background,
    );
  });
});
