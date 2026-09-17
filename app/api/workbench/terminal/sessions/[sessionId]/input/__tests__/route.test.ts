import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";
import { WORKBENCH_TERMINAL_INPUT_LEASE_HEADER } from "@/lib/workbench/interactive-terminal-contract";

class MockWorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

const sessionId = "0123456789abcdef01234567";
const leaseToken = "a".repeat(43);
const bytes = new Uint8Array([97]);
const mockAssertSameOriginMutation = jest.fn();
const mockAuthorizePremiumWorkbench = jest.fn();
const mockReadWorkbenchRequestTextWithLimit = jest.fn();
const mockWithPremiumWorkspaceTerminalInputSandbox = jest.fn();
const mockWorkbenchTerminalLeaseContext = jest.fn();
const mockWorkbenchErrorResponse = jest.fn((error: unknown) => ({ error }));
const mockParseTerminalSessionId = jest.fn((value: string) => value);
const mockParseTerminalInput = jest.fn(() => bytes);
const mockSendInteractiveTerminalInput = jest.fn();
const mockLeaseSendInput = jest.fn();
const mockAuthenticatedSender = jest.fn();
const mockConsumeWorkbenchTerminalInputLease = jest.fn();
const mockIssueWorkbenchTerminalInputLease = jest.fn();
const mockRevokeWorkbenchTerminalInputLease = jest.fn();

let POST: (
  req: NextRequest,
  context: { params: Promise<{ sessionId: string }> },
) => Promise<unknown>;

function request(inputLease?: string) {
  const headers = new Map<string, string>();
  if (inputLease) {
    headers.set(
      WORKBENCH_TERMINAL_INPUT_LEASE_HEADER.toLowerCase(),
      inputLease,
    );
  }
  return {
    headers: {
      get(name: string) {
        return headers.get(name.toLowerCase()) ?? null;
      },
    },
  } as unknown as NextRequest;
}

const routeContext = { params: Promise.resolve({ sessionId }) };

