import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";
import {
  FIND_GIT_ROOT_COMMAND,
  type BoundedGitStatus,
} from "@/lib/workbench/git-status-command";
import {
  FILTER_FREE_GIT_STATUS_COMMAND,
  GIT_COMMIT_PREFLIGHT_COMMAND,
  GIT_INIT_COMMAND,
  GIT_MUTATION_COMMAND,
} from "@/lib/workbench/git-operations";

const mockAssertSameOriginMutation = jest.fn();
const mockAssertWorkspaceDirectoryAccess = jest.fn();
const mockAuthorizePremiumWorkbench = jest.fn();
const mockReadWorkbenchRequestTextWithLimit = jest.fn();
const mockWithPremiumWorkspaceSandbox = jest.fn();
const mockWorkbenchErrorResponse = jest.fn((error: unknown) => ({ error }));
const mockNextResponseJson = jest.fn((body: unknown, init?: unknown) => ({
  body,
  init,
}));
const mockSandboxRun = jest.fn();

class MockWorkbenchRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
  }
}

let POST: (req: NextRequest) => Promise<unknown>;

function request() {
  return {} as NextRequest;
}

const cleanStatus: BoundedGitStatus = {
  ahead: 0,
  behind: 0,
  detached: false,
  currentBranch: "main",
  fileStatus: [],
  truncated: false,
};

