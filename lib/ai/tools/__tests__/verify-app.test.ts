import {
  createAppVerificationGate,
  createVerifyApp,
  verifyBrowserRuntime,
  type AppVerificationResult,
} from "../verify-app";

jest.mock("playwright", () => ({ chromium: { launch: jest.fn() } }));

describe("browser verifier availability", () => {
  it("does not authorize a preview when build and HTTP pass but Chromium cannot start", async () => {
    const { chromium } = await import("playwright");
    (chromium.launch as jest.Mock).mockRejectedValueOnce(
      new Error("browserType.launch: Executable doesn't exist"),
    );
    const harness = createHarness({
      "/home/user/app/package.json": JSON.stringify({
        scripts: { build: "vite build" },
      }),
    });
    const verifier = createVerifyApp(
      harness.context as any,
      harness.gate,
      verifyBrowserRuntime,
    );

    const result = await verify(verifier.execute as any, {
      project_path: "/home/user/app",
      port: 5173,
    });

    expect(
      result.checks.find((check) => check.name === "production-build")?.ok,
    ).toBe(true);
    expect(
      result.checks.find((check) => check.name === "live-server")?.ok,
    ).toBe(true);
    expect(result.ok).toBe(false);
    expect(harness.gate.peek(5173)).toBeNull();
  });

  it.each([
    "browserType.launch: Executable doesn't exist at /tmp/chromium",
    "browserType.launch: Target page, context or browser has been closed",
  ])("does not pass an unexecuted browser check: %s", async (message) => {
    const { chromium } = await import("playwright");
    (chromium.launch as jest.Mock).mockRejectedValueOnce(new Error(message));

    const result = await verifyBrowserRuntime("https://preview.example.test");

    expect(result.ok).toBe(false);
    expect(result.output).toContain(message);
    expect(result.screenshots).toBeUndefined();
  });
});

type FileMap = Record<string, string>;

const htmlProbe = (
  html = "<!doctype html><html><body><main>App</main></body></html>",
) =>
  `RIFT_HTTP:200\nRIFT_BYTES:${Buffer.byteLength(html)}\nRIFT_TYPE:text/html; charset=utf-8\nRIFT_BODY_B64:${Buffer.from(html).toString("base64")}`;

