import { posix as path } from "node:path";
import { tool } from "ai";
import { z } from "zod";
import type { AnySandbox, ToolContext } from "@/types";
import { supportsMultimodalToolResults } from "@/lib/ai/providers";
import { buildSandboxCommandOptions } from "./utils/sandbox-command-options";
import { ensureVitePreviewable } from "./utils/vite-preview-hardening";
import { isE2BSandbox } from "./utils/sandbox-types";

const BUILD_TIMEOUT_MS = 5 * 60_000;
const LIVE_PROBE_TIMEOUT_MS = 15_000;
const BROWSER_NAVIGATION_TIMEOUT_MS = 20_000;
const MAX_DIAGNOSTIC_CHARS = 8_000;
const VERIFICATION_TTL_MS = 10 * 60_000;

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

type CommandResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type AppVerificationCheck = {
  name:
    | "project"
    | "production-build"
    | "static-entry"
    | "live-server"
    | "browser-runtime";
  ok: boolean;
  detail: string;
  command?: string;
  output?: string;
  /**
   * What the app actually looked like. Never persisted with the tool result —
   * `execute` moves these into `screenshotCache` and hands them to the model
   * through `toModelOutput`, the same way `file`'s view action does.
   */
  screenshots?: readonly AppScreenshot[];
};

export type AppScreenshot = {
  viewport: string;
  /** Base64 JPEG. */
  data: string;
  mediaType: string;
};

/**
 * DOM metrics answer "did it render". They cannot answer "does it look right" —
 * a globe clipped by the right edge, a scene too dark to read, a control panel
 * overlapping its own heading all pass every structural check. So the verifier
 * takes a picture and the model looks at it.
 *
 * Base64 frames are heavy, so they never enter the persisted tool result. They
 * live in the tool instance between `execute` and `toModelOutput`, keyed by
 * tool call, and are dropped on read. The cap is a backstop for the case where
 * `toModelOutput` never runs.
 */
const MAX_CACHED_SCREENSHOT_SETS = 4;

type BrowserRuntimeVerifier = (
  url: string,
  signal?: AbortSignal,
) => Promise<AppVerificationCheck>;

const isBenignBrowserConsoleError = (message: string): boolean =>
  /favicon\.ico|download the react devtools|websocket connection.*(?:failed|closed)/i.test(
    message,
  );

/**
 * Execute the generated app at desktop and mobile widths. This catches the
 * class of failures an HTTP probe cannot see: startup exceptions, empty React
 * roots, missing critical assets, framework error pages, and document-level
 * mobile overflow.
 *
 * Trigger production images include Chromium via trigger.config.ts. Local
 * development may omit the browser binary; an unavailable verifier cannot
 * establish that the application passed its browser checks.
 */
