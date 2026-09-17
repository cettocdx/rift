import { validateConsoleCommand } from "./command-validator.mjs";
/** Browser-safe wire contract for a console paired to an authenticated RIFT app. */
export const CONSOLE_PROTOCOL = "rift-console-v1";
export const CONSOLE_VERSION = 1;
export const CONSOLE_SOCKET_PATH = "/console";
export const CONSOLE_MAX_MESSAGE_BYTES = 1024 * 1024;
export { CONSOLE_MAX_INPUT_LENGTH } from "./command-validator.mjs";

export type ConsoleChoice = {
  value: string;
  label: string;
  description?: string;
};
export type ConsoleEntry = {
  id: string;
  kind: "user" | "assistant" | "activity" | "error";
  text: string;
  details?: string;
};
export type ConsoleQuestion = { id: string; title: string; options: string[] };
export type ConsoleSnapshot = {
  questions?: ConsoleQuestion[];
  chatId: string | null;
  status: "ready" | "submitted" | "streaming" | "error" | "unavailable";
  entries: ConsoleEntry[];
  model: string;
  modelLabel: string;
  effort: string;
  approval: string;
  mode: string;
  target: string;
  targetLabel: string;
  models: ConsoleChoice[];
  efforts: ConsoleChoice[];
  targets: ConsoleChoice[];
  /** Optional lists allow the app to expose only currently supported settings. */
  permissions?: ConsoleChoice[];
  modes?: ConsoleChoice[];
  approvals: { id: string; toolName: string; preview: string }[];
  queued: number;
};
export type ConsoleCommand =
  | { type: "answer"; id: string; text: string; chatId: string }
  | { type: "submit"; text: string; chatId: string | null }
  | { type: "stop"; chatId: string | null }
  | { type: "approve"; id: string; approve: boolean; chatId: string }
  | {
      type:
        | "set-model"
        | "set-effort"
        | "set-approval"
        | "set-mode"
        | "set-target";
      value: string;
    }
  | { type: "new-chat" };
export type ConsoleServerMessage =
  | { type: "connected"; version: 1; sessionId: string; cwd: string }
  | { type: "command"; id: string; command: ConsoleCommand };
export type ConsoleAppMessage =
  | { type: "snapshot"; snapshot: ConsoleSnapshot }
  | { type: "result"; id: string; accepted: boolean; error?: string };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function text(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length <= max;
}
function choices(value: unknown): value is ConsoleChoice[] {
  return (
    Array.isArray(value) &&
    value.length <= 500 &&
    value.every(
      (item) =>
        record(item) &&
        text(item.value) &&
        text(item.label) &&
        (item.description === undefined || text(item.description, 2000)),
    )
  );
}
export function isConsoleSnapshot(value: unknown): value is ConsoleSnapshot {
  if (!record(value)) return false;
  return (
    (value.chatId === null || text(value.chatId)) &&
    ["ready", "submitted", "streaming", "error", "unavailable"].includes(
      String(value.status),
    ) &&
    Array.isArray(value.entries) &&
    value.entries.length <= 500 &&
    value.entries.every(
      (entry) =>
        record(entry) &&
        text(entry.id) &&
        ["user", "assistant", "activity", "error"].includes(
          String(entry.kind),
        ) &&
        text(entry.text, 100_000) &&
        (entry.details === undefined || text(entry.details, 60_000)),
    ) &&
    [
      "model",
      "modelLabel",
      "effort",
      "approval",
      "mode",
      "target",
      "targetLabel",
    ].every((key) => text(value[key])) &&
    (value.questions === undefined ||
      (Array.isArray(value.questions) &&
        value.questions.length <= 3 &&
        value.questions.every(
          (q) =>
            record(q) &&
            text(q.id) &&
            text(q.title, 2000) &&
            Array.isArray(q.options) &&
            q.options.length <= 6 &&
            q.options.every((o) => text(o, 500)),
        ))) &&
    choices(value.models) &&
    choices(value.efforts) &&
    choices(value.targets) &&
    (value.permissions === undefined || choices(value.permissions)) &&
    (value.modes === undefined || choices(value.modes)) &&
    Array.isArray(value.approvals) &&
    value.approvals.length <= 100 &&
    value.approvals.every(
      (item) =>
        record(item) &&
        text(item.id) &&
        text(item.toolName) &&
        text(item.preview, 16_000),
    ) &&
    Number.isSafeInteger(value.queued) &&
    (value.queued as number) >= 0
  );
}
export function isConsoleCommand(value: unknown): value is ConsoleCommand {
  return validateConsoleCommand(value);
}
export function isConsoleAppMessage(
  value: unknown,
): value is ConsoleAppMessage {
  if (!record(value)) return false;
  if (value.type === "snapshot") return isConsoleSnapshot(value.snapshot);
  return (
    value.type === "result" &&
    text(value.id, 128) &&
    typeof value.accepted === "boolean" &&
    (value.error === undefined || text(value.error, 2000))
  );
}
export function isConsoleServerMessage(
  value: unknown,
): value is ConsoleServerMessage {
  if (!record(value)) return false;
  if (value.type === "connected")
    return (
      value.version === 1 && text(value.sessionId, 128) && text(value.cwd, 8192)
    );
  return (
    value.type === "command" &&
    text(value.id, 128) &&
    isConsoleCommand(value.command)
  );
}
