import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { WorkbenchInteractiveTerminal } from "../WorkbenchInteractiveTerminal";

const mockHeaders = {};
const mockWrites: Array<{ bytes: string | Uint8Array; done?: () => void }> = [];
let mockInput: (text: string) => void;
let mockThrowOnWrite: number | null = null;
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));
jest.mock("../WorkbenchProvider", () => ({
  useWorkbenchRequestHeaders: () => mockHeaders,
}));
jest.mock("../WorkbenchActivity", () => ({
  useOptionalWorkbenchActivityPublisher: () => null,
}));
jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: () => false }));
jest.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
jest.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    options = {};
    textarea = document.createElement("textarea");
    loadAddon() {}
    open() {}
    reset() {}
    focus() {}
    dispose() {}
    write(bytes: string | Uint8Array, done?: () => void) {
      mockWrites.push({ bytes, done });
      if (mockWrites.length === mockThrowOnWrite) {
        throw new Error("Synthetic renderer failure");
      }
    }
    onData(callback: (text: string) => void) {
      mockInput = callback;
      return { dispose() {} };
    }
    onResize() {
      return { dispose() {} };
    }
  },
}));

const session = (id: string) => ({
  id,
  clientTerminalId: "remote_test",
  pid: 1,
  cwd: "/tmp/fixture",
  cols: 80,
  rows: 24,
  status: "running",
  exitCode: null,
  createdAt: 1,
  lastActivityAt: 1,
  expiresAt: Date.now() + 60000,
  profile: "shell",
  backend: "remote",
});
const firstId = "a".repeat(24),
  nextId = "b".repeat(24);
let streams: Map<string, ReadableStreamDefaultController<Uint8Array>>;
let activeId: string | null;
let previousFetch: typeof fetch;
let width: jest.SpyInstance, height: jest.SpyInstance;
let previousObserver: typeof ResizeObserver;
const encode = (...events: unknown[]) =>
  new TextEncoder().encode(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""),
  );
const response = (value: unknown, body?: ReadableStream<Uint8Array>) =>
  ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => value,
    body,
  }) as unknown as Response;
beforeEach(() => {
  mockWrites.length = 0;
  mockThrowOnWrite = null;
  streams = new Map();
  activeId = firstId;
  sessionStorage.clear();
  width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(400);
  previousObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  previousFetch = global.fetch;
  global.fetch = jest.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path.includes("/events?")) {
      const id = path.includes(firstId) ? firstId : nextId;
      return response(
        null,
        new ReadableStream<Uint8Array>({
          start(controller) {
            streams.set(id, controller);
            controller.enqueue(
              encode({
                type: "ready",
                session: session(id),
                cursor: 0,
                reconnected: false,
              }),
            );
          },
        }),
      );
    }
    if (init?.method === "DELETE") {
      activeId = null;
      return response(null);
    }
    if (init?.method === "POST" && path.endsWith("/sessions")) {
      activeId = nextId;
      return response(session(nextId));
    }
    if (path.endsWith("/sessions"))
      return response({ sessions: activeId ? [session(activeId)] : [] });
    if (path.endsWith("/resize")) return response(null);
    throw new Error(`Unexpected fixture request: ${path}`);
  });
});
afterEach(() => {
  global.fetch = previousFetch;
  width.mockRestore();
  height.mockRestore();
  global.ResizeObserver = previousObserver;
  sessionStorage.clear();
});
function sendTail(two = false) {
  streams.get(firstId)!.enqueue(
    encode(
      {
        type: "output",
        encoding: "base64",
        data: btoa("first complete bytes\r\n"),
        cursor: 1,
      },
      ...(two
        ? [
            {
              type: "output",
              encoding: "base64",
              data: btoa("last complete bytes\r\n"),
              cursor: 2,
            },
          ]
        : []),
      { type: "exit", exitCode: 19, cursor: 3 },
    ),
  );
}
it("publishes remote exit only after every output write in the same SSE chunk is consumed", async () => {
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="remote_test" />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    act(() => sendTail(true));
    await waitFor(() => expect(mockWrites).toHaveLength(1));
    expect(view.queryByText("Exited 19")).not.toBeInTheDocument();
    act(() => mockInput("must not be sent after process exit"));
    expect(
      (global.fetch as jest.Mock).mock.calls.some(([url]) =>
        String(url).endsWith("/input"),
      ),
    ).toBe(false);
    await act(async () => mockWrites[0].done?.());
    await waitFor(() => expect(mockWrites).toHaveLength(2));
    expect(view.queryByText("Exited 19")).not.toBeInTheDocument();
    await act(async () => mockWrites[1].done?.());
    await waitFor(() =>
      expect(view.getByText("Exited 19")).toBeInTheDocument(),
    );
    expect(
      mockWrites
        .map((write) => new TextDecoder().decode(write.bytes as Uint8Array))
        .join(""),
    ).toBe("first complete bytes\r\nlast complete bytes\r\n");
  } finally {
    view.unmount();
  }
});
it.each(["unmount", "restart"])(
  "a late final write cannot publish an old exit after %s",
  async (action) => {
    const changed = jest.fn();
    const view = render(
      <WorkbenchInteractiveTerminal
        clientTerminalId="remote_test"
        onConnectionChange={changed}
      />,
    );
    try {
      await waitFor(() =>
        expect(view.getByText("Connected")).toBeInTheDocument(),
      );
      act(() => sendTail());
      await waitFor(() => expect(mockWrites).toHaveLength(1));
      if (action === "unmount") view.unmount();
      else {
        fireEvent.click(
          view.getByRole("button", { name: "Restart terminal session" }),
        );
        await waitFor(() => expect(streams.has(nextId)).toBe(true));
        await waitFor(() =>
          expect(view.getByText("Connected")).toBeInTheDocument(),
        );
      }
      changed.mockClear();
      await act(async () => mockWrites[0].done?.());
      expect(changed.mock.calls.some(([, status]) => status === "exited")).toBe(
        false,
      );
      if (action === "restart")
        expect(view.getByText("Connected")).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  },
);
it("publishes an empty remote exit without waiting for a nonexistent write", async () => {
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="remote_test" />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    act(() =>
      streams
        .get(firstId)!
        .enqueue(encode({ type: "exit", exitCode: 0, cursor: 0 })),
    );
    await waitFor(() => expect(view.getByText("Exited 0")).toBeInTheDocument());
    expect(mockWrites).toHaveLength(0);
  } finally {
    view.unmount();
  }
});