export const verifyBrowserRuntime: BrowserRuntimeVerifier = async (
  url,
  signal,
) => {
  let browser: Awaited<
    ReturnType<(typeof import("playwright"))["chromium"]["launch"]>
  > | null = null;
  const onAbort = () => {
    void browser?.close().catch(() => {});
  };

  try {
    signal?.throwIfAborted();
    const { chromium } = await import("playwright");
    signal?.throwIfAborted();
    browser = await chromium.launch({ headless: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    signal?.throwIfAborted();
    const viewportResults: Array<{
      viewport: string;
      textLength: number;
      visibleElements: number;
      overflowPx: number;
    }> = [];
    const failures: string[] = [];
    const screenshots: AppScreenshot[] = [];

    for (const viewport of [
      { name: "desktop", width: 1440, height: 900 },
      { name: "mobile", width: 390, height: 844 },
    ] as const) {
      signal?.throwIfAborted();
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        serviceWorkers: "block",
      });
      const page = await context.newPage();
      const consoleErrors: string[] = [];
      const pageErrors: string[] = [];
      const networkErrors: string[] = [];

      page.on("console", (message) => {
        if (message.type() !== "error") return;
        const text = message.text();
        if (!isBenignBrowserConsoleError(text)) consoleErrors.push(text);
      });
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("requestfailed", (request) => {
        if (
          !["document", "script", "stylesheet", "fetch", "xhr"].includes(
            request.resourceType(),
          )
        ) {
          return;
        }
        try {
          if (new URL(request.url()).origin !== new URL(url).origin) return;
        } catch {
          return;
        }
        networkErrors.push(
          `${request.resourceType()} ${request.url()} — ${request.failure()?.errorText ?? "request failed"}`,
        );
      });
      page.on("response", (response) => {
        if (response.status() < 400) return;
        const request = response.request();
        if (
          !["document", "script", "stylesheet", "fetch", "xhr"].includes(
            request.resourceType(),
          )
        ) {
          return;
        }
        try {
          if (new URL(response.url()).origin !== new URL(url).origin) return;
        } catch {
          return;
        }
        networkErrors.push(
          `${response.status()} ${request.resourceType()} ${response.url()}`,
        );
      });

      try {
        const navigation = await page.goto(url, {
          waitUntil: "domcontentloaded",
          timeout: BROWSER_NAVIGATION_TIMEOUT_MS,
        });
        await page.waitForTimeout(800);

        if (!navigation || navigation.status() >= 400) {
          failures.push(
            `${viewport.name}: navigation returned ${navigation?.status() ?? "no response"}`,
          );
        }

        const rendered = await page.evaluate(() => {
          const body = document.body;
          const root = document.querySelector(
            "#root, #app, [data-reactroot], main",
          );
          const visibleElements = Array.from(
            document.querySelectorAll<HTMLElement>("body *"),
          ).filter((element) => {
            const style = getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity || "1") > 0 &&
              rect.width > 0 &&
              rect.height > 0
            );
          }).length;
          const text = body?.innerText?.replace(/\s+/g, " ").trim() ?? "";
          const richElements = document.querySelectorAll(
            "img, svg, canvas, video, button, input, select, textarea, a",
          ).length;
          const rootRect = root?.getBoundingClientRect();
          const documentWidth = Math.max(
            document.documentElement.scrollWidth,
            body?.scrollWidth ?? 0,
          );
          const viewportWidth = document.documentElement.clientWidth;
          const errorSurface = text.match(
            /(?:internal server error|application error|failed to load module script|uncaught runtime error|vite client error)/i,
          )?.[0];

          return {
            textLength: text.length,
            visibleElements,
            richElements,
            rootExists: Boolean(root),
            rootChildren: root?.childElementCount ?? 0,
            rootArea: rootRect ? rootRect.width * rootRect.height : 0,
            overflowPx: Math.max(0, documentWidth - viewportWidth),
            errorSurface: errorSurface ?? null,
          };
        });

        const visuallyEmpty =
          rendered.visibleElements === 0 ||
          (rendered.textLength < 4 && rendered.richElements === 0) ||
          (rendered.rootExists &&
            rendered.rootChildren === 0 &&
            rendered.rootArea === 0);
        if (visuallyEmpty) {
          failures.push(`${viewport.name}: rendered page is visually empty`);
        }
        if (rendered.errorSurface) {
          failures.push(
            `${viewport.name}: framework error surface (${rendered.errorSurface})`,
          );
        }
        if (viewport.name === "mobile" && rendered.overflowPx > 8) {
          failures.push(
            `${viewport.name}: document overflows horizontally by ${rendered.overflowPx}px`,
          );
        }
        if (pageErrors.length > 0) {
          failures.push(
            `${viewport.name}: page error — ${pageErrors.slice(0, 3).join(" | ")}`,
          );
        }
        if (consoleErrors.length > 0) {
          failures.push(
            `${viewport.name}: console error — ${consoleErrors.slice(0, 3).join(" | ")}`,
          );
        }
        if (networkErrors.length > 0) {
          failures.push(
            `${viewport.name}: critical request failure — ${networkErrors.slice(0, 3).join(" | ")}`,
          );
        }
        viewportResults.push({
          viewport: viewport.name,
          textLength: rendered.textLength,
          visibleElements: rendered.visibleElements,
          overflowPx: rendered.overflowPx,
        });

        // What the viewport shows, not the whole scrollable page: the reader's
        // first impression is the thing worth judging. A failed capture must
        // not fail the verification — the structural checks stand on their own.
        try {
          const frame = await page.screenshot({ type: "jpeg", quality: 60 });
          screenshots.push({
            viewport: viewport.name,
            data: frame.toString("base64"),
            mediaType: "image/jpeg",
          });
        } catch {
          // No picture this round; the metrics above still decided `ok`.
        }
      } catch (error) {
        signal?.throwIfAborted();
        failures.push(
          `${viewport.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await context.close();
      }
    }

    signal?.throwIfAborted();
    const ok = failures.length === 0;
    return {
      name: "browser-runtime",
      ok,
      command: `Chromium desktop + mobile ${url}`,
      detail: ok
        ? "Chromium rendered the app at desktop and mobile widths without runtime, critical network, empty-root, or overflow failures."
        : `Browser runtime verification failed: ${failures[0]}`,
      output: diagnosticTail(
        JSON.stringify({ viewports: viewportResults, failures }, null, 2),
      ),
      ...(screenshots.length > 0 && { screenshots }),
    };
  } catch (error) {
    signal?.throwIfAborted();
    const message = error instanceof Error ? error.message : String(error);
    return {
      name: "browser-runtime",
      ok: false,
      command: `Chromium desktop + mobile ${url}`,
      detail: `Browser runtime verification could not complete: ${message}`,
      output: diagnosticTail(message),
    };
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await browser?.close().catch(() => {});
  }
};

export type AppVerificationResult = {
  ok: boolean;
  projectPath: string;
  packageManager?: PackageManager;
  checks: AppVerificationCheck[];
  summary: string;
};

export type VerifiedApp = {
  projectPath: string;
  port: number;
  verifiedAt: number;
};

export type AppVerificationGate = {
  mark: (verification: VerifiedApp, expectedRevision?: number) => boolean;
  revision: () => number;
  beginMutation: () => () => void;
  peek: (port: number) => VerifiedApp | null;
  consume: (port: number) => VerifiedApp | null;
  invalidate: (port: number) => void;
  complete: (port: number) => VerifiedApp | null;
  isComplete: () => boolean;
};

/**
 * Request-local proof that a port passed verify_app. The proof is consumed by
 * expose_preview, so a later preview exposure must pass the gate again.
 */
export function createAppVerificationGate(): AppVerificationGate {
  const verifiedPorts = new Map<number, VerifiedApp>();
  let completedPreview: VerifiedApp | null = null;
  let workspaceRevision = 0;
  let activeMutations = 0;
  const invalidateWorkspace = () => {
    workspaceRevision += 1;
    verifiedPorts.clear();
    completedPreview = null;
  };

  const peek = (port: number) => {
    const verification = verifiedPorts.get(port);
    if (!verification) return null;
    if (Date.now() - verification.verifiedAt > VERIFICATION_TTL_MS) {
      verifiedPorts.delete(port);
      return null;
    }
    return verification;
  };

  const consume = (port: number) => {
    const verification = peek(port);
    if (verification) verifiedPorts.delete(port);
    return verification;
  };

  return {
    revision: () => workspaceRevision,
    beginMutation() {
      activeMutations += 1;
      invalidateWorkspace();
      let finished = false;
      return () => {
        if (finished) return;
        finished = true;
        activeMutations -= 1;
        invalidateWorkspace();
      };
    },
    mark(verification, expectedRevision = workspaceRevision) {
      if (activeMutations > 0 || expectedRevision !== workspaceRevision)
        return false;
      completedPreview = null;
      verifiedPorts.set(verification.port, verification);
      return true;
    },
    peek,
    consume,
    invalidate(port) {
      verifiedPorts.delete(port);
      completedPreview = null;
    },
    complete(port) {
      const verification = consume(port);
      if (verification) completedPreview = verification;
      return verification;
    },
    isComplete() {
      return completedPreview !== null;
    },
  };
}

function normalizeProjectPath(projectPath: string): string | null {
  if (!projectPath.startsWith("/") || projectPath.includes("\0")) return null;
  const normalized = path.normalize(projectPath);
  if (normalized === "/" || normalized === "/tmp") return null;
  return normalized;
}

function diagnosticTail(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= MAX_DIAGNOSTIC_CHARS) return trimmed;
  return `[earlier output omitted]\n${trimmed.slice(-MAX_DIAGNOSTIC_CHARS)}`;
}

function commandErrorResult(error: unknown): CommandResult {
  if (typeof error !== "object" || error === null) {
    return { stdout: "", stderr: String(error), exitCode: 1 };
  }

  const value = error as Record<string, unknown>;
  return {
    stdout: typeof value.stdout === "string" ? value.stdout : "",
    stderr:
      typeof value.stderr === "string"
        ? value.stderr
        : error instanceof Error
          ? error.message
          : String(error),
    exitCode: typeof value.exitCode === "number" ? value.exitCode : 1,
  };
}

async function runSandboxCommand(
  sandbox: AnySandbox,
  command: string,
  cwd: string,
  timeoutMs: number,
  handlers?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  },
  signal?: AbortSignal,
): Promise<CommandResult> {
  try {
    signal?.throwIfAborted();
    const options = {
      ...buildSandboxCommandOptions(sandbox, handlers),
      cwd,
      timeoutMs,
    };
    let result;
    if (signal && isE2BSandbox(sandbox)) {
      // Aborting an HTTP stream alone does not kill its process. Keep an E2B
      // handle, then explicitly kill the build when the user stops the run.
      const handle = await sandbox.commands.run(command, {
        ...options,
        background: true,
        requestTimeoutMs: 10_000,
      });
      let cancellation: Promise<unknown> | undefined;
      const onAbort = () => {
        cancellation ??= handle.kill().catch(() => undefined);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();
      try {
        signal.throwIfAborted();
        result = await handle.wait();
        signal.throwIfAborted();
      } finally {
        signal.removeEventListener("abort", onAbort);
        await cancellation;
      }
    } else {
      // The desktop relay owns process cancellation for its signal-aware call.
      result = await sandbox.commands.run(command, {
        ...options,
        ...(signal && { signal }),
      });
      signal?.throwIfAborted();
    }
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.exitCode ?? 0,
    };
  } catch (error) {
    signal?.throwIfAborted();
    return commandErrorResult(error);
  }
}

async function readOptionalFile(
  sandbox: AnySandbox,
  filePath: string,
): Promise<string | null> {
  try {
    return await sandbox.files.read(filePath, { user: "user" as const });
  } catch {
    return null;
  }
}

async function detectPackageManager(
  sandbox: AnySandbox,
  projectPath: string,
  packageManagerField: unknown,
): Promise<PackageManager> {
  if (typeof packageManagerField === "string") {
    const declared = packageManagerField.split("@")[0];
    if (
      declared === "npm" ||
      declared === "pnpm" ||
      declared === "yarn" ||
      declared === "bun"
    ) {
      return declared;
    }
  }

  const lockfiles: Array<[string, PackageManager]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ];

  for (const [lockfile, packageManager] of lockfiles) {
    if (
      (await readOptionalFile(sandbox, path.join(projectPath, lockfile))) !==
      null
    ) {
      return packageManager;
    }
  }

  return "npm";
}

function buildCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "pnpm":
      return "pnpm run build";
    case "yarn":
      return "yarn build";
    case "bun":
      return "bun run build";
    default:
      return "npm run build";
  }
}

function combinedOutput(result: CommandResult): string {
  return diagnosticTail(
    [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join("\n"),
  );
}

async function verifyProductionBuild(
  sandbox: AnySandbox,
  projectPath: string,
  packageJsonText: string,
  handlers?: {
    onCommand?: (command: string) => void;
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
  },
  signal?: AbortSignal,
): Promise<{
  packageManager?: PackageManager;
  check: AppVerificationCheck;
}> {
  let manifest: {
    scripts?: Record<string, unknown>;
    packageManager?: unknown;
  };

  try {
    manifest = JSON.parse(packageJsonText) as typeof manifest;
  } catch {
    return {
      check: {
        name: "production-build",
        ok: false,
        detail: "package.json is not valid JSON.",
      },
    };
  }

  if (typeof manifest.scripts?.build !== "string") {
    return {
      check: {
        name: "production-build",
        ok: false,
        detail:
          "package.json has no build script. Add a deterministic production build before presenting the app as complete.",
      },
    };
  }

  const packageManager = await detectPackageManager(
    sandbox,
    projectPath,
    manifest.packageManager,
  );
  const command = buildCommand(packageManager);
  handlers?.onCommand?.(command);
  const result = await runSandboxCommand(
    sandbox,
    command,
    projectPath,
    BUILD_TIMEOUT_MS,
    handlers,
    signal,
  );

  return {
    packageManager,
    check: {
      name: "production-build",
      ok: result.exitCode === 0,
      command,
      detail:
        result.exitCode === 0
          ? "Production build completed successfully."
          : `Production build failed with exit code ${result.exitCode}.`,
      output: combinedOutput(result),
    },
  };
}

async function verifyStaticEntry(
  sandbox: AnySandbox,
  projectPath: string,
): Promise<AppVerificationCheck> {
  const html = await readOptionalFile(
    sandbox,
    path.join(projectPath, "index.html"),
  );
  const looksLikeHtml =
    html !== null &&
    html.trim().length >= 64 &&
    /<(?:!doctype\s+html|html|body)\b/i.test(html);

  return {
    name: "static-entry",
    ok: looksLikeHtml,
    detail: looksLikeHtml
      ? "Static HTML entry point is present and non-empty."
      : "No package.json or usable index.html was found. Create a runnable app entry point.",
  };
}

function parseProbeOutput(output: string): {
  status: number;
  bytes: number;
  contentType: string;
  body: string;
} | null {
  const status = output.match(/RIFT_HTTP:(\d{3})/);
  const bytes = output.match(/RIFT_BYTES:(\d+)/);
  const contentType = output.match(/RIFT_TYPE:([^\n]*)/);
  const bodyBase64 = output.match(/RIFT_BODY_B64:([A-Za-z0-9+/=]*)/);
  if (!status || !bytes || !contentType) return null;
  return {
    status: Number(status[1]),
    bytes: Number(bytes[1]),
    contentType: contentType[1].trim(),
    body: bodyBase64?.[1]
      ? Buffer.from(bodyBase64[1], "base64").toString("utf8")
      : "",
  };
}

async function verifyLiveServer(
  sandbox: AnySandbox,
  projectPath: string,
  port: number,
  signal?: AbortSignal,
): Promise<AppVerificationCheck> {
  const command =
    `body="$(mktemp /tmp/rift-live-probe.XXXXXX)"; ` +
    `curl -sS -L --max-time 10 -o "$body" ` +
    `-w 'RIFT_HTTP:%{http_code}\\nRIFT_BYTES:%{size_download}\\nRIFT_TYPE:%{content_type}\\n' ` +
    `http://127.0.0.1:${port}/; ` +
    `code=$?; printf 'RIFT_BODY_B64:'; head -c 32768 "$body" | base64 | tr -d '\\n'; ` +
    `rm -f "$body"; exit $code`;
  const result = await runSandboxCommand(
    sandbox,
    command,
    projectPath,
    LIVE_PROBE_TIMEOUT_MS,
    undefined,
    signal,
  );
  const probe = parseProbeOutput(result.stdout);
  const validStatus = !!probe && probe.status >= 200 && probe.status < 400;
  const validBody = !!probe && probe.bytes >= 64;
  const validContentType =
    !!probe &&
    /(?:text\/html|application\/xhtml\+xml)/i.test(probe.contentType);
  const looksLikeHtml =
    !!probe && /<(?:!doctype\s+html|html|body)\b/i.test(probe.body);
  const knownFailureSurface =
    !!probe &&
    /blocked request[^<]{0,120}(?:host|allowed)|<title>\s*(?:500|internal server error)\b/i.test(
      probe.body,
    );
  const ok =
    result.exitCode === 0 &&
    validStatus &&
    validBody &&
    validContentType &&
    looksLikeHtml &&
    !knownFailureSurface;

  let detail: string;
  if (!probe) {
    detail = `The server on port ${port} did not return a readable HTTP response.`;
  } else if (!validStatus) {
    detail = `The server responded with HTTP ${probe.status}; expected a successful app response.`;
  } else if (!validBody) {
    detail = `The server returned only ${probe.bytes} bytes; the app response appears empty.`;
  } else if (!validContentType || !looksLikeHtml) {
    detail = `Port ${port} returned ${probe.contentType || "an unknown content type"}, not a rendered HTML app. Check that this is the frontend port rather than an API or health endpoint.`;
  } else if (knownFailureSurface) {
    detail =
      "The live server returned a framework/proxy failure page instead of the app. Fix the reported host or runtime error and verify again.";
  } else {
    detail = `Live server returned HTTP ${probe.status} (${probe.bytes} bytes${
      probe.contentType ? `, ${probe.contentType}` : ""
    }).`;
  }

  return {
    name: "live-server",
    ok,
    command: `GET http://127.0.0.1:${port}/`,
    detail,
    ...(!ok && { output: combinedOutput(result) }),
  };
}

export const createVerifyApp = (
  context: ToolContext,
  verificationGate: AppVerificationGate = createAppVerificationGate(),
  browserRuntimeVerifier: BrowserRuntimeVerifier = verifyBrowserRuntime,
) => {
  const { sandboxManager, writer, modelName, getCurrentModelName } = context;
  // Each factory instance belongs to its own tool context/run. Provider call
  // IDs are not globally unique and must never authorize cross-run frames.
  const screenshotCache = new Map<string, readonly AppScreenshot[]>();

  const cacheScreenshots = (
    toolCallId: string,
    screenshots: readonly AppScreenshot[],
  ): void => {
    if (screenshots.length === 0) return;
    screenshotCache.set(toolCallId, screenshots);
    while (screenshotCache.size > MAX_CACHED_SCREENSHOT_SETS) {
      const oldest = screenshotCache.keys().next().value;
      if (oldest === undefined) break;
      screenshotCache.delete(oldest);
    }
  };

  const takeScreenshots = (toolCallId: string): readonly AppScreenshot[] => {
    const screenshots = screenshotCache.get(toolCallId) ?? [];
    screenshotCache.delete(toolCallId);
    return screenshots;
  };

  return tool({
    description: `Verify that a generated web app is genuinely runnable before presenting it as complete, and SEE what it looks like.

Run this after meaningful code changes and before expose_preview. It performs a production build (or validates a standalone static entry point) and, when a port is supplied, probes the live server and renders it in Chromium at desktop and mobile widths.

It returns screenshots of both widths. Look at them. Structural checks only prove the page rendered — they cannot see a component clipped by the viewport edge, a scene too dark to read, text colliding with a control, or a layout that is technically fine and visually wrong. Judge the frames as a designer would and fix what you see, then run verify_app again to confirm the fix landed.

If any check fails, fix the reported issue and call verify_app again. Never call expose_preview after a failed verification.`,
    inputSchema: z.object({
      project_path: z
        .string()
        .describe(
          "Absolute path to the generated app directory containing package.json or index.html.",
        ),
      port: z
        .number()
        .int()
        .min(1)
        .max(65_535)
        .optional()
        .describe(
          "Port of the already-running dev server. Include it to verify the live app response as well as the production build.",
        ),
      brief: z
        .string()
        .describe("A one-sentence preamble describing the verification."),
    }),
    execute: async (
      { project_path: rawProjectPath, port },
      { toolCallId, abortSignal },
    ): Promise<AppVerificationResult> => {
      // A reused call ID must not retain frames after an early failure/abort.
      screenshotCache.delete(toolCallId);
      // A new verification attempt supersedes any earlier proof for the same
      // port. In particular, a failed re-check must not leave a stale success
      // available for expose_preview to consume.
      if (port !== undefined) verificationGate.invalidate(port);
      const verificationRevision = verificationGate.revision();
      abortSignal?.throwIfAborted();

      const projectPath = normalizeProjectPath(rawProjectPath);
      if (!projectPath) {
        return {
          ok: false,
          projectPath: rawProjectPath,
          checks: [
            {
              name: "project",
              ok: false,
              detail:
                "project_path must be a specific absolute sandbox directory, not the filesystem root or /tmp.",
            },
          ],
          summary: "App verification failed before execution.",
        };
      }

      const { sandbox } = await sandboxManager.getSandbox();
      abortSignal?.throwIfAborted();
      let terminalEvent = 0;
      const emitTerminal = (terminal: string) => {
        writer?.write({
          type: "data-terminal",
          id: `verify-app-${toolCallId}-${++terminalEvent}`,
          data: {
            terminal,
            toolCallId,
            action: "exec",
          } as unknown as { terminal: string; toolCallId: string },
        });
      };
      const packageJsonText = await readOptionalFile(
        sandbox,
        path.join(projectPath, "package.json"),
      );
      abortSignal?.throwIfAborted();
      const checks: AppVerificationCheck[] = [
        {
          name: "project",
          ok: true,
          detail: `Validating ${projectPath}.`,
        },
      ];
      let packageManager: PackageManager | undefined;

      // The public E2B host used by the browser has stricter Host/HMR rules
      // than the sandbox-local curl probe. Harden Vite before building so the
      // exact configuration that will be previewed is the one we validate.
      if (port !== undefined) {
        await ensureVitePreviewable(sandbox);
        abortSignal?.throwIfAborted();
      }

      if (packageJsonText !== null) {
        emitTerminal(`$ verifying production build in ${projectPath}\n`);
        const build = await verifyProductionBuild(
          sandbox,
          projectPath,
          packageJsonText,
          {
            onCommand: (command) => emitTerminal(`$ ${command}\n`),
            onStdout: emitTerminal,
            onStderr: emitTerminal,
          },
          abortSignal,
        );
        packageManager = build.packageManager;
        checks.push(build.check);
      } else {
        emitTerminal(`$ validating static app entry in ${projectPath}\n`);
        checks.push(await verifyStaticEntry(sandbox, projectPath));
      }
      abortSignal?.throwIfAborted();

      if (checks.every((check) => check.ok) && port !== undefined) {
        checks.push(
          await verifyLiveServer(sandbox, projectPath, port, abortSignal),
        );
      }

      if (checks.every((check) => check.ok) && port !== undefined) {
        const getHost = (sandbox as { getHost?: (value: number) => string })
          .getHost;
        if (typeof getHost !== "function") {
          checks.push({
            name: "browser-runtime",
            ok: false,
            detail:
              "The sandbox cannot expose a public host for browser verification. Use the cloud sandbox for a verified live preview.",
          });
        } else {
          const host = getHost.call(sandbox, port);
          const url = /^https?:\/\//i.test(host) ? host : `https://${host}`;
          checks.push(await browserRuntimeVerifier(url, abortSignal));
        }
      }
      abortSignal?.throwIfAborted();

      // Hold the frames aside for `toModelOutput` and strip them from the
      // result that gets persisted with the message.
      cacheScreenshots(
        toolCallId,
        checks.flatMap((check) => check.screenshots ?? []),
      );
      const persistedChecks = checks.map(
        ({ screenshots: _screenshots, ...check }) => check,
      );

      let ok = checks.every((check) => check.ok);
      if (ok && port !== undefined) {
        ok = verificationGate.mark(
          { projectPath, port, verifiedAt: Date.now() },
          verificationRevision,
        );
        if (ok) {
          emitTerminal(
            `\n✓ build, live server, and browser runtime verified on port ${port}\n`,
          );
        } else {
          persistedChecks.push({
            name: "project",
            ok: false,
            detail:
              "The workspace changed during verification. Finish pending edits and verify the current files again.",
          });
        }
      }
      if (!ok) {
        const failed = persistedChecks.find((check) => !check.ok);
        emitTerminal(
          `\n✗ verification failed: ${failed?.detail ?? "unknown error"}\n`,
        );
      }
      return {
        ok,
        projectPath,
        ...(packageManager && { packageManager }),
        checks: persistedChecks,
        summary: ok
          ? port === undefined
            ? "The app passed its production-readiness check. Start it and verify the live port before previewing."
            : "The app passed its production build, live-server, and browser-runtime checks. It is safe to expose the preview."
          : "The app is not ready. Fix the failed check, then run verify_app again.",
      };
    },
    // Structural checks say whether it rendered. The frames say whether it
    // looks right — which is the only way to catch clipping, contrast, framing,
    // and crowding. Passing checks are not permission to stop looking.
    toModelOutput({ output, toolCallId }) {
      const screenshots = takeScreenshots(toolCallId);
      const text = JSON.stringify(output);
      if (
        screenshots.length === 0 ||
        !supportsMultimodalToolResults(
          getCurrentModelName?.() ?? modelName ?? "",
        )
      ) {
        return { type: "text" as const, value: text };
      }
      return {
        type: "content" as const,
        value: [
          { type: "text" as const, text },
          ...screenshots.map((shot) => ({
            type: "image-data" as const,
            data: shot.data,
            mediaType: shot.mediaType,
          })),
        ],
      };
    },
  });
};
