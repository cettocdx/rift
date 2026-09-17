import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

const session = {
  id: "0123456789abcdef01234567",
  clientTerminalId: "terminal-client-1",
  pid: 42,
  cwd: "/home/user",
  cols: 80,
  rows: 24,
  status: "running" as const,
  exitCode: null,
  createdAt: 1,
  lastActivityAt: 1,
  expiresAt: 2,
};
const leaseToken = "a".repeat(43);
const mockAuthorizePremiumWorkbench = jest.fn();
const mockReadWorkbenchRequestTextWithLimit = jest.fn();
const mockWithPremiumWorkspaceSandbox = jest.fn();
const mockWithPremiumLocalWorkbenchTerminal = jest.fn();
const mockIsLocalMacWorkbenchTerminalRequest = jest.fn();
const mockWorkbenchTerminalLeaseContext = jest.fn();
const mockWorkbenchErrorResponse = jest.fn((error: unknown) => ({ error }));
const mockListInteractiveTerminalSessions = jest.fn();
const mockCreateInteractiveTerminalSession = jest.fn();
const mockCreateLocalInteractiveTerminalSession = jest.fn();
const mockListLocalInteractiveTerminalSessions = jest.fn();
const mockParseCreateTerminalRequest = jest.fn();
const mockCreateLocalInteractiveTerminalInputSender = jest.fn();
const mockInputSender = jest.fn();
const mockIssueWorkbenchTerminalInputLease = jest.fn();
const mockNextResponseJson = jest.fn((body: unknown, init?: unknown) => ({
  body,
  init,
}));

let GET: (req: NextRequest) => Promise<unknown>;
let POST: (req: NextRequest) => Promise<unknown>;

