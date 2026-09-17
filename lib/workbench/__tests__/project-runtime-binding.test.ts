import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

const mockGetUserIDAndPro = jest.fn();
const mockAssertUserCanMakeCostIncurringRequest = jest.fn();
const mockGetChatById = jest.fn();
const mockGetActiveProjectForUser = jest.fn();
const mockGetSandbox = jest.fn();
const mockHybridSandboxManager = jest.fn().mockImplementation(function (this: {
  getSandbox: typeof mockGetSandbox;
}) {
  this.getSandbox = mockGetSandbox;
});

let withPremiumWorkspaceSandbox: (typeof import("@/lib/workbench/workspace-server"))["withPremiumWorkspaceSandbox"];
let withPremiumManualTerminalSandbox: (typeof import("@/lib/workbench/workspace-server"))["withPremiumManualTerminalSandbox"];
let resetWorkbenchWorkspaceSandboxCacheForTests: (typeof import("@/lib/workbench/workspace-server"))["resetWorkbenchWorkspaceSandboxCacheForTests"];
let deriveProjectSandboxNamespace: (typeof import("@/lib/projects/project-runtime"))["deriveProjectSandboxNamespace"];

const originalNamespaceSecret = process.env.PROJECT_SANDBOX_NAMESPACE_SECRET;
const namespaceSecret = "workbench-project-test-secret";
const projectId = "project-alpha";

function request(headers: Record<string, string> = {}) {
  const normalizedHeaders = new Map(
    Object.entries({
      "x-rift-workbench": "1",
      "sec-fetch-site": "same-origin",
      origin: "https://riftsys.app",
      ...headers,
    }).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    url: "https://riftsys.app/api/workbench/tree",
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
  } as unknown as NextRequest;
}

function managerArgument(index: number) {
  return mockHybridSandboxManager.mock.calls.at(-1)?.[index];
}

