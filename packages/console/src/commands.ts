import {
  CONSOLE_MAX_INPUT_LENGTH,
  type ConsoleChoice,
  type ConsoleCommand,
  type ConsoleSnapshot,
} from "./protocol.js";

export type Setting = "model" | "effort" | "permissions" | "mode" | "target";
export type ParsedInput =
  | { kind: "command"; command: ConsoleCommand }
  | { kind: "menu"; setting: Setting; choices: ConsoleChoice[] }
  | {
      kind: "approval";
      approve: boolean;
      choices: ConsoleSnapshot["approvals"];
    }
  | { kind: "local"; action: "help" | "app" | "quit" | "details" }
  | { kind: "error"; message: string };

export function settingCommand(
  setting: Setting,
  value: string,
): ConsoleCommand {
  const type =
    setting === "permissions" ? "set-approval" : (`set-${setting}` as const);
  return { type, value };
}
export function parseConsoleInput(
  input: string,
  snapshot: ConsoleSnapshot | null,
): ParsedInput {
  const value = input.trim();
  if (!value)
    return { kind: "error", message: "Write a message or choose /help." };
  if (value.length > CONSOLE_MAX_INPUT_LENGTH)
    return {
      kind: "error",
      message: "Keep the message under 32,000 characters.",
    };
  const [name, ...rest] = value.split(/\s+/);
  if (["/help", "/app", "/quit", "/details"].includes(name)) {
    if (rest.length)
      return { kind: "error", message: `${name} takes no arguments.` };
    return {
      kind: "local",
      action: name.slice(1) as "help" | "app" | "quit" | "details",
    };
  }
  if (snapshot && name === "/new" && rest.length === 0)
    return { kind: "command", command: { type: "new-chat" } };
  if (!snapshot || snapshot.status === "unavailable")
    return {
      kind: "error",
      message: "Connect to the RIFT app and sign in before sending actions.",
    };
  if (!value.startsWith("/"))
    return {
      kind: "command",
      command: { type: "submit", text: value, chatId: snapshot.chatId },
    };
  if (name === "/new" || name === "/stop") {
    if (rest.length)
      return { kind: "error", message: `${name} takes no arguments.` };
    return {
      kind: "command",
      command:
        name === "/new"
          ? { type: "new-chat" }
          : { type: "stop", chatId: snapshot.chatId },
    };
  }
  if (name === "/approve" || name === "/deny") {
    if (rest.length)
      return {
        kind: "error",
        message:
          "Select the pending action interactively, then confirm your decision.",
      };
    if (!snapshot.chatId || !snapshot.approvals.length)
      return {
        kind: "error",
        message: "There are no pending approvals in this conversation.",
      };
    return {
      kind: "approval",
      approve: name === "/approve",
      choices: snapshot.approvals,
    };
  }
  const setting = name.slice(1) as Setting;
  const choices =
    setting === "model"
      ? snapshot.models
      : setting === "effort"
        ? snapshot.efforts
        : setting === "target"
          ? snapshot.targets
          : setting === "permissions"
            ? snapshot.permissions
            : setting === "mode"
              ? snapshot.modes
              : undefined;
  if (!choices)
    return { kind: "error", message: `Unknown command ${name}. Use /help.` };
  if (!choices.length)
    return {
      kind: "error",
      message: `No ${setting} choices are available for this session.`,
    };
  if (!rest.length) return { kind: "menu", setting, choices };
  const requested = rest.join(" ").toLowerCase();
  const matches = choices.filter(
    (choice) =>
      choice.value.toLowerCase() === requested ||
      choice.label.toLowerCase() === requested,
  );
  if (matches.length !== 1)
    return {
      kind: "error",
      message: `Use /${setting} to select an available option.`,
    };
  return {
    kind: "command",
    command: settingCommand(setting, matches[0].value),
  };
}

export const CONSOLE_HELP = [
  "Write a message to work in the active RIFT conversation.",
  "/model  /effort  /permissions  /mode  /target   Choose session settings",
  "/approve  /deny   Review a pending tool action and confirm once",
  "/new   Start a conversation     /stop   Stop the active run",
  "/app   Open the pairing page   /help   Show this guide   /quit   Exit",
  "↑ ↓ menu or input history · Enter select/send · Esc dismiss · Ctrl+C stop",
  "PageUp/PageDown scroll · Ctrl+J newline · Ctrl+D exit on an empty input",
  "/details   Expand or collapse tool output",
  "Local sessions run here independently. Cloud sessions continue on their worker.",
];
