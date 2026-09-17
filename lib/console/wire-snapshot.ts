import {
  CONSOLE_MAX_MESSAGE_BYTES,
  type ConsoleSnapshot,
} from "@/packages/console/src/protocol";

/** Keep full approval previews; only older transcript content may be omitted. */
export function encodeConsoleSnapshot(snapshot: ConsoleSnapshot): string {
  const encoder = new TextEncoder();
  const entries = [...snapshot.entries];
  const encode = () =>
    JSON.stringify({ type: "snapshot", snapshot: { ...snapshot, entries } });
  let json = encode();
  while (
    encoder.encode(json).byteLength > CONSOLE_MAX_MESSAGE_BYTES &&
    entries.length
  ) {
    if (entries.length > 1) entries.shift();
    else if (entries[0].text.length > 1000) {
      const characters = Array.from(entries[0].text);
      entries[0] = {
        ...entries[0],
        text: `…\n${characters.slice(-Math.floor(characters.length / 2)).join("")}`,
      };
    } else entries.shift();
    json = encode();
  }
  if (encoder.encode(json).byteLength > CONSOLE_MAX_MESSAGE_BYTES) {
    // A preview must never be partially shown as if it were a complete action.
    // Clear actionable state so the receiver cannot retain an older snapshot.
    const unavailable: ConsoleSnapshot = {
      chatId: null,
      status: "unavailable",
      entries: [
        {
          id: "console-display-limit",
          kind: "error",
          text: "This conversation exceeds the console display limit. Review it in the RIFT app.",
        },
      ],
      model: "",
      modelLabel: "RIFT app",
      effort: "",
      approval: "",
      mode: "",
      target: "",
      targetLabel: "",
      models: [],
      efforts: [],
      targets: [],
      permissions: [],
      modes: [],
      approvals: [],
      queued: 0,
    };
    return JSON.stringify({ type: "snapshot", snapshot: unavailable });
  }
  return json;
}