it.each([false, true])(
  "surfaces a renderer failure instead of successful exit (two writes: %s)",
  async (two) => {
    mockThrowOnWrite = 1;
    const view = render(
      <WorkbenchInteractiveTerminal clientTerminalId="remote_test" />,
    );
    try {
      await waitFor(() =>
        expect(view.getByText("Connected")).toBeInTheDocument(),
      );
      await act(async () => sendTail(two));
      // Release any later write: a successful callback must not erase the first failure.
      await act(async () => mockWrites[1]?.done?.());
      await waitFor(() =>
        expect(
          view.getByText("Terminal output could not be rendered."),
        ).toBeInTheDocument(),
      );
      expect(view.queryByText("Connected")).not.toBeInTheDocument();
      expect(view.queryByText("Exited 19")).not.toBeInTheDocument();
      expect(mockWrites).toHaveLength(1);
      act(() => mockInput("must not send after renderer failure"));
      expect(
        (global.fetch as jest.Mock).mock.calls.some(([url]) =>
          String(url).endsWith("/input"),
        ),
      ).toBe(false);
    } finally {
      view.unmount();
    }
  },
);

it("stops remote input on rendering failure even without a process exit", async () => {
  mockThrowOnWrite = 1;
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="remote_test" />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    await act(async () =>
      streams.get(firstId)!.enqueue(
        encode({
          type: "output",
          encoding: "base64",
          data: btoa("not rendered"),
          cursor: 1,
        }),
      ),
    );
    await waitFor(() =>
      expect(
        view.getByText("Terminal output could not be rendered."),
      ).toBeInTheDocument(),
    );
    act(() => mockInput("must not send after renderer failure"));
    expect(
      (global.fetch as jest.Mock).mock.calls.some(([url]) =>
        String(url).endsWith("/input"),
      ),
    ).toBe(false);
    expect(view.queryByText("Connected")).not.toBeInTheDocument();
    expect(mockWrites).toHaveLength(1);
  } finally {
    view.unmount();
  }
});
it.each(["unmount", "restart"])(
  "does not render a queued failing old write after %s",
  async (action) => {
    const changed = jest.fn();
    const view = render(
      <WorkbenchInteractiveTerminal
        clientTerminalId="remote_test"
        onConnectionChange={changed}
      />,
    );
    try {
      await waitFor(() =>
        expect(view.getByText("Connected")).toBeInTheDocument(),
      );
      act(() => sendTail(true));
      await waitFor(() => expect(mockWrites).toHaveLength(1));
      mockThrowOnWrite = 2;
      if (action === "unmount") view.unmount();
      else {
        fireEvent.click(
          view.getByRole("button", { name: "Restart terminal session" }),
        );
        await waitFor(() => expect(streams.has(nextId)).toBe(true));
        await waitFor(() =>
          expect(view.getByText("Connected")).toBeInTheDocument(),
        );
      }
      changed.mockClear();
      await act(async () => mockWrites[0].done?.());
      expect(mockWrites).toHaveLength(1);
      expect(changed).not.toHaveBeenCalled();
      if (action === "restart") {
        expect(view.getByText("Connected")).toBeInTheDocument();
        expect(
          view.queryByText("Terminal output could not be rendered."),
        ).not.toBeInTheDocument();
      }
    } finally {
      view.unmount();
    }
  },
);
