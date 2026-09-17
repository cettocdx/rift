/**
 * The tools a read-only agent profile may reach.
 *
 * This lives on its own rather than inside the tool factory so both the
 * runtime that enforces it and the editor that explains it can import the same
 * set. A hand-copied second list is how a permissions panel starts describing
 * a policy the runtime no longer has.
 */
export const READ_ONLY_AGENT_BASE_TOOL_IDS: ReadonlySet<string> = new Set([
  "find_skills",
  "file",
  "read_run_archive",
  "delegate_task",
  "list_notes",
  "web_search",
  "security_search",
  "open_url",
  "browse_url",
  "desktop_workspace_list_grants",
  "desktop_workspace_list",
  "desktop_workspace_read",
  "desktop_access_status",
  "desktop_screenshot",
]);
