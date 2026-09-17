#!/usr/bin/env bun
import {
  createStandaloneSession,
  createLocalSession,
  readSettings,
  login,
} from "./standalone-session.js";
import { FrameScheduler } from "./frame-scheduler.js";
import { TerminalScreen } from "./screen.js";
import { HAND_CYCLE_MS, HAND_FRAME_COUNT } from "./terminal-art.js";
import { RIFT_ACTIVITY_FRAME_MS } from "./activity-orb.js";
import { parseArgs } from "node:util";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import {
  createConsoleSession,
  validateAppUrl,
  type ConsoleSession,
} from "./session.js";
import {
  parseConsoleInput,
  settingCommand,
  CONSOLE_HELP,
  type Setting,
} from "./commands.js";
import {
  previewPage,
  renderView,
  sanitizeTerminalText,
  type ConsoleMenu,
} from "./renderer.js";
import { createTerminalInput } from "./input.js";
import {
  CONSOLE_MAX_INPUT_LENGTH,
  type ConsoleChoice,
  type ConsoleCommand,
} from "./protocol.js";

const VERSION = "0.3.5";
const HELP = `RIFT Terminal ${VERSION}

Usage: rift [--app URL] [--resume]
       rift [--app URL] login
       rift --pair [--no-open]
       rift [--json] doctor [--online]
       rift [--json] models|skills|plugins list

OpenTUI terminal application with RIFT models, local files and reviewed shell commands.
Use --cloud for a durable remote Build session.
The app does not need to stay open. Sign in once with rift login.

Options:
  --resume     Restore the last terminal conversation (default: new session)
  --cloud      Use the remote Build worker instead of local tools
  --app URL    RIFT model service (default https://riftsys.app)
  --no-open    Print a private pairing link instead of opening the browser
  --online     Verify service and authentication with doctor
  --json       Machine-readable command output
  --help       Show this help
  --version    Show version

In the console:
${CONSOLE_HELP.map((line) => `  ${line}`).join("\n")}

UI preview: rift-console --app http://localhost:3020
`;

async function openUrl(url: string) {
  const program =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  await new Promise<void>((resolveOpen, reject) => {
    const child = spawn(program, args, { stdio: "ignore", shell: false });
    child.once("error", () =>
      reject(new Error("The browser could not be opened.")),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolveOpen()
        : reject(new Error("The browser could not be opened.")),
    );
  });
}

type Selection =
  | {
      kind: "setting";
      setting: Setting;
      choices: ConsoleChoice[];
      index: number;
      previewOffset: number;
    }
  | {
      kind: "approval";
      choices: NonNullable<ConsoleSession["snapshot"]>["approvals"];
      index: number;
      approve: boolean;
      chatId: string;
      previewOffset: number;
    }
  | {
      kind: "confirm";
      id: string;
      toolName: string;
      preview: string;
      approve: boolean;
      chatId: string;
      index: number;
      previewOffset: number;
      reviewed: boolean;
    };