describe("Workbench terminal session lease responses", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/workbench/interactive-terminal", () => ({
      MAX_WORKBENCH_TERMINAL_CREATE_BODY_BYTES: 4 * 1024,
      createInteractiveTerminalSession: mockCreateInteractiveTerminalSession,
      createLocalInteractiveTerminalSession:
        mockCreateLocalInteractiveTerminalSession,
      createLocalInteractiveTerminalInputSender:
        mockCreateLocalInteractiveTerminalInputSender,
      listInteractiveTerminalSessions: mockListInteractiveTerminalSessions,
      listLocalInteractiveTerminalSessions:
        mockListLocalInteractiveTerminalSessions,
      parseCreateTerminalRequest: mockParseCreateTerminalRequest,
    }));
    jest.doMock("@/lib/workbench/terminal-input-lease", () => ({
      issueWorkbenchTerminalInputLease: mockIssueWorkbenchTerminalInputLease,
    }));
    jest.doMock("@/lib/workbench/workspace-server", () => ({
      WorkbenchRequestError: class MockWorkbenchRequestError extends Error {
        constructor(
          message: string,
          public readonly status: number,
          public readonly code: string,
        ) {
          super(message);
        }
      },
      authorizePremiumWorkbench: mockAuthorizePremiumWorkbench,
      isLocalMacWorkbenchTerminalRequest:
        mockIsLocalMacWorkbenchTerminalRequest,
      readWorkbenchRequestTextWithLimit: mockReadWorkbenchRequestTextWithLimit,
      withPremiumWorkspaceSandbox: mockWithPremiumWorkspaceSandbox,
      withPremiumLocalWorkbenchTerminal: mockWithPremiumLocalWorkbenchTerminal,
      workbenchTerminalLeaseContext: mockWorkbenchTerminalLeaseContext,
      workbenchErrorResponse: mockWorkbenchErrorResponse,
    }));
    ({ GET, POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizePremiumWorkbench.mockResolvedValue({
      userId: "user-1",
      subscription: "pro",
    });
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue("{}");
    mockIsLocalMacWorkbenchTerminalRequest.mockReturnValue(false);
    mockParseCreateTerminalRequest.mockReturnValue({
      cols: 80,
      rows: 24,
      cwd: "",
      clientTerminalId: null,
      profile: "shell",
    });
    mockWorkbenchTerminalLeaseContext.mockReturnValue({
      chatId: null,
      projectId: "project-1",
    });
    mockListInteractiveTerminalSessions.mockResolvedValue({
      sessions: [session],
    });
    mockCreateInteractiveTerminalSession.mockResolvedValue({
      session,
      created: true,
    });
    mockCreateLocalInteractiveTerminalSession.mockResolvedValue({
      session: { ...session, backend: "local", profile: "shell" },
      created: true,
    });
    mockListLocalInteractiveTerminalSessions.mockResolvedValue({
      sessions: [{ ...session, backend: "local", profile: "shell" }],
    });
    mockCreateLocalInteractiveTerminalInputSender.mockReturnValue(
      mockInputSender,
    );
    mockIssueWorkbenchTerminalInputLease.mockReturnValue(leaseToken);
    mockWithPremiumWorkspaceSandbox.mockImplementation(async (_req, action) =>
      action({}, "user-1", "user-1\0project-1"),
    );
    mockWithPremiumLocalWorkbenchTerminal.mockImplementation(
      async (_req, action) =>
        action("user-1", "local\0user-1\0project-1", "/Users/example/project"),
    );
  });

  it("adds a lease only to a live process-local session in an authenticated list", async () => {
    const response = (await GET({} as NextRequest)) as {
      body: { sessions: Array<Record<string, unknown>> };
      init: { headers: Record<string, string> };
    };

    expect(response.body.sessions).toEqual([
      { ...session, inputLease: leaseToken },
    ]);
    expect(mockIssueWorkbenchTerminalInputLease).toHaveBeenCalledWith(
      {
        userId: "user-1",
        workspaceKey: "user-1\0project-1",
        sessionId: session.id,
        context: { chatId: null, projectId: "project-1" },
      },
      mockInputSender,
    );
    expect(response.init.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("keeps a cold-instance list compatible by omitting an unusable lease", async () => {
    mockCreateLocalInteractiveTerminalInputSender.mockReturnValue(null);

    const response = (await GET({} as NextRequest)) as {
      body: { sessions: Array<Record<string, unknown>> };
    };

    expect(response.body.sessions).toEqual([session]);
    expect(mockIssueWorkbenchTerminalInputLease).not.toHaveBeenCalled();
  });

  it("keeps the create response shape and adds the local lease after premium authorization", async () => {
    const response = (await POST({} as NextRequest)) as {
      body: Record<string, unknown>;
      init: { status: number; headers: Record<string, string> };
    };

    expect(mockAuthorizePremiumWorkbench).toHaveBeenCalledTimes(1);
    expect(mockReadWorkbenchRequestTextWithLimit).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({ ...session, inputLease: leaseToken });
    expect(response.init.status).toBe(201);
    expect(response.init.headers["Cache-Control"]).toBe("private, no-store");
  });

  it("creates the loopback macOS PTY without connecting a remote sandbox", async () => {
    mockIsLocalMacWorkbenchTerminalRequest.mockReturnValue(true);

    const response = (await POST({} as NextRequest)) as {
      body: Record<string, unknown>;
      init: { status: number };
    };

    expect(mockCreateLocalInteractiveTerminalSession).toHaveBeenCalledWith(
      "local\0user-1\0project-1",
      "/Users/example/project",
      expect.objectContaining({ profile: "shell" }),
    );
    expect(mockWithPremiumWorkspaceSandbox).not.toHaveBeenCalled();
    expect(mockCreateInteractiveTerminalSession).not.toHaveBeenCalled();
    expect(response.body).toEqual(
      expect.objectContaining({ backend: "local", profile: "shell" }),
    );
    expect(response.init.status).toBe(201);
  });

  it("rejects a remote-only agent profile before connecting a paid sandbox", async () => {
    mockParseCreateTerminalRequest.mockReturnValue({
      cols: 80,
      rows: 24,
      cwd: "",
      clientTerminalId: null,
      profile: "codex",
    });

    const response = (await POST({} as NextRequest)) as { error: unknown };

    expect(response.error).toEqual(
      expect.objectContaining({
        status: 409,
        code: "terminal_profile_unavailable",
      }),
    );
    expect(mockWithPremiumWorkspaceSandbox).not.toHaveBeenCalled();
    expect(mockCreateInteractiveTerminalSession).not.toHaveBeenCalled();
  });
});
