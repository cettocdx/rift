import type { AnySandbox } from "@/types";
import { createRetryLogger } from "@/lib/posthog/worker";
import { isE2BSandbox } from "./sandbox-types";
import { retryWithBackoff } from "./retry-with-backoff";
import { isE2BPermanentError } from "./e2b-errors";

const sandboxHealthLogger = createRetryLogger("sandbox-health");

const CPU_WARNING_THRESHOLD = 95; // percentage
const MEM_WARNING_THRESHOLD = 90; // percentage

/**
 * Check sandbox resource metrics and return a diagnostic summary.
 * Returns null if metrics are unavailable (non-E2B sandbox or API error).
 */
async function checkSandboxMetrics(sandbox: AnySandbox): Promise<{
  cpuPct: number;
  memPct: number;
  diskPct: number;
  warning: string | null;
} | null> {
  if (!isE2BSandbox(sandbox)) return null;

  try {
    const metrics = await sandbox.getMetrics();
    if (!metrics.length) return null;

    const latest = metrics[metrics.length - 1];
    const cpuPct = latest.cpuUsedPct;
    const memPct =
      latest.memTotal > 0 ? (latest.memUsed / latest.memTotal) * 100 : 0;
    const diskPct =
      latest.diskTotal > 0 ? (latest.diskUsed / latest.diskTotal) * 100 : 0;

    const warnings: string[] = [];
    if (cpuPct > CPU_WARNING_THRESHOLD) {
      warnings.push(`CPU at ${cpuPct.toFixed(0)}%`);
    }
    if (memPct > MEM_WARNING_THRESHOLD) {
      warnings.push(
        `Memory at ${memPct.toFixed(0)}% (${Math.round(latest.memUsed / 1024 / 1024)}/${Math.round(latest.memTotal / 1024 / 1024)} MB)`,
      );
    }

    return {
      cpuPct,
      memPct,
      diskPct,
      warning: warnings.length > 0 ? warnings.join(", ") : null,
    };
  } catch {
    // Metrics API failure shouldn't block health checks
    return null;
  }
}

/**
 * Build a diagnostic message from metrics for error context.
 */
export async function getSandboxDiagnostics(
  sandbox: AnySandbox,
): Promise<string> {
  const metrics = await checkSandboxMetrics(sandbox);
  if (!metrics) return "metrics unavailable";
  return `CPU: ${metrics.cpuPct.toFixed(0)}%, Memory: ${metrics.memPct.toFixed(0)}%, Disk: ${metrics.diskPct.toFixed(0)}%`;
}

/**
 * Wait for sandbox to become available and ready to execute commands.
 *
 * Checks running status and actual command execution. Resource telemetry is an
 * optional diagnostic, not a prerequisite for dispatching each user command.
 *
 * @param sandbox - Sandbox instance to check
 * @param maxRetries - Maximum number of health check attempts (default: 5)
 * @param signal - Optional abort signal to cancel health checks
 * @returns Promise that resolves when sandbox is ready
 * @throws Error if sandbox doesn't become ready after all retries
 */
export async function waitForSandboxReady(
  sandbox: AnySandbox,
  maxRetries: number = 5,
  signal?: AbortSignal,
): Promise<void> {
  const checkAbort = () => {
    if (signal?.aborted)
      throw new DOMException("Operation aborted", "AbortError");
  };
  await retryWithBackoff(
    async () => {
      checkAbort();
      // For E2B Sandbox, check if it's running first
      if (isE2BSandbox(sandbox)) {
        const running = await sandbox.isRunning({
          requestTimeoutMs: 5000,
          signal,
        });
        checkAbort();
        if (!running) {
          throw new Error("Sandbox is not running");
        }
      }

      // Verify it can actually execute commands with a simple test
      checkAbort();
      await sandbox.commands.run("echo ready", {
        timeoutMs: 5000, // 5 second timeout for health check (envd can be slow under CPU pressure)
        requestTimeoutMs: 5000,
        signal,
        // Hide from local CLI output (empty string = hide)
        displayName: "",
      } as {
        timeoutMs: number;
        requestTimeoutMs: number;
        signal?: AbortSignal;
        displayName?: string;
      });
      checkAbort();
    },
    {
      maxRetries,
      baseDelayMs: 1000, // Five attempts have four waits: 1s, 2s, 4s, 8s.
      jitterMs: 100,
      isPermanentError: isE2BPermanentError,
      logger: (message, error) => {
        // Only log final failure (when it gives up)
        if (message.includes("failed after")) {
          sandboxHealthLogger(message, error);
        }
      },
      signal,
    },
  );
}
