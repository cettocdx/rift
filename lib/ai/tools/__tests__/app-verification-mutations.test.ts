import { createTools } from "../index";
import type { ToolApprovalGate } from "@/lib/ai/approval/policy";

const mockFileExecute = jest.fn(async () => ({ success: true }));
const mockTerminalExecute = jest.fn(async () => ({ exitCode: 0 }));
const mockBrowserVerifier = jest.fn(async () => ({
  name: "browser-runtime",
  ok: true,
  detail: "Rendered test app",
}));
const mockSandbox = {
  jupyterUrl: "https://sandbox.example.test",
  getHost: () => "https://app.example.test",
  files: {
    read: jest.fn(async (name: string) => {
      if (name.endsWith("package.json"))
        return JSON.stringify({
          scripts: { build: "vite build" },
          packageManager: "pnpm@10",
        });
      throw new Error("Not found");
    }),
  },
  commands: {
    run: jest.fn(async (command: string) => {
      if (command.includes("rift_vite_harden"))
        return { stdout: "RIFT_PATCHED:[]", stderr: "", exitCode: 0 };
      if (command.includes("127.0.0.1"))
        return {
          stdout: `RIFT_HTTP:200\nRIFT_BYTES:200\nRIFT_TYPE:text/html\nRIFT_BODY_B64:${Buffer.from("<!doctype html><html><body>A working test application</body></html>").toString("base64")}`,
          stderr: "",
          exitCode: 0,
        };
      return { stdout: "RIFT_UP", stderr: "", exitCode: 0 };
    }),
  },
};

jest.mock("../utils/sandbox-manager", () => ({
  DefaultSandboxManager: jest.fn(() => ({
    getSandbox: async () => ({ sandbox: mockSandbox }),
  })),
}));
jest.mock("../utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn(),
}));
jest.mock("../file", () => ({
  createFile: () => ({
    execute: (...args: unknown[]) => (mockFileExecute as jest.Mock)(...args),
  }),
}));
jest.mock("../run-terminal-cmd", () => ({
  createRunTerminalCmd: () => ({
    execute: (...args: unknown[]) =>
      (mockTerminalExecute as jest.Mock)(...args),
  }),
}));
jest.mock("../verify-app", () => {
  const original = jest.requireActual("../verify-app");
  return {
    ...original,
    createVerifyApp: (context: unknown, gate: unknown) =>
      original.createVerifyApp(context, gate, (...args: unknown[]) =>
        (mockBrowserVerifier as jest.Mock)(...args),
      ),
  };
});

function harness(approvalGate?: ToolApprovalGate) {
  return createTools(
    "user",
    "chat",
    { write: jest.fn() } as never,
    "agent",
    {},
    undefined,
    false,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    false,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "app",
    "Improve the app",
    undefined,
    undefined,
    undefined,
    undefined,
    approvalGate,
  );
}

let toolCallSequence = 0;
async function execute(tool: { execute?: unknown }, input: unknown) {
  return (
    tool.execute as (...args: unknown[]) => Promise<Record<string, unknown>>
  )(input, { toolCallId: `call-${++toolCallSequence}`, messages: [] });
}

async function verified(h: ReturnType<typeof harness>) {
  expect(
    await execute(h.tools.verify_app, {
      project_path: "/home/user/app",
      port: 5173,
    }),
  ).toMatchObject({ ok: true });
  expect(await execute(h.tools.expose_preview, { port: 5173 })).toMatchObject({
    ok: true,
  });
  expect(h.isAppBuildComplete()).toBe(true);
}

