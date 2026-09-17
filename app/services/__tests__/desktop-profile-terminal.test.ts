import { invoke } from "@tauri-apps/api/core";
import {
  createDesktopProfileTerminal,
  detachDesktopProfileTerminal,
  closeDesktopProfileTerminalTab,
  killDesktopProfileTerminal,
  listDesktopTerminalProfiles,
  resizeDesktopProfileTerminal,
  sendDesktopProfileTerminalInput,
} from "../desktop-profile-terminal";

let mockOwnerCurrent = true;
const mockOwner = { ownerId: "account-a", ownerGeneration: 3 };
jest.mock("../desktop-terminal-owner", () => ({
  requireDesktopTerminalOwner: async () => mockOwner,
  isCurrentDesktopTerminalOwner: () => mockOwnerCurrent,
}));

const channels: Array<{ onmessage?: (value: unknown) => void }> = [];

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: jest.fn(() => true),
}));

jest.mock("@tauri-apps/api/core", () => ({
  invoke: jest.fn(),
  Channel: class MockChannel {
    onmessage?: (value: unknown) => void;

    constructor() {
      channels.push(this);
    }
  },
}));

const mockInvoke = invoke as jest.MockedFunction<typeof invoke>;

describe("desktop profile terminal service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvoke.mockReset();
    mockInvoke.mockResolvedValue(undefined);
    channels.length = 0;
    mockOwnerCurrent = true;
  });

  it("starts a standalone shell without a workspace grant", async () => {
    mockInvoke.mockResolvedValueOnce({
      pid: 42,
      sessionId: "native_terminal_123",
      profile: "shell",
      runtimeLabel: "Shell",
      cwd: "/Users/test",
    });
    const handle = await createDesktopProfileTerminal({
      sessionId: "native_terminal_123",
      profile: "shell",
      cols: 80,
      rows: 24,
      callbacks: { onOutput: jest.fn(), onExit: jest.fn() },
    });
    expect(mockInvoke).toHaveBeenCalledWith(
      "create_desktop_profile_pty_v2",
      expect.objectContaining({ grantId: null }),
    );
    expect(handle.session.cwd).toBe("/Users/test");
  });

  it("detects the four allowlisted native profiles", async () => {
    mockInvoke.mockResolvedValueOnce({
      backend: "local",
      profiles: [
        ["shell", "System shell"],
        ["claude", "Claude Code"],
        ["codex", "Codex"],
        ["grok", "Grok"],
      ].map(([profile, runtimeLabel]) => ({
        profile,
        runtimeLabel,
        available: true,
        unavailableReason: null,
      })),
    });

    await expect(listDesktopTerminalProfiles()).resolves.toEqual(
      expect.objectContaining({ backend: "local" }),
    );
    expect(mockInvoke).toHaveBeenCalledWith("list_desktop_terminal_profiles");
  });

  it("creates only a fixed profile inside an opaque writable grant", async () => {
    const onOutput = jest.fn();
    const onExit = jest.fn();
    mockInvoke.mockResolvedValueOnce({
      pid: 42,
      sessionId: "native_terminal_123",
      profile: "codex",
      runtimeLabel: "Codex",
    });

    const handle = await createDesktopProfileTerminal({
      sessionId: "native_terminal_123",
      profile: "codex",
      grantId: "grant-opaque",
      relativeCwd: "",
      cols: 100,
      rows: 24,
      callbacks: { onOutput, onExit },
    });

    expect(handle.session).toEqual({
      pid: 42,
      sessionId: "native_terminal_123",
      profile: "codex",
      runtimeLabel: "Codex",
    });
    expect(mockInvoke).toHaveBeenCalledWith("create_desktop_profile_pty_v2", {
      ...mockOwner,
      clientTerminalId: "native_terminal_123",
      attachmentId: expect.any(String),
      restart: false,
      sessionId: "native_terminal_123",
      profile: "codex",
      grantId: "grant-opaque",
      relativeCwd: "",
      cols: 100,
      rows: 24,
      onData: channels[0],
    });

    mockInvoke.mockResolvedValueOnce({ sequence: 7, data: "ready\r\n" });
    channels[0].onmessage?.({ type: "ready", sequence: 7 });
    await Promise.resolve();
    expect(onOutput).toHaveBeenCalledWith("ready\r\n", expect.any(Function));
    expect(
      mockInvoke.mock.calls.some(
        ([command]) => command === "acknowledge_desktop_profile_pty_output",
      ),
    ).toBe(false);
    onOutput.mock.calls[0][1]();
    expect(mockInvoke).toHaveBeenLastCalledWith(
      "acknowledge_desktop_profile_pty_output",
      {
        ...mockOwner,
        sessionId: handle.session.sessionId,
        attachmentId: handle.attachmentId,
        cursor: 7,
      },
    );
    channels[0].onmessage?.({ type: "exit", exitCode: 0 });
    expect(onExit).toHaveBeenCalledWith(0);
  });

  it("does not swallow exit-like output from the program itself", async () => {
    const onOutput = jest.fn();
    mockInvoke.mockResolvedValueOnce({
      pid: null,
      sessionId: "native_terminal_123",
      profile: "shell",
      runtimeLabel: "System shell",
    });
    await createDesktopProfileTerminal({
      sessionId: "native_terminal_123",
      profile: "shell",
      grantId: "grant-opaque",
      cols: 80,
      rows: 24,
      callbacks: { onOutput, onExit: jest.fn() },
    });

    const printedJson = JSON.stringify({
      type: "exit",
      exitCode: 3,
      sessionId: "some_other_session",
    });
    mockInvoke.mockResolvedValueOnce({
      sequence: printedJson.length,
      data: printedJson,
    });
    channels[0].onmessage?.({ type: "ready", sequence: printedJson.length });
    await Promise.resolve();
    expect(onOutput).toHaveBeenCalledWith(printedJson, expect.any(Function));
  });

  it("chunks large Unicode input without splitting a code point", async () => {
    mockInvoke.mockResolvedValue(undefined);
    const input = "🙂".repeat(5_000);
    await sendDesktopProfileTerminalInput("native_terminal_123", input);

    const chunks = mockInvoke.mock.calls.map(
      ([command, args]) => [command, (args as { data: string }).data] as const,
    );
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.map(([, chunk]) => chunk).join("")).toBe(input);
    expect(
      chunks.every(
        ([command, chunk]) =>
          command === "send_desktop_profile_pty_input" &&
          new TextEncoder().encode(chunk).byteLength <= 16 * 1024,
      ),
    ).toBe(true);
  });

  it("uses dedicated resize and kill commands", async () => {
    mockInvoke.mockResolvedValue(undefined);
    await resizeDesktopProfileTerminal("native_terminal_123", 120, 40);
    await killDesktopProfileTerminal("native_terminal_123");

    expect(mockInvoke).toHaveBeenNthCalledWith(
      1,
      "resize_desktop_profile_pty",
      { ...mockOwner, sessionId: "native_terminal_123", cols: 120, rows: 40 },
    );
    expect(mockInvoke).toHaveBeenNthCalledWith(2, "kill_desktop_profile_pty", {
      ...mockOwner,
      sessionId: "native_terminal_123",
    });
  });
  it("uses the attached incarnation and scoped detach without killing it", async () => {
    mockInvoke.mockResolvedValueOnce({
      pid: 42,
      sessionId: "existing_session",
      profile: "shell",
      runtimeLabel: "Shell",
    });
    const output = jest.fn();
    const handle = await createDesktopProfileTerminal({
      sessionId: "new_proposal",
      clientTerminalId: "stable_tab",
      profile: "shell",
      cols: 80,
      rows: 24,
      callbacks: { onOutput: output, onExit: jest.fn() },
    });
    expect(handle.session.sessionId).toBe("existing_session");
    mockInvoke.mockResolvedValueOnce({ sequence: 8, data: "replayed" });
    channels[0].onmessage?.({ type: "ready", sequence: 8 });
    await Promise.resolve();
    channels[0].onmessage?.({ type: "ready", sequence: 8 });
    expect(output).toHaveBeenCalledTimes(1);
    await detachDesktopProfileTerminal(handle);
    expect(mockInvoke).toHaveBeenLastCalledWith("detach_desktop_profile_pty", {
      ...mockOwner,
      sessionId: "existing_session",
      attachmentId: handle.attachmentId,
    });
    await closeDesktopProfileTerminalTab("stable_tab");
    expect(mockInvoke).toHaveBeenLastCalledWith(
      "close_desktop_profile_terminal",
      { ...mockOwner, clientTerminalId: "stable_tab" },
    );
    expect(
      mockInvoke.mock.calls.some(
        ([command]) => command === "kill_desktop_profile_pty",
      ),
    ).toBe(false);
  });
  it("does not create or mutate under a replacement owner during an async boundary", async () => {
    const create = createDesktopProfileTerminal({
      sessionId: "new_proposal",
      clientTerminalId: "stable_tab",
      profile: "shell",
      cols: 80,
      rows: 24,
      callbacks: { onOutput: jest.fn(), onExit: jest.fn() },
    });
    const close = closeDesktopProfileTerminalTab("stable_tab");
    const input = sendDesktopProfileTerminalInput("old_session", "echo no\r");
    const resize = resizeDesktopProfileTerminal("old_session", 80, 24);
    mockOwnerCurrent = false;
    for (const operation of [create, close, input, resize])
      await expect(operation).rejects.toThrow("ownership changed");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  const options = () => ({
    sessionId: "proposal",
    clientTerminalId: "tab",
    profile: "shell" as const,
    cols: 80,
    rows: 24,
    callbacks: {
      onOutput: jest.fn(),
      onExit: jest.fn(),
      onClosed: jest.fn(),
      onError: jest.fn(),
      onTruncated: jest.fn(),
    },
  });
  const session = {
    pid: 42,
    sessionId: "incarnation",
    profile: "shell",
    runtimeLabel: "Shell",
  };

  it("holds an early readiness notice until create returns the actual incarnation", async () => {
    let resolve!: (value: unknown) => void;
    mockInvoke.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const request = options();
    const created = createDesktopProfileTerminal(request);
    while (channels.length === 0) await Promise.resolve();
    channels[0].onmessage?.({ type: "ready", sequence: 4 });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    mockInvoke.mockResolvedValueOnce({ sequence: 4, data: "test" });
    resolve(session);
    const handle = await created;
    await Promise.resolve();
    expect(mockInvoke).toHaveBeenLastCalledWith(
      "read_desktop_profile_pty_output",
      {
        ...mockOwner,
        sessionId: "incarnation",
        attachmentId: handle.attachmentId,
        cursor: 4,
      },
    );
    expect(request.callbacks.onOutput).toHaveBeenCalledWith(
      "test",
      expect.any(Function),
    );
    const rendered = request.callbacks.onOutput.mock.calls[0][1];
    rendered();
    rendered();
    expect(
      mockInvoke.mock.calls.filter(
        ([command]) => command === "acknowledge_desktop_profile_pty_output",
      ),
    ).toHaveLength(1);
  });

  it.each(["detach", "owner change", "closed"])(
    "discards a pending read after %s",
    async (change) => {
      mockInvoke.mockResolvedValueOnce(session);
      const request = options();
      const handle = await createDesktopProfileTerminal(request);
      let resolve!: (value: unknown) => void;
      mockInvoke.mockReturnValueOnce(
        new Promise((done) => {
          resolve = done;
        }),
      );
      channels[0].onmessage?.({ type: "ready", sequence: 4 });
      if (change === "detach") await detachDesktopProfileTerminal(handle);
      else if (change === "owner change") mockOwnerCurrent = false;
      else channels[0].onmessage?.({ type: "closed" });
      resolve({ sequence: 4, data: "test" });
      await Promise.resolve();
      expect(request.callbacks.onOutput).not.toHaveBeenCalled();
      expect(
        mockInvoke.mock.calls.some(
          ([command]) => command === "acknowledge_desktop_profile_pty_output",
        ),
      ).toBe(false);
      if (change === "closed")
        expect(request.callbacks.onClosed).toHaveBeenCalledTimes(1);
    },
  );

  it("cancels an unrendered batch on close and reports history truncation explicitly", async () => {
    mockInvoke.mockResolvedValueOnce(session);
    const request = options();
    await createDesktopProfileTerminal(request);
    channels[0].onmessage?.({ type: "truncated" });
    mockInvoke.mockResolvedValueOnce({ sequence: 4, data: "test" });
    channels[0].onmessage?.({ type: "ready", sequence: 4 });
    await Promise.resolve();
    channels[0].onmessage?.({ type: "closed" });
    request.callbacks.onOutput.mock.calls[0][1]();
    expect(request.callbacks.onTruncated).toHaveBeenCalledTimes(1);
    expect(request.callbacks.onClosed).toHaveBeenCalledTimes(1);
    expect(
      mockInvoke.mock.calls.some(
        ([command]) => command === "acknowledge_desktop_profile_pty_output",
      ),
    ).toBe(false);
  });

  it.each([
    { sequence: 4, data: "x".repeat(65537) },
    { sequence: 5, data: "test" },
    { sequence: 4, data: "🙂🙂" },
  ])(
    "rejects malformed or oversized read results without render ACK: %p",
    async (result) => {
      mockInvoke.mockResolvedValueOnce(session);
      const request = options();
      await createDesktopProfileTerminal(request);
      mockInvoke.mockResolvedValueOnce(result);
      channels[0].onmessage?.({ type: "ready", sequence: 4 });
      await Promise.resolve();
      expect(request.callbacks.onOutput).not.toHaveBeenCalled();
      expect(request.callbacks.onError).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenLastCalledWith(
        "detach_desktop_profile_pty",
        expect.objectContaining({ sessionId: "incarnation" }),
      );
    },
  );

  it("requires a desktop update when the bounded transport command is unavailable", async () => {
    mockInvoke.mockRejectedValueOnce(
      "Command create_desktop_profile_pty_v2 not found",
    );
    await expect(createDesktopProfileTerminal(options())).rejects.toThrow(
      "Update RIFT Desktop",
    );
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0]).toBe("create_desktop_profile_pty_v2");
  });
});
