import {
  StyledText,
  bold,
  fg,
  BoxRenderable,
  TextRenderable,
  TextareaRenderable,
  ScrollBoxRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  createCliRenderer,
  type CliRenderer,
} from "@opentui/core";
import { readdir, realpath } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import type { Resource } from "./resources.js";
import type { ConsoleSession } from "./session.js";
import type { ConsoleCommand, ConsoleEntry } from "./protocol.js";
import { parseConsoleInput, settingCommand, CONSOLE_HELP } from "./commands.js";
import { sanitizeTerminalText } from "./renderer.js";
import {
  RIFT_ACTIVITY_MARK,
  RIFT_ACTIVITY_FRAME_MS,
  riftActivityIntensity,
} from "./activity-orb.js";
import { RIFT_WORDMARK, RIFT_COMPACT_LOGO } from "./terminal-art.js";

const colors = {
  bg: "#202124",
  panel: "#34363e",
  ink: "#eeeef2",
  muted: "#a5a7b0",
  border: "#51535e",
  accent: "#c2b5ff",
  error: "#ed9595",
};
const clean = sanitizeTerminalText;
type TuiSession = Pick<
  ConsoleSession,
  "events" | "snapshot" | "send" | "close"
>;
export type TuiOptions = {
  cwd: string;
  connect: (target?: "local" | "cloud") => Promise<TuiSession>;
  login: () => Promise<void>;
  openApp: () => Promise<void>;
  resources?: (kind: "models" | "skills" | "plugins") => Promise<Resource[]>;
};

/** The renderer owns keyboard editing, mouse selection, layout and cell diffs.
 * Session work is independent of frames; no network request handles keystrokes. */
