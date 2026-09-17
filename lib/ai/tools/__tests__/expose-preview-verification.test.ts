import { createExposePreview } from "../expose-preview";
import { createAppVerificationGate } from "../verify-app";

function createHarness(withGate = true) {
  const run = jest.fn(async (command: string) => {
    if (command.includes("rift_vite_harden")) {
      return { stdout: "RIFT_PATCHED:[]", stderr: "", exitCode: 0 };
    }
    return { stdout: "RIFT_UP\n", stderr: "", exitCode: 0 };
  });
  const sandbox = {
    jupyterUrl: "https://example.invalid/jupyter",
    files: { write: jest.fn(async () => undefined) },
    commands: { run },
    getHost: jest.fn((port: number) => `${port}-demo.e2b.app`),
  };
  const sandboxManager = {
    getSandbox: jest.fn(async () => ({ sandbox })),
  };
  const gate = createAppVerificationGate();
  const tool = createExposePreview(
    { sandboxManager } as any,
    withGate ? gate : undefined,
  );
  const execute = tool.execute as any;

  return { execute, gate, run, sandboxManager };
}

async function expose(execute: (...args: any[]) => Promise<unknown>) {
  return execute(
    { port: 5173, brief: "Expose the verified app" },
    { toolCallId: "preview-1", messages: [] },
  );
}

async function exposePort(
  execute: (...args: any[]) => Promise<unknown>,
  port: number,
) {
  return execute(
    { port, brief: "Expose the verified app" },
    { toolCallId: "preview-invalid", messages: [] },
  );
}

describe("expose_preview verification gate", () => {
  it("preserves legacy preview behavior outside Build mode", async () => {
    const { execute, sandboxManager } = createHarness(false);

    await expect(expose(execute)).resolves.toMatchObject({
      ok: true,
      port: 5173,
      url: "https://5173-demo.e2b.app",
    });
    expect(sandboxManager.getSandbox).toHaveBeenCalledTimes(1);
  });

  it("refuses to expose an app that has not passed verify_app", async () => {
    const { execute, sandboxManager } = createHarness();

    await expect(expose(execute)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("has not passed verify_app"),
    });
    expect(sandboxManager.getSandbox).not.toHaveBeenCalled();
  });

  it.each([0, -1, 65_536, 5173.5])(
    "rejects invalid preview port %s before touching the sandbox",
    async (port) => {
      const { execute, sandboxManager } = createHarness(false);

      await expect(exposePort(execute, port)).resolves.toMatchObject({
        ok: false,
        error: expect.stringContaining("between 1 and 65535"),
      });
      expect(sandboxManager.getSandbox).not.toHaveBeenCalled();
    },
  );

  it("exposes a verified live app and consumes the one-time proof", async () => {
    const { execute, gate } = createHarness();
    gate.mark({
      projectPath: "/home/user/app",
      port: 5173,
      verifiedAt: Date.now(),
    });

    await expect(expose(execute)).resolves.toMatchObject({
      ok: true,
      port: 5173,
      url: "https://5173-demo.e2b.app",
    });
    expect(gate.peek(5173)).toBeNull();
    expect(gate.isComplete()).toBe(true);
    await expect(expose(execute)).resolves.toMatchObject({ ok: false });
  });

  it("keeps proof available when the dev server has not started yet", async () => {
    const { execute, gate, run } = createHarness();
    run.mockImplementation(async (command: string) => {
      if (command.includes("rift_vite_harden")) {
        return { stdout: "RIFT_PATCHED:[]", stderr: "", exitCode: 0 };
      }
      return { stdout: "RIFT_DOWN\n", stderr: "", exitCode: 0 };
    });
    gate.mark({
      projectPath: "/home/user/app",
      port: 5173,
      verifiedAt: Date.now(),
    });

    await expect(expose(execute)).resolves.toMatchObject({
      ok: false,
      error: expect.stringContaining("Nothing is listening"),
    });
    expect(gate.peek(5173)).not.toBeNull();
    expect(gate.isComplete()).toBe(false);
  });
});
