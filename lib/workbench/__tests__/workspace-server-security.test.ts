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
const mockGetSandbox = jest.fn();
const mockAssertUserCanMakeCostIncurringRequest = jest.fn();
let authorizePremiumWorkbench: (typeof import("@/lib/workbench/workspace-server"))["authorizePremiumWorkbench"];
let withPremiumWorkspaceSandbox: (typeof import("@/lib/workbench/workspace-server"))["withPremiumWorkspaceSandbox"];
let withPremiumWorkspaceTerminalInputSandbox: (typeof import("@/lib/workbench/workspace-server"))["withPremiumWorkspaceTerminalInputSandbox"];
const originalSkin = process.env.RIFT_UI_SKIN;

function request(
  headers: Record<string, string> = {},
  url = "https://riftsys.app/api/workbench/tree",
) {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );

  return {
    url,
    headers: {
      get(name: string) {
        return normalizedHeaders.get(name.toLowerCase()) ?? null;
      },
    },
  } as unknown as NextRequest;
}

function browserRequest(overrides: Record<string, string> = {}) {
  return request({
    "x-rift-workbench": "1",
    "sec-fetch-site": "same-origin",
    origin: "https://riftsys.app",
    ...overrides,
  });
}

describe("Workbench request security", () => {
  beforeAll(() => {
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
    jest.doMock("@/lib/ai/tools/utils/hybrid-sandbox-manager", () => ({
      HybridSandboxManager: jest.fn().mockImplementation(() => ({
        getSandbox: mockGetSandbox,
      })),
    }));

    const workspaceServer =
      require("@/lib/workbench/workspace-server") as typeof import("@/lib/workbench/workspace-server");
    authorizePremiumWorkbench = workspaceServer.authorizePremiumWorkbench;
    withPremiumWorkspaceSandbox = workspaceServer.withPremiumWorkspaceSandbox;
    withPremiumWorkspaceTerminalInputSandbox =
      workspaceServer.withPremiumWorkspaceTerminalInputSandbox;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSandbox.mockResolvedValue({ sandbox: {} });
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-123",
      subscription: "pro",
    });
    mockAssertUserCanMakeCostIncurringRequest.mockResolvedValue(undefined);
  });

  afterAll(() => {
    if (originalSkin === undefined) delete process.env.RIFT_UI_SKIN;
    else process.env.RIFT_UI_SKIN = originalSkin;
  });

  it("does not use a presentation skin as an API availability gate", async () => {
    process.env.RIFT_UI_SKIN = "default";

    await expect(
      authorizePremiumWorkbench(browserRequest()),
    ).resolves.toMatchObject({ userId: "user-123", subscription: "pro" });
    expect(mockGetUserIDAndPro).toHaveBeenCalledTimes(1);
  });

  it("requires the fixed Workbench header before authentication", async () => {
    await expect(
      authorizePremiumWorkbench(
        request({
          "sec-fetch-site": "same-origin",
          origin: "https://riftsys.app",
        }),
      ),
    ).rejects.toMatchObject({
      status: 403,
      code: "workbench_header_required",
    });
    expect(mockGetUserIDAndPro).not.toHaveBeenCalled();
  });

  it.each(["same-site", "cross-site", "none"])(
    "rejects Sec-Fetch-Site: %s before authentication",
    async (fetchSite) => {
      await expect(
        authorizePremiumWorkbench(
          browserRequest({ "sec-fetch-site": fetchSite }),
        ),
      ).rejects.toMatchObject({ status: 403, code: "cross_origin" });
      expect(mockGetUserIDAndPro).not.toHaveBeenCalled();
    },
  );

  it("accepts a non-browser client only when it supplies the custom header", async () => {
    await expect(
      authorizePremiumWorkbench(request({ "x-rift-workbench": "1" })),
    ).resolves.toMatchObject({ userId: "user-123", subscription: "pro" });
  });

  it("requires an exact serialized Origin match when Origin is present", async () => {
    await expect(
      authorizePremiumWorkbench(
        browserRequest({ origin: "https://riftsys.app/path" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "invalid_origin" });

    await expect(
      authorizePremiumWorkbench(
        browserRequest({ origin: "https://preview.riftsys.app" }),
      ),
    ).rejects.toMatchObject({ status: 403, code: "cross_origin" });

    await expect(
      authorizePremiumWorkbench(browserRequest()),
    ).resolves.toMatchObject({ userId: "user-123" });
  });

  it("rejects a local runner at the cloud-only Workspace boundary", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-cloud-boundary",
      subscription: "pro",
    });
    mockGetSandbox.mockResolvedValue({
      sandbox: { sandboxKind: "centrifugo" },
    });
    const action = jest.fn(async () => "must not run");

    await expect(
      withPremiumWorkspaceSandbox(browserRequest(), action),
    ).rejects.toThrow("This Workspace requires a cloud sandbox.");
    expect(action).not.toHaveBeenCalled();
  });

  it("caps concurrent sandbox-backed operations per user and releases slots", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-concurrency",
      subscription: "pro",
    });
    const releases: Array<() => void> = [];
    const running = Array.from({ length: 4 }, () =>
      withPremiumWorkspaceSandbox(browserRequest(), async () => {
        await new Promise<void>((resolve) => releases.push(resolve));
      }),
    );

    for (let attempt = 0; attempt < 10 && releases.length < 4; attempt += 1) {
      await Promise.resolve();
    }
    expect(releases).toHaveLength(4);

    await expect(
      withPremiumWorkspaceSandbox(browserRequest(), async () => undefined),
    ).rejects.toMatchObject({
      status: 429,
      code: "workbench_concurrency_limited",
    });

    releases.forEach((release) => release());
    await Promise.all(running);
    await expect(
      withPremiumWorkspaceSandbox(browserRequest(), async () => undefined),
    ).resolves.toBeUndefined();
  });

  it("caps repeated sandbox-backed requests per user within the local window", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-request-window",
      subscription: "pro",
    });

    for (let requestIndex = 0; requestIndex < 120; requestIndex += 1) {
      await withPremiumWorkspaceSandbox(
        browserRequest(),
        async () => undefined,
      );
    }

    await expect(
      withPremiumWorkspaceSandbox(browserRequest(), async () => undefined),
    ).rejects.toMatchObject({
      status: 429,
      code: "workbench_rate_limited",
    });

    await expect(
      withPremiumWorkspaceTerminalInputSandbox(
        browserRequest(),
        1,
        async () => undefined,
      ),
    ).resolves.toBeUndefined();
  });

  it("rate limits terminal input by a byte-aware token budget", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-terminal-input-budget",
      subscription: "pro",
    });

    for (let requestIndex = 0; requestIndex < 4; requestIndex += 1) {
      await withPremiumWorkspaceTerminalInputSandbox(
        browserRequest(),
        16 * 1024,
        async () => undefined,
      );
    }

    await expect(
      withPremiumWorkspaceTerminalInputSandbox(
        browserRequest(),
        16 * 1024,
        async () => undefined,
      ),
    ).rejects.toMatchObject({
      status: 429,
      code: "terminal_input_rate_limited",
    });
  });

  it("does not trip the generic request window during sustained typing", async () => {
    mockGetUserIDAndPro.mockResolvedValue({
      userId: "user-sustained-terminal-input",
      subscription: "pro",
    });

    for (let requestIndex = 0; requestIndex < 121; requestIndex += 1) {
      await expect(
        withPremiumWorkspaceTerminalInputSandbox(
          browserRequest(),
          1,
          async () => undefined,
        ),
      ).resolves.toBeUndefined();
    }
  });
});
