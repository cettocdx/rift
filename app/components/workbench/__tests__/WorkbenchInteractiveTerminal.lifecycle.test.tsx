import React from "react";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { WorkbenchInteractiveTerminal } from "../WorkbenchInteractiveTerminal";

let mockResize: () => void;
let mockInput: (text: string) => void;
const mockCreate = jest.fn();
const mockDetach = jest.fn().mockResolvedValue(undefined);
const mockKill = jest.fn().mockResolvedValue(undefined);
const mockSend = jest.fn().mockResolvedValue(undefined);
const mockHeaders = {};
const mockDispose = jest.fn();
const mockWrite = jest.fn((_text: string | Uint8Array, callback?: () => void) =>
  callback?.(),
);
jest.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));
jest.mock("../WorkbenchProvider", () => ({
  useWorkbenchRequestHeaders: () => mockHeaders,
}));
jest.mock("../WorkbenchActivity", () => ({
  useOptionalWorkbenchActivityPublisher: () => null,
}));
jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: () => true }));
jest.mock("@/app/services/desktop-profile-terminal", () => ({
  createDesktopProfileTerminalSessionId: () => "native_test",
  createDesktopProfileTerminal: (...args: unknown[]) => mockCreate(...args),
  detachDesktopProfileTerminal: (...args: unknown[]) => mockDetach(...args),
  killDesktopProfileTerminal: (...args: unknown[]) => mockKill(...args),
  sendDesktopProfileTerminalInput: (...args: unknown[]) => mockSend(...args),
  resizeDesktopProfileTerminal: jest.fn().mockResolvedValue(undefined),
}));
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
    dispose() {
      mockDispose();
    }
    write(text: string | Uint8Array, callback?: () => void) {
      mockWrite(text, callback);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockWrite.mockImplementation((_text, callback) => callback?.());
  mockSend.mockResolvedValue(undefined);
});

it("acknowledges a bounded native batch only after rendering and publishes exit afterward", async () => {
  const width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  const height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(400);
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  mockCreate.mockResolvedValue({
    session: { sessionId: "burst", profile: "shell", pid: 42 },
    channel: {},
  });
  mockWrite.mockImplementation(() => {});
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="burst_tab" />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    const { callbacks } = mockCreate.mock.calls[0][0];
    const rendered = jest.fn();
    act(() =>
      callbacks.onOutput(
        Array.from({ length: 1000 }, (_, index) => `${index}\r\n`).join(""),
        rendered,
      ),
    );
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    const data = mockWrite.mock.calls[0][0];
    expect(
      typeof data === "string" ? data.length : data.byteLength,
    ).toBeGreaterThan(4000);
    expect(rendered).not.toHaveBeenCalled();
    act(() => callbacks.onExit(19));
    expect(view.queryByText("Exited 19")).not.toBeInTheDocument();
    act(() => mockWrite.mock.calls[0][1]?.());
    expect(rendered).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(view.getByText("Exited 19")).toBeInTheDocument(),
    );
    expect(mockWrite).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    global.ResizeObserver = originalObserver;
  }
});

it("keeps revoked status when an earlier input later fails and suppresses stale render ACK", async () => {
  const width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  const height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(400);
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  mockCreate.mockResolvedValue({
    session: { sessionId: "revoked", profile: "shell", pid: 42 },
    channel: {},
  });
  let rejectInput!: (error: unknown) => void;
  mockSend.mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      rejectInput = reject;
    }),
  );
  mockWrite.mockImplementation(() => {});
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="revoked_tab" />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    act(() => mockInput("long paste"));
    await waitFor(() => expect(mockSend).toHaveBeenCalledTimes(1));
    const { callbacks } = mockCreate.mock.calls[0][0];
    const rendered = jest.fn();
    act(() => callbacks.onOutput("last bytes", rendered));
    await waitFor(() => expect(mockWrite).toHaveBeenCalled());
    act(() => callbacks.onClosed());
    await act(async () => rejectInput(new Error("input closed")));
    act(() => mockWrite.mock.calls[0][1]?.());
    expect(rendered).not.toHaveBeenCalled();
    expect(view.getByText("Exited -1")).toBeInTheDocument();
    expect(
      view.getByText(
        "This terminal was closed or its local access was revoked.",
      ),
    ).toBeInTheDocument();
    expect(view.queryByText("input closed")).not.toBeInTheDocument();
    act(() => mockInput("must not reach native"));
    expect(mockSend).toHaveBeenCalledTimes(1);
  } finally {
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    global.ResizeObserver = originalObserver;
  }
});