describe("Workbench Git route contract", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@e2b/code-interpreter", () => ({
      CommandExitError: class CommandExitError extends Error {},
    }));
    jest.doMock("@/lib/workbench/workspace-server", () => ({
      assertSameOriginMutation: mockAssertSameOriginMutation,
      assertWorkspaceDirectoryAccess: mockAssertWorkspaceDirectoryAccess,
      authorizePremiumWorkbench: mockAuthorizePremiumWorkbench,
      readWorkbenchRequestTextWithLimit: mockReadWorkbenchRequestTextWithLimit,
      withPremiumWorkspaceSandbox: mockWithPremiumWorkspaceSandbox,
      workbenchErrorResponse: mockWorkbenchErrorResponse,
      WorkbenchRequestError: MockWorkbenchRequestError,
    }));

    ({ POST } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertSameOriginMutation.mockImplementation(() => undefined);
    mockAssertWorkspaceDirectoryAccess.mockImplementation(async (path) => path);
    mockAuthorizePremiumWorkbench.mockResolvedValue({
      userId: "user-1",
      subscription: "pro",
    });
    mockSandboxRun.mockImplementation(async (command: string) => {
      if (command === FIND_GIT_ROOT_COMMAND) {
        return {
          stdout: JSON.stringify({ repositoryRoot: "/home/user/project" }),
        };
      }
      if (command === GIT_MUTATION_COMMAND) {
        return {
          stdout: JSON.stringify({ ok: true, action: "stage" }),
        };
      }
      return { stdout: JSON.stringify(cleanStatus) };
    });
    mockWithPremiumWorkspaceSandbox.mockImplementation(async (_req, action) =>
      action({ commands: { run: mockSandboxRun } }, "user-1"),
    );
  });

  it("runs the same-origin mutation gate before auth and body parsing", async () => {
    const gateError = new MockWorkbenchRequestError(
      "Cross-origin request.",
      403,
      "cross_origin",
    );
    mockAssertSameOriginMutation.mockImplementation(() => {
      throw gateError;
    });

    const response = await POST(request());

    expect(mockWorkbenchErrorResponse).toHaveBeenCalledWith(gateError);
    expect(response).toEqual({ error: gateError });
    expect(mockAuthorizePremiumWorkbench).not.toHaveBeenCalled();
    expect(mockReadWorkbenchRequestTextWithLimit).not.toHaveBeenCalled();
  });

  it("completes premium authorization before reading the request body", async () => {
    const authError = new MockWorkbenchRequestError(
      "Premium required.",
      403,
      "premium_required",
    );
    mockAuthorizePremiumWorkbench.mockRejectedValue(authError);

    await POST(request());

    expect(mockAssertSameOriginMutation).toHaveBeenCalledTimes(1);
    expect(mockReadWorkbenchRequestTextWithLimit).not.toHaveBeenCalled();
    expect(mockWithPremiumWorkspaceSandbox).not.toHaveBeenCalled();
  });

  it("initializes an authorized directory without requiring an existing repository", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "init", path: "new-project" }),
    );
    mockSandboxRun.mockImplementation(async (command: string) => {
      if (command !== GIT_INIT_COMMAND)
        throw new Error("Init must not discover an existing repository first");
      return { stdout: JSON.stringify({ ok: true, action: "init" }) };
    });

    expect(await POST(request())).toEqual(
      expect.objectContaining({ body: { ok: true, action: "init" } }),
    );
    expect(mockAssertWorkspaceDirectoryAccess).toHaveBeenCalledWith(
      expect.anything(),
      "new-project",
    );
    expect(mockSandboxRun).toHaveBeenCalledWith(
      GIT_INIT_COMMAND,
      expect.objectContaining({
        envs: expect.objectContaining({
          RIFT_ROOT: "/home/user",
          RIFT_GIT_INIT_TARGET: "/home/user/new-project",
        }),
      }),
    );
  });

  it("does not initialize when directory access rejects a symlink or unavailable folder", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "init", path: "linked-project" }),
    );
    const error = new MockWorkbenchRequestError(
      "Unsafe directory",
      403,
      "path_outside_workspace",
    );
    mockAssertWorkspaceDirectoryAccess.mockRejectedValue(error);

    expect(await POST(request())).toEqual({ error });
    expect(mockSandboxRun).not.toHaveBeenCalled();
  });

  it("rejects an init path outside the workspace before connecting", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "init", path: "../outside" }),
    );

    await POST(request());

    expect(mockWorkbenchErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({ code: "path_outside_workspace" }),
    );
    expect(mockWithPremiumWorkspaceSandbox).not.toHaveBeenCalled();
  });

  it("preserves the existing-repository refusal from init", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "init", path: "project" }),
    );
    mockSandboxRun.mockResolvedValue({
      stdout: JSON.stringify({
        ok: false,
        action: "init",
        code: "already_a_repository",
      }),
    });

    await POST(request());

    expect(mockWorkbenchErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({ status: 409, code: "already_a_repository" }),
    );
  });

  it("keeps a selected path out of shell source and passes it only as env data", async () => {
    const file = "odd $(touch ROUTE_PATH_INJECTION).txt";
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "stage", path: "project", file }),
    );
    mockSandboxRun.mockImplementation(async (command: string) => {
      if (command === FIND_GIT_ROOT_COMMAND) {
        return {
          stdout: JSON.stringify({ repositoryRoot: "/home/user/project" }),
        };
      }
      if (command === FILTER_FREE_GIT_STATUS_COMMAND) {
        return {
          stdout: JSON.stringify({
            ...cleanStatus,
            fileStatus: [
              {
                name: file,
                status: "untracked",
                indexStatus: "?",
                workingTreeStatus: "?",
                staged: false,
              },
            ],
          } satisfies BoundedGitStatus),
        };
      }
      return {
        stdout: JSON.stringify({ ok: true, action: "stage" }),
      };
    });

    const response = (await POST(request())) as {
      body: { ok: boolean; action: string };
    };

    expect(response.body).toEqual({ ok: true, action: "stage" });
    const mutationCall = mockSandboxRun.mock.calls.find(
      ([command]) => command === GIT_MUTATION_COMMAND,
    );
    expect(mutationCall).toBeDefined();
    const [command, options] = mutationCall as [
      string,
      { envs: Record<string, string> },
    ];
    expect(command).not.toContain(file);
    expect(options.envs.RIFT_GIT_FILE).toBe(file);
    expect(options.envs.RIFT_REPOSITORY_ROOT).toBe("/home/user/project");
  });

  it("keeps the commit message out of shell source and sends it as base64 env data", async () => {
    const message = "release $(touch ROUTE_COMMIT_INJECTION)";
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({ action: "commit", path: "project", message }),
    );
    mockSandboxRun.mockImplementation(async (command: string) => {
      if (command === FIND_GIT_ROOT_COMMAND) {
        return {
          stdout: JSON.stringify({ repositoryRoot: "/home/user/project" }),
        };
      }
      if (command === FILTER_FREE_GIT_STATUS_COMMAND) {
        return { stdout: JSON.stringify(cleanStatus) };
      }
      if (command === GIT_COMMIT_PREFLIGHT_COMMAND) {
        return {
          stdout: JSON.stringify({
            treeOid: "b".repeat(40),
            parentOid: "d".repeat(40),
            headRef: "refs/heads/main",
            changedPaths: ["README.md"],
            truncated: false,
          }),
        };
      }
      return {
        stdout: JSON.stringify({
          ok: true,
          action: "commit",
          oid: "a".repeat(40),
        }),
      };
    });

    const response = (await POST(request())) as {
      body: { commit: { oid: string } };
    };

    expect(response.body.commit.oid).toBe("a".repeat(40));
    const mutationCall = mockSandboxRun.mock.calls.find(
      ([command]) => command === GIT_MUTATION_COMMAND,
    );
    const [command, options] = mutationCall as [
      string,
      { envs: Record<string, string> },
    ];
    expect(command).not.toContain(message);
    expect(
      Buffer.from(options.envs.RIFT_GIT_COMMIT_MESSAGE_B64, "base64").toString(
        "utf8",
      ),
    ).toBe(message);
    expect(options.envs.RIFT_GIT_EXPECTED_TREE).toBe("b".repeat(40));
    expect(options.envs.RIFT_GIT_EXPECTED_PARENT).toBe("d".repeat(40));
    expect(options.envs.RIFT_GIT_EXPECTED_HEAD_REF).toBe("refs/heads/main");
  });

  it("refuses to commit staged paths hidden by the workspace policy", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue(
      JSON.stringify({
        action: "commit",
        path: "project",
        message: "Do not include secrets",
      }),
    );
    mockSandboxRun.mockImplementation(async (command: string) => {
      if (command === FIND_GIT_ROOT_COMMAND) {
        return {
          stdout: JSON.stringify({ repositoryRoot: "/home/user/project" }),
        };
      }
      if (command === GIT_COMMIT_PREFLIGHT_COMMAND) {
        return {
          stdout: JSON.stringify({
            treeOid: "c".repeat(40),
            parentOid: "d".repeat(40),
            headRef: "refs/heads/main",
            changedPaths: [".env"],
            truncated: false,
          }),
        };
      }
      return {
        stdout: JSON.stringify({ ok: true, action: "commit" }),
      };
    });

    await POST(request());

    expect(mockWorkbenchErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 409,
        code: "protected_staged_changes",
      }),
    );
    expect(
      mockSandboxRun.mock.calls.some(
        ([command]) => command === GIT_MUTATION_COMMAND,
      ),
    ).toBe(false);
  });

  it("rejects invalid mutation JSON before opening a workspace sandbox", async () => {
    mockReadWorkbenchRequestTextWithLimit.mockResolvedValue("not-json");

    await POST(request());

    expect(mockWithPremiumWorkspaceSandbox).not.toHaveBeenCalled();
    expect(mockWorkbenchErrorResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        code: "invalid_git_mutation",
      }),
    );
  });
});
