import type { ToolApprovalGate } from "@/lib/ai/approval/policy";

// Exact built-in operations only. MCP annotations, names and model-supplied
// readOnly hints cannot turn an external action into a replayable operation.
const READS = new Set([
  "read_file",
  "list_files",
  "list_directory",
  "get_terminal_files",
  "list_notes",
  "read_skill",
  "get_workspace_context",
  "desktop_workspace_list_grants",
  "desktop_workspace_list",
  "desktop_workspace_read",
  "desktop_access_status",
  "desktop_screenshot",
  "search_connected_tools",
]);

export function createCheckpointToolBarrier(options: {
  isDisabled: () => boolean;
  assertRead: () => Promise<boolean>;
  markEffect: () => Promise<boolean>;
}): ToolApprovalGate {
  return async ({ toolName, input, signal }) => {
    signal?.throwIfAborted();
    if (options.isDisabled()) return;
    const action =
      input && typeof input === "object"
        ? (input as Record<string, unknown>).action
        : undefined;
    const readOnly =
      READS.has(toolName) ||
      (toolName === "file" && (action === "read" || action === "view"));
    const owned = await (readOnly
      ? options.assertRead()
      : options.markEffect());
    signal?.throwIfAborted();
    if (!owned)
      throw new Error(
        "This run no longer owns the pending action. No tool was executed.",
      );
  };
}