describe("Build proof follows workspace mutations", () => {
  beforeEach(() => jest.clearAllMocks());

  it("requires new verification after a file edit following a verified preview", async () => {
    const h = harness();
    await verified(h);
    await execute(h.tools.file, {
      action: "edit",
      path: "/home/user/app/src/App.tsx",
    });
    expect(h.isAppBuildComplete()).toBe(false);
    expect(await execute(h.tools.expose_preview, { port: 5173 })).toMatchObject(
      { ok: false },
    );
    await verified(h);
  });

  it.each(["read", "view"])(
    "preserves proof when file action is %s",
    async (action) => {
      const h = harness();
      await verified(h);
      await execute(h.tools.file, {
        action,
        path: "/home/user/app/src/App.tsx",
      });
      expect(h.isAppBuildComplete()).toBe(true);
    },
  );

  it("invalidates on a failed edit because partial writes cannot be ruled out", async () => {
    const h = harness();
    await verified(h);
    mockFileExecute.mockRejectedValueOnce(
      new Error("partial write failed") as never,
    );
    await expect(execute(h.tools.file, { action: "edit" })).rejects.toThrow(
      "partial write",
    );
    expect(h.isAppBuildComplete()).toBe(false);
  });

  it("retains only its own pending frames across provider toolset rebuilds", async () => {
    const owner = harness();
    owner.setCurrentModelName("claude-opus-5");
    mockBrowserVerifier.mockResolvedValueOnce({
      name: "browser-runtime",
      ok: true,
      detail: "Owner app",
      screenshots: [
        {
          viewport: "desktop",
          data: "b3duZXItZGVza3RvcA==",
          mediaType: "image/jpeg",
        },
        {
          viewport: "mobile",
          data: "b3duZXItbW9iaWxl",
          mediaType: "image/jpeg",
        },
      ],
    } as any);
    const input = { project_path: "/home/user/app", port: 5173 };
    const options = { toolCallId: "shared-provider-call", messages: [] };
    const ownerResult = await (owner.tools.verify_app.execute as any)(
      input,
      options,
    );
    owner.getToolsForModel("model-gpt-5.6-sol");

    const other = harness();
    other.setCurrentModelName("claude-opus-5");
    const otherResult = await (other.tools.verify_app.execute as any)(
      input,
      options,
    );
    expect(
      await (other.tools.verify_app.toModelOutput as any)({
        output: otherResult,
        toolCallId: options.toolCallId,
      }),
    ).toEqual({ type: "text", value: JSON.stringify(otherResult) });

    const modelOutput = await (owner.tools.verify_app.toModelOutput as any)({
      output: ownerResult,
      toolCallId: options.toolCallId,
    });
    expect(modelOutput.type).toBe("content");
    expect(modelOutput.value.slice(1)).toEqual([
      {
        type: "image-data",
        data: "b3duZXItZGVza3RvcA==",
        mediaType: "image/jpeg",
      },
      { type: "image-data", data: "b3duZXItbW9iaWxl", mediaType: "image/jpeg" },
    ]);
    owner.getToolsForModel("claude-opus-5");
    expect(
      await (owner.tools.verify_app.toModelOutput as any)({
        output: ownerResult,
        toolCallId: options.toolCallId,
      }),
    ).toEqual({ type: "text", value: JSON.stringify(ownerResult) });
  });

  it("keeps tracking mutations after rebuilding the provider toolset", async () => {
    const h = harness();
    await verified(h);
    await execute(h.getToolsForModel("model-gpt-5.6-sol").run_terminal_cmd, {
      command: "pnpm update",
    });
    expect(h.isAppBuildComplete()).toBe(false);
  });

  it("does not certify a verification that overlaps an edit", async () => {
    const h = harness();
    let startBrowser!: () => void;
    let finishBrowser!: () => void;
    const browserStarted = new Promise<void>((resolve) => {
      startBrowser = resolve;
    });
    mockBrowserVerifier.mockImplementationOnce(async () => {
      startBrowser();
      await new Promise<void>((resolve) => {
        finishBrowser = resolve;
      });
      return { name: "browser-runtime", ok: true, detail: "Rendered test app" };
    });
    const pending = execute(h.tools.verify_app, {
      project_path: "/home/user/app",
      port: 5173,
    });
    await browserStarted;
    await execute(h.tools.file, { action: "edit" });
    finishBrowser();
    expect(await pending).toMatchObject({ ok: false });
    expect(await execute(h.tools.expose_preview, { port: 5173 })).toMatchObject(
      { ok: false },
    );
    expect(h.isAppBuildComplete()).toBe(false);
  });

  it("preserves proof when approval denies a write before it executes", async () => {
    const h = harness(async ({ toolName }) => {
      if (toolName === "file") throw new Error("Action denied");
    });
    await verified(h);
    await expect(execute(h.tools.file, { action: "edit" })).rejects.toThrow(
      "Action denied",
    );
    expect(mockFileExecute).not.toHaveBeenCalled();
    expect(h.isAppBuildComplete()).toBe(true);
  });

  it("refuses proof while a mutating operation is still running", async () => {
    const h = harness();
    let started!: () => void;
    let finish!: () => void;
    const editing = new Promise<void>((resolve) => {
      started = resolve;
    });
    mockFileExecute.mockImplementationOnce(async () => {
      started();
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return { success: true };
    });
    const edit = execute(h.tools.file, { action: "edit" });
    await editing;
    const verification = await execute(h.tools.verify_app, {
      project_path: "/home/user/app",
      port: 5173,
    });
    finish();
    await edit;
    expect(verification).toMatchObject({ ok: false });
    expect(h.isAppBuildComplete()).toBe(false);
    expect(await execute(h.tools.expose_preview, { port: 5173 })).toMatchObject(
      { ok: false },
    );
  });
});
