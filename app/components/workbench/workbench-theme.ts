import type { Monaco } from "@monaco-editor/react";
import type { ITheme } from "@xterm/xterm";

export type WorkbenchColorScheme = "light" | "dark";

export const WORKBENCH_EDITOR_THEME_NAMES = {
  light: "rift-workbench-light",
  dark: "rift-workbench-dark",
} as const;

export function resolveWorkbenchColorScheme(
  resolvedTheme: string | undefined,
): WorkbenchColorScheme {
  return resolvedTheme === "light" ? "light" : "dark";
}

export function workbenchEditorThemeName(resolvedTheme: string | undefined) {
  return WORKBENCH_EDITOR_THEME_NAMES[
    resolveWorkbenchColorScheme(resolvedTheme)
  ];
}

type WorkbenchEditorTheme = Parameters<Monaco["editor"]["defineTheme"]>[1];

export const WORKBENCH_EDITOR_THEMES: Record<
  WorkbenchColorScheme,
  WorkbenchEditorTheme
> = {
  light: {
    base: "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: "667A5A", fontStyle: "italic" },
      { token: "keyword", foreground: "7A3E9D" },
      { token: "number", foreground: "2D6F4D" },
      { token: "string", foreground: "A0443A" },
      { token: "type", foreground: "176E7A" },
    ],
    colors: {
      "editor.background": "#ffffff",
      "editor.foreground": "#202124",
      "editorLineNumber.foreground": "#8b8e94",
      "editorLineNumber.activeForeground": "#5f6268",
      "editorCursor.foreground": "#202124",
      "editor.selectionBackground": "#add6ff",
      "editor.inactiveSelectionBackground": "#dce8f3",
      "editor.lineHighlightBackground": "#f7f7f7",
      "editorIndentGuide.background1": "#e3e3e5",
      "editorIndentGuide.activeBackground1": "#c5c7ca",
      "editorWhitespace.foreground": "#d5d6d9",
      "editorGutter.background": "#ffffff",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#dedee1",
      "input.background": "#f7f7f7",
      "input.border": "#c8c9cd",
      focusBorder: "#8d8d8d",
      "scrollbarSlider.background": "#17171724",
      "scrollbarSlider.hoverBackground": "#17171742",
      "scrollbarSlider.activeBackground": "#17171759",
    },
  },
  dark: {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "comment", foreground: "6A9955", fontStyle: "italic" },
      { token: "keyword", foreground: "C586C0" },
      { token: "number", foreground: "B5CEA8" },
      { token: "string", foreground: "CE9178" },
      { token: "type", foreground: "4EC9B0" },
    ],
    colors: {
      "editor.background": "#181818",
      "editor.foreground": "#f0f0f0",
      "editorLineNumber.foreground": "#737373",
      "editorLineNumber.activeForeground": "#b8b8b8",
      "editorCursor.foreground": "#f0f0f0",
      "editor.selectionBackground": "#264f78",
      "editor.inactiveSelectionBackground": "#2a3f55",
      "editor.lineHighlightBackground": "#1f1f1f",
      "editorIndentGuide.background1": "#2a2a2a",
      "editorIndentGuide.activeBackground1": "#464646",
      "editorWhitespace.foreground": "#383838",
      "editorGutter.background": "#181818",
      "editorWidget.background": "#1f1f1f",
      "editorWidget.border": "#2b2b2b",
      "input.background": "#1f1f1f",
      "input.border": "#363636",
      focusBorder: "#808080",
      "scrollbarSlider.background": "#f0f0f02e",
      "scrollbarSlider.hoverBackground": "#f0f0f052",
      "scrollbarSlider.activeBackground": "#f0f0f06b",
    },
  },
};

export const WORKBENCH_TERMINAL_THEMES: Record<WorkbenchColorScheme, ITheme> = {
  light: {
    background: "#fbfbfb",
    foreground: "#202124",
    cursor: "#202124",
    cursorAccent: "#fbfbfb",
    selectionBackground: "#add6ff",
    black: "#202124",
    red: "#b92f3d",
    green: "#237a42",
    yellow: "#8a611f",
    blue: "#1967b3",
    magenta: "#7a3e9d",
    cyan: "#176e7a",
    white: "#e3e3e5",
    brightBlack: "#6d7077",
    brightRed: "#ce4856",
    brightGreen: "#2f8a50",
    brightYellow: "#a37325",
    brightBlue: "#2d7fc4",
    brightMagenta: "#9256b2",
    brightCyan: "#2a8491",
    brightWhite: "#ffffff",
  },
  dark: {
    background: "#141414",
    foreground: "#f0f0f0",
    cursor: "#f0f0f0",
    cursorAccent: "#141414",
    selectionBackground: "#264f78",
    black: "#181818",
    red: "#df5b67",
    green: "#4aa878",
    yellow: "#d5a84f",
    blue: "#4c8ed9",
    magenta: "#b07ec8",
    cyan: "#62a6b5",
    white: "#f0f0f0",
    brightBlack: "#737373",
    brightRed: "#ed7a84",
    brightGreen: "#65b98a",
    brightYellow: "#e1bb68",
    brightBlue: "#6ba0de",
    brightMagenta: "#c294d8",
    brightCyan: "#82bdc9",
    brightWhite: "#f0f0f0",
  },
};