async function runConsole(
  app: string,
  noOpen: boolean,
  paired = false,
  cloud = false,
) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error(
      "The interactive console needs a TTY. Run rift-console in a terminal, or use --json doctor.",
    );
  const session = paired
    ? await createConsoleSession({ appUrl: app, cwd: resolve(process.cwd()) })
    : cloud
      ? await createStandaloneSession(app, resolve(process.cwd()))
      : await createLocalSession(app, resolve(process.cwd()));
  const screen = new TerminalScreen();
  let input = "";
  let cursor = 0;
  let selection: Selection | null = null;
  let notice = paired ? "Approve this console in the RIFT app to connect." : "";
  let privateLink = paired && noOpen;
  let waitingForSnapshot = false;
  let scroll = 0;
  let pendingActions = 0;
  let ended = false;
  let lastInterrupt = 0;
  let historyIndex = 0;
  let helpRows: string[] | null = null;
  let helpIndex = 0;
  const history: string[] = [];
  let escapeTimer: ReturnType<typeof setTimeout> | undefined;
  const frames = new FrameScheduler(renderNow);
  let outputBlocked = false;
  let showDetails = false;
  const color =
    process.env.NO_COLOR === undefined && process.env.TERM !== "dumb";

  function menuView(): ConsoleMenu | null {
    if (helpRows)
      return {
        title: "RIFT console guide",
        rows: helpRows,
        selected: helpIndex,
      };
    if (!selection) return null;
    if (selection.kind === "setting")
      return {
        title: `Choose ${selection.setting}`,
        rows: selection.choices.map((choice) => choice.label),
        selected: selection.index,
        preview: selection.choices[selection.index]?.description,
        previewOffset: selection.previewOffset,
      };
    if (selection.kind === "approval")
      return {
        title: selection.approve
          ? "Review an action to allow once"
          : "Review an action to deny",
        rows: selection.choices.map((choice) => choice.toolName),
        selected: selection.index,
        preview: selection.choices[selection.index]?.preview,
        previewOffset: selection.previewOffset,
      };
    const complete =
      selection.reviewed ||
      previewPage(
        selection.preview,
        process.stdout.columns || 80,
        process.stdout.rows || 24,
        selection.previewOffset,
      ).atEnd;
    return {
      title: selection.toolName,
      preview: selection.preview,
      previewOffset: selection.previewOffset,
      rows: [
        "Cancel",
        complete
          ? selection.approve
            ? "Allow this action once"
            : "Deny this action"
          : "Review remaining preview with PageDown first",
      ],
      selected: selection.index,
    };
  }
  function renderNow() {
    if (ended || outputBlocked) return;
    const linkNotice =
      privateLink && !session.connected
        ? process.stdout.columns <= 60
          ? "Use /app to pair. The complete private link is in terminal scrollback."
          : `Private pairing link (do not share): ${session.pairingUrl}`
        : notice;
    const view = renderView({
      columns: process.stdout.columns || 80,
      rows: process.stdout.rows || 24,
      snapshot: session.snapshot,
      connected: session.connected,
      cwd: process.cwd(),
      input,
      inputCursor: cursor,
      showDetails,
      notice: linkNotice,
      menu: menuView(),
      scroll,
      color,
      animationTime: process.env.RIFT_REDUCED_MOTION === "1" ? 0 : Date.now(),
    });
    if (
      !process.stdout.write(
        screen.paint(view.frame, process.stdout.columns || 80, view.cursor),
      )
    ) {
      outputBlocked = true;
      process.stdout.once("drain", () => {
        outputBlocked = false;
        frames.request(0);
      });
    }
    // Repaint only while work is live; snapshots still own all agent state.
    if (
      session.connected &&
      !session.snapshot?.approvals.length &&
      (session.snapshot?.status === "submitted" ||
        session.snapshot?.status === "streaming")
    ) {
      frames.animateAfter(
        process.env.RIFT_REDUCED_MOTION === "1"
          ? undefined
          : RIFT_ACTIVITY_FRAME_MS,
      );
    } else if (
      !session.snapshot?.entries.length &&
      !menuView() &&
      color &&
      (process.stdout.columns || 80) >= 56 &&
      (process.stdout.rows || 24) >= 38 &&
      process.env.RIFT_REDUCED_MOTION !== "1"
    ) {
      frames.animateAfter(HAND_CYCLE_MS / HAND_FRAME_COUNT);
    } else frames.animateAfter(undefined);
  }
  function redraw() {
    frames.request();
  }
  function inputRedraw() {
    frames.request(0);
  }
  async function finish() {
    if (ended) return;
    ended = true;
    clearTimeout(escapeTimer);
    frames.close();
    process.stdin.off("data", onData);
    process.stdout.off("resize", redraw);
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    keyboard.close();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdout.write("\x1b[0m\x1b[?2004l\x1b[?25h\x1b[?1049l\x1b[23;2t");
    await session.close();
    process.stdout.write(
      cloud || paired
        ? "RIFT console closed. Any accepted cloud task continues on its worker.\n"
        : "RIFT terminal closed. Local work stopped; your session and file changes are saved.\n",
    );
  }
  async function send(command: ConsoleCommand, submittedInput?: string) {
    if (pendingActions > 0 && command.type !== "stop") {
      notice = "Waiting for RIFT to acknowledge the last action.";
      redraw();
      return;
    }
    pendingActions++;
    const oldChat = session.snapshot?.chatId;
    notice = "Sending to RIFT…";
    redraw();
    try {
      await session.send(command);
      if (submittedInput !== undefined && input === submittedInput) {
        input = "";
        cursor = 0;
      }
      notice = command.type === "stop" ? "Stop requested in RIFT." : "";
      if (oldChat !== session.snapshot?.chatId) scroll = 0;
    } catch (error) {
      notice =
        error instanceof Error
          ? error.message
          : "RIFT could not accept this action.";
    } finally {
      pendingActions--;
      redraw();
    }
  }
  async function submit() {
    const parsed = parseConsoleInput(input, session.snapshot);
    if (parsed.kind === "error") {
      notice = parsed.message;
      redraw();
      return;
    }
    if (parsed.kind === "local") {
      input = "";
      cursor = 0;
      if (parsed.action === "quit") {
        await finish();
        return;
      }
      if (parsed.action === "details") {
        showDetails = !showDetails;
      } else if (parsed.action === "help") {
        selection = null;
        notice = CONSOLE_HELP.join("\n");
        // A scrollable menu keeps the complete guide visible on small terminals.
        helpRows = [...CONSOLE_HELP];
        helpIndex = 0;
      } else {
        try {
          await openUrl(
            session.connected ? session.appUrl : session.pairingUrl,
          );
          privateLink = false;
          notice = paired
            ? "RIFT opened. Approve the pairing request to connect."
            : "RIFT opened.";
        } catch {
          privateLink = true;
          notice = "Open the private pairing link in your browser.";
        }
      }
      redraw();
      return;
    }
    helpRows = null;
    if (parsed.kind === "menu") {
      const current = session.snapshot;
      const selectedValue =
        parsed.setting === "permissions"
          ? current?.approval
          : current?.[parsed.setting];
      selection = {
        kind: "setting",
        setting: parsed.setting,
        choices: parsed.choices,
        index: Math.max(
          0,
          parsed.choices.findIndex((choice) => choice.value === selectedValue),
        ),
        previewOffset: 0,
      };
      input = "";
      cursor = 0;
      redraw();
      return;
    }
    if (parsed.kind === "approval") {
      selection = {
        kind: "approval",
        choices: parsed.choices,
        approve: parsed.approve,
        chatId: session.snapshot!.chatId!,
        index: 0,
        previewOffset: 0,
      };
      input = "";
      cursor = 0;
      redraw();
      return;
    }
    const text = input;
    if (text && history[history.length - 1] !== text) {
      history.push(text);
      if (history.length > 100) history.shift();
    }
    historyIndex = history.length;
    scroll = 0;
    await send(parsed.command, text);
  }
  const keyboard = createTerminalInput(
    (text, key) => {
      if (ended) return;
      if (key.ctrl && key.name === "c") {
        if (selection || helpRows) {
          selection = null;
          helpRows = null;
        } else if (
          session.snapshot?.status === "streaming" ||
          session.snapshot?.status === "submitted"
        )
          void send({ type: "stop", chatId: session.snapshot.chatId });
        else if (input) {
          input = "";
          cursor = 0;
        } else if (Date.now() - lastInterrupt < 1500) void finish();
        else {
          lastInterrupt = Date.now();
          notice = "Press Ctrl+C again to exit.";
        }
        inputRedraw();
        return;
      }
      if (key.ctrl && key.name === "d" && !input) {
        void finish();
        return;
      }
      if (key.name === "escape") {
        selection = null;
        helpRows = null;
        notice = "";
        inputRedraw();
        return;
      }
      if (helpRows) {
        if (key.name === "down")
          helpIndex = Math.min(helpRows.length - 1, helpIndex + 1);
        if (key.name === "up") helpIndex = Math.max(0, helpIndex - 1);
        if (key.name === "return") helpRows = null;
        inputRedraw();
        return;
      }
      if (selection) {
        const length =
          selection.kind === "confirm" ? 2 : selection.choices.length;
        const selectedPreview =
          selection.kind === "confirm"
            ? selection.preview
            : selection.kind === "approval"
              ? selection.choices[selection.index].preview
              : selection.choices[selection.index].description || "";
        if (key.name === "pageup" || key.name === "pagedown") {
          const page = previewPage(
            selectedPreview,
            process.stdout.columns || 80,
            process.stdout.rows || 24,
            selection.previewOffset,
          );
          const next = previewPage(
            selectedPreview,
            process.stdout.columns || 80,
            process.stdout.rows || 24,
            page.offset +
              (key.name === "pagedown" ? 1 : -1) *
                Math.max(1, page.pageSize - 1),
          );
          selection.previewOffset = next.offset;
          if (selection.kind === "confirm" && next.atEnd)
            selection.reviewed = true;
        }
        if (key.name === "down" || key.name === "up") {
          selection.index =
            (selection.index + (key.name === "down" ? 1 : -1) + length) %
            length;
          if (selection.kind !== "confirm") selection.previewOffset = 0;
        }
        if (key.name === "return") {
          const chosen = selection;
          if (chosen.kind === "setting") {
            selection = null;
            void send(
              settingCommand(
                chosen.setting,
                chosen.choices[chosen.index].value,
              ),
            );
          } else if (chosen.kind === "approval") {
            const approval = chosen.choices[chosen.index];
            selection = {
              kind: "confirm",
              ...approval,
              approve: chosen.approve,
              chatId: chosen.chatId,
              index: 0,
              previewOffset: chosen.previewOffset,
              reviewed: previewPage(
                approval.preview,
                process.stdout.columns || 80,
                process.stdout.rows || 24,
                chosen.previewOffset,
              ).atEnd,
            };
          } else {
            const complete =
              chosen.reviewed ||
              previewPage(
                chosen.preview,
                process.stdout.columns || 80,
                process.stdout.rows || 24,
                chosen.previewOffset,
              ).atEnd;
            if (chosen.index === 0 || complete) {
              selection = null;
              if (chosen.index === 1)
                void send({
                  type: "approve",
                  id: chosen.id,
                  approve: chosen.approve,
                  chatId: chosen.chatId,
                });
            }
          }
        }
        inputRedraw();
        return;
      }
      const chars = Array.from(input);
      if (key.name === "pageup")
        scroll = Math.min(
          100_000,
          scroll + Math.max(5, process.stdout.rows - 12),
        );
      else if (key.name === "pagedown")
        scroll = Math.max(0, scroll - Math.max(5, process.stdout.rows - 12));
      else if (key.name === "return") {
        void submit();
        return;
      } else if (key.name === "enter" || (key.ctrl && key.name === "j")) {
        chars.splice(cursor, 0, "\n");
        cursor++;
      } else if (key.name === "backspace") {
        if (cursor > 0) chars.splice(--cursor, 1);
      } else if (key.name === "delete") chars.splice(cursor, 1);
      else if (key.name === "left") cursor = Math.max(0, cursor - 1);
      else if (key.name === "right")
        cursor = Math.min(chars.length, cursor + 1);
      else if (key.name === "home" || (key.ctrl && key.name === "a"))
        cursor = 0;
      else if (key.name === "end" || (key.ctrl && key.name === "e"))
        cursor = chars.length;
      else if (key.ctrl && key.name === "u") {
        chars.splice(0, cursor);
        cursor = 0;
      } else if (key.name === "up" || key.name === "down") {
        historyIndex = Math.max(
          0,
          Math.min(history.length, historyIndex + (key.name === "up" ? -1 : 1)),
        );
        input = history[historyIndex] ?? "";
        cursor = Array.from(input).length;
        inputRedraw();
        return;
      } else if (!key.ctrl && !key.meta && text) {
        const insert = Array.from(
          sanitizeTerminalText(text).replace(/\n/g, ""),
        );
        chars.splice(cursor, 0, ...insert);
        cursor += insert.length;
      }
      input = chars.join("").slice(0, CONSOLE_MAX_INPUT_LENGTH);
      cursor = Math.min(cursor, Array.from(input).length);
      inputRedraw();
    },
    (pasted) => {
      if (selection || helpRows) return;
      const chars = Array.from(input);
      const insert = Array.from(
        sanitizeTerminalText(pasted.replace(/\r\n?/g, "\n")),
      );
      chars.splice(cursor, 0, ...insert);
      input = chars.join("").slice(0, CONSOLE_MAX_INPUT_LENGTH);
      cursor = Math.min(cursor + insert.length, Array.from(input).length);
      inputRedraw();
    },
  );
  function onData(chunk: string) {
    keyboard.write(chunk);
    clearTimeout(escapeTimer);
    escapeTimer = setTimeout(() => keyboard.flushEscape(), 40);
  }
  function onSigint() {
    void finish();
  }
  function onSigterm() {
    void finish();
  }
  let seenApproval: string | undefined;
  session.events.on("snapshot", () => {
    privateLink = false;
    const pending = session.snapshot?.approvals[0];
    if (
      pending &&
      pending.id !== seenApproval &&
      !selection &&
      !input &&
      !helpRows
    ) {
      seenApproval = pending.id;
      selection = {
        kind: "confirm",
        ...pending,
        approve: true,
        chatId: session.snapshot!.chatId!,
        index: 0,
        previewOffset: 0,
        reviewed: false,
      };
    }
    if (!pending && selection && selection.kind !== "setting") selection = null;
    if (waitingForSnapshot) {
      waitingForSnapshot = false;
      notice =
        session.snapshot?.status === "unavailable"
          ? "RIFT connected. Open a conversation or use /new."
          : "";
    }
    redraw();
  });
  session.events.on("connected", () => {
    waitingForSnapshot = true;
    notice = "Connected. Waiting for the authenticated RIFT session.";
    redraw();
  });
  session.events.on("disconnected", () => {
    selection = null;
    notice =
      "App disconnected. Open /app to reconnect. No action will be resent automatically.";
    redraw();
  });
  session.events.on("connection-error", (message: string) => {
    notice = message;
    redraw();
  });
  process.title = "rift";
  process.stdin.setEncoding("utf8");
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", onData);
  process.stdout.on("resize", redraw);
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  if (paired && noOpen)
    process.stdout.write(
      `Private RIFT pairing link (do not share):\n${session.pairingUrl}\n`,
    );
  process.stdout.write(
    "\x1b[22;2t\x1b]0;RIFT Terminal\x07\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J",
  );
  renderNow();
  if (paired && !noOpen) {
    try {
      await openUrl(session.pairingUrl);
    } catch {
      privateLink = true;
      notice = "Open the private pairing link in your browser.";
    }
    redraw();
  }
}

