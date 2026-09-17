/**
 * OpenCode tool vocabulary → RIFT part vocabulary.
 *
 * The chat client renders parts by a fixed switch on `tool-<name>`
 * (MessagePartHandler); an unknown name renders nothing. OpenCode's built-in
 * tools have different names and output shapes than RIFT's, so the driver maps
 * every tool part through here BEFORE writing chunks — the persisted transcript
 * then carries RIFT names and the existing renderers, replay and pruning all
 * keep working unchanged. RIFT's own sandbox tools (verify_app, expose_preview,
 * …) pass through by identity. Anything unmapped falls back to `opencode_<n>`
 * so it persists safely (rendering nothing, exactly like an unknown MCP tool).
 */

export interface OpenCodeToolSnapshot {
  tool: string;
  callID: string;
  state: {
    status: "pending" | "running" | "completed" | "error";
    input?: unknown;
    output?: string;
    title?: string;
    metadata?: Record<string, unknown>;
    error?: string;
  };
}

export interface MappedToolPart {
  toolName: string;
  input: unknown;
  output?: unknown;
  errorText?: string;
}

/** RIFT tools exposed to OpenCode by identity (their names already match). */
export const RIFT_PASSTHROUGH_TOOLS: ReadonlySet<string> = new Set([
  "verify_app",
  "expose_preview",
  "browse_url",
  "web_search",
  "generate_image",
  "generate_video",
  "create_note",
  "list_notes",
  "update_note",
  "delete_note",
]);

/** OpenCode built-in name → RIFT renderer name. */
export const OPENCODE_TOOL_NAME_MAP: Readonly<Record<string, string>> = {
  bash: "run_terminal_cmd",
  shell: "run_terminal_cmd",
  read: "file",
  edit: "file",
  write: "file",
  apply_patch: "apply_patch",
  glob: "search",
  grep: "search",
  todowrite: "todo_write",
  webfetch: "browse_url",
  task: "delegate_task",
  skill: "find_skills",
};

function asObj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}
function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

/** RIFT renderer name for an OpenCode tool. */
export function mapToolName(ocTool: string): string {
  if (RIFT_PASSTHROUGH_TOOLS.has(ocTool)) return ocTool;
  if (OPENCODE_TOOL_NAME_MAP[ocTool]) return OPENCODE_TOOL_NAME_MAP[ocTool];
  if (/^[a-z0-9]+_[a-z0-9_]+$/i.test(ocTool)) return ocTool; // MCP <server>_<tool>
  return `opencode_${ocTool}`;
}

function mapInput(ocTool: string, input: unknown, title?: string): unknown {
  const i = asObj(input);
  switch (ocTool) {
    case "bash":
    case "shell": {
      const command = str(i.command) ?? "";
      return {
        command,
        brief: str(i.description) ?? title,
        is_background: /(?:^|\s)&\s*$|\bnohup\b|\bsetsid\b/.test(command),
        timeout: num(i.timeout),
      };
    }
    case "read": {
      const offset = num(i.offset);
      const limit = num(i.limit);
      return {
        action: "read",
        path: str(i.filePath),
        brief: title,
        range: offset != null ? [offset, limit != null ? offset + limit - 1 : -1] : undefined,
      };
    }
    case "edit":
      return {
        action: "edit",
        path: str(i.filePath),
        brief: title,
        edits: [{ find: str(i.oldString) ?? "", replace: str(i.newString) ?? "", all: !!i.replaceAll }],
      };
    case "write":
      return { action: "write", path: str(i.filePath), brief: title, text: str(i.content) };
    case "apply_patch":
      return { patchText: str(i.patchText) ?? str(i.patch), brief: title };
    case "glob":
      return { kind: "glob", pattern: str(i.pattern), path: str(i.path), brief: title };
    case "grep":
      return { kind: "grep", pattern: str(i.pattern), path: str(i.path), include: str(i.include), brief: title };
    case "todowrite":
      return {
        merge: false,
        todos: Array.isArray(i.todos)
          ? i.todos.map((t: unknown, idx: number) => {
              const to = asObj(t);
              const s = str(to.status);
              return {
                id: str(to.id) ?? String(idx + 1),
                content: str(to.content) ?? "",
                status: s === "cancelled" ? "completed" : s ?? "pending",
              };
            })
          : [],
      };
    case "webfetch":
      return { url: str(i.url), brief: title };
    case "task":
      return { agentId: str(i.subagent_type), name: str(i.description), task: str(i.prompt) };
    case "skill":
      return { task: str(i.name) ?? title };
    default:
      return input;
  }
}

function mapOutput(ocTool: string, s: OpenCodeToolSnapshot["state"]): unknown {
  const meta = asObj(s.metadata);
  const output = s.output ?? "";
  switch (ocTool) {
    case "bash":
    case "shell":
      return {
        output,
        exitCode: num(meta.exit) ?? (s.status === "error" ? 1 : 0),
        aborted: /User aborted/i.test(output),
        truncated: !!meta.truncated,
        outputPath: str(meta.outputPath),
      };
    case "read":
      return { action: "read", content: output };
    case "edit":
      return { action: "edit", result: output, diff: meta.diff };
    case "write":
      return { action: "write", result: output, created: meta.exists === false };
    case "apply_patch":
      return { files: meta.files, summary: output };
    case "glob":
      return { count: num(meta.count), truncated: !!meta.truncated, text: output };
    case "grep":
      return { count: num(meta.matches), truncated: !!meta.truncated, text: output };
    case "todowrite":
      return { result: "updated" };
    case "webfetch":
      return { text: output };
    case "task":
      return {
        agent: { id: str(meta.sessionId) ?? "subagent", name: undefined, profileId: undefined },
        summary: output,
      };
    case "skill":
      return { matched: true, count: 1 };
    default:
      return output;
  }
}

/** Map one OpenCode tool snapshot to a RIFT part. Never returns null today —
 * unmapped tools fall back to `opencode_<name>` so they persist safely. */
export function mapOpenCodeToolPart(snapshot: OpenCodeToolSnapshot): MappedToolPart {
  const toolName = mapToolName(snapshot.tool);
  const input = mapInput(snapshot.tool, snapshot.state.input, snapshot.state.title);
  const part: MappedToolPart = { toolName, input };
  if (snapshot.state.status === "error") {
    part.errorText = snapshot.state.error ?? "Tool failed";
  } else if (snapshot.state.status === "completed") {
    part.output = mapOutput(snapshot.tool, snapshot.state);
  }
  return part;
}

export interface ProgressCursor {
  emitted: string;
}

/**
 * Diff a running bash tool's streamed stdout for `data-terminal` chunks.
 * OpenCode reports the ≤30 KB tail in `state.metadata.output`; when it grows we
 * emit the new suffix, and when the tail was rewound (preview trimmed) we emit a
 * marker plus the fresh tail so the terminal card never loses its place.
 */
export function diffToolProgress(
  prev: ProgressCursor | undefined,
  snapshot: OpenCodeToolSnapshot,
): { delta: string | null; cursor: ProgressCursor } {
  const current = str(asObj(snapshot.state.metadata).output) ?? "";
  const emitted = prev?.emitted ?? "";
  if (current === emitted) return { delta: null, cursor: { emitted } };
  if (current.startsWith(emitted)) {
    return { delta: current.slice(emitted.length), cursor: { emitted: current } };
  }
  return { delta: `\n[…output preview trimmed…]\n${current}`, cursor: { emitted: current } };
}
