import type {
  AgentApprovalPolicy,
  AgentAutonomy,
  AgentEscalationPolicy,
  AgentPermissionPreset,
  CustomAgentProfileConfig,
} from "./pet-roster";

/**
 * What an agent can actually do, derived from the rules the runtime enforces.
 *
 * The editor showed the form back to the reader: the fields they had just set,
 * restated. That answers "what did I choose", not "what will this agent be able
 * to do" -- and those differ, because the runtime narrows a profile in ways the
 * form never mentions. A read-only profile cannot reach a tool it has ticked;
 * an MCP server's tools arrive only if that server is selected; some control
 * tools are always present whatever the profile says.
 *
 * Every entry here is derived from an enforcement point in the runtime, not
 * from the shape of the form. When the runtime changes, this must change with
 * it -- there is a test that reads the runtime's own allowlist to keep them
 * honest.
 */

/** Tools every run gets regardless of profile, because they gate the run. */
export const ALWAYS_AVAILABLE_BUILD_TOOL_IDS = ["find_skills"] as const;

export type PermissionEnforcement =
  /** The runtime enforces this. A person cannot talk the agent out of it. */
  | "enforced"
  /** Guidance in the prompt. The model usually follows it; nothing stops it. */
  | "advisory";

export type EffectivePermissionLine = {
  label: string;
  value: string;
  enforcement: PermissionEnforcement;
  /** Why it resolves this way, when the value alone would surprise a reader. */
  note?: string;
};

export type EffectivePermissions = {
  /** Tool ids the agent will actually be offered. */
  grantedToolIds: string[];
  /**
   * Tools the profile selected that the runtime will still withhold. Showing
   * these is the point: a ticked box that does nothing is a lie.
   */
  withheldToolIds: string[];
  filesystem: EffectivePermissionLine;
  network: EffectivePermissionLine;
  concurrency: EffectivePermissionLine;
  escalation: EffectivePermissionLine;
  approval: EffectivePermissionLine;
  autonomy: EffectivePermissionLine;
};

const FILESYSTEM_BY_PRESET: Record<
  AgentPermissionPreset,
  { value: string; note: string }
> = {
  "read-only": {
    value: "Read only",
    note: "Write, edit and delete actions are removed from the tool set, not merely discouraged.",
  },
  "workspace-write": {
    value: "Read and write inside the workspace",
    note: "Paths outside the workspace root are refused by the sandbox regardless of this setting.",
  },
  trusted: {
    value: "Read and write inside the workspace",
    note: "Trusted raises autonomy, not the filesystem boundary: the sandbox root still bounds every path.",
  },
};

const ESCALATION_LABEL: Record<AgentEscalationPolicy, string> = {
  "when-blocked": "Ask when blocked",
  "risk-or-blocked": "Ask on risk or when blocked",
  "before-every-action": "Ask before every action",
};

const APPROVAL_LABEL: Record<AgentApprovalPolicy, string> = {
  always: "Every action needs approval",
  "risky-actions": "Risky actions need approval",
  "on-escalation": "Approval only when the agent escalates",
};

const AUTONOMY_LABEL: Record<AgentAutonomy, string> = {
  guided: "Guided — checks in often",
  balanced: "Balanced",
  autonomous: "Autonomous — proceeds on its own",
};

