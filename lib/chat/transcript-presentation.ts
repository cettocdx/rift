import type { ChatStatus } from "@/types/chat";

export type TranscriptToolCategory =
  | "read"
  | "image"
  | "edit"
  | "command"
  | "search"
  | "web"
  | "agent"
  | "plan"
  | "skill"
  | "desktop"
  | "tool";
export type TranscriptToolStatus =
  | "completed"
  | "running"
  | "awaiting-approval"
  | "not-approved"
  | "failed"
  | "needs-setup"
  | "interrupted"
  | "unknown";
export type TranscriptToolPart = {
  type: string;
  toolName?: string;
  state?: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
  approval?: unknown;
};
export type TranscriptAgentIdentity = { name: string; identity: string };
export type TranscriptToolSummary = {
  label: string;
  detail: string;
  failed: number;
  running: boolean;
  category: TranscriptToolCategory;
  agents: TranscriptAgentIdentity[];
  status: TranscriptToolStatus;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const cleanLabel = (value: unknown, limit = 72): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text
    ? text.length > limit
      ? `${text.slice(0, limit - 1)}…`
      : text
    : undefined;
};
const toolName = (part: TranscriptToolPart) =>
  part.type === "dynamic-tool"
    ? (part.toolName ?? "")
    : part.type.replace(/^tool-/, "");
const isTool = (part: TranscriptToolPart) =>
  part.type.startsWith("tool-") || part.type === "dynamic-tool";
const fileName = (part: TranscriptToolPart): string | undefined => {
  const input = record(part.input);
  const path =
    input.relativePath ?? input.path ?? input.file_path ?? input.filename;
  if (typeof path !== "string") return undefined;
  return cleanLabel(path.split(/[\\/]/).filter(Boolean).at(-1));
};

const categories: Record<string, TranscriptToolCategory> = {
  read_file: "read",
  list_files: "read",
  list_directory: "read",
  desktop_workspace_read: "read",
  desktop_workspace_list: "read",
  desktop_workspace_list_grants: "read",
  write_file: "edit",
  edit_file: "edit",
  delete_file: "edit",
  search_replace: "edit",
  multi_edit: "edit",
  apply_patch: "edit",
  desktop_workspace_write: "edit",
  shell: "command",
  run_terminal_cmd: "command",
  interact_terminal_session: "command",
  search: "search",
  web_search: "search",
  grep: "search",
  glob: "search",
  security_search: "search",
  open_url: "web",
  browse_url: "web",
  desktop_access_status: "desktop",
  desktop_screenshot: "desktop",
  desktop_computer_action: "desktop",
  web: "web",
  delegate_task: "agent",
  todo_write: "plan",
  find_skills: "skill",
  read_skill: "skill",
};

/** Known runtime contracts only; opaque provider/MCP names are not evidence of an action. */
export function classifyTranscriptTool(
  part: TranscriptToolPart,
): TranscriptToolCategory {
  const name = toolName(part);
  if (name === "file") {
    const action = record(part.input).action;
    if (action === "read") return "read";
    if (action === "view") return "image";
    if (["write", "edit", "append", "delete"].includes(String(action)))
      return "edit";
    return "tool";
  }
  return Object.hasOwn(categories, name) ? categories[name] : "tool";
}

function agentIdentity(
  part: TranscriptToolPart,
): TranscriptAgentIdentity | undefined {
  if (classifyTranscriptTool(part) !== "agent") return undefined;
  const input = record(part.input);
  const agent = record(record(part.output).agent);
  const name = cleanLabel(agent.name ?? input.agentName);
  const identity = cleanLabel(
    input.agentId ??
      input.agentName ??
      agent.profileId ??
      agent.name ??
      agent.id,
    128,
  );
  return identity ? { name: name ?? "Agent", identity } : undefined;
}
const hasError = (value: unknown) =>
  typeof value === "string"
    ? value.trim().length > 0
    : value !== undefined && value !== null && value !== false;
const liveChat = (status: ChatStatus) =>
  status === "streaming" || status === "submitted";

