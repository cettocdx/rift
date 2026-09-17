import {
  resolveEffectivePermissions,
  summarizeAgentRuns,
  MIN_RUNS_FOR_SUCCESS_RATE,
  ALWAYS_AVAILABLE_BUILD_TOOL_IDS,
} from "../effective-permissions";
import { READ_ONLY_AGENT_BASE_TOOL_IDS } from "../read-only-tools";

const profile = (overrides: Record<string, unknown> = {}) =>
  ({
    permissionPreset: "workspace-write",
    toolIds: ["file", "run_terminal_cmd"],
    mcpServerIds: [],
    concurrencyLimit: 2,
    escalationPolicy: "when-blocked",
    approvalPolicy: "risky-actions",
    autonomy: "balanced",
    ...overrides,
  }) as never;

const resolve = (overrides: Record<string, unknown> = {}, extra = {}) =>
  resolveEffectivePermissions({
    profile: profile(overrides),
    readOnlyBaseToolIds: READ_ONLY_AGENT_BASE_TOOL_IDS,
    ...extra,
  });

describe("what an agent can actually do", () => {
  it("shows tools a read-only profile selected but will never reach", () => {
    // A ticked box that does nothing is the lie this panel exists to expose.
    const result = resolve({
      permissionPreset: "read-only",
      toolIds: ["file", "run_terminal_cmd", "web_search"],
    });

    expect(result.grantedToolIds).toContain("file");
    expect(result.grantedToolIds).toContain("web_search");
    expect(result.grantedToolIds).not.toContain("run_terminal_cmd");
    expect(result.withheldToolIds).toEqual(["run_terminal_cmd"]);
  });

  it("withholds nothing when the preset does not narrow the selection", () => {
    const result = resolve();
    expect(result.withheldToolIds).toEqual([]);
    expect(result.grantedToolIds).toContain("run_terminal_cmd");
  });

  it("always includes the control tools a Build run cannot start without", () => {
    const result = resolve({ toolIds: [] });
    for (const toolId of ALWAYS_AVAILABLE_BUILD_TOOL_IDS) {
      expect(result.grantedToolIds).toContain(toolId);
    }
  });

  it("adds the tools a selected MCP server contributes", () => {
    const result = resolve(
      { mcpServerIds: ["srv-1"] },
      { availableMcpToolIdsByServer: { "srv-1": ["mcp_github_list_prs"] } },
    );
    expect(result.grantedToolIds).toContain("mcp_github_list_prs");
  });

  it("ignores an MCP server the profile did not select", () => {
    const result = resolve(
      { mcpServerIds: [] },
      { availableMcpToolIdsByServer: { "srv-1": ["mcp_github_list_prs"] } },
    );
    expect(result.grantedToolIds).not.toContain("mcp_github_list_prs");
  });

  it("separates what the runtime enforces from what it merely advises", () => {
    // Escalation and approval shape the prompt; nothing stops a model from
    // pressing on. Presenting them as enforced would be the same class of
    // false assurance as a hardcoded AUTHORIZED badge.
    const result = resolve();
    expect(result.filesystem.enforcement).toBe("enforced");
    expect(result.concurrency.enforcement).toBe("enforced");
    expect(result.escalation.enforcement).toBe("advisory");
    expect(result.approval.enforcement).toBe("advisory");
  });

  it("does not claim trusted widens the filesystem boundary", () => {
    // Trusted raises autonomy. The sandbox root still bounds every path, and
    // saying otherwise would invite a dangerous assumption.
    const trusted = resolve({ permissionPreset: "trusted" });
    expect(trusted.filesystem.value).toContain("workspace");
    expect(trusted.filesystem.note).toContain("still bounds");
  });

  it("says plainly when no network tool was granted", () => {
    const result = resolve({ toolIds: ["file"] });
    expect(result.network.value).toBe("No network tools granted");
  });
});

describe("run metrics stay silent until they mean something", () => {
  const run = (status: string, overrides: Record<string, unknown> = {}) => ({
    status,
    started_at: 1000,
    ended_at: 3000,
    ...overrides,
  });

  it("reports how many more runs are needed instead of a misleading rate", () => {
    // One failure out of one is "0% success", which tells a reader something
    // false about the agent.
    const metrics = summarizeAgentRuns([run("failed")]);
    expect(metrics.sufficient).toBe(false);
    if (!metrics.sufficient) {
      expect(metrics.runCount).toBe(1);
      expect(metrics.runsRequired).toBe(MIN_RUNS_FOR_SUCCESS_RATE - 1);
    }
  });

  it("computes a rate once there is enough data", () => {
    const runs = [
      run("completed"),
      run("completed"),
      run("completed"),
      run("completed_with_warnings"),
      run("failed"),
    ];
    const metrics = summarizeAgentRuns(runs);
    expect(metrics.sufficient).toBe(true);
    if (metrics.sufficient) {
      expect(metrics.successRate).toBeCloseTo(0.8);
      expect(metrics.runCount).toBe(5);
    }
  });

  it("does not count a cancelled run against the agent", () => {
    // The user stopped it. Counting that as a failure punishes an agent for
    // being interrupted.
    const runs = [
      run("completed"),
      run("completed"),
      run("completed"),
      run("completed"),
      run("completed"),
      run("cancelled"),
    ];
    const metrics = summarizeAgentRuns(runs);
    expect(metrics.sufficient).toBe(true);
    if (metrics.sufficient) {
      expect(metrics.runCount).toBe(5);
      expect(metrics.successRate).toBe(1);
    }
  });

  it("ignores a run that has not finished", () => {
    const runs = Array.from({ length: 5 }, () => run("completed"));
    const metrics = summarizeAgentRuns([
      ...runs,
      { status: "running", started_at: 1000 },
    ]);
    if (metrics.sufficient) expect(metrics.runCount).toBe(5);
  });

  it("omits an average it has no data for", () => {
    const runs = Array.from({ length: 5 }, () => run("completed"));
    const metrics = summarizeAgentRuns(runs);
    if (metrics.sufficient) {
      expect(metrics.averageCostDollars).toBeUndefined();
      expect(metrics.averageDurationMs).toBe(2000);
    }
  });
});

describe("the panel and the runtime cannot drift apart", () => {
  it("derives read-only grants from the runtime's own allowlist", () => {
    // If the runtime adds or removes a read-only tool, this follows it. A
    // hand-copied list would silently start lying.
    for (const toolId of READ_ONLY_AGENT_BASE_TOOL_IDS) {
      const result = resolve({
        permissionPreset: "read-only",
        toolIds: [toolId],
      });
      expect(result.withheldToolIds).toEqual([]);
    }
  });
});
