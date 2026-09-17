import type { AnySandbox } from "@/types";
import { isE2BSandbox } from "./sandbox-types";

/**
 * The `terminal-agent-sandbox` E2B image (Kali + a large pentest toolset) fills
 * its auto-sized rootfs almost completely — a freshly created sandbox is born at
 * ~100% disk with 0 bytes free. Any write (scan output, `apt install`, the
 * truncated-output saver) then fails with NotEnoughSpaceError, which crashes
 * envd, fails the health check, and triggers an endless kill+recreate spiral
 * (each fresh sandbox is also born full). To the user this looks like the agent
 * hanging for many minutes with no output.
 *
 * Until the template is rebuilt with a larger disk (the durable fix — E2B's V3
 * build API doesn't expose a disk-size knob, so it needs a slimmer image or an
 * E2B-side disk bump), this best-effort runtime reclaim deletes purely
 * non-functional files — package docs, man pages, locales, apt lists, and
 * Python bytecode caches. When it works it frees ~1.2 GB of real persistent
 * rootfs (not the RAM-backed /tmp tmpfs, so large outputs don't risk OOM).
 *
 * IMPORTANT — this is unreliable by nature: on E2B's overlay filesystem the
 * deleted image-layer blocks are returned to the free pool only asynchronously,
 * and on some sandbox instances the space never frees within a useful window.
 * So this is fire-and-forget upside, never a guarantee — callers must not block
 * on it, and the kill+recreate cap in run_terminal_cmd is what keeps the
 * no-space case graceful.
 */
const RECLAIM_CMD = [
  "rm -rf",
  "/usr/share/doc/*",
  "/usr/share/man/*",
  "/usr/share/locale/*",
  "/usr/share/info/*",
  "/var/lib/apt/lists/*",
  "/var/cache/apt/archives/*",
  "/root/.cache",
  "/home/user/.cache",
  "2>/dev/null;",
  // Scope the bytecode-cache sweep to the dirs that actually hold Python
  // packages rather than walking the whole 11 GB filesystem — keeps the
  // reclaim to a couple of seconds on the agent cold-start path. The direct
  // rm -rf above already accounts for the bulk of the reclaimed space.
  "find /usr/lib /usr/local /opt -type d -name __pycache__ -prune -exec rm -rf {} + 2>/dev/null;",
  "true",
].join(" ");

/**
 * Free non-functional rootfs space on a freshly created E2B sandbox so the
 * agent has writable headroom. Best-effort: a failure here must never block
 * the boot — the command runs as root and swallows its own errors.
 *
 * No-op for non-E2B (local/desktop) sandboxes, which manage their own disk.
 */
export async function reclaimSandboxDisk(sandbox: AnySandbox): Promise<void> {
  if (!isE2BSandbox(sandbox)) return;
  try {
    await sandbox.commands.run(RECLAIM_CMD, {
      timeoutMs: 60_000,
      user: "root",
      envs: { HOME: "/root", USER: "root", LOGNAME: "root" },
    });
  } catch (err) {
    console.warn(
      "[sandbox] disk reclaim failed (continuing):",
      err instanceof Error ? err.message : err,
    );
  }
}
