import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

const mockAuthorizePremiumWorkbench = jest.fn();
const mockIsLocalMacWorkbenchTerminalRequest = jest.fn();
const mockWorkbenchErrorResponse = jest.fn((error: unknown) => ({ error }));
const mockResolveLocalWorkspaceRoot = jest.fn();
const mockResolveLocalTerminalProfileCapabilities = jest.fn();
const mockNextResponseJson = jest.fn((body: unknown, init?: unknown) => ({
  body,
  init,
}));

let GET: (req: NextRequest) => Promise<unknown>;

describe("Workbench terminal profile capabilities", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/workbench/local-pty-adapter", () => ({
      resolveLocalWorkspaceRoot: mockResolveLocalWorkspaceRoot,
      resolveLocalTerminalProfileCapabilities:
        mockResolveLocalTerminalProfileCapabilities,
    }));
    jest.doMock("@/lib/workbench/workspace-server", () => ({
      authorizePremiumWorkbench: mockAuthorizePremiumWorkbench,
      isLocalMacWorkbenchTerminalRequest:
        mockIsLocalMacWorkbenchTerminalRequest,
      workbenchErrorResponse: mockWorkbenchErrorResponse,
    }));
    ({ GET } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthorizePremiumWorkbench.mockResolvedValue({
      userId: "user-1",
      subscription: "pro",
    });
    mockIsLocalMacWorkbenchTerminalRequest.mockReturnValue(false);
    mockResolveLocalWorkspaceRoot.mockReturnValue("/Users/example/project");
    mockResolveLocalTerminalProfileCapabilities.mockReturnValue([
      {
        profile: "shell",
        available: true,
        runtimeLabel: "macOS zsh",
        unavailableReason: null,
      },
    ]);
  });

  it("authenticates and advertises only the shell on the remote backend", async () => {
    const response = (await GET({} as NextRequest)) as {
      body: {
        backend: string;
        profiles: Array<{ profile: string; available: boolean }>;
      };
      init: { headers: Record<string, string> };
    };

    expect(mockAuthorizePremiumWorkbench).toHaveBeenCalledTimes(1);
    expect(response.body.backend).toBe("remote");
    expect(response.body.profiles).toEqual([
      expect.objectContaining({ profile: "shell", available: true }),
      expect.objectContaining({ profile: "claude", available: false }),
      expect.objectContaining({ profile: "codex", available: false }),
      expect.objectContaining({ profile: "grok", available: false }),
    ]);
    expect(response.init.headers["Cache-Control"]).toBe("private, no-store");
    expect(mockResolveLocalWorkspaceRoot).not.toHaveBeenCalled();
  });

  it("returns detected host commands only after validating the local workspace root", async () => {
    mockIsLocalMacWorkbenchTerminalRequest.mockReturnValue(true);

    const response = (await GET({} as NextRequest)) as {
      body: { backend: string; profiles: unknown[] };
    };

    expect(mockResolveLocalWorkspaceRoot).toHaveBeenCalledTimes(1);
    expect(mockResolveLocalTerminalProfileCapabilities).toHaveBeenCalledTimes(
      1,
    );
    expect(response.body).toEqual({
      backend: "local",
      profiles: [
        expect.objectContaining({
          profile: "shell",
          available: true,
          runtimeLabel: "macOS zsh",
        }),
      ],
    });
  });
});
