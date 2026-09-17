import { stripVTControlCharacters } from "node:util";
import {
  RIFT_WORDMARK,
  RIFT_COMPACT_LOGO,
  terminalHands,
  terminalHandFrame,
} from "./terminal-art.js";
import { RIFT_ACTIVITY_MARK, riftActivityIntensity } from "./activity-orb.js";
import type { ConsoleSnapshot, ConsoleEntry } from "./protocol.js";

const entryWrapCache = new WeakMap<
  ConsoleEntry,
  { width: number; text: string; lines: string[] }
>();
function wrapEntry(entry: ConsoleEntry, width: number) {
  const cached = entryWrapCache.get(entry);
  if (cached?.width === width && cached.text === entry.text)
    return cached.lines;
  const lines = wrap(entry.text, width);
  entryWrapCache.set(entry, { width, text: entry.text, lines });
  return lines;
}

/** Strip terminal instructions, C1, bidi overrides, and other non-text controls. */
export function sanitizeTerminalText(value: string): string {
  return stripVTControlCharacters(value)
    .replace(/\x1b[^\n]*/g, "")
    .replace(
      /[\x00-\x08\x0b-\x1f\x7f-\x9f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g,
      "",
    )
    .replace(/\t/g, "  ");
}
export function characterWidth(char: string): number {
  if (/\p{Mark}/u.test(char) || char === "\ufe0f" || char === "\u200d")
    return 0;
  const code = char.codePointAt(0) ?? 0;
  return code >= 0x1100 &&
    (code <= 0x115f ||
      code === 0x2329 ||
      code === 0x232a ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe10 && code <= 0xfe6f) ||
      (code >= 0xff01 && code <= 0xff60) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      code >= 0x20000)
    ? 2
    : 1;
}
export function terminalWidth(value: string): number {
  return Array.from(sanitizeTerminalText(value)).reduce(
    (total, char) => total + characterWidth(char),
    0,
  );
}
export function clip(value: string, width: number): string {
  let result = "";
  let used = 0;
  for (const char of sanitizeTerminalText(value).replace(/\n/g, " ")) {
    const size = characterWidth(char);
    if (used + size > width) break;
    result += char;
    used += size;
  }
  return result;
}
export function wrap(value: string, width: number): string[] {
  if (width < 1) return [""];
  const lines: string[] = [];
  for (const raw of sanitizeTerminalText(value).split("\n")) {
    let current = "";
    let used = 0;
    for (const char of raw) {
      const size = characterWidth(char);
      if (used + size > width && current) {
        lines.push(current);
        current = "";
        used = 0;
      }
      current += char;
      used += size;
    }
    lines.push(current);
  }
  return lines;
}
export function previewPage(
  text: string,
  columns: number,
  rows: number,
  offset = 0,
) {
  const lines = wrap(text, Math.max(8, columns - 2));
  const pageSize = Math.max(1, Math.min(6, rows - 16));
  const start = Math.max(
    0,
    Math.min(offset, Math.max(0, lines.length - pageSize)),
  );
  return {
    lines: lines.slice(start, start + pageSize),
    offset: start,
    total: lines.length,
    pageSize,
    atEnd: start + pageSize >= lines.length,
  };
}
export type ConsoleMenu = {
  title: string;
  rows: string[];
  selected: number;
  preview?: string;
  previewOffset?: number;
};
export type FrameOptions = {
  columns: number;
  rows: number;
  snapshot: ConsoleSnapshot | null;
  connected: boolean;
  cwd: string;
  input: string;
  notice?: string;
  menu?: ConsoleMenu | null;
  scroll?: number;
  color?: boolean;
  animationTime?: number;
  inputCursor?: number;
  showDetails?: boolean;
};
export function renderFrame(options: FrameOptions): string {
  return renderView(options).frame;
}
export function renderView(options: FrameOptions): {
  frame: string;
  cursor?: { row: number; column: number };
} {
  const width = Math.max(8, options.columns - 2);
  const height = Math.max(6, options.rows);
  const base = options.color ? "\x1b[0;38;2;199;199;199;48;2;20;20;20m" : "";
  const paint = (text: string, code: string) =>
    options.color ? `\x1b[${code}m${text}${base}` : text;
  const gradient = (text: string, from: number[], to: number[]) =>
    Array.from(text)
      .map((char, index, chars) => {
        const t = index / Math.max(1, chars.length - 1);
        const rgb = from.map((value, i) =>
          Math.round(value + (to[i] - value) * t),
        );
        return options.color ? `\x1b[38;2;${rgb.join(";")}m${char}` : char;
      })
      .join("") + base;
  const subtle = (text: string) => paint(text, "2");
  const accent = (text: string) => paint(text, "38;5;141");
  const current = options.snapshot;
  const online =
    options.connected && current !== null && current.status !== "unavailable";
  const lines = [subtle(clip(options.cwd, width)), ""];
  const footer: string[] = [];
  if (options.menu) {
    const menu = options.menu;
    footer.push(accent(clip(menu.title, width)));
    if (menu.preview) {
      const page = previewPage(
        menu.preview,
        options.columns,
        height,
        menu.previewOffset,
      );
      footer.push(...page.lines.map(subtle));
      if (page.total > page.pageSize)
        footer.push(
          subtle(
            clip(
              `Preview ${page.offset + 1}–${Math.min(page.offset + page.pageSize, page.total)}/${page.total} · PageUp/PageDown${page.atEnd ? " · End" : " · More below"}`,
              width,
            ),
          ),
        );
    }
    const visible = Math.max(1, Math.min(6, menu.rows.length, height - 12));
    const start = Math.max(
      0,
      Math.min(menu.selected - visible + 1, menu.rows.length - visible),
    );
    footer.push(
      ...menu.rows.slice(start, start + visible).map((row, index) => {
        const selected = start + index === menu.selected;
        const label = clip(`${selected ? "›" : " "} ${row}`, width);
        return selected ? accent(label) : subtle(label);
      }),
    );
    footer.push("");
  } else if (options.notice)
    footer.push(...wrap(options.notice, width).slice(0, 3).map(subtle), "");
  const working =
    !current?.approvals.length &&
    (current?.status === "streaming" || current?.status === "submitted");
  const state = current?.approvals.length
    ? `${current.approvals.length} awaiting approval · /approve /deny`
    : current?.status === "streaming"
      ? "Working…"
      : current?.status === "submitted"
        ? "Working…"
        : online
          ? ""
          : "Waiting for RIFT";
  const statusText = `${current?.target !== "local" && current ? current.targetLabel + " · " : ""}${state}${current?.queued ? ` · ${current.queued} queued` : ""}`;
  if (working) {
    const intensity = riftActivityIntensity(
      options.animationTime ?? 0,
      process.env.RIFT_REDUCED_MOTION === "1",
    );
    footer.push(
      ...RIFT_ACTIVITY_MARK.map(
        (row, index) =>
          paint(row, `38;2;${intensity};${intensity};${intensity}`) +
          (index === 1
            ? subtle(clip(`  ${statusText}`, width - row.length))
            : ""),
      ),
    );
  } else footer.push(subtle(clip(statusText, width)));
  const inputWidth = Math.max(1, width - 5);
  const maxInputRows = Math.max(1, Math.min(4, height - 12));
  const cursorPosition = Math.min(
    Array.from(options.input).length,
    options.inputCursor ?? Array.from(options.input).length,
  );
  let cursorRow = 0,
    cursorColumn = 0;
  for (const char of Array.from(options.input).slice(0, cursorPosition)) {
    if (char === "\n") {
      cursorRow++;
      cursorColumn = 0;
      continue;
    }
    const size = characterWidth(char);
    if (cursorColumn + size > inputWidth) {
      cursorRow++;
      cursorColumn = 0;
    }
    cursorColumn += size;
  }
  // Keep an insertion point at a wrapped line end inside the input viewport.
  if (cursorColumn === inputWidth) {
    cursorRow++;
    cursorColumn = 0;
  }
  const allInputLines = wrap(
    options.input ||
      (online ? "Ask RIFT to build something…" : "Connecting to RIFT…"),
    inputWidth,
  );
  if (options.input && cursorRow >= allInputLines.length)
    allInputLines.push("");
  const firstInputRow = Math.max(0, cursorRow - maxInputRows + 1);
  const inputLines = allInputLines.slice(
    firstInputRow,
    firstInputRow + maxInputRows,
  );
  const inputFooterRow = footer.length + 1;
  footer.push(subtle(`╭${"─".repeat(width - 2)}╮`));
  footer.push(
    ...inputLines.map(
      (line, index) =>
        subtle("│ ") +
        (index === 0 ? accent("› ") : "  ") +
        (options.input ? line : subtle(line)) +
        " ".repeat(Math.max(0, inputWidth - terminalWidth(line))) +
        subtle("│"),
    ),
  );
  const effortLabel =
    current?.efforts.find((choice) => choice.value === current.effort)?.label ||
    current?.effort;
  const permissionLabel =
    current?.permissions?.find((choice) => choice.value === current.approval)
      ?.label || current?.approval;
  const caption = clip(
    current
      ? `${current.modelLabel} (${effortLabel}) · ${permissionLabel}`
      : "RIFT app session",
    Math.max(1, width - 7),
  );
  footer.push(
    subtle(
      `╰${"─".repeat(Math.max(1, width - terminalWidth(caption) - 5))} ${caption} ─╯`,
    ),
  );
  footer.push(
    "",
    subtle(
      clip(
        options.menu
          ? "↑ ↓ choose  ·  Enter select  ·  Esc cancel"
          : "Enter send  ·  Ctrl+C stop  ·  /help  ·  /details" +
              (options.scroll ? "  ·  scrolled" : ""),
        width,
      ),
    ),
  );
  const transcript: string[] = [];
  if (!current?.entries.length) {
    const centre = (text: string) =>
      " ".repeat(Math.max(0, Math.floor((width - terminalWidth(text)) / 2))) +
      text;
    if (width >= 34 && height >= 23) {
      transcript.push(
        ...RIFT_WORDMARK.map((row) => centre(paint(row, "38;2;238;238;242"))),
        "",
      );
    } else
      transcript.push(
        ...RIFT_COMPACT_LOGO.map((row) =>
          centre(paint(row, "38;2;238;238;242")),
        ),
        "",
      );
    if (width >= 54 && height >= 38) {
      const artWidth = Math.min(74, width - 4);
      transcript.push(
        ...terminalHands(
          artWidth,
          13,
          terminalHandFrame(options.animationTime ?? 0),
        ).map((row) => centre(gradient(row, [183, 146, 136], [129, 155, 168]))),
        "",
      );
    }
    transcript.push(
      centre(subtle(clip("Recursive Intelligence for Technology", width))),
      "",
      centre(clip("/new  New chat    /model  Select model", width)),
      centre(subtle(clip("/help  Commands", width))),
    );
  } else {
    const needed =
      Math.max(0, height - lines.length - footer.length - 1) +
      (options.scroll ?? 0);
    for (
      let i = current.entries.length - 1;
      i >= 0 && transcript.length < needed;
      i--
    ) {
      const entry = current.entries[i];
      const block: string[] = [];
      const displayed =
        options.showDetails && entry.details
          ? { ...entry, text: `${entry.text}\n${entry.details}` }
          : entry;
      if (entry.kind === "user")
        block.push(
          ...wrapEntry(entry, width - 2).map((line, index) =>
            paint(
              `${index === 0 ? "›" : " "} ${line}`.padEnd(width),
              "48;2;36;36;36",
            ),
          ),
          "",
        );
      else if (entry.kind === "activity")
        block.push(
          ...wrapEntry(displayed, width - 2)
            .slice(0, options.showDetails ? undefined : 3)
            .map((line, index) => subtle(`${index === 0 ? "◇" : "│"} ${line}`)),
          "",
        );
      else
        block.push(
          ...wrapEntry(entry, width).map((line) =>
            entry.kind === "error" ? paint(line, "31") : line,
          ),
          "",
        );
      transcript.unshift(...block);
    }
  }
  const available = Math.max(0, height - lines.length - footer.length - 1);
  const end = Math.max(0, transcript.length - (options.scroll ?? 0));
  const visibleTranscript = !current?.entries.length
    ? transcript.slice(0, available)
    : transcript.slice(Math.max(0, end - available), end);
  if (!current?.entries.length && available > visibleTranscript.length)
    lines.push(
      ...Array(Math.floor((available - visibleTranscript.length) / 2)).fill(""),
    );
  lines.push(...visibleTranscript);
  while (lines.length < height - footer.length - 1) lines.push("");
  lines.push(...footer);
  const frame = lines
    .slice(-(height - 1))
    .map((line) => `${base} ${line}${base}\x1b[K`)
    .join("\r\n");
  return {
    frame,
    cursor: options.menu
      ? undefined
      : {
          row:
            height - footer.length + inputFooterRow + cursorRow - firstInputRow,
          column: Math.min(width, 6 + cursorColumn),
        },
  };
}