export function getTranscriptToolStatus(
  part: TranscriptToolPart,
  chatStatus: ChatStatus,
  awaitingApproval: boolean,
): TranscriptToolStatus {
  const output = record(part.output);
  const mcpCall = toolName(part).startsWith("mcp_");
  if (
    mcpCall &&
    output.code === "mcp_call_unconfirmed" &&
    output.executionStatus === "unconfirmed" &&
    output.retrySafe === false
  )
    return "unknown";
  // A readiness probe can truthfully report a missing desktop connection.
  // Keep it visible as setup needed; never apply this to actual actions.
  if (
    toolName(part) === "desktop_access_status" &&
    part.state === "output-available" &&
    output.ok === false &&
    ["unavailable", "denied"].includes(String(output.code))
  )
    return "needs-setup";
  // These are actual runtime envelopes, not arbitrary file content or stdout.
  const result = record(output.result);
  const agent = record(output.agent);
  const execution = record(output.execution);
  const exitCodes = [
    output.exitCode,
    result.exitCode,
    record(result.exited).exitCode,
  ];
  const approval = record(part.approval);
  const states = [
    output.status,
    result.status,
    agent.status,
    execution.stopReason,
  ];
  if (
    part.state === "output-denied" ||
    approval.approved === false ||
    /Action (denied|expired|canceled)\./i.test(part.errorText ?? "") ||
    states.some((state) =>
      ["approval-denied", "not-approved", "denied"].includes(String(state)),
    )
  )
    return "not-approved";
  if (
    (["run_terminal_cmd", "shell"].includes(toolName(part)) &&
      (output.aborted === true || result.aborted === true)) ||
    states.some((state) =>
      ["cancelled", "canceled", "interrupted", "aborted"].includes(
        String(state),
      ),
    ) ||
    /Stopped by user before the tool completed|Command execution aborted by user|The subagent was cancelled with the parent run/i.test(
      part.errorText ?? "",
    ) ||
    exitCodes.some((code) => code === 130 || code === 143)
  )
    return "interrupted";
  // run_terminal_cmd reports an unconfirmed result with a diagnostic error.
  // The explicit outcome is uncertainty, while independent failure evidence
  // below still takes precedence.
  const unconfirmedTerminalResult =
    toolName(part) === "run_terminal_cmd" &&
    result.outcome === "unknown" &&
    result.exitCode === null;
  if (
    part.state === "output-error" ||
    (mcpCall && output.isError === true) ||
    hasError(output.error) ||
    (!unconfirmedTerminalResult && hasError(result.error)) ||
    output.ok === false ||
    output.success === false ||
    result.ok === false ||
    result.success === false ||
    states.some((state) =>
      [
        "failed",
        "error",
        "timeout",
        "step-limit",
        "tool-limit",
        "token-limit",
        "budget-limit",
      ].includes(String(state)),
    ) ||
    exitCodes.some((code) => typeof code === "number" && code !== 0)
  )
    return "failed";
  const pending = [
    "input-streaming",
    "input-available",
    "approval-requested",
    "approval-responded",
  ].includes(part.state ?? "");
  if (pending) {
    if (!liveChat(chatStatus)) return "interrupted";
    if (part.state === "approval-requested" || awaitingApproval)
      return "awaiting-approval";
    return "running";
  }
  if (
    classifyTranscriptTool(part) === "command" &&
    (output.exitCode === null ||
      result.exitCode === null ||
      ((output.pid !== undefined || result.pid !== undefined) &&
        output.exitCode === undefined &&
        result.exitCode === undefined))
  )
    return "unknown";
  return part.state === "output-available" ? "completed" : "unknown";
}

