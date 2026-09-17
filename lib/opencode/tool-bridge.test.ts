import { createToolBridge } from "@/lib/opencode/tool-bridge";
import { reqPath, resPath, BRIDGE_DIR } from "@/lib/opencode/bridge-protocol";
import { sandboxToolFiles } from "@/lib/opencode/sandbox-tools";
import type { OpenCodeToolSnapshot } from "@/lib/opencode/tool-map";

function fakeFs(initial: Record<string, string> = {}) {
  const files = { ...initial };
  return {
    files,
    sandbox: {
      files: {
        read: async (p: string) => {
          if (!(p in files))
            throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return files[p];
        },
        write: async (p: string, d: string) => {
          files[p] = d;
        },
      },
    },
  };
}
const snap = (
  tool: string,
  status: OpenCodeToolSnapshot["state"]["status"],
  callID = "c1",
): OpenCodeToolSnapshot => ({
  tool,
  callID,
  state: { status, input: {} },
});
const flush = () => jest.advanceTimersByTimeAsync(20);

describe("createToolBridge", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  it("serves a bridged tool: reads the request, runs the executor, writes the response", async () => {
    const { sandbox, files } = fakeFs({
      [reqPath("c1")]: JSON.stringify({
        v: 1,
        tool: "verify_app",
        callID: "c1",
        sessionID: "s",
        args: { project_path: "/p", port: 5173 },
        requestedAt: 1,
      }),
    });
    const executor = jest
      .fn()
      .mockResolvedValue({ ok: true, url: "https://x" });
    const bridge = createToolBridge({
      sandbox,
      executors: { verify_app: executor },
      readRetryMs: 1,
    });
    expect(bridge.onToolSnapshot(snap("verify_app", "running"))).toBe(true);
    await flush();
    expect(executor).toHaveBeenCalledWith(
      { project_path: "/p", port: 5173 },
      expect.objectContaining({ toolCallId: "c1" }),
    );
    expect(JSON.parse(files[resPath("c1")])).toEqual({
      v: 1,
      ok: true,
      output: JSON.stringify({ ok: true, url: "https://x" }),
    });
    expect(bridge.inflight()).toEqual([]);
  });

  it("ignores tools it does not serve and non-running states", () => {
    const { sandbox } = fakeFs();
    const bridge = createToolBridge({
      sandbox,
      executors: { verify_app: jest.fn() },
    });
    expect(bridge.onToolSnapshot(snap("bash", "running"))).toBe(false);
    expect(bridge.onToolSnapshot(snap("verify_app", "pending"))).toBe(false);
    expect(bridge.inflight()).toEqual([]);
  });

  it("does not run the same call twice", async () => {
    const { sandbox } = fakeFs({
      [reqPath("c1")]: JSON.stringify({
        v: 1,
        tool: "expose_preview",
        callID: "c1",
        sessionID: "s",
        args: { port: 3000 },
        requestedAt: 1,
      }),
    });
    let resolve!: () => void;
    const executor = jest.fn(() => new Promise<void>((r) => (resolve = r)));
    const bridge = createToolBridge({
      sandbox,
      executors: { expose_preview: executor },
      readRetryMs: 1,
    });
    bridge.onToolSnapshot(snap("expose_preview", "running"));
    await flush();
    bridge.onToolSnapshot(snap("expose_preview", "running"));
    await flush();
    expect(executor).toHaveBeenCalledTimes(1);
    resolve();
    await flush();
  });

  it("writes an error response when the request never appears or the executor throws", async () => {
    const { sandbox, files } = fakeFs();
    const onError = jest.fn();
    const bridge = createToolBridge({
      sandbox,
      executors: { verify_app: jest.fn() },
      readRetries: 2,
      readRetryMs: 1,
      onError,
    });
    bridge.onToolSnapshot(snap("verify_app", "running", "missing"));
    await flush();
    expect(JSON.parse(files[resPath("missing")])).toMatchObject({
      ok: false,
      error: expect.stringMatching(/never appeared/),
    });
    expect(onError).toHaveBeenCalled();

    files[reqPath("boom")] = JSON.stringify({
      v: 1,
      tool: "verify_app",
      callID: "boom",
      sessionID: "s",
      args: {},
      requestedAt: 1,
    });
    const failing = createToolBridge({
      sandbox,
      executors: {
        verify_app: jest.fn().mockRejectedValue(new Error("build failed")),
      },
      readRetryMs: 1,
    });
    failing.onToolSnapshot(snap("verify_app", "running", "boom"));
    await flush();
    expect(JSON.parse(files[resPath("boom")])).toMatchObject({
      ok: false,
      error: "build failed",
    });
  });

  it("close() aborts in-flight executors", async () => {
    const { sandbox } = fakeFs({
      [reqPath("c1")]: JSON.stringify({
        v: 1,
        tool: "verify_app",
        callID: "c1",
        sessionID: "s",
        args: {},
        requestedAt: 1,
      }),
    });
    let seen: AbortSignal | undefined;
    const executor = jest.fn((_a: unknown, ctx: { signal: AbortSignal }) => {
      seen = ctx.signal;
      return new Promise((_res, rej) =>
        ctx.signal.addEventListener("abort", () => rej(new Error("aborted"))),
      );
    });
    const bridge = createToolBridge({
      sandbox,
      executors: { verify_app: executor },
      readRetryMs: 1,
    });
    bridge.onToolSnapshot(snap("verify_app", "running"));
    await flush();
    await bridge.close();
    expect(seen?.aborted).toBe(true);
  });
});

describe("sandboxToolFiles", () => {
  it("emits the bridge lib and one tool per bridged RIFT tool, under the config dir", () => {
    const files = sandboxToolFiles();
    expect(files.map((f) => f.path)).toEqual([
      "/home/user/.config/opencode/lib/rift-bridge.ts",
      "/home/user/.config/opencode/tools/verify_app.ts",
      "/home/user/.config/opencode/tools/expose_preview.ts",
    ]);
    const lib = files[0].content;
    expect(lib).toContain(`const DIR = "${BRIDGE_DIR}"`);
    for (const f of files.slice(1)) {
      expect(f.content).toContain('import { tool } from "@opencode-ai/plugin"');
      expect(f.content).toContain('from "../lib/rift-bridge"');
      expect(f.content).toMatch(/callRift\("(verify_app|expose_preview)"/);
    }
  });
});
