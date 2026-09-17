import { act, fireEvent, render, screen } from "@testing-library/react";
import { RiftConsoleConnection } from "../RiftConsoleConnection";
import {
  CONSOLE_PROTOCOL,
  type ConsoleCommand,
  type ConsoleSnapshot,
} from "@/packages/console/src/protocol";

const onCommand = jest.fn<
  Promise<{ accepted: boolean; error?: string }>,
  [ConsoleCommand]
>();
const snapshot: ConsoleSnapshot = {
  chatId: "chat-a",
  status: "ready",
  entries: [],
  model: "model-a",
  modelLabel: "Model A",
  effort: "high",
  approval: "ask",
  mode: "agent",
  target: "e2b",
  targetLabel: "Cloud",
  models: [],
  efforts: [],
  targets: [],
  approvals: [],
  queued: 0,
};
const runtime = { snapshot, onCommand };
jest.mock("../useRiftConsoleRuntime", () => ({
  useRiftConsoleRuntime: () => runtime,
}));

class TestSocket {
  static OPEN = 1;
  static CLOSED = 3;
  static instances: TestSocket[] = [];
  readyState = TestSocket.OPEN;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  send = jest.fn();
  constructor(
    public url: string,
    public protocols: string[],
  ) {
    TestSocket.instances.push(this);
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
  close() {
    this.readyState = TestSocket.CLOSED;
    this.onclose?.();
  }
}

const realSocket = global.WebSocket;
const token = "a".repeat(43);
const greet = (socket: TestSocket) =>
  socket.message({
    type: "connected",
    version: 1,
    sessionId: "session-a",
    cwd: "/workspace",
  });
const command = (socket: TestSocket, id: string, text = "Build") =>
  socket.message({
    type: "command",
    id,
    command: { type: "submit", text, chatId: "chat-a" },
  });
const advance = async (milliseconds = 0) => {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(milliseconds);
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  global.WebSocket = TestSocket as unknown as typeof WebSocket;
  TestSocket.instances = [];
  onCommand.mockReset().mockResolvedValue({ accepted: true });
  window.history.replaceState(
    null,
    "",
    `/c/chat-a#tab=preview&riftConsole=43123:${token}`,
  );
});

afterEach(() => {
  global.WebSocket = realSocket;
  jest.useRealTimers();
  window.history.replaceState(null, "", "/");
});

async function connect() {
  const result = render(<RiftConsoleConnection />);
  await advance(20);
  fireEvent.click(screen.getByRole("button", { name: "Connect console" }));
  await advance();
  const socket = TestSocket.instances[0];
  act(() => greet(socket));
  return { ...result, socket };
}

it("requires explicit pairing, strips its capability from history and uses loopback only", async () => {
  render(<RiftConsoleConnection />);
  expect(window.location.hash).toBe("#tab=preview");
  await advance(20);
  expect(screen.getByRole("alertdialog")).toBeVisible();
  expect(TestSocket.instances).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Connect console" }));
  await advance();
  expect(TestSocket.instances).toHaveLength(1);
  expect(TestSocket.instances[0].url).toBe("ws://127.0.0.1:43123/console");
  expect(TestSocket.instances[0].protocols).toEqual([
    CONSOLE_PROTOCOL,
    `rift-${token}`,
  ]);
  expect(TestSocket.instances[0].send).not.toHaveBeenCalled();
  act(() => greet(TestSocket.instances[0]));
  expect(JSON.parse(TestSocket.instances[0].send.mock.calls[0][0])).toEqual({
    type: "snapshot",
    snapshot,
  });
});

it("does not connect or accept actions when pairing is declined", async () => {
  render(<RiftConsoleConnection />);
  await advance(20);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await advance(1000);
  expect(TestSocket.instances).toHaveLength(0);
  expect(onCommand).not.toHaveBeenCalled();
});

it("serializes commands and deduplicates pending and acknowledged command ids", async () => {
  let release!: (value: { accepted: boolean }) => void;
  onCommand.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { socket } = await connect();
  act(() => {
    command(socket, "one", "First");
    command(socket, "one", "First");
    command(socket, "two", "Second");
  });
  await advance();
  expect(onCommand.mock.calls.map(([value]) => value)).toEqual([
    { type: "submit", text: "First", chatId: "chat-a" },
  ]);
  await act(async () => {
    release({ accepted: true });
  });
  await advance(1);
  expect(
    onCommand.mock.calls.map(([value]) =>
      "text" in value ? value.text : value.type,
    ),
  ).toEqual(["First", "Second"]);
  act(() => command(socket, "one", "First"));
  await advance(1);
  expect(onCommand).toHaveBeenCalledTimes(2);
  const responses = socket.send.mock.calls
    .map(([json]) => JSON.parse(json))
    .filter((value) => value.type === "result");
  expect(responses.filter((value) => value.id === "one")).toHaveLength(2);
});

it("reconnects with an authoritative snapshot and never starts queued commands from the old socket", async () => {
  let release!: (value: { accepted: boolean }) => void;
  onCommand.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const { socket } = await connect();
  act(() => {
    command(socket, "one", "First");
    command(socket, "old-queued", "Do not replay");
  });
  await advance();
  act(() => socket.close());
  await advance(500);
  const replacement = TestSocket.instances[1];
  expect(replacement).toBeDefined();
  act(() => greet(replacement));
  expect(JSON.parse(replacement.send.mock.calls[0][0])).toEqual({
    type: "snapshot",
    snapshot,
  });
  await act(async () => {
    release({ accepted: true });
  });
  await advance(1);
  act(() => command(replacement, "new", "New command"));
  await advance(1);
  expect(
    onCommand.mock.calls.map(([value]) =>
      "text" in value ? value.text : value.type,
    ),
  ).toEqual(["First", "New command"]);
});

it("never retries the same id after an unexpected command failure with an uncertain outcome", async () => {
  onCommand.mockRejectedValueOnce(new Error("Action outcome is unknown"));
  const { socket } = await connect();
  act(() => command(socket, "uncertain"));
  await advance();
  act(() => command(socket, "uncertain"));
  await advance();
  expect(onCommand).toHaveBeenCalledTimes(1);
  const responses = socket.send.mock.calls
    .map(([json]) => JSON.parse(json))
    .filter((value) => value.type === "result");
  expect(responses).toHaveLength(2);
  expect(responses[0]).toEqual(responses[1]);
  expect(responses[0].accepted).toBe(false);
});