export function mountRiftTui(renderer: CliRenderer, options: TuiOptions) {
  let session: TuiSession | null = null;
  let closed = false;
  let interruptRequested = false;
  let connecting = false;
  let executionTarget: "local" | "cloud" | undefined;
  let details = false;
  let menu: SelectRenderable | null = null;
  let slashOpen = false;
  let suppressSlash = false;
  let menuAction: ((value: string) => void) | null = null;
  let effortMenu = false;
  let questionId: string | null = null;
  let questionDraft = "";
  let customQuestion: { id: string; chatId: string } | null = null;
  let approvalId: string | null = null;
  let shutdown: Promise<void> | null = null;
  const entryNodes = new Map<
    string,
    {
      node: TextRenderable;
      kind: ConsoleEntry["kind"];
      sourceText: string;
      sourceDetails: string | undefined;
      showDetails: boolean;
    }
  >();
  const root = new BoxRenderable(renderer, {
    id: "rift",
    width: "100%",
    height: "100%",
    flexDirection: "column",
    padding: 1,
    gap: 1,
    backgroundColor: colors.bg,
  });
  const header = new TextRenderable(renderer, {
    id: "header",
    content: `RIFT  /  ${clean(options.cwd)}`,
    fg: colors.muted,
    height: 1,
  });
  const transcript = new ScrollBoxRenderable(renderer, {
    id: "transcript",
    flexGrow: 1,
    minHeight: 1,
    scrollY: true,
    scrollX: false,
    stickyScroll: true,
    stickyStart: "top",
    contentOptions: { flexDirection: "column", gap: 1 },
    scrollbarOptions: { showArrows: false },
  });
  const welcome = new TextRenderable(renderer, {
    id: "welcome",
    content: "",
    fg: colors.accent,
  });
  function paintWelcome() {
    const lines =
      renderer.height >= 32 && renderer.width >= 38
        ? RIFT_WORDMARK
        : RIFT_COMPACT_LOGO;
    welcome.content = new StyledText([
      ...lines.map((line) => fg(colors.ink)(line + "\n")),
      fg(colors.ink)("Recursive Intelligence for Technology\n\n"),
      fg(colors.muted)("A fresh space to think, build and explore.\n"),
      fg(colors.accent)("/  Explore commands"),
      fg(colors.muted)("    Enter  Send a task"),
    ]);
  }
  paintWelcome();
  renderer.on("resize", paintWelcome);
  transcript.add(welcome);
  const status = new TextRenderable(renderer, {
    id: "status",
    content: "Opening your RIFT session…",
    fg: colors.muted,
    height: 1,
  });
  const menuHost = new BoxRenderable(renderer, {
    id: "menu-host",
    visible: false,
    flexDirection: "column",
    border: true,
    borderColor: colors.border,
    padding: 1,
    flexShrink: 0,
  });
  const menuTitle = new TextRenderable(renderer, {
    content: "",
    fg: colors.accent,
    height: 1,
  });
  const preview = new ScrollBoxRenderable(renderer, {
    height: 7,
    scrollY: true,
    visible: false,
  });
  const previewText = new TextRenderable(renderer, {
    content: "",
    fg: colors.ink,
  });
  preview.add(previewText);
  menuHost.add(menuTitle);
  menuHost.add(preview);
  const composer = new BoxRenderable(renderer, {
    border: true,
    borderColor: colors.border,
    paddingLeft: 1,
    paddingRight: 1,
    height: 5,
    flexShrink: 0,
  });
  const input = new TextareaRenderable(renderer, {
    id: "composer",
    width: "100%",
    height: 3,
    backgroundColor: colors.bg,
    focusedBackgroundColor: colors.bg,
    textColor: colors.ink,
    focusedTextColor: colors.ink,
    placeholder: "Ask RIFT to build, inspect, or fix…  /help",
    keyBindings: [
      { name: "return", action: "submit" },
      { name: "return", shift: true, action: "newline" },
      { name: "j", ctrl: true, action: "newline" },
    ],
    onSubmit: () => {
      if (slashOpen && menu?.getSelectedOption()) {
        menu.selectCurrent();
        return;
      }
      const text = input.plainText;
      void submit(text);
    },
  });
  composer.add(input);
  const footer = new TextRenderable(renderer, {
    id: "footer",
    content:
      "Enter send · Shift+Enter newline · Ctrl+P commands · Ctrl+C stop · Ctrl+Q quit",
    fg: colors.muted,
    height: 1,
  });
  root.add(header);
  root.add(transcript);
  root.add(menuHost);
  root.add(status);
  root.add(composer);
  root.add(footer);
  renderer.root.add(root);
  input.focus();

  function notice(message: string) {
    stopOrb();
    status.content = clean(message);
  }
  function closeMenu() {
    if (menu) {
      menuHost.remove(menu);
      menu.destroy();
      menu = null;
    }
    slashOpen = false;
    effortMenu = false;
    menuAction = null;
    menuHost.visible = false;
    preview.visible = false;
    input.focus();
  }
  function choose(
    title: string,
    choices: { value: string; label: string; description?: string }[],
    action: (value: string) => void,
    text = "",
  ) {
    closeMenu();
    input.blur();
    menuTitle.content = clean(title);
    const availableRows = Math.max(4, renderer.height - 19);
    const previewLines = text
      ? text
          .split("\n")
          .reduce(
            (n, line) =>
              n +
              Math.max(
                1,
                Math.ceil(line.length / Math.max(20, renderer.width - 10)),
              ),
            0,
          )
      : 0;
    const previewRows = Math.min(
      5,
      Math.floor(availableRows / 2),
      previewLines,
    );
    const descriptions = choices.some((c) => !!c.description);
    const menuRows = Math.min(
      8,
      choices.length * (descriptions ? 2 : 1),
      availableRows - previewRows,
    );
    preview.height = previewRows;
    menuHost.height = menuRows + previewRows + 5;
    previewText.content = clean(text);
    preview.visible = !!text;
    menu = new SelectRenderable(renderer, {
      options: choices.map((c) => ({
        name: clean(c.label),
        description: clean(c.description ?? ""),
        value: c.value,
      })),
      height: menuRows,
      showDescription: descriptions,
      backgroundColor: colors.bg,
      textColor: colors.ink,
      selectedBackgroundColor: colors.panel,
      selectedTextColor: colors.accent,
      focusedBackgroundColor: colors.bg,
      descriptionColor: colors.muted,
    });
    menuAction = action;
    menu.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, item: { value: string }) => {
        const fn = menuAction;
        closeMenu();
        Promise.resolve(fn?.(item.value)).catch((e) =>
          notice(e instanceof Error ? e.message : "Action failed."),
        );
      },
    );
    menuHost.add(menu);
    menuHost.visible = true;
    menu.focus();
  }
  const commandCatalog = [
    ["/question", "Reopen the pending question"],
    ["/model", "Choose a model"],
    ["/effort", "Adjust reasoning effort"],
    ["/files", "Browse local files"],
    ["/permissions", "Choose approval rules"],
    ["/tools", "See available tools and execution modes"],
    ["/cloud", "New session with the full Cloud Build harness"],
    ["/local", "New session with files and shell on this computer"],
    ["/skills", "Browse enabled account skills"],
    ["/plugins", "Browse connected MCP servers"],
    ["/mode", "Plan or build"],
    ["/target", "Choose an execution target"],
    ["/new", "Start a fresh conversation"],
    ["/stop", "Stop current work"],
    ["/approve", "Review a pending action"],
    ["/deny", "Decline a pending action"],
    ["/details", "Toggle full tool output"],
    ["/login", "Sign in to RIFT"],
    ["/connect", "Retry the service connection"],
    ["/app", "Open the RIFT app"],
    ["/quit", "Exit the terminal"],
  ];
  function suggestCommands() {
    if (suppressSlash || (menu && !slashOpen)) return;
    const query = input.plainText;
    if (!/^\/[a-z]*$/i.test(query)) {
      if (slashOpen) closeMenu();
      return;
    }
    const needle = query.slice(1).toLowerCase();
    const matches = commandCatalog.filter(
      ([name, description]) =>
        name.slice(1).includes(needle) ||
        description.toLowerCase().includes(needle),
    );
    if (!matches.length) {
      if (slashOpen) closeMenu();
      return;
    }
    const options = matches.map(([name, description]) => ({
      name,
      description,
      value: name,
    }));
    if (slashOpen && menu) {
      menu.options = options;
      menu.height = Math.min(6, options.length * 2);
      menuHost.height = menu.height + 5;
      return;
    }
    choose(
      "Commands · type to filter · ↑ ↓ select · Enter open",
      matches.map(([value, description]) => ({
        value,
        label: value,
        description,
      })),
      (value) => {
        suppressSlash = true;
        input.clear();
        suppressSlash = false;
        void submit(value);
      },
    );
    slashOpen = true;
    if (menu) {
      menu.height = Math.min(6, options.length * 2);
      menuHost.height = menu.height + 5;
      menu.blur();
    }
    input.focus();
  }
  input.onContentChange = suggestCommands;
  async function send(command: ConsoleCommand) {
    if (!session) {
      notice("Sign in with /login, then use /connect.");
      return;
    }
    try {
      await session.send(command);
    } catch (error) {
      notice(error instanceof Error ? error.message : "The action failed.");
    }
  }
  function review(id: string, approve = true) {
    const snap = session?.snapshot;
    const pending = snap?.approvals.find((a) => a.id === id);
    if (!pending || !snap?.chatId) {
      notice("This action is no longer waiting for approval.");
      return;
    }
    const chatId = snap.chatId;
    choose(
      `Review · ${pending.toolName}`,
      [
        { value: "cancel", label: "Keep waiting" },
        {
          value: "confirm",
          label: approve ? "Allow this action once" : "Deny this action",
        },
      ],
      (value) => {
        if (
          value === "confirm" &&
          session?.snapshot?.approvals.some((a) => a.id === id)
        )
          void send({ type: "approve", id, approve, chatId });
      },
      pending.preview,
    );
  }
  let orbTimer: ReturnType<typeof setInterval> | undefined;
  let orbStarted = 0;
  const reducedMotion = process.env.RIFT_REDUCED_MOTION === "1";
  function stopOrb() {
    if (orbTimer !== undefined) clearInterval(orbTimer);
    orbTimer = undefined;
    status.height = 1;
  }
  function paintOrb() {
    if (closed) return;
    const last = session?.snapshot?.entries.at(-1);
    const reasoning = last && /:reasoning(?:[:]|$)|:thinking$/.test(last.id);
    const intensity = riftActivityIntensity(
      Date.now() - orbStarted,
      reducedMotion,
    );
    const ink = `#${intensity.toString(16).repeat(3)}`;
    status.height = RIFT_ACTIVITY_MARK.length;
    status.content = new StyledText(
      RIFT_ACTIVITY_MARK.flatMap((line, index) => [
        fg(ink)(line),
        fg(colors.muted)(
          index === 1
            ? `  ${reasoning ? "Reasoning" : "Working"} · Ctrl+C to stop`
            : "",
        ),
        fg(colors.muted)(index < RIFT_ACTIVITY_MARK.length - 1 ? "\n" : ""),
      ]),
    );
  }
  function showQuestion() {
    const snap = session?.snapshot;
    const q = snap?.questions?.[0];
    if (!q || !snap?.chatId) {
      notice("No question is waiting for an answer.");
      return;
    }
    const chatId = snap.chatId;
    choose(
      "Your input · ↑ ↓ choose · Enter review",
      [
        ...q.options.map((label, i) => ({
          value: String(i),
          label: `${i + 1}  ${label}`,
        })),
        { value: "custom", label: "Write your own answer" },
      ],
      (value) => {
        if (value === "custom") {
          questionDraft = input.plainText;
          input.clear();
          customQuestion = { id: q.id, chatId };
          notice("Write your answer below · Enter sends · Esc cancels");
          input.focus();
        } else {
          const answer = q.options[Number(value)];
          choose(
            "Send this answer?",
            [
              { value: "send", label: "Send answer" },
              { value: "back", label: "Back to choices" },
            ],
            (action) => {
              if (action === "send")
                void send({ type: "answer", id: q.id, chatId, text: answer });
              else showQuestion();
            },
            answer,
          );
        }
      },
      q.title,
    );
  }
  function showEffort(choices: { value: string; label: string }[]) {
    choose(
      "RIFT intensity · ← → adjust · Enter apply",
      choices,
      (value) => void send(settingCommand("effort", value)),
      " \n \n ",
    );
    effortMenu = true;
    const paint = (index: number) => {
      const choice = choices[index];
      if (!choice) return;
      const top = index === choices.length - 1;
      const spectrum = ["#a3dfdf", "#a3ceee", "#b7bdff", "#ccb9ff", "#dabfff"];
      previewText.content = new StyledText([
        fg(top ? "#dabfff" : colors.accent)(
          `  ${top ? "◈" : "◇"}  ${choice.label}\n`,
        ),
        ...choices.map((_, i) =>
          fg(i <= index ? spectrum[Math.min(i, 4)] : colors.border)(
            i <= index ? "━━━━━━━━" : "────────",
          ),
        ),
        fg(colors.muted)("\n  Faster                         Deeper"),
      ]);
    };
    menu?.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) =>
      paint(index),
    );
    const current = Math.max(
      0,
      choices.findIndex((c) => c.value === session?.snapshot?.effort),
    );
    menu?.setSelectedIndex(current);
    paint(current);
  }
  function update() {
    if (closed || !session) return;
    const snap = session.snapshot;
    if (!snap) return;
    if (snap.status !== "streaming" && snap.status !== "submitted")
      interruptRequested = false;
    welcome.visible = snap.entries.length === 0;
    const anchor = welcome.visible ? "top" : "bottom";
    if (transcript.stickyStart !== anchor) transcript.stickyStart = anchor;
    const ids = new Set(snap.entries.map((e) => e.id));
    for (const [id, row] of entryNodes)
      if (!ids.has(id)) {
        transcript.remove(row.node);
        row.node.destroy();
        entryNodes.delete(id);
      }
    for (const entry of snap.entries) {
      const existing = entryNodes.get(entry.id);
      // Compare immutable field values, not entry identity: local snapshots
      // mutate entries while remote snapshots replace their objects.
      if (existing) {
        if (
          existing.sourceText === entry.text &&
          existing.sourceDetails === entry.details &&
          existing.kind === entry.kind &&
          existing.showDetails === details
        )
          continue;
        existing.node.content = paintEntry(entry, details);
        existing.node.bg = entry.kind === "user" ? colors.panel : colors.bg;
        existing.sourceText = entry.text;
        existing.sourceDetails = entry.details;
        existing.kind = entry.kind;
        existing.showDetails = details;
      } else {
        const node = new TextRenderable(renderer, {
          id: `entry-${entry.id}`,
          content: paintEntry(entry, details),
          paddingLeft: 1,
          paddingRight: 1,
          marginBottom: 1,
          bg: entry.kind === "user" ? colors.panel : colors.bg,
          fg:
            entry.kind === "error"
              ? colors.error
              : entry.kind === "activity"
                ? colors.muted
                : colors.ink,
        });
        transcript.add(node);
        entryNodes.set(entry.id, {
          node,
          kind: entry.kind,
          sourceText: entry.text,
          sourceDetails: entry.details,
          showDetails: details,
        });
      }
    }
    header.content = `RIFT  /  ${clean(options.cwd)}  ·  ${clean(snap.targetLabel)}`;
    footer.content = `${clean(snap.modelLabel)} · ${clean(snap.effort)} · ${clean(snap.approval)}  |  /help · Ctrl+P commands`;
    status.content = clean(
      snap.approvals.length
        ? `${snap.approvals.length} action(s) need your review · /approve`
        : snap.status === "streaming" || snap.status === "submitted"
          ? "Working · Ctrl+C to stop"
          : snap.status === "unavailable"
            ? "Not connected · /login or /connect"
            : "Ready · Start a new task",
    );
    const working =
      !snap.approvals.length &&
      !snap.questions?.length &&
      (snap.status === "streaming" || snap.status === "submitted");
    if (working) {
      if (orbTimer === undefined) {
        orbStarted = Date.now();
        if (!reducedMotion)
          orbTimer = setInterval(paintOrb, RIFT_ACTIVITY_FRAME_MS);
      }
      paintOrb();
    } else stopOrb();
    const pending = snap.approvals[0];
    if (pending && pending.id !== approvalId) {
      approvalId = pending.id;
      review(pending.id);
    }
    if (!pending) approvalId = null;
    const question = snap.questions?.[0];
    if (question) {
      notice("Your input is needed · /question");
      if (question.id !== questionId) {
        questionId = question.id;
        showQuestion();
      }
    } else {
      questionId = null;
      customQuestion = null;
    }
  }
  async function connect() {
    if (connecting || session || closed) return;
    connecting = true;
    try {
      const next = await options.connect(executionTarget);
      if (closed) {
        await next.close();
        return;
      }
      session = next;
      session.events.on("snapshot", update);
      session.events.on("connection-error", notice);
      session.events.on("disconnected", () =>
        notice("Connection interrupted. Saved work is retained."),
      );
      update();
    } catch (error) {
      notice(
        error instanceof Error
          ? error.message
          : "Could not connect. Use /connect to retry.",
      );
    } finally {
      connecting = false;
    }
  }
  async function browse(path = options.cwd) {
    try {
      const base = await realpath(options.cwd);
      const directory = await realpath(path);
      const rel = relative(base, directory);
      if (rel.startsWith("..") || isAbsolute(rel))
        throw new Error("Choose a file inside this directory.");
      const rows = (await readdir(directory, { withFileTypes: true })).sort(
        (a, b) =>
          Number(b.isDirectory()) - Number(a.isDirectory()) ||
          a.name.localeCompare(b.name),
      );
      choose(
        `Files · ${directory}`,
        [
          ...(rel ? [{ value: "..", label: "../" }] : []),
          ...rows.slice(0, 200).map((row) => ({
            value: row.name,
            label: row.name + (row.isDirectory() ? "/" : ""),
            description: row.isSymbolicLink() ? "Symbolic link" : "",
          })),
        ],
        async (name) => {
          const target = await realpath(resolve(directory, name));
          const inside = relative(base, target);
          if (inside.startsWith("..") || isAbsolute(inside)) {
            notice("This link points outside the current directory.");
            return;
          }
          if (
            name === ".." ||
            rows.find((r) => r.name === name)?.isDirectory()
          ) {
            await browse(target);
            return;
          }
          try {
            const { open } = await import("node:fs/promises");
            const file = await open(target, "r");
            let content: string;
            try {
              const bytes = Buffer.alloc(32000);
              const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
              content = bytes.subarray(0, bytesRead).toString("utf8");
            } finally {
              await file.close();
            }
            choose(
              inside,
              [
                { value: "back", label: "Back to files" },
                {
                  value: "context",
                  label: "Insert local file path (does not upload)",
                },
              ],
              (value) => {
                if (value === "back") void browse(directory);
                else {
                  input.insertText(
                    ` Inspect the file ${JSON.stringify(inside)}. `,
                  );
                  input.focus();
                }
              },
              content.includes("\0") ? "Binary file" : content,
            );
          } catch (e) {
            notice(e instanceof Error ? e.message : "Could not read file");
          }
        },
      );
    } catch (e) {
      notice(e instanceof Error ? e.message : "Could not browse files");
    }
  }
  async function submit(text: string) {
    if (customQuestion) {
      const q = customQuestion;
      if (!text.trim()) return;
      await send({ type: "answer", ...q, text });
      input.setText(questionDraft);
      customQuestion = null;
      return;
    }
    if (text.trim() === "/question") {
      showQuestion();
      return;
    }
    if (!text.trim()) return;
    if (text.trim() === "/cloud" || text.trim() === "/local") {
      if (
        connecting ||
        session?.snapshot?.status === "streaming" ||
        session?.snapshot?.status === "submitted" ||
        session?.snapshot?.approvals.length
      ) {
        notice(
          "Finish or stop the current task before changing execution mode.",
        );
        return;
      }
      const nextTarget = text.trim() === "/cloud" ? "cloud" : "local";
      choose(
        `Start a new ${nextTarget} session`,
        [
          { value: "cancel", label: "Keep current session" },
          { value: "switch", label: `Open ${nextTarget} session` },
        ],
        async (value) => {
          if (value !== "switch") return;
          input.clear();
          await session?.close();
          session = null;
          executionTarget = nextTarget;
          notice(`Connecting to ${nextTarget}…`);
          await connect();
        },
        "Current history stays saved. Local files are not automatically uploaded to Cloud.",
      );
      return;
    }
    if (text.trim() === "/tools") {
      input.clear();
      choose(
        "RIFT tools",
        [{ value: "close", label: "Back to task" }],
        () => {},
        "Local: read files, list files, write files, edit files, run commands.\nSkills and MCP discovery: /skills and /plugins.\nCloud Build: use /cloud for the shared RIFT tool harness.\nProject, bot and Studio management are not yet terminal commands.",
      );
      return;
    }
    if (text.trim() === "/files") {
      input.clear();
      await browse();
      return;
    }
    if (text.trim() === "/skills" || text.trim() === "/plugins") {
      input.clear();
      const kind = text.trim() === "/skills" ? "skills" : "plugins";
      try {
        if (!options.resources)
          throw new Error("Account resources are unavailable.");
        notice(`Loading ${kind}…`);
        const items = await options.resources(kind);
        if (!items.length) {
          notice(`No enabled ${kind} in your RIFT account.`);
          return;
        }
        choose(
          `RIFT ${kind}`,
          items.map((i) => ({
            value: i.id,
            label: i.name,
            description: i.status,
          })),
          (id) => {
            const item = items.find((i) => i.id === id)!;
            choose(
              item.name,
              [{ value: "close", label: "Close" }],
              () => {},
              item.description ?? item.tools?.join("\n") ?? item.name,
            );
          },
        );
      } catch (e) {
        notice(e instanceof Error ? e.message : "Could not load resources");
      }
      return;
    }
    if (text.trim() === "/connect") {
      input.clear();
      await connect();
      return;
    }
    if (text.trim() === "/login") {
      input.clear();
      notice("Complete sign-in in your browser.");
      try {
        await options.login();
        await connect();
      } catch (e) {
        notice(e instanceof Error ? e.message : "Sign-in failed.");
      }
      return;
    }
    const result = parseConsoleInput(text, session?.snapshot ?? null);
    if (result.kind === "error") {
      notice(result.message);
      return;
    }
    input.clear();
    if (result.kind === "command") {
      await send(result.command);
      return;
    }
    if (result.kind === "menu") {
      if (result.setting === "effort") {
        showEffort(result.choices);
        return;
      }
      choose(
        `Choose ${result.setting}`,
        result.choices,
        (value) => void send(settingCommand(result.setting, value)),
      );
      return;
    }
    if (result.kind === "approval") {
      choose(
        "Pending actions",
        result.choices.map((c) => ({ value: c.id, label: c.toolName })),
        (id) => review(id, result.approve),
      );
      return;
    }
    if (result.action === "quit") {
      await close();
      return;
    }
    if (result.action === "app") {
      await options
        .openApp()
        .catch(() => notice("Could not open the browser."));
      return;
    }
    if (result.action === "details") {
      details = !details;
      update();
      return;
    }
    choose(
      "RIFT commands · Enter open · Esc back",
      commandCatalog.map(([value, description]) => ({
        value,
        label: value,
        description,
      })),
      (value) => void submit(value),
    );
  }

  function close() {
    if (shutdown) return shutdown;
    closed = true;
    stopOrb();
    renderer.off("resize", paintWelcome);
    renderer.destroy();
    shutdown = session?.close() ?? Promise.resolve();
    return shutdown;
  }
  renderer.keyInput.on("keypress", (key) => {
    if (effortMenu && menu && (key.name === "left" || key.name === "right")) {
      key.preventDefault();
      key.stopPropagation();
      if (key.name === "left") menu.moveUp();
      else menu.moveDown();
    } else if (key.name === "escape" && customQuestion) {
      input.setText(questionDraft);
      customQuestion = null;
      notice("Answer not sent · /question to reopen");
    } else if (
      slashOpen &&
      menu &&
      (key.name === "up" || key.name === "down")
    ) {
      key.preventDefault();
      key.stopPropagation();
      if (key.name === "up") menu.moveUp();
      else menu.moveDown();
    } else if (slashOpen && menu && key.name === "tab") {
      key.preventDefault();
      key.stopPropagation();
      menu.selectCurrent();
    } else if (key.ctrl && key.name === "q") {
      key.preventDefault();
      void close();
    } else if (key.ctrl && key.name === "c") {
      key.preventDefault();
      key.stopPropagation();
      if (closed) return;
      const busy =
        session?.snapshot?.status === "streaming" ||
        session?.snapshot?.status === "submitted";
      if (busy && !interruptRequested) {
        interruptRequested = true;
        notice("Stopping · Press Ctrl+C again to exit");
        void send({ type: "stop", chatId: session!.snapshot!.chatId });
      } else void close();
    } else if (key.ctrl && key.name === "p") {
      key.preventDefault();
      void submit("/help");
    } else if (key.name === "escape" && menu) {
      key.preventDefault();
      suppressSlash = true;
      closeMenu();
      suppressSlash = false;
    } else if (key.name === "pageup" || key.name === "pagedown") {
      key.preventDefault();
      (menu && preview.visible ? preview : transcript).scrollBy(
        key.name === "pageup" ? -8 : 8,
      );
    }
  });
  void connect();
  return { input, transcript, submit, close, update };
}
export function paintEntry(entry: ConsoleEntry, details: boolean): StyledText {
  const text = entryText(entry, details);
  const reasoning = /:reasoning(?:[:]|$)/.test(entry.id);
  const color =
    entry.kind === "error"
      ? colors.error
      : reasoning
        ? "#c2b5ff"
        : entry.kind === "activity"
          ? "#a3dfdf"
          : colors.ink;
  // Only style complete inline spans; partial streaming delimiters stay readable.
  const chunks = text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g);
  return new StyledText(
    chunks.map((chunk) =>
      chunk.startsWith("**") && entry.kind === "assistant"
        ? bold(fg("#dabfff")(clean(chunk.slice(2, -2))))
        : fg(chunk.startsWith("`") ? "#a3dfdf" : color)(clean(chunk)),
    ),
  );
}
export function entryText(entry: ConsoleEntry, details: boolean) {
  const prefix =
    entry.kind === "user"
      ? "› "
      : /:reasoning(?:[:]|$)/.test(entry.id)
        ? "Reasoning\n"
        : entry.kind === "activity"
          ? "· "
          : "";
  return clean(
    prefix +
      entry.text +
      (details && entry.details ? "\n" + entry.details : ""),
  );
}
export async function runOpenTui(options: TuiOptions) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("Run rift in a terminal, or use rift doctor --json.");
  process.title = "rift";
  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    backgroundColor: colors.bg,
    targetFps: 60,
    useMouse: true,
  });
  const view = mountRiftTui(renderer, options);
  process.once("SIGTERM", () => {
    void view.close();
  });
  process.once("SIGHUP", () => {
    void view.close();
  });
}