function createHarness(files: FileMap, runImpl?: jest.Mock) {
  const read = jest.fn(async (filePath: string) => {
    if (Object.prototype.hasOwnProperty.call(files, filePath)) {
      return files[filePath];
    }
    throw new Error(`ENOENT: ${filePath}`);
  });
  const run =
    runImpl ??
    jest.fn(async (command: string) => {
      if (command.includes("127.0.0.1")) {
        return {
          stdout: htmlProbe(
            "<!doctype html><html><body><main>Verified application surface with meaningful content</main></body></html>",
          ),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "build complete", stderr: "", exitCode: 0 };
    });
  const sandbox = {
    jupyterUrl: "https://example.invalid/jupyter",
    getHost: jest.fn((port: number) => `https://${port}-sandbox.example.test`),
    files: { read },
    commands: { run },
  };
  const context = {
    sandboxManager: {
      getSandbox: jest.fn(async () => ({ sandbox })),
    },
    // Vision-capable, so the verifier's frames are allowed to reach the model.
    modelName: "claude-opus-5",
  };
  const gate = createAppVerificationGate();
  const browserRuntimeVerifier = jest.fn(async (url: string) => ({
    name: "browser-runtime" as const,
    ok: true,
    command: `Chromium ${url}`,
    detail: "Browser runtime verified.",
  }));
  const verifyApp = createVerifyApp(
    context as any,
    gate,
    browserRuntimeVerifier,
  );
  const execute = verifyApp.execute as any;

  return {
    context,
    execute,
    gate,
    read,
    run,
    sandbox,
    browserRuntimeVerifier,
    verifyApp,
  };
}

async function verify(
  execute: (...args: any[]) => Promise<AppVerificationResult>,
  args: { project_path: string; port?: number },
) {
  return execute(
    { ...args, brief: "Verify the generated app" },
    { toolCallId: "verify-1", messages: [] },
  );
}

describe("verify_app screenshots", () => {
  // DOM metrics prove the page rendered; they cannot see clipping, contrast, or
  // crowding. The frames exist so the model can judge those — but base64 is
  // heavy, so they must reach the model WITHOUT being persisted with the
  // message. See docs/product-transformation/grok-agent-behaviour-2026-08-17.md.
  const withScreenshots = () => {
    const harness = createHarness({
      "/home/user/app/package.json": JSON.stringify({
        scripts: { build: "vite build" },
      }),
    });
    harness.browserRuntimeVerifier.mockResolvedValueOnce({
      name: "browser-runtime" as const,
      ok: true,
      command: "Chromium",
      detail: "Browser runtime verified.",
      screenshots: [
        { viewport: "desktop", data: "ZGVza3RvcA==", mediaType: "image/jpeg" },
        { viewport: "mobile", data: "bW9iaWxl", mediaType: "image/jpeg" },
      ],
    } as any);
    return harness;
  };

  it("keeps the frames out of the persisted tool result", async () => {
    const harness = withScreenshots();

    const result = await verify(harness.execute, {
      project_path: "/home/user/app",
      port: 5173,
    });

    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain("ZGVza3RvcA==");
    for (const check of result.checks) {
      expect(check).not.toHaveProperty("screenshots");
    }
  });

  it("shows both frames to a model that accepts image tool results", async () => {
    const harness = withScreenshots();
    const result = await verify(harness.execute, {
      project_path: "/home/user/app",
      port: 5173,
    });

    const modelOutput = await (harness.verifyApp as any).toModelOutput({
      output: result,
      toolCallId: "verify-1",
    });

    expect(modelOutput.type).toBe("content");
    const images = modelOutput.value.filter(
      (part: { type: string }) => part.type === "image-data",
    );
    expect(images).toHaveLength(2);
    expect(images[0].data).toBe("ZGVza3RvcA==");
    expect(images[0].mediaType).toBe("image/jpeg");
  });

  it.each(["failed", "empty"])(
    "does not hand another tool instance's frames to a %s verification with the same call ID",
    async (kind) => {
      const owner = withScreenshots();
      const ownerResult = await verify(owner.execute, {
        project_path: "/home/user/app",
        port: 5173,
      });
      const other = createHarness({
        "/home/user/app/package.json": JSON.stringify({
          scripts: { build: "vite build" },
        }),
      });
      other.browserRuntimeVerifier.mockResolvedValueOnce({
        name: "browser-runtime",
        ok: kind !== "failed",
        detail: kind === "failed" ? "Browser failed" : "No frames available",
      });
      const otherResult = await verify(other.execute, {
        project_path: "/home/user/app",
        port: 5173,
      });
      const foreignOutput = await (other.verifyApp as any).toModelOutput({
        output: otherResult,
        toolCallId: "verify-1",
      });
      expect(foreignOutput).toEqual({
        type: "text",
        value: JSON.stringify(otherResult),
      });
      const ownOutput = await (owner.verifyApp as any).toModelOutput({
        output: ownerResult,
        toolCallId: "verify-1",
      });
      expect(ownOutput.value.slice(1)).toEqual([
        { type: "image-data", data: "ZGVza3RvcA==", mediaType: "image/jpeg" },
        { type: "image-data", data: "bW9iaWxl", mediaType: "image/jpeg" },
      ]);
    },
  );

  it("bounds unconsumed frames per instance without evicting another run's frames", async () => {
    const owner = withScreenshots();
    const ownerResult = await verify(owner.execute, {
      project_path: "/home/user/app",
      port: 5173,
    });
    const other = withScreenshots();
    const results: AppVerificationResult[] = [];
    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        other.browserRuntimeVerifier.mockResolvedValueOnce({
          name: "browser-runtime",
          ok: true,
          detail: "Verified",
          screenshots: [
            {
              viewport: "desktop",
              data: `frame-${i}`,
              mediaType: "image/jpeg",
            },
          ],
        } as any);
      }
      results.push(
        await other.execute(
          { project_path: "/home/user/app", port: 5173 },
          { toolCallId: `other-${i}`, messages: [] },
        ),
      );
    }
    expect(
      (
        await (owner.verifyApp as any).toModelOutput({
          output: ownerResult,
          toolCallId: "verify-1",
        })
      ).type,
    ).toBe("content");
    for (let i = 0; i < results.length; i++) {
      const output = await (other.verifyApp as any).toModelOutput({
        output: results[i],
        toolCallId: `other-${i}`,
      });
      expect(output.type).toBe(i === 0 ? "text" : "content");
      if (i > 0) expect(output.value[1].data).toBe(`frame-${i}`);
    }
  });

  it("invalidates unconsumed frames when the same call ID is retried and fails early", async () => {
    const harness = withScreenshots();
    await verify(harness.execute, {
      project_path: "/home/user/app",
      port: 5173,
    });
    const result = await verify(harness.execute, { project_path: "/" });
    expect(result.ok).toBe(false);
    expect(
      await (harness.verifyApp as any).toModelOutput({
        output: result,
        toolCallId: "verify-1",
      }),
    ).toEqual({ type: "text", value: JSON.stringify(result) });
  });

  it("hands each frame set to exactly one turn", async () => {
    const harness = withScreenshots();
    const result = await verify(harness.execute, {
      project_path: "/home/user/app",
      port: 5173,
    });

    await (harness.verifyApp as any).toModelOutput({
      output: result,
      toolCallId: "verify-1",
    });
    // A replayed history entry must not resurrect the images: they are dropped
    // on read, so the second call degrades to text rather than re-sending them.
    const replayed = await (harness.verifyApp as any).toModelOutput({
      output: result,
      toolCallId: "verify-1",
    });

    expect(replayed.type).toBe("text");
  });
});

