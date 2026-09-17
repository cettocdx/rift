import "server-only";
import { confirmSandboxAbsence } from "@/lib/agent/confirm-sandbox-absence";
import { runs } from "@trigger.dev/sdk";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { buildJournalLaunch } from "@/lib/agent/remote-command-journal";
import {
  reconcileRemoteExitReceipts,
  type RecoveryOwner,
} from "@/lib/agent/reconcile-remote-exit-receipts";

/** Runs independently of the dead agent worker. Only authenticated server code
 * supplies this binding; sandbox ownership is verified before reading a receipt. */
export async function reconcileOwnedRemoteExitReceipts(owner: RecoveryOwner) {
  const client = getConvexClient(),
    serviceKey = getConvexServiceKey()!;
  const signal = AbortSignal.timeout(10000);
  const origin = getSandboxContext();
  const sandboxes = new Map<
    string,
    Promise<import("@e2b/code-interpreter").Sandbox>
  >();
  return reconcileRemoteExitReceipts(
    owner,
    {
      producer: async () => {
        const run = await runs.retrieve(owner.runId);
        const payload = run.payload as {
          userId?: string;
          chatId?: string;
          startClaimId?: string;
        };
        return {
          id: run.id,
          status: run.status,
          taskIdentifier: run.taskIdentifier,
          userId: payload.userId ?? "",
          chatId: payload.chatId ?? "",
          claimId: payload.startClaimId ?? "",
          cleanupDrained: run.metadata?.cleanupDrained === true,
        };
      },
      page: async (state, cursor) => {
        const page = await client.query(api.agentRunResources.listPending, {
          ...owner,
          serviceKey,
          state,
          paginationOpts: { numItems: 25, cursor },
        });
        return {
          ...page,
          page: page.page.map((row) => ({
            userId: row.user_id,
            chatId: row.chat_id,
            claimId: row.claim_id,
            runId: row.run_id,
            resourceId: row.resource_id,
            sandboxId: row.sandbox_id,
            pid: row.pid,
            processIdentity: row.process_identity,
          })),
        };
      },
      read: async (resource) => {
        let pending = sandboxes.get(resource.sandboxId);
        if (!pending) {
          pending = (async () => {
            const { Sandbox } = await import("@e2b/code-interpreter");
            const options = {
              ...origin.connection,
              requestTimeoutMs: 2000,
            };
            const info = await Sandbox.getInfo(resource.sandboxId, options);
            // Project namespaces are opaque; their account owner is separate.
            // Never fall back to userID when an explicit owner conflicts.
            const metadata = info.metadata;
            const sandboxOwner =
              metadata?.ownerUserID ??
              (metadata?.workspaceScope === "project"
                ? undefined
                : metadata?.userID);
            if (sandboxOwner !== owner.userId || info.state !== "running")
              throw new Error(
                "Recovery sandbox is not an owned running sandbox",
              );
            const sandbox = await Sandbox.connect(resource.sandboxId, options);
            return sandbox;
          })();
          sandboxes.set(resource.sandboxId, pending);
        }
        const sandbox = await pending;
        signal.throwIfAborted();
        const { receipt } = buildJournalLaunch("", resource);
        return JSON.parse(
          await sandbox.files.read(receipt, {
            user: "root",
            requestTimeoutMs: 1000,
          }),
        );
      },
      started: (resource, receipt) =>
        client.mutation(api.agentRunResources.recordStarted, {
          ...owner,
          resourceId: resource.resourceId,
          sandboxId: resource.sandboxId,
          pid: receipt.pid,
          processIdentity: receipt.processIdentity,
          serviceKey,
        }),
      absent: async (resource) => {
        const { Sandbox, SandboxNotFoundError } =
          await import("@e2b/code-interpreter");
        const options = { ...origin.connection, requestTimeoutMs: 2000 };
        if (
          !(await confirmSandboxAbsence(
            resource.sandboxId,
            {
              info: () => Sandbox.getInfo(resource.sandboxId, options),
              isNotFound: (error) => error instanceof SandboxNotFoundError,
              inventory: async function* () {
                const pages = Sandbox.list({
                  ...options,
                  query: { state: ["running", "paused"] },
                });
                while (pages.hasNext) {
                  signal.throwIfAborted();
                  yield await pages.nextItems();
                }
              },
            },
            signal,
          ))
        )
          return false;
        signal.throwIfAborted();
        return client.mutation(api.agentRunResources.recordSandboxAbsent, {
          ...owner,
          resourceId: resource.resourceId,
          sandboxId: resource.sandboxId,
          serviceKey,
        });
      },
      complete: async (binding) => {
        signal.throwIfAborted();
        if (
          !(await client.mutation(api.agentRunClaims.confirmRemoteCleanup, {
            ...binding,
            serviceKey,
          }))
        )
          return false;
        signal.throwIfAborted();
        return client.mutation(api.agentRunClaims.release, {
          ...binding,
          serviceKey,
        });
      },
      exited: (resource, receipt) =>
        client.mutation(api.agentRunResources.recordExited, {
          ...owner,
          resourceId: resource.resourceId,
          sandboxId: resource.sandboxId,
          pid: receipt.pid,
          processIdentity: receipt.processIdentity,
          serviceKey,
        }),
    },
    signal,
  );
}
