import { defineConfig } from "@trigger.dev/sdk";
import type { BuildExtension } from "@trigger.dev/core/v3/build";
import { additionalPackages } from "@trigger.dev/build/extensions/core";
import { playwright } from "@trigger.dev/build/extensions/playwright";

// No dotenv load or secret synchronization here: each entry chooses its policy.
export function createTriggerConfig(options: {
  project: string;
  dirs: string[];
  enableConsoleLogging: boolean;
  extensions?: BuildExtension[];
  processReuse?: boolean;
}) {
  return defineConfig({
    project: options.project,
    // centrifuge-js relies on globalThis.WebSocket, which is only stable on
    // Node 22+. The default "node" runtime is older and would throw
    // "WebSocket constructor not found" when CentrifugoSandbox connects.
    runtime: "node-22",
    ...(options.processReuse !== undefined
      ? {
          processKeepAlive: {
            enabled: options.processReuse,
            devMaxPoolSize: 2,
            maxExecutionsPerProcess: 10,
          },
        }
      : {}),
    logLevel: "log",
    // Keep task-side console output visible in the local Trigger.dev worker.
    // This makes process-level stream failures diagnosable during development;
    // production still sends the same logs to Trigger.dev observability.
    enableConsoleLogging: options.enableConsoleLogging,
    // Up to one hour per agent-long run.
    maxDuration: 3600,
    retries: {
      enabledInDev: false,
      default: {
        maxAttempts: 3,
        minTimeoutInMs: 1000,
        maxTimeoutInMs: 10000,
        factor: 2,
        randomize: true,
      },
    },
    dirs: options.dirs,
    build: {
      // Native modules that must be installed at deploy time, not bundled.
      // @e2b/code-interpreter is pure JS and intentionally NOT listed here —
      // bundling it lets esbuild convert chalk's ESM to CJS inline, avoiding
      // the ERR_REQUIRE_ESM crash that occurs when Docker installs it via npm.
      // Playwright loads the Chromium BiDi mapper through runtime
      // `require()` calls. Keeping this trio external follows Trigger.dev's
      // browser-worker guidance and prevents esbuild from trying to resolve the
      // mapper inside Playwright's pre-bundled core during `trigger dev`.
      // The e2b SDK reaches for undici through `new Function("m", "return import(m)")`,
      // which no bundler can see. Bundled, that import finds nothing at runtime and
      // e2b falls back to global fetch for both its API and envd transports -- every
      // sandbox transport loses the SDK's HTTP/2-capable dispatcher. Merely
      // marking undici external cannot discover this dynamic import; the
      // additionalPackages layer below must install it in the deploy image.
      external: [
        "node-pty",
        "sharp",
        "playwright",
        "playwright-core",
        "chromium-bidi",
        "undici",
      ],
      extensions: [
        ...(options.extensions ?? []),
        additionalPackages({
          packages: ["node-pty@1.2.0-beta.12", "sharp@0.34.5", "undici@7.25.0"],
        }),
        // Build agents verify generated apps in a real browser after the
        // production build and live HTTP probe. Keep this in the Trigger image,
        // not the already-large offensive-security sandbox image.
        // Trigger's browser layer parses Playwright's machine-readable dry-run
        // output. Playwright 1.58+ changed that format. Keep both this value and
        // the package dependency pinned: Trigger gives the detected external
        // package version precedence over this explicit fallback.
        playwright({ browsers: ["chromium"], version: "1.55.0" }),
      ],
    },
  });
}