describe("verify_app cancellation", () => {
  it("does not start verification after the run was stopped", async () => {
    const h = createHarness({});
    const stop = new AbortController();
    stop.abort();
    await expect(
      h.execute(
        { project_path: "/home/user/app", port: 5173 },
        { toolCallId: "stopped", messages: [], abortSignal: stop.signal },
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(h.context.sandboxManager.getSandbox).not.toHaveBeenCalled();
  });

  it("kills its tracked E2B build and never proceeds to a browser check after Stop", async () => {
    let started!: () => void;
    let finish!: (result: {
      stdout: string;
      stderr: string;
      exitCode: number;
    }) => void;
    const buildStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const completion = new Promise<{
      stdout: string;
      stderr: string;
      exitCode: number;
    }>((resolve) => {
      finish = resolve;
    });
    const kill = jest.fn(async () => {
      finish({ stdout: "", stderr: "Stopped", exitCode: 137 });
      return true;
    });
    const run = jest.fn(
      async (command: string, options: { background?: boolean }) => {
        if (command === "pnpm run build") {
          started();
          return options.background
            ? { wait: () => completion, kill }
            : completion;
        }
        return { stdout: "RIFT_PATCHED:[]", stderr: "", exitCode: 0 };
      },
    );
    const h = createHarness(
      {
        "/home/user/app/package.json": JSON.stringify({
          scripts: { build: "vite build" },
          packageManager: "pnpm@10",
        }),
      },
      run,
    );
    const stop = new AbortController();
    const running = h.execute(
      { project_path: "/home/user/app", port: 5173 },
      { toolCallId: "build-stop", messages: [], abortSignal: stop.signal },
    );
    await buildStarted;
    stop.abort();
    finish({ stdout: "build finished", stderr: "", exitCode: 0 });
    await expect(running).rejects.toMatchObject({ name: "AbortError" });
    expect(kill).toHaveBeenCalledTimes(1);
    expect(h.browserRuntimeVerifier).not.toHaveBeenCalled();
    expect(h.gate.peek(5173)).toBeNull();
  });
});

describe("verify_app", () => {
  it("requires a successful production build and live HTTP response", async () => {
    const { execute, run, browserRuntimeVerifier } = createHarness({
      "/home/user/app/package.json": JSON.stringify({
        scripts: { build: "vite build" },
      }),
      "/home/user/app/pnpm-lock.yaml": "lockfileVersion: '9.0'",
    });

    const result = await verify(execute, {
      project_path: "/home/user/app",
      port: 5173,
    });

    expect(result).toMatchObject({
      ok: true,
      projectPath: "/home/user/app",
      packageManager: "pnpm",
    });
    expect(result.checks.map((check) => check.name)).toEqual([
      "project",
      "production-build",
      "live-server",
      "browser-runtime",
    ]);
    expect(run).toHaveBeenNthCalledWith(
      1,
      "pnpm run build",
      expect.objectContaining({
        cwd: "/home/user/app",
        timeoutMs: 300_000,
      }),
    );
    expect(run.mock.calls[1][0]).toContain("http://127.0.0.1:5173/");
    expect(browserRuntimeVerifier).toHaveBeenCalledWith(
      "https://5173-sandbox.example.test",
      undefined,
    );
  });

  it("returns build diagnostics and never probes a failed build", async () => {
    const run = jest.fn(async () => {
      throw Object.assign(new Error("command failed"), {
        stdout: "src/App.tsx(8,2): error TS1005",
        stderr: "Build failed",
        exitCode: 2,
      });
    });
    const harness = createHarness(
      {
        "/workspace/app/package.json": JSON.stringify({
          packageManager: "npm@11.0.0",
          scripts: { build: "tsc && vite build" },
        }),
        "/workspace/app/package-lock.json": "{}",
      },
      run,
    );

    const result = await verify(harness.execute, {
      project_path: "/workspace/app",
      port: 4173,
    });

    expect(result.ok).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks[1]).toMatchObject({
      name: "production-build",
      ok: false,
      command: "npm run build",
    });
    expect(result.checks[1].output).toContain("error TS1005");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("accepts a standalone static app with a meaningful HTML entry", async () => {
    const { execute, run } = createHarness({
      "/app/index.html":
        "<!doctype html><html><head><title>Demo</title></head><body><main>Real static app</main></body></html>",
    });

    const result = await verify(execute, { project_path: "/app" });

    expect(result.ok).toBe(true);
    expect(result.checks.map((check) => check.name)).toEqual([
      "project",
      "static-entry",
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it("rejects a live server that only returns an HTTP error page", async () => {
    const run = jest.fn(async (command: string) => {
      if (command.includes("127.0.0.1")) {
        return {
          stdout:
            "RIFT_HTTP:500\nRIFT_BYTES:1024\nRIFT_TYPE:text/html\nRIFT_BODY_B64:PGh0bWw+PGJvZHk+RXJyb3I8L2JvZHk+PC9odG1sPg==",
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "built", stderr: "", exitCode: 0 };
    });
    const harness = createHarness(
      {
        "/code/app/package.json": JSON.stringify({
          scripts: { build: "vite build" },
        }),
      },
      run,
    );

    const result = await verify(harness.execute, {
      project_path: "/code/app",
      port: 5173,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({
      name: "live-server",
      ok: false,
      detail:
        "The server responded with HTTP 500; expected a successful app response.",
    });
  });

  it("invalidates an earlier proof when re-verification on that port fails", async () => {
    const harness = createHarness({
      "/code/app/package.json": JSON.stringify({
        scripts: { build: "vite build" },
      }),
    });

    await expect(
      verify(harness.execute, { project_path: "/code/app", port: 5173 }),
    ).resolves.toMatchObject({ ok: true });
    expect(harness.gate.peek(5173)).not.toBeNull();

    harness.run.mockImplementation(async () => ({
      stdout: "",
      stderr: "Build failed",
      exitCode: 1,
    }));
    await expect(
      verify(harness.execute, { project_path: "/code/app", port: 5173 }),
    ).resolves.toMatchObject({ ok: false });
    expect(harness.gate.peek(5173)).toBeNull();
  });

  it("does not mint preview proof when the real browser runtime fails", async () => {
    const harness = createHarness({
      "/code/app/package.json": JSON.stringify({
        scripts: { build: "vite build" },
      }),
    });
    harness.browserRuntimeVerifier.mockResolvedValueOnce({
      name: "browser-runtime",
      ok: false,
      detail: "mobile: page error — App crashed",
    });

    const result = await verify(harness.execute, {
      project_path: "/code/app",
      port: 5173,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({
      name: "browser-runtime",
      ok: false,
    });
    expect(harness.gate.peek(5173)).toBeNull();
  });

  it("rejects a healthy API port that is not the rendered frontend", async () => {
    const run = jest.fn(async (command: string) => {
      if (command.includes("127.0.0.1")) {
        const body = JSON.stringify({
          status: "ok",
          service: "api",
          message: "This is a healthy API response, not the rendered frontend.",
        });
        return {
          stdout: `RIFT_HTTP:200\nRIFT_BYTES:${Buffer.byteLength(body)}\nRIFT_TYPE:application/json\nRIFT_BODY_B64:${Buffer.from(body).toString("base64")}`,
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "built", stderr: "", exitCode: 0 };
    });
    const harness = createHarness(
      {
        "/code/app/package.json": JSON.stringify({
          scripts: { build: "vite build" },
        }),
      },
      run,
    );

    const result = await verify(harness.execute, {
      project_path: "/code/app",
      port: 8787,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)).toMatchObject({
      name: "live-server",
      ok: false,
      detail: expect.stringContaining("not a rendered HTML app"),
    });
  });

  it("rejects a proxy failure page even when it returns HTTP 200", async () => {
    const failureHtml =
      "<!doctype html><html><body>Blocked request. This host is not allowed.</body></html>";
    const run = jest.fn(async (command: string) => {
      if (command.includes("127.0.0.1")) {
        return {
          stdout: htmlProbe(failureHtml),
          stderr: "",
          exitCode: 0,
        };
      }
      return { stdout: "built", stderr: "", exitCode: 0 };
    });
    const harness = createHarness(
      {
        "/code/app/package.json": JSON.stringify({
          scripts: { build: "vite build" },
        }),
      },
      run,
    );

    const result = await verify(harness.execute, {
      project_path: "/code/app",
      port: 5173,
    });

    expect(result.ok).toBe(false);
    expect(result.checks.at(-1)?.detail).toContain("failure page");
  });

  it("rejects unsafe root-level project paths before starting a sandbox", async () => {
    const { context, execute } = createHarness({});

    const result = await verify(execute, { project_path: "/" });

    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: "project", ok: false });
    expect(context.sandboxManager.getSandbox).not.toHaveBeenCalled();
  });
});
