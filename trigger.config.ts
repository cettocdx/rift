import { config } from "dotenv";
import { syncEnvVars } from "@trigger.dev/build/extensions/core";
import { createTriggerConfig } from "./trigger.shared";

if (process.env.NODE_ENV !== "production") {
  config({ path: ".env.local" });
}

export default createTriggerConfig({
  project: process.env.TRIGGER_PROJECT_ID!,
  dirs: ["./trigger"],
  enableConsoleLogging: process.env.NODE_ENV !== "production",
  // Reuse the initialized runtime after SDK cleanup. Per-run clients and
  // remote-command state remain scoped by AsyncLocalStorage. Bound recycling
  // limits retained process state; false provides an explicit rollback.
  processReuse: process.env.RIFT_WORKER_PROCESS_REUSE !== "false",
  extensions: [
    // Authenticated MCP plugins encrypt credentials in the Next.js runtime
    // and decrypt them again inside long-running Trigger.dev agents. Keep the
    // same keyring in both runtimes without committing secret material.
    syncEnvVars(() => {
      const activeVersion =
        process.env.MCP_CREDENTIALS_ACTIVE_KEY_VERSION?.trim();
      const encryptionKeys =
        process.env.MCP_CREDENTIALS_ENCRYPTION_KEYS?.trim();
      if (!activeVersion || !encryptionKeys) return;
      return {
        MCP_CREDENTIALS_ACTIVE_KEY_VERSION: activeVersion,
        MCP_CREDENTIALS_ENCRYPTION_KEYS: encryptionKeys,
      };
    }),
  ],
});