type Operation = {
  part: TranscriptToolPart;
  category: TranscriptToolCategory;
  status: TranscriptToolStatus;
  agent?: TranscriptAgentIdentity;
};
const activeLabels: Record<TranscriptToolCategory, string> = {
  desktop: "Checking desktop connection",
  read: "Reading files",
  image: "Viewing an image",
  edit: "Editing files",
  command: "Running a command",
  search: "Searching",
  web: "Reading a page",
  agent: "Agent working",
  plan: "Updating the plan",
  skill: "Checking skills",
  tool: "Using a tool",
};
const neutralLabels: Record<TranscriptToolCategory, string> = {
  desktop: "Desktop connection",
  read: "File read",
  image: "Image view",
  edit: "File edit",
  command: "Command",
  search: "Search",
  web: "Page read",
  agent: "Agent task",
  plan: "Plan update",
  skill: "Skill lookup",
  tool: "Tool call",
};
function neutralLabel(operation: Operation) {
  if (toolName(operation.part) === "desktop_screenshot") return "Screenshot";
  if (toolName(operation.part) === "desktop_computer_action")
    return "Desktop input";
  return neutralLabels[operation.category];
}
function activeLabel(operation: Operation) {
  if (toolName(operation.part) === "desktop_screenshot")
    return "Capturing a screenshot";
  if (toolName(operation.part) === "desktop_computer_action")
    return "Sending desktop input";
  const name = fileName(operation.part);
  if (operation.category === "read" && name) return `Reading ${name}`;
  if (operation.category === "edit" && name) return `Editing ${name}`;
  if (operation.category === "agent" && operation.agent)
    return `${operation.agent.name} working`;
  if (toolName(operation.part) === "interact_terminal_session") {
    switch (record(operation.part.input).action) {
      case "send":
        return "Sending terminal input";
      case "view":
        return "Reading terminal output";
      case "wait":
        return "Waiting for terminal output";
      case "kill":
        return "Closing terminal session";
      default:
        return "Using terminal session";
    }
  }
  return activeLabels[operation.category];
}
function completedLabel(
  category: TranscriptToolCategory,
  operations: Operation[],
) {
  const count = operations.length;
  const paths = new Set(
    operations.map((operation) => fileName(operation.part)).filter(Boolean),
  );
  const name = paths.size === 1 ? [...paths][0] : undefined;
  switch (category) {
    case "desktop":
      if (toolName(operations[0].part) === "desktop_screenshot")
        return count === 1
          ? "Captured a screenshot"
          : `Captured ${count} screenshots`;
      if (toolName(operations[0].part) === "desktop_computer_action")
        return "Sent desktop input";
      return "Checked desktop connection";
    case "read": {
      const listingOnly = operations.every((operation) =>
        [
          "list_files",
          "list_directory",
          "desktop_workspace_list",
          "desktop_workspace_list_grants",
        ].includes(toolName(operation.part)),
      );
      if (listingOnly) return "Listed files";
      return name ? `Read ${name}` : "Read files";
    }
    case "image":
      return count === 1 ? "Viewed an image" : `Viewed ${count} images`;
    case "edit":
      return name ? `Updated ${name}` : "Made file edits";
    case "command": {
      const executions = operations.filter(
        (operation) => toolName(operation.part) !== "interact_terminal_session",
      );
      const labels = executions.length
        ? [
            executions.length === 1
              ? "Ran a command"
              : `Ran ${executions.length} commands`,
          ]
        : [];
      for (const operation of operations.filter(
        (operation) => toolName(operation.part) === "interact_terminal_session",
      )) {
        const action = record(operation.part.input).action;
        const label =
          action === "send"
            ? "Sent terminal input"
            : action === "view"
              ? "Read terminal output"
              : action === "wait"
                ? "Checked terminal output"
                : action === "kill"
                  ? "Closed terminal session"
                  : "Used terminal session";
        if (!labels.includes(label)) labels.push(label);
      }
      return joinLabels(labels.map((label) => ({ label })));
    }
    case "search":
      return count === 1 ? "Searched" : `Ran ${count} searches`;
    case "web":
      return count === 1 ? "Read a page" : `Read ${count} pages`;
    case "agent": {
      const names = [
        ...new Set(
          operations.map((operation) => operation.agent?.name).filter(Boolean),
        ),
      ];
      return names.length > 0
        ? `${names.join(", ")} updated`
        : count === 1
          ? "Agent task completed"
          : "Agent tasks completed";
    }
    case "plan":
      return "Updated the plan";
    case "skill":
      return "Checked skills";
    default:
      return count === 1 ? "Used a tool" : `Used ${count} tools`;
  }
}
const joinLabels = (labels: { label: string; preserveCase?: boolean }[]) =>
  labels
    .map(({ label, preserveCase }, index) =>
      index && !preserveCase
        ? `${label[0].toLowerCase()}${label.slice(1)}`
        : label,
    )
    .join(", ");

