import {
  getSandboxContext,
  type SandboxContextOrigin,
} from "@/lib/ai/sandbox-context";
import { Sandbox } from "@e2b/code-interpreter";
import type { SandboxBootInfo, SandboxContext } from "@/types";
import { getUserFacingE2BErrorMessage } from "./e2b-errors";
import { reclaimSandboxDisk } from "./sandbox-disk-reclaim";

type SandboxReadyPath = SandboxBootInfo["path"];

// Creation and reconnection use the same lifetime. Reconnecting must not
// shorten a running workspace to five minutes while agents still use it.
export const SANDBOX_KEEPALIVE_MS = 2 * 60 * 60 * 1000; // 2 hours
const BASH_SANDBOX_AUTOPAUSE_TIMEOUT = SANDBOX_KEEPALIVE_MS;
// Retry config for E2B 429 rate limits
const RATE_LIMIT_COOLDOWN_MS = 1_000;
const MAX_CREATE_RETRIES = 3;

// Metadata for new workspaces only. A template update must never delete an
// existing workspace; moving its files requires a separate verified migration.
const SANDBOX_VERSION = "v15";

/**
 * Ensures a sandbox connection is established and maintained
 * Reuses existing sandboxes when possible to maintain state and improve performance
 *
 * @param context - Sandbox context containing user ID and state management
 * @param options - Configuration options for sandbox connection
 * @returns Connected sandbox instance
 *
 * Existing workspaces retain their identity across reconnects and template
 * revisions. Failed reconnects preserve the workspace rather than replacing it.
 * New workspaces are created only when the owner-scoped lookup returns none.
 */
export const ensureSandboxConnection = async (
  context: SandboxContext,
  options: {
    initialSandbox?: Sandbox | null;
    origin?: SandboxContextOrigin;
  } = {},
): Promise<{ sandbox: Sandbox }> => {
  const { userID, sandboxNamespace, setSandbox, onBoot } = context;
  const sandboxIdentity = sandboxNamespace ?? userID;
  const { initialSandbox } = options;
  const origin = options.origin ?? getSandboxContext();

  // Return existing sandbox if already connected
  if (initialSandbox) {
    return { sandbox: initialSandbox };
  }
  const startedAt = performance.now();
  const createPath: SandboxReadyPath = "create_fresh";
  const reportBoot = (path: SandboxReadyPath, attempts: number): void => {
    onBoot?.({
      path,
      duration_ms: Math.round(performance.now() - startedAt),
      create_attempts: attempts,
    });
  };
  try {
    // Step 1: Look for existing sandbox for this user
    const paginator = Sandbox.list({
      ...origin.connection,
      query: {
        metadata: {
          userID: sandboxIdentity,
          template: origin.template,
        },
      },
    });
    const existingSandbox = (await paginator.nextItems())[0];

    if (existingSandbox?.sandboxId) {
      // Connect resumes this exact paused workspace. A network/auth failure or
      // an old template version is never permission to delete the user's files.
      const sandbox = await Sandbox.connect(existingSandbox.sandboxId, {
        ...origin.connection,
        timeoutMs: SANDBOX_KEEPALIVE_MS,
      });
      setSandbox(sandbox);
      reportBoot("reuse_existing", 0);
      return { sandbox };
    }

    // No existing workspace: create with bounded E2B rate-limit retries.
    let lastError: unknown;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      if (attempt > 0) {
        console.warn(
          `[${userID}] E2B rate limit — retrying sandbox creation (${attempt + 1}/${MAX_CREATE_RETRIES}) after ${RATE_LIMIT_COOLDOWN_MS}ms`,
        );
        await new Promise((r) => setTimeout(r, RATE_LIMIT_COOLDOWN_MS));
      }

      try {
        const sandbox = await Sandbox.create(origin.template, {
          ...origin.connection,
          timeoutMs: BASH_SANDBOX_AUTOPAUSE_TIMEOUT,
          lifecycle: { onTimeout: "pause" },
          secure: true,
          metadata: {
            // Project sandboxes use an HMAC-derived identity for lookup. Keep
            // the account owner separately so account-wide cleanup can still
            // find every workspace without weakening isolation.
            userID: sandboxIdentity,
            ...(sandboxNamespace
              ? { ownerUserID: userID, workspaceScope: "project" }
              : {}),
            template: origin.template,
            secure: "true",
            sandboxVersion: SANDBOX_VERSION,
          },
        });

        // A fresh sandbox is born at ~100% disk (the image fills its auto-sized
        // rootfs). Kick off a best-effort reclaim of non-functional space, but
        // do NOT await it: on E2B's overlay filesystem, deleting image-layer
        // files frees space only unreliably/asynchronously (sometimes ~1.2 GB,
        // sometimes nothing for tens of seconds), and awaiting it would add
        // ~35 s to every cold start for an uncertain payoff. Fire-and-forget
        // keeps the boot fast without replacing a slow workspace. The durable
        // fix for an undersized image is a larger
        // template disk from E2B (see sandbox-disk-reclaim.ts).
        void reclaimSandboxDisk(sandbox);

        setSandbox(sandbox);
        reportBoot(createPath, attempt + 1);
        return { sandbox };
      } catch (createError) {
        lastError = createError;
        const isRateLimit =
          createError instanceof Error &&
          (createError.message?.includes("429") ||
            createError.message?.includes("Rate limit"));
        if (!isRateLimit) throw createError;
      }
    }
    throw lastError;
  } catch (error) {
    console.error("Error creating persistent sandbox:", error);

    // Surface specific error messages for known E2B errors
    const userMessage = getUserFacingE2BErrorMessage(error);
    if (userMessage) {
      throw new Error(userMessage);
    }

    throw new Error(
      `Failed creating persistent sandbox: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
  }
};
