import { tool } from "ai";
import { z } from "zod";
import { ToolContext } from "@/types";
import { ensureVitePreviewable } from "./utils/vite-preview-hardening";
import type { AppVerificationGate } from "./verify-app";

/**
 * Expose a running dev-server port from the sandbox as a public preview URL the
 * user can open. Used by the app-builder: after the agent starts a dev server
 * (bound to 0.0.0.0), it calls this to give the user a live, openable link.
 *
 * Returns the URL in the result and instructs the agent to share it. Opening in
 * a new tab sidesteps the iframe X-Frame-Options problem entirely (a future
 * enhancement can embed it in the sidebar behind a header-stripping proxy).
 */
export const createExposePreview = (
  context: ToolContext,
  verificationGate?: AppVerificationGate,
) => {
  const { sandboxManager } = context;

  return tool({
    description: `Expose a running dev-server port as a public preview URL the user can open in their browser.

<instructions>
- Call this AFTER the dev server is actually listening (start it in the background first, bound to 0.0.0.0).
- Pass the port the dev server is on (e.g. 5173 for Vite, 3000 for Next).
- The user is shown the running app automatically in an embedded live preview pane — do NOT paste the URL or tell them to open a link; just say their app is running and what they can try.
</instructions>`,
    inputSchema: z.object({
      port: z
        .number()
        .int()
        .min(1)
        .max(65_535)
        .describe("The port the dev server is listening on (e.g. 5173)."),
      brief: z
        .string()
        .describe(
          "A one-sentence preamble describing what is being previewed.",
        ),
    }),
    execute: async ({ port }: { port: number; brief: string }) => {
      try {
        // Keep the runtime boundary defensive even when a caller invokes the
        // tool executor directly instead of going through schema validation.
        if (!Number.isInteger(port) || port < 1 || port > 65_535) {
          return {
            ok: false as const,
            error: "Preview port must be an integer between 1 and 65535.",
          };
        }

        if (verificationGate && !verificationGate.peek(port)) {
          return {
            ok: false as const,
            error:
              `Port ${port} has not passed verify_app in this build run. ` +
              `Call verify_app with the app's absolute project path and port ${port}; ` +
              `fix every failed check before exposing the preview.`,
          };
        }

        const { sandbox } = await sandboxManager.getSandbox();
        const getHost = (sandbox as { getHost?: (p: number) => string })
          .getHost;
        if (typeof getHost !== "function") {
          return "Error: live preview is only available on cloud sandboxes.";
        }

        // Deterministically harden any Vite config so the E2B proxy host is
        // allowed. Without this, Vite 5+/6 answers the preview with "Blocked
        // request — this host is not allowed" and the pane shows a blank page.
        // Vite watches its config and auto-restarts, so the probe below waits
        // for the restarted server to come back up. Best-effort + idempotent —
        // never throws, no-ops on non-Vite projects.
        await ensureVitePreviewable(sandbox);

        // Verify the dev server is actually listening before handing out a URL.
        // getHost() only builds a hostname — it never checks the port — so
        // without this probe the agent can give the user a valid-looking link
        // to a dead server. `curl` WITHOUT `-f` so a live server that answers
        // `/` with a 404/redirect still counts as up (we only need to know the
        // port accepts connections). Retry briefly: a just-started dev server
        // can take a second or two to bind. The loop always exits 0 (the final
        // echo), so commands.run won't throw on an unreachable port.
        const probe = await sandbox.commands.run(
          `for i in 1 2 3 4 5; do ` +
            `curl -s -o /dev/null --max-time 2 "http://localhost:${port}" && { echo RIFT_UP; exit 0; }; ` +
            `sleep 1; done; echo RIFT_DOWN`,
          {},
        );
        if (!probe.stdout.includes("RIFT_UP")) {
          return {
            ok: false as const,
            error:
              `Nothing is listening on port ${port} inside the sandbox, ` +
              `so the preview URL would be dead. Make sure the dev server is ` +
              `started in the background and bound to 0.0.0.0:${port} (not ` +
              `127.0.0.1), confirm it has finished booting, then call ` +
              `expose_preview again. If it crashed, check its logs and restart it.`,
          };
        }

        const host = getHost.call(sandbox, port);
        const url = /^https?:\/\//.test(host) ? host : `https://${host}`;
        if (verificationGate && !verificationGate.complete(port)) {
          return {
            ok: false as const,
            error:
              `The verification proof for port ${port} expired before the preview became ready. ` +
              "Call verify_app again, then retry expose_preview.",
          };
        }
        // Structured output so the frontend can embed the live app in the
        // in-app preview pane (see MessagePartHandler `tool-expose_preview`),
        // not just print a link. The `message` keeps the model informed.
        return {
          ok: true as const,
          url,
          port,
          message: `Preview is live at ${url}. It is shown to the user in an embedded preview pane; tell them their app is running.`,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        return {
          ok: false as const,
          error: `Error exposing preview: ${message}`,
        };
      }
    },
  });
};