/** Present observed tool activity only. No generated reasoning or claims inferred from briefs. */
export function summarizeTranscriptTools(
  parts: readonly TranscriptToolPart[],
  chatStatus: ChatStatus,
  isAwaitingApproval = false,
): TranscriptToolSummary {
  const operations: Operation[] = parts.filter(isTool).map((part) => ({
    part,
    category: classifyTranscriptTool(part),
    status: getTranscriptToolStatus(part, chatStatus, isAwaitingApproval),
    agent: agentIdentity(part),
  }));
  const failed = operations.filter(
    (operation) => operation.status === "failed",
  ).length;
  const denied = operations.filter(
    (operation) => operation.status === "not-approved",
  ).length;
  const interrupted = operations.some(
    (operation) => operation.status === "interrupted",
  );
  const unknown = operations.some(
    (operation) => operation.status === "unknown",
  );
  const needsSetup = operations.some(
    (operation) => operation.status === "needs-setup",
  );
  const active =
    operations.findLast(
      (operation) => operation.status === "awaiting-approval",
    ) ?? operations.findLast((operation) => operation.status === "running");
  const status: TranscriptToolStatus =
    active?.status ??
    (denied
      ? "not-approved"
      : failed
        ? "failed"
        : interrupted
          ? "interrupted"
          : needsSetup
            ? "needs-setup"
            : unknown || !operations.length
              ? "unknown"
              : "completed");
  const agents = [
    ...new Map(
      operations.flatMap((operation) =>
        operation.agent
          ? [[operation.agent.identity, operation.agent] as const]
          : [],
      ),
    ).values(),
  ];
  const category =
    active?.category ??
    operations.find((operation) => operation.category !== "tool")?.category ??
    "tool";
  const backgroundOnly =
    operations.length > 0 &&
    operations.every((operation) => {
      const output = record(operation.part.output);
      const result = record(output.result);
      return (
        operation.category === "command" &&
        operation.status === "unknown" &&
        result.outcome !== "unknown" &&
        (output.pid !== undefined || result.pid !== undefined)
      );
    });
  let label: string;
  if (active)
    label =
      active.status === "awaiting-approval"
        ? `Approve ${neutralLabel(active).toLowerCase()}`
        : activeLabel(active);
  else if (backgroundOnly)
    label =
      operations.length === 1
        ? "Started a background command"
        : "Started background commands";
  else {
    const groups = new Map<string, Operation[]>();
    for (const operation of operations) {
      // Desktop observation, input, and readiness must remain distinct actions.
      const action =
        operation.category === "desktop"
          ? toolName(operation.part)
          : operation.category;
      const key = `${action}:${operation.status}`;
      groups.set(key, [...(groups.get(key) ?? []), operation]);
    }
    label =
      joinLabels(
        [...groups.values()].map((group) => {
          const { category, status, agent } = group[0];
          const preserveCase =
            category === "agent" && group.some((operation) => operation.agent);
          if (status === "completed")
            return { label: completedLabel(category, group), preserveCase };
          const subject =
            category === "agent" && agent ? agent.name : neutralLabel(group[0]);
          if (status === "unknown")
            return { label: `${subject} output available`, preserveCase };
          if (status === "needs-setup")
            return { label: `${subject} needs setup`, preserveCase };
          return {
            label: `${subject} ${status === "not-approved" ? "not approved" : status}`,
            preserveCase,
          };
        }),
      ) || "Tool activity";
  }
  const details: string[] = [];
  if (denied) details.push(`${denied} not approved`);
  if (failed) details.push(`${failed} failed`);
  if (needsSetup) details.push("desktop setup needed");
  if (active)
    details.push(
      active.status === "awaiting-approval" ? "awaiting approval" : "running",
    );
  else if (interrupted) details.push("interrupted");
  else if (backgroundOnly) details.push("started");
  else if (unknown) details.push("completion not confirmed");
  if (!details.length)
    details.push(operations.length ? "completed" : "no completed operations");
  return {
    label,
    detail: details.join(" · "),
    failed,
    running: status === "running",
    category,
    agents,
    status,
  };
}
