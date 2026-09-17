import type { ToolExecutionOptions, ToolSet } from "ai";
import type { AppVerificationGate } from "../verify-app";

// These tools cannot alter the app's workspace. A command or unknown connector
// may write even if its label sounds read-only, so neither is exempted here.
const NON_WORKSPACE_MUTATING_TOOLS = new Set([
  "verify_app",
  "expose_preview",
  "get_terminal_files",
  "todo_write",
  "delegate_task",
  "find_skills",
  "read_skill",
  "web_search",
  "security_search",
  "open_url",
  "browse_url",
  "create_note",
  "list_notes",
  "update_note",
  "delete_note",
  "report_finding",
  "desktop_workspace_list_grants",
  "desktop_workspace_list",
  "desktop_workspace_read",
]);

function canMutateWorkspace(name: string, input: unknown): boolean {
  if (NON_WORKSPACE_MUTATING_TOOLS.has(name)) return false;
  if (name === "file" && input && typeof input === "object") {
    const action = (input as Record<string, unknown>).action;
    return action !== "read" && action !== "view";
  }
  return true;
}

/** Wrap inside approvals: a denied action never invalidates a valid proof. */
export function trackAppWorkspaceMutations(
  tools: ToolSet,
  gate: AppVerificationGate,
): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      const original = tool.execute;
      if (!original || NON_WORKSPACE_MUTATING_TOOLS.has(name))
        return [name, tool];
      return [
        name,
        {
          ...tool,
          execute: async (input: unknown, options: ToolExecutionOptions) => {
            options.abortSignal?.throwIfAborted();
            if (!canMutateWorkspace(name, input))
              return original.call(tool, input, options);
            const finishMutation = gate.beginMutation();
            try {
              return await original.call(tool, input, options);
            } finally {
              // Failed commands may already have written files. Both entry and exit
              // advance the revision, including concurrent verification attempts.
              finishMutation();
            }
          },
        },
      ];
    }),
  );
}
