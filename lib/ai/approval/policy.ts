export const APPROVAL_MODES = ["ask", "auto", "full"] as const;
export type ApprovalMode = (typeof APPROVAL_MODES)[number];
export function parseApprovalMode(value: unknown): ApprovalMode {
  // Absent mode means the caller supplied no preference: default to fully
  // autonomous ("Run freely") so runs never block on per-tool approval.
  if (value === undefined || value === null) return "full";
  if (value === "ask" || value === "auto" || value === "full") return value;
  throw new Error("Invalid approval mode");
}
export const APPROVAL_LABELS: Record<ApprovalMode, string> = {
  ask: "Review first",
  auto: "Allow edits",
  full: "Run freely",
};
// Unknown tools (including newly installed MCP tools) always require approval.
// Model descriptions and provider-supplied safety annotations are not authority.
const LOCAL_READS = new Set([
  "read_file",
  "read_run_archive",
  "list_files",
  "list_directory",
  "get_terminal_files",
  "todo_write",
  "list_notes",
  "find_skills",
  "search_connected_tools",
  "read_skill",
  "get_workspace_context",
  "desktop_workspace_list_grants",
  "desktop_workspace_list",
  "desktop_workspace_read",
]);
const LOCAL_EDITS = new Set([
  "write_file",
  "edit_file",
  "create_note",
  "update_note",
]);
export function requiresToolApproval(
  mode: ApprovalMode,
  name: string,
  input: unknown,
): boolean {
  if (mode === "full") return false;
  if (LOCAL_READS.has(name)) return false;
  if (name === "file" && input && typeof input === "object") {
    const action = (input as Record<string, unknown>).action;
    if (action === "read" || action === "view") return false;
    if (
      mode === "auto" &&
      (action === "write" || action === "edit" || action === "append")
    )
      return false;
  }
  return !(mode === "auto" && LOCAL_EDITS.has(name));
}
export type ApprovalPrompt = {
  toolName: string;
  input: unknown;
  toolCallId: string;
  signal?: AbortSignal;
};
export type ToolApprovalGate = ((prompt: ApprovalPrompt) => Promise<void>) & {
  isStopped?: () => boolean;
};
export function gateToolSet<T extends Record<string, any>>(
  tools: T,
  gate: ToolApprovalGate,
): T {
  return Object.fromEntries(
    Object.entries(tools).map(([name, tool]) => {
      if (!tool || typeof tool.execute !== "function") return [name, tool];
      const execute = tool.execute;
      return [
        name,
        {
          ...tool,
          execute: async (
            input: unknown,
            options: { toolCallId: string; abortSignal?: AbortSignal },
          ) => {
            options.abortSignal?.throwIfAborted();
            await gate({
              toolName: name,
              input,
              toolCallId: options.toolCallId,
              signal: options.abortSignal,
            });
            options.abortSignal?.throwIfAborted();
            if (gate.isStopped?.())
              throw new Error(
                "Approval stopped this run. No action was executed.",
              );
            return execute.call(tool, input, options);
          },
        },
      ];
    }),
  ) as T;
}
