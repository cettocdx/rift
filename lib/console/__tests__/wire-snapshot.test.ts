import { encodeConsoleSnapshot } from "../wire-snapshot";
import {
  CONSOLE_MAX_MESSAGE_BYTES,
  isConsoleAppMessage,
  type ConsoleSnapshot,
} from "@/packages/console/src/protocol";

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength;

function makeSnapshot(): ConsoleSnapshot {
  return {
    chatId: "chat-a",
    status: "streaming",
    entries: [],
    model: "model-a",
    modelLabel: "Model A",
    effort: "high",
    approval: "ask",
    mode: "agent",
    target: "desktop",
    targetLabel: "My Mac",
    models: [{ value: "model-a", label: "Model A" }],
    efforts: [{ value: "high", label: "High" }],
    targets: [{ value: "desktop", label: "My Mac" }],
    approvals: [],
    queued: 0,
  };
}

it("fits the UTF-8 wire limit by dropping oldest transcript entries while preserving complete long approvals", () => {
  const snapshot = makeSnapshot();
  snapshot.entries = Array.from({ length: 14 }, (_, index) => ({
    id: `message-${index}`,
    kind: "assistant",
    text: `${index}: ${"界".repeat(30_000)} END ${index}`,
  }));
  snapshot.approvals = Array.from({ length: 30 }, (_, index) => ({
    id: `approval-${index}`,
    toolName: "run_terminal_cmd",
    preview: `Review ${index}\n${"界".repeat(5_950)}\nFINAL COMMAND ${index}`,
  }));
  const original = JSON.stringify(snapshot);
  expect(
    byteLength(JSON.stringify({ type: "snapshot", snapshot })),
  ).toBeGreaterThan(CONSOLE_MAX_MESSAGE_BYTES);

  const json = encodeConsoleSnapshot(snapshot);
  const message = JSON.parse(json);
  expect(byteLength(json)).toBeLessThanOrEqual(CONSOLE_MAX_MESSAGE_BYTES);
  expect(isConsoleAppMessage(message)).toBe(true);
  expect(message.snapshot.approvals).toEqual(snapshot.approvals);
  expect(message.snapshot.entries.length).toBeLessThan(snapshot.entries.length);
  expect(message.snapshot.entries.length).toBeGreaterThan(0);
  expect(message.snapshot.entries).toEqual(
    snapshot.entries.slice(-message.snapshot.entries.length),
  );
  expect(message.snapshot.entries.at(-1)).toEqual(snapshot.entries.at(-1));
  expect(JSON.stringify(snapshot)).toBe(original);
});

it("keeps complete Unicode code points when the newest entry alone must be shortened beside approvals", () => {
  const snapshot = makeSnapshot();
  // The protocol supports up to 100 previews; these remain individually below
  // its 16,000-character bound and fit without any transcript content.
  snapshot.approvals = Array.from({ length: 72 }, (_, index) => ({
    id: `approval-${index}`,
    toolName: "edit_file",
    preview: `${"界".repeat(4_000)}\nReview the complete operation ${index}`,
  }));
  expect(
    byteLength(JSON.stringify({ type: "snapshot", snapshot })),
  ).toBeLessThan(CONSOLE_MAX_MESSAGE_BYTES);
  const text = `a${"😀".repeat(49_999)}z`;
  snapshot.entries = [{ id: "newest", kind: "assistant", text }];
  expect(
    byteLength(JSON.stringify({ type: "snapshot", snapshot })),
  ).toBeGreaterThan(CONSOLE_MAX_MESSAGE_BYTES);

  const json = encodeConsoleSnapshot(snapshot);
  const message = JSON.parse(json);
  expect(byteLength(json)).toBeLessThanOrEqual(CONSOLE_MAX_MESSAGE_BYTES);
  expect(isConsoleAppMessage(message)).toBe(true);
  expect(message.snapshot.approvals).toEqual(snapshot.approvals);
  expect(message.snapshot.entries).toHaveLength(1);
  const tail: string = message.snapshot.entries[0].text;
  expect(tail.startsWith("…\n")).toBe(true);
  expect(tail.endsWith("z")).toBe(true);
  expect(tail.length).toBeLessThan(text.length);
  expect(
    Array.from(tail).some(
      (char) => char.length === 1 && /[\uD800-\uDFFF]/.test(char),
    ),
  ).toBe(false);
  expect(snapshot.entries[0].text).toBe(text);
});

it("replaces oversized non-transcript state with an explicit unavailable snapshot instead of partial approvals", () => {
  const snapshot = makeSnapshot();
  snapshot.approvals = Array.from({ length: 100 }, (_, index) => ({
    id: `approval-${index}`,
    toolName: "edit_file",
    preview: `START ${index}\n${"界".repeat(15_000)}\nEND ${index}`,
  }));
  snapshot.queued = 2;
  snapshot.permissions = [{ value: "full-access", label: "Full access" }];
  snapshot.modes = [{ value: "agent", label: "Build" }];
  const original = JSON.stringify(snapshot);
  expect(
    byteLength(JSON.stringify({ type: "snapshot", snapshot })),
  ).toBeGreaterThan(CONSOLE_MAX_MESSAGE_BYTES);

  const json = encodeConsoleSnapshot(snapshot);
  const message = JSON.parse(json);
  expect(byteLength(json)).toBeLessThan(CONSOLE_MAX_MESSAGE_BYTES);
  expect(isConsoleAppMessage(message)).toBe(true);
  expect(message.snapshot).toMatchObject({
    chatId: null,
    status: "unavailable",
    approvals: [],
    models: [],
    efforts: [],
    targets: [],
    permissions: [],
    modes: [],
    model: "",
    effort: "",
    approval: "",
    mode: "",
    target: "",
    queued: 0,
  });
  expect(message.snapshot.entries).toEqual([
    expect.objectContaining({
      kind: "error",
      text: expect.stringContaining("Review it in the RIFT app"),
    }),
  ]);
  expect(JSON.stringify(snapshot)).toBe(original);
});
