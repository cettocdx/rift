import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

class TestWorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let leases: typeof import("@/lib/workbench/terminal-input-lease");

const binding = {
  userId: "user-lease",
  workspaceKey: "user-lease\0project-a",
  sessionId: "0123456789abcdef01234567",
  context: { chatId: "chat-a", projectId: null },
} as const;
const sendInput = jest.fn(async (_bytes: Uint8Array) => undefined);

describe("Workbench terminal input leases", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("server-only", () => ({}), { virtual: true });
    jest.doMock("@/lib/workbench/workspace-server", () => ({
      WorkbenchRequestError: TestWorkbenchRequestError,
    }));
    leases =
      require("@/lib/workbench/terminal-input-lease") as typeof import("@/lib/workbench/terminal-input-lease");
  });

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-17T12:00:00.000Z"));
    leases.resetWorkbenchTerminalInputLeasesForTests();
    sendInput.mockClear();
  });

  it("binds an opaque process-local lease to one user, workspace, session and request context", () => {
    const token = leases.issueWorkbenchTerminalInputLease(binding, sendInput);

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(leases.issueWorkbenchTerminalInputLease(binding, sendInput)).toBe(
      token,
    );
    expect(
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 3,
      }),
    ).toEqual({ ...binding, sendInput });

    const refreshedSender = jest.fn(async (_bytes: Uint8Array) => undefined);
    expect(
      leases.issueWorkbenchTerminalInputLease(binding, refreshedSender),
    ).toBe(token);
    expect(
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 1,
      }).sendInput,
    ).toBe(refreshedSender);
  });

  it("rejects malformed, cross-session and cross-context capability use", () => {
    const token = leases.issueWorkbenchTerminalInputLease(binding, sendInput);

    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token: "not-a-capability",
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        status: 401,
        code: "terminal_input_lease_invalid",
      }),
    );
    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: "abcdef0123456789abcdef01",
        context: binding.context,
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        code: "terminal_input_lease_invalid",
      }),
    );
    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: binding.sessionId,
        context: { chatId: "chat-b", projectId: null },
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        status: 403,
        code: "terminal_input_lease_invalid",
      }),
    );
  });

  it("expires capabilities and revokes them immediately on terminal close", () => {
    const expired = leases.issueWorkbenchTerminalInputLease(binding, sendInput);
    jest.advanceTimersByTime(leases.WORKBENCH_TERMINAL_INPUT_LEASE_TTL_MS + 1);
    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token: expired,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: "terminal_input_lease_invalid" }),
    );

    const revoked = leases.issueWorkbenchTerminalInputLease(binding, sendInput);
    expect(revoked).not.toBe(expired);
    leases.revokeWorkbenchTerminalInputLeases(
      binding.workspaceKey,
      binding.sessionId,
    );
    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token: revoked,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({ code: "terminal_input_lease_invalid" }),
    );
  });

  it("keeps a byte-aware rate budget on the reused lease", () => {
    const token = leases.issueWorkbenchTerminalInputLease(binding, sendInput);
    for (let index = 0; index < 4; index += 1) {
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 16 * 1024,
      });
    }
    expect(leases.issueWorkbenchTerminalInputLease(binding, sendInput)).toBe(
      token,
    );
    expect(() =>
      leases.consumeWorkbenchTerminalInputLease({
        token,
        sessionId: binding.sessionId,
        context: binding.context,
        inputBytes: 1,
      }),
    ).toThrow(
      expect.objectContaining({
        status: 429,
        code: "terminal_input_rate_limited",
      }),
    );
  });
});