describe("Workbench project runtime binding", () => {
  beforeAll(() => {
    process.env.PROJECT_SANDBOX_NAMESPACE_SECRET = namespaceSecret;
    jest.resetModules();
    jest.doMock("server-only", () => ({}), { virtual: true });
    jest.doMock("next/server", () => ({
      NextResponse: { json: jest.fn() },
    }));
    jest.doMock("@e2b/code-interpreter", () => ({
      CommandExitError: class CommandExitError extends Error {},
    }));
    jest.doMock("isbinaryfile", () => ({
      isBinaryFileSync: jest.fn(() => false),
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserIDAndPro: mockGetUserIDAndPro,
    }));
    jest.doMock("@/lib/suspensions", () => ({
      assertUserCanMakeCostIncurringRequest:
        mockAssertUserCanMakeCostIncurringRequest,
    }));
    jest.doMock("@/lib/db/actions", () => ({
      getChatById: mockGetChatById,
      getActiveProjectForUser: mockGetActiveProjectForUser,
    }));
    jest.doMock("@/lib/ai/tools/utils/hybrid-sandbox-manager", () => ({
      HybridSandboxManager: mockHybridSandboxManager,
    }));

    const workspaceServer =
      require("@/lib/workbench/workspace-server") as typeof import("@/lib/workbench/workspace-server");
    const projectRuntime =
      require("@/lib/projects/project-runtime") as typeof import("@/lib/projects/project-runtime");
    withPremiumWorkspaceSandbox = workspaceServer.withPremiumWorkspaceSandbox;
    withPremiumManualTerminalSandbox =
      workspaceServer.withPremiumManualTerminalSandbox;
    resetWorkbenchWorkspaceSandboxCacheForTests =
      workspaceServer.resetWorkbenchWorkspaceSandboxCacheForTests;
    deriveProjectSandboxNamespace =
      projectRuntime.deriveProjectSandboxNamespace;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    resetWorkbenchWorkspaceSandboxCacheForTests();
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-123",
      subscription: "pro",
    });
    mockAssertUserCanMakeCostIncurringRequest.mockResolvedValue(undefined);
    mockGetChatById.mockResolvedValue(null);
    mockGetActiveProjectForUser.mockImplementation(
      async ({ projectId: requestedId }: { projectId: string }) =>
        requestedId === projectId
          ? { _id: projectId, type: "app" as const }
          : null,
    );
    mockGetSandbox.mockResolvedValue({ sandbox: { marker: "sandbox" } });
  });

  afterAll(() => {
    if (originalNamespaceSecret === undefined) {
      delete process.env.PROJECT_SANDBOX_NAMESPACE_SECRET;
    } else {
      process.env.PROJECT_SANDBOX_NAMESPACE_SECRET = originalNamespaceSecret;
    }
  });

  it("resolves a persisted Build chat into the exact project sandbox namespace", async () => {
    mockGetChatById.mockResolvedValue({
      user_id: "user-123",
      purpose: "app",
      project_id: projectId,
    });

    let callbackWorkspaceKey: string | undefined;
    await withPremiumWorkspaceSandbox(
      request({ "x-rift-workbench-chat-id": "chat-123" }),
      async (_sandbox, _userId, workspaceKey) => {
        callbackWorkspaceKey = workspaceKey;
      },
    );

    expect(mockGetChatById).toHaveBeenCalledWith({ id: "chat-123" });
    expect(mockGetActiveProjectForUser).toHaveBeenCalledWith({
      projectId,
      userId: "user-123",
    });
    expect(managerArgument(0)).toBe("user-123");
    const namespace = deriveProjectSandboxNamespace(
      "user-123",
      projectId,
      namespaceSecret,
    );
    expect(managerArgument(7)).toBe(namespace);
    expect(callbackWorkspaceKey).toBe(`user-123\0${namespace}`);
  });

  it("validates a fresh project selection before opening its sandbox", async () => {
    await withPremiumWorkspaceSandbox(
      request({ "x-rift-workbench-project-id": projectId }),
      async () => undefined,
    );

    expect(mockGetChatById).not.toHaveBeenCalled();
    expect(mockGetActiveProjectForUser).toHaveBeenCalledWith({
      projectId,
      userId: "user-123",
    });
    expect(managerArgument(7)).toBe(
      deriveProjectSandboxNamespace("user-123", projectId, namespaceSecret),
    );
  });

  it("rejects a missing route-bound chat before opening any sandbox", async () => {
    mockGetChatById.mockResolvedValue(null);

    await expect(
      withPremiumWorkspaceSandbox(
        request({ "x-rift-workbench-chat-id": "deleted-chat" }),
        async () => undefined,
      ),
    ).rejects.toMatchObject({ type: "not_found", statusCode: 404 });

    expect(mockGetChatById).toHaveBeenCalledWith({ id: "deleted-chat" });
    expect(mockGetActiveProjectForUser).not.toHaveBeenCalled();
    expect(mockHybridSandboxManager).not.toHaveBeenCalled();
  });

  it("keeps standalone Explorer and PTY APIs on the legacy account workspace", async () => {
    await withPremiumWorkspaceSandbox(request(), async () => undefined);

    expect(mockGetChatById).not.toHaveBeenCalled();
    expect(mockGetActiveProjectForUser).not.toHaveBeenCalled();
    expect(managerArgument(0)).toBe("user-123");
    expect(managerArgument(7)).toBeUndefined();
  });

  it("reuses one warm sandbox manager for sequential requests in the same authoritative scope", async () => {
    await withPremiumWorkspaceSandbox(request(), async () => undefined);
    await withPremiumWorkspaceSandbox(request(), async () => undefined);

    expect(mockHybridSandboxManager).toHaveBeenCalledTimes(1);
    expect(mockGetSandbox).toHaveBeenCalledTimes(2);
  });

  it("evicts the warm manager after a stale sandbox failure", async () => {
    await expect(
      withPremiumWorkspaceSandbox(request(), async () => {
        throw new Error("Sandbox was not found");
      }),
    ).rejects.toThrow("Sandbox was not found");

    await withPremiumWorkspaceSandbox(request(), async () => undefined);

    expect(mockHybridSandboxManager).toHaveBeenCalledTimes(2);
  });

  it("does not evict the warm manager for a missing file", async () => {
    const missingFile = new Error("Path /home/user/missing.txt not found");
    missingFile.name = "NotFoundError";

    await expect(
      withPremiumWorkspaceSandbox(request(), async () => {
        throw missingFile;
      }),
    ).rejects.toBe(missingFile);

    await withPremiumWorkspaceSandbox(request(), async () => undefined);

    expect(mockHybridSandboxManager).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce simultaneous standalone and project connections", async () => {
    const releases: Array<(value: { sandbox: object }) => void> = [];
    mockGetSandbox.mockImplementation(
      () =>
        new Promise<{ sandbox: object }>((resolve) => {
          releases.push(resolve);
        }),
    );

    const standalone = withPremiumWorkspaceSandbox(
      request(),
      async () => undefined,
    );
    const project = withPremiumWorkspaceSandbox(
      request({ "x-rift-workbench-project-id": projectId }),
      async () => undefined,
    );

    for (let attempt = 0; attempt < 10 && releases.length < 2; attempt += 1) {
      await Promise.resolve();
    }
    expect(releases).toHaveLength(2);
    releases.forEach((release, index) =>
      release({ sandbox: { marker: `sandbox-${index}` } }),
    );
    await Promise.all([standalone, project]);
  });

  it("shares a project-bound command runner with Build but preserves the standalone runner namespace", async () => {
    await withPremiumManualTerminalSandbox(
      request({ "x-rift-workbench-project-id": projectId }),
      async () => undefined,
    );
    expect(managerArgument(0)).toBe("user-123");
    expect(managerArgument(7)).toBe(
      deriveProjectSandboxNamespace("user-123", projectId, namespaceSecret),
    );

    jest.clearAllMocks();
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-123",
      subscription: "pro",
    });
    mockAssertUserCanMakeCostIncurringRequest.mockResolvedValue(undefined);
    mockGetSandbox.mockResolvedValue({ sandbox: { marker: "standalone" } });
    await withPremiumManualTerminalSandbox(request(), async () => undefined);

    expect(managerArgument(0)).toBe("user-123:workbench-cli-v2");
    expect(managerArgument(7)).toBeUndefined();
  });

  it("rejects a spoofed project before connecting to a sandbox", async () => {
    mockGetChatById.mockResolvedValue({
      user_id: "user-123",
      purpose: "app",
      project_id: projectId,
    });

    await expect(
      withPremiumWorkspaceSandbox(
        request({
          "x-rift-workbench-chat-id": "chat-123",
          "x-rift-workbench-project-id": "project-other",
        }),
        async () => undefined,
      ),
    ).rejects.toMatchObject({ type: "forbidden" });
    expect(mockHybridSandboxManager).not.toHaveBeenCalled();
  });
});
