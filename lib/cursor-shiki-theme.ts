import type { ThemeRegistrationAny } from "shiki";

/**
 * Cursor Dark's core TextMate colors, mirrored from the locally installed
 * Cursor 3.11 theme. Keeping this small avoids shipping the full editor theme
 * while making chat code blocks match the workbench.
 */
export const CURSOR_DARK_SHIKI_THEME: ThemeRegistrationAny = {
  name: "rift-cursor-dark",
  type: "dark",
  colors: {
    "editor.background": "#181818",
    "editor.foreground": "#d6d6dd",
  },
  tokenColors: [
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "#E4E4E45E", fontStyle: "italic" },
    },
    {
      scope: [
        "keyword",
        "keyword.control",
        "keyword.operator",
        "storage.type",
        "storage.modifier",
      ],
      settings: { foreground: "#82d2ce" },
    },
    {
      scope: ["entity.name.function", "support.function", "meta.function-call"],
      settings: { foreground: "#efb080" },
    },
    {
      scope: ["string", "punctuation.definition.string"],
      settings: { foreground: "#e394dc" },
    },
    {
      scope: ["constant", "constant.numeric", "constant.language"],
      settings: { foreground: "#f8c762" },
    },
    {
      scope: ["entity.name.type", "entity.name.class", "support.type"],
      settings: { foreground: "#87c3ff" },
    },
    {
      scope: [
        "variable.other.property",
        "support.variable.property",
        "meta.object-literal.key",
      ],
      settings: { foreground: "#AAA0FA" },
    },
    {
      scope: ["variable", "punctuation", "meta.brace"],
      settings: { foreground: "#d6d6dd" },
    },
  ],
};