async function main() {
  const args = parseArgs({
    options: {
      app: { type: "string" },
      pair: { type: "boolean" },
      online: { type: "boolean" },
      resume: { type: "boolean" },
      cloud: { type: "boolean" },
      "no-open": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    allowPositionals: true,
  });
  if (args.values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (args.values.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const saved = await readSettings();
  const app = validateAppUrl(
    args.values.app ??
      process.env.RIFT_APP_URL ??
      saved?.app ??
      "https://riftsys.app",
  ).toString();
  if (args.positionals[0] === "login") {
    await login(app, openUrl);
    process.stdout.write(
      "Signed in. Run rift to start an independent session.\n",
    );
    return;
  }
  if (args.positionals[0] === "doctor" && args.positionals.length === 1) {
    if (args.values.online) {
      const { readResources } = await import("./resources.js");
      const models = await readResources(app, "models");
      process.stdout.write(
        args.values.json
          ? JSON.stringify({
              ok: true,
              version: VERSION,
              appUrl: app,
              reachable: true,
              authenticated: true,
              models: models.length,
            }) + "\n"
          : `RIFT service connected. ${models.length} models available.\n`,
      );
      return;
    }
    const result = {
      ok: true,
      version: VERSION,
      node: process.versions.node,
      renderer: "opentui",
      runtime: "bun" in process.versions ? "bun" : "node",
      appUrl: app,
      tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      auth: {
        source: process.env.RIFT_API_KEY
          ? "environment"
          : saved
            ? "saved-personal-key"
            : "missing",
        paired: false,
        required: "Run rift login once, or set RIFT_API_KEY.",
      },
      harness: args.values.cloud
        ? "independent-durable-build"
        : "local-tool-loop",
      localFiles: args.values.cloud
        ? "Cloud tasks use the configured RIFT execution target."
        : "Files and approved commands execute in the current local directory.",
    };
    process.stdout.write(
      args.values.json
        ? `${JSON.stringify(result)}\n`
        : `RIFT Console ${result.version}\nNode ${result.node}\nApp ${app}\nAuthentication: ${result.auth.required}\n${result.localFiles}\n`,
    );
    return;
  }
  if (
    ["models", "skills", "plugins"].includes(args.positionals[0]) &&
    args.positionals[1] === "list" &&
    args.positionals.length === 2
  ) {
    const { readResources } = await import("./resources.js");
    const items = await readResources(
      app,
      args.positionals[0] as "models" | "skills" | "plugins",
    );
    process.stdout.write(
      args.values.json
        ? JSON.stringify({ ok: true, items }) + "\n"
        : items.map((i) => `${i.id}  ${i.name}`).join("\n") + "\n",
    );
    return;
  }
  if (args.positionals.length || args.values.json)
    throw new Error(
      "Use rift-console --help for supported commands. --json is supported with doctor.",
    );
  if (args.values.pair) {
    await runConsole(app, Boolean(args.values["no-open"]), true, false);
    return;
  }
  const { runOpenTui } = await import("./opentui.js");
  await runOpenTui({
    cwd: resolve(process.cwd()),
    connect: (target) =>
      (target ? target === "cloud" : args.values.cloud)
        ? createStandaloneSession(
            app,
            resolve(process.cwd()),
            Boolean(args.values.resume),
          )
        : createLocalSession(
            app,
            resolve(process.cwd()),
            Boolean(args.values.resume),
          ),
    login: () => login(app, openUrl),
    openApp: () => openUrl(app),
    resources: async (kind) =>
      (await import("./resources.js")).readResources(app, kind),
  });
}
main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "RIFT console could not start.";
  if (process.argv.includes("--json"))
    process.stdout.write(
      `${JSON.stringify({ ok: false, error: { code: "CONSOLE_START_FAILED", message } })}\n`,
    );
  else process.stderr.write(`RIFT: ${sanitizeTerminalText(message)}\n`);
  process.exitCode = 1;
});