describe("Workbench terminal input route", () => {
  beforeAll(() => {
    if (typeof globalThis.Response === "undefined") {
      class TestResponse {
        readonly status: number;
        readonly headers: Headers;

        constructor(_body: BodyInit | null, init?: ResponseInit) {
          this.status = init?.status ?? 200;
          this.headers = new Headers(init?.headers);
        }
      }
      Object.defineProperty(globalThis, "Response", {
        configurable: true,
        value: TestResponse,
      });
    }
    jest.resetModules();
    jest.doMock("@/lib/workbench/interactive-terminal", () => ({
      MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES: 32 * 1024,
      parseTerminalInput: mockParseTerminalInput,
      parseTerminalSessionId: mockParseTerminalSessionId,
      sendInteractiveTerminalInput: mockSendInteractiveTerminalInput,
    }));
    jest.doMock("@/lib/workbench/terminal-input-lease", () => ({
      consumeWorkbenchTerminalInputLease:
        mockConsumeWorkbenchTerminalInputLease,
      issueWorkbenchTerminalInputLease: mockIssueWorkbenchTerminalInputLease,
      revokeWorkbenchTerminalInputLease: mockRevokeWorkbenchTerminalInputLease,
    }));
    jest.doMock("@/lib/workbench/workspace-server", () => ({
      WorkbenchRequestError: MockWorkbenchRequestError,
      assertSameOriginMutation: mockAssertSameOriginMutation,
      authorizePremiumWorkbench: mockAuthorizePremiumWorkbench,
      isLocalMacWorkbenchTerminalRequest: () => false,
      readWorkbenchRequestTextWithLimit: mockReadWorkbenchRequestTextWithLimit,
      withPremiumWorkspaceTerminalInputSandbox:
        mockWithPremiumWorkspaceTerminalInputSandbox,
      workbenchTerminalLeaseContext: mockWorkbenchTerminalLeaseContext,
      workbenchErrorResponse: mockWorkbenchErrorResponse,
    }));
    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertSameOriginMutation.mockImplementation(() => undefined);
    mockAuthorizePremiumWorkbench.mockResolvedValue({
      userId: "user-1",
      subscription: "pro",
    });
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ data: "YQ==" }),
    );
    mockWorkbenchTerminalLeaseContext.mockReturnValue({
      chatId: "chat-1",
      projectId: null,
    });
    mockConsumeWorkbenchTerminalInputLease.mockReturnValue({
      userId: "user-1",
      workspaceKey: "user-1\0project-1",
      sessionId,
      context: { chatId: "chat-1", projectId: null },
      sendInput: mockLeaseSendInput,
    });
    mockLeaseSendInput.mockResolvedValue(undefined);
    mockAuthenticatedSender.mockResolvedValue(undefined);
    mockSendInteractiveTerminalInput.mockResolvedValue(mockAuthenticatedSender);
    mockIssueWorkbenchTerminalInputLease.mockReturnValue(leaseToken);
    mockWithPremiumWorkspaceTerminalInputSandbox.mockImplementation(
      async (_req, _inputBytes, action) =>
        action({}, "user-1", "user-1\0project-1"),
    );
  });

  it("uses the same-origin, bounded, process-local path without rerunning account or sandbox resolution", async () => {
    const response = (await POST(
      request(leaseToken),
      routeContext,
    )) as Response;

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mockAssertSameOriginMutation).toHaveBeenCalledTimes(1);
    expect(mockReadWorkbenchRequestTextWithLimit).toHaveBeenCalledTimes(1);
    expect(mockConsumeWorkbenchTerminalInputLease).toHaveBeenCalledWith({
      token: leaseToken,
      sessionId,
      context: { chatId: "chat-1", projectId: null },
      inputBytes: 1,
    });
    expect(mockLeaseSendInput).toHaveBeenCalledWith(bytes);
    expect(mockAuthorizePremiumWorkbench).not.toHaveBeenCalled();
    expect(mockWithPremiumWorkspaceTerminalInputSandbox).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin lease request before reading attacker-controlled bytes", async () => {
    const error = new MockWorkbenchRequestError(
      "Cross-origin request.",
      403,
      "cross_origin",
    );
    mockAssertSameOriginMutation.mockImplementation(() => {
      throw error;
    });

    const response = await POST(request(leaseToken), routeContext);

    expect(response).toEqual({ error });
    expect(mockReadWorkbenchRequestTextWithLimit).not.toHaveBeenCalled();
    expect(mockConsumeWorkbenchTerminalInputLease).not.toHaveBeenCalled();
    expect(mockAuthorizePremiumWorkbench).not.toHaveBeenCalled();
  });

  it("revokes a lease whose local PTY moved to another instance", async () => {
    const error = new MockWorkbenchRequestError(
      "Moved instance.",
      409,
      "terminal_fast_path_unavailable",
    );
    mockLeaseSendInput.mockRejectedValue(error);

    const response = await POST(request(leaseToken), routeContext);

    expect(response).toEqual({
      error: expect.objectContaining({
        status: 409,
        code: "terminal_fast_path_unavailable",
      }),
    });
    expect(mockRevokeWorkbenchTerminalInputLease).toHaveBeenCalledWith(
      leaseToken,
    );
    expect(mockAuthorizePremiumWorkbench).not.toHaveBeenCalled();
  });

  it("preserves the fully authenticated fallback and refreshes a local lease", async () => {
    const response = (await POST(request(), routeContext)) as Response;

    expect(mockAuthorizePremiumWorkbench).toHaveBeenCalledTimes(1);
    expect(mockReadWorkbenchRequestTextWithLimit).toHaveBeenCalledTimes(1);
    expect(mockWithPremiumWorkspaceTerminalInputSandbox).toHaveBeenCalledTimes(
      1,
    );
    expect(mockSendInteractiveTerminalInput).toHaveBeenCalledWith(
      {},
      "user-1\0project-1",
      sessionId,
      bytes,
    );
    expect(mockIssueWorkbenchTerminalInputLease).toHaveBeenCalledWith(
      {
        userId: "user-1",
        workspaceKey: "user-1\0project-1",
        sessionId,
        context: { chatId: "chat-1", projectId: null },
      },
      mockAuthenticatedSender,
    );
    expect(response.status).toBe(204);
    expect(response.headers.get(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER)).toBe(
      leaseToken,
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("caches the authenticated pid sender without opening a second output attachment", async () => {
    const response = (await POST(request(), routeContext)) as Response;

    expect(mockSendInteractiveTerminalInput).toHaveBeenCalledTimes(1);
    expect(mockIssueWorkbenchTerminalInputLease).toHaveBeenCalledWith(
      expect.any(Object),
      mockAuthenticatedSender,
    );
    expect(response.headers.get(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER)).toBe(
      leaseToken,
    );
  });
});