it("keeps the same native shell and input drain when its host is hidden and shown", async () => {
  let visible = true;
  const width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockImplementation(() => (visible ? 800 : 0));
  const height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockImplementation(() => (visible ? 400 : 0));
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    constructor(callback: () => void) {
      mockResize = callback;
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  mockCreate.mockResolvedValue({
    session: {
      sessionId: "native_test",
      profile: "shell",
      pid: 42,
      cwd: "/Users/test",
    },
    channel: {},
  });
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="terminal_test" />,
  );
  try {
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    visible = false;
    await act(async () => {
      mockResize();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(mockKill).not.toHaveBeenCalled();
    visible = true;
    await act(async () => {
      mockResize();
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    act(() => mockInput("echo preserved\r"));
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith("native_test", "echo preserved\r"),
    );
    view.unmount();
    expect(mockKill).not.toHaveBeenCalled();
    await waitFor(() => expect(mockDetach).toHaveBeenCalledTimes(1));
  } finally {
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    global.ResizeObserver = originalObserver;
  }
});

it("latches a tab workspace, reattaches after remount, and requests explicit restart", async () => {
  const width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  const height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(400);
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  const grant = {
    grantId: "grant-a",
    rootPath: "/tmp/a",
    writable: true,
    name: "a",
    grantedAt: 1,
  };
  const handle = {
    session: {
      sessionId: "native_existing",
      profile: "shell",
      pid: 42,
      cwd: "/tmp/a",
    },
    channel: {},
    attachmentId: "first",
  };
  mockCreate.mockResolvedValue(handle);
  let view = render(
    <WorkbenchInteractiveTerminal
      clientTerminalId="stable_tab"
      desktopWorkspaceGrant={grant}
    />,
  );
  try {
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    view.rerender(
      <WorkbenchInteractiveTerminal
        clientTerminalId="stable_tab"
        desktopWorkspaceGrant={{ ...grant }}
      />,
    );
    view.rerender(
      <WorkbenchInteractiveTerminal
        clientTerminalId="stable_tab"
        desktopWorkspaceGrant={{ ...grant, grantId: "grant-b" }}
      />,
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0]).toMatchObject({
      clientTerminalId: "stable_tab",
      grantId: "grant-a",
      restart: false,
    });
    view.unmount();
    expect(mockKill).not.toHaveBeenCalled();
    expect(mockDetach).toHaveBeenCalledWith(handle);
    view = render(
      <WorkbenchInteractiveTerminal
        clientTerminalId="stable_tab"
        desktopWorkspaceGrant={grant}
      />,
    );
    await waitFor(() =>
      expect(view.getByText("Connected")).toBeInTheDocument(),
    );
    act(() => mockInput("echo continued\r"));
    await waitFor(() =>
      expect(mockSend).toHaveBeenCalledWith(
        "native_existing",
        "echo continued\r",
      ),
    );
    const disposalsBeforeRestart = mockDispose.mock.calls.length;
    fireEvent.click(
      view.getByRole("button", { name: "Restart terminal session" }),
    );
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(3));
    expect(mockDispose.mock.calls.length).toBeGreaterThan(
      disposalsBeforeRestart,
    );
    expect(mockCreate.mock.calls[2][0]).toMatchObject({
      clientTerminalId: "stable_tab",
      restart: true,
    });
  } finally {
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    global.ResizeObserver = originalObserver;
  }
});

it("detaches a late attach result after unmount without terminating the process", async () => {
  const width = jest
    .spyOn(HTMLElement.prototype, "clientWidth", "get")
    .mockReturnValue(800);
  const height = jest
    .spyOn(HTMLElement.prototype, "clientHeight", "get")
    .mockReturnValue(400);
  const originalObserver = global.ResizeObserver;
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  let resolve!: (value: unknown) => void;
  mockCreate.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const view = render(
    <WorkbenchInteractiveTerminal clientTerminalId="stable_tab" />,
  );
  try {
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1));
    view.unmount();
    const handle = {
      session: { sessionId: "native_late", profile: "shell" },
      channel: {},
    };
    await act(async () => resolve(handle));
    expect(mockKill).not.toHaveBeenCalled();
    expect(mockDetach).toHaveBeenCalledWith(handle);
  } finally {
    view.unmount();
    width.mockRestore();
    height.mockRestore();
    global.ResizeObserver = originalObserver;
  }
});