export function resolveEffectivePermissions({
  profile,
  readOnlyBaseToolIds,
  availableMcpToolIdsByServer,
  purpose = "app",
}: {
  profile: Pick<
    CustomAgentProfileConfig,
    | "permissionPreset"
    | "toolIds"
    | "mcpServerIds"
    | "concurrencyLimit"
    | "escalationPolicy"
    | "approvalPolicy"
    | "autonomy"
  >;
  /** The runtime's own read-only allowlist. Passed in so it cannot drift. */
  readOnlyBaseToolIds: ReadonlySet<string>;
  /** Tool ids each connected MCP server contributes. */
  availableMcpToolIdsByServer?: Record<string, readonly string[]>;
  purpose?: string;
}): EffectivePermissions {
  const selected = new Set(profile.toolIds);
  const readOnly = profile.permissionPreset === "read-only";

  const mcpToolIds = new Set(
    profile.mcpServerIds.flatMap(
      (serverId) => availableMcpToolIdsByServer?.[serverId] ?? [],
    ),
  );

  const mandatory =
    purpose === "app" ? new Set<string>(ALWAYS_AVAILABLE_BUILD_TOOL_IDS) : new Set<string>();

  const granted = new Set<string>(mandatory);
  const withheld: string[] = [];

  for (const toolId of selected) {
    if (mandatory.has(toolId)) continue;
    // A read-only profile can only reach tools on the runtime's allowlist,
    // however many boxes were ticked.
    if (readOnly && !readOnlyBaseToolIds.has(toolId)) {
      withheld.push(toolId);
      continue;
    }
    granted.add(toolId);
  }

  for (const toolId of mcpToolIds) granted.add(toolId);

  return {
    grantedToolIds: [...granted].sort(),
    withheldToolIds: withheld.sort(),
    filesystem: {
      label: "Filesystem",
      value: FILESYSTEM_BY_PRESET[profile.permissionPreset].value,
      enforcement: "enforced",
      note: FILESYSTEM_BY_PRESET[profile.permissionPreset].note,
    },
    network: {
      label: "Network",
      value:
        mcpToolIds.size > 0 || granted.has("web_search") || granted.has("browse_url")
          ? "Outbound requests allowed through granted tools"
          : "No network tools granted",
      enforcement: "enforced",
      note: "Network access follows the tools above; there is no separate switch.",
    },
    concurrency: {
      label: "Concurrency",
      value:
        profile.concurrencyLimit > 0
          ? `${profile.concurrencyLimit} parallel ${profile.concurrencyLimit === 1 ? "task" : "tasks"}`
          : "Unlimited",
      enforcement: "enforced",
    },
    escalation: {
      label: "Escalation",
      value: ESCALATION_LABEL[profile.escalationPolicy],
      // Nothing in the runtime stops a model from pressing on; this shapes the
      // prompt. Calling it enforced would be the kind of claim this replaces.
      enforcement: "advisory",
      note: "Guidance in the agent's instructions. It is not a hard stop.",
    },
    approval: {
      label: "Approval",
      value: APPROVAL_LABEL[profile.approvalPolicy],
      enforcement: "advisory",
      note: "Guidance in the agent's instructions. It is not a hard stop.",
    },
    autonomy: {
      label: "Autonomy",
      value: AUTONOMY_LABEL[profile.autonomy],
      enforcement: "advisory",
    },
  };
}

// ---------------------------------------------------------------------------
// Run metrics
// ---------------------------------------------------------------------------

/**
 * How many finished runs an agent needs before a success rate means anything.
 *
 * Below this the number is noise that reads as fact: one failed run out of one
 * is "0% success", which tells a reader something false about the agent.
 */
export const MIN_RUNS_FOR_SUCCESS_RATE = 5;

export type AgentRunMetrics =
  | {
      sufficient: true;
      runCount: number;
      successRate: number;
      averageCostDollars?: number;
      averageDurationMs?: number;
    }
  | {
      sufficient: false;
      runCount: number;
      /** How many more runs are needed, so the UI can say it. */
      runsRequired: number;
    };

export function summarizeAgentRuns(
  runs: ReadonlyArray<{
    status: string;
    started_at: number;
    ended_at?: number;
    cost_dollars?: number;
  }>,
): AgentRunMetrics {
  // A cancelled run says nothing about whether the agent works -- the user
  // stopped it. Counting it as a failure would punish an agent for being
  // interrupted.
  const attributable = runs.filter(
    (run) => run.status !== "cancelled" && run.ended_at !== undefined,
  );

  if (attributable.length < MIN_RUNS_FOR_SUCCESS_RATE) {
    return {
      sufficient: false,
      runCount: attributable.length,
      runsRequired: MIN_RUNS_FOR_SUCCESS_RATE - attributable.length,
    };
  }

  const succeeded = attributable.filter(
    (run) => run.status === "completed" || run.status === "completed_with_warnings",
  ).length;

  const costs = attributable
    .map((run) => run.cost_dollars)
    .filter((value): value is number => typeof value === "number");

  const durations = attributable
    .map((run) =>
      run.ended_at !== undefined ? run.ended_at - run.started_at : undefined,
    )
    .filter((value): value is number => typeof value === "number");

  return {
    sufficient: true,
    runCount: attributable.length,
    successRate: succeeded / attributable.length,
    averageCostDollars:
      costs.length > 0
        ? costs.reduce((sum, value) => sum + value, 0) / costs.length
        : undefined,
    averageDurationMs:
      durations.length > 0
        ? durations.reduce((sum, value) => sum + value, 0) / durations.length
        : undefined,
  };
}
