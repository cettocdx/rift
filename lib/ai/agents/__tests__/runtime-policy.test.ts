import {
  normalizeAgentRosterConfiguration,
  renderAgentRosterSkillInstructions,
} from "../pet-roster";
import {
  extractAgentRuntimeRequest,
  renderActiveAgentWorkflowReminder,
  resolveActiveAgentModel,
  resolveAgentRuntimePolicy,
  resolveDelegationAgent,
} from "../runtime-policy";

function managedSkillFor(
  customAgents: Array<Record<string, unknown>>,
  teams: Array<Record<string, unknown>> = [],
) {
  const configuration = normalizeAgentRosterConfiguration({
    activeAgentId: "build-engineer",
    workflowAgentIds: ["build-engineer", "quality"],
    customAgents,
    teams,
  });
  return {
    name: "RIFT Agent Crew",
    instructions: renderAgentRosterSkillInstructions(configuration),
    scope: "app" as const,
    catalog_id: "rift-agent-roster",
  };
}

function customAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "agent-atlas",
    mention: "@agent:atlas",
    enabled: true,
    name: "Atlas",
    petId: "wolf",
    roleName: "Systems Architect",
    mission: "Own architecture decisions and return a verified delivery plan.",
    model: "build-balanced",
    reasoningEffort: "high",
    toolIds: ["file", "delegate_task"],
    mcpServerIds: ["server-owned"],
    skillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    repository: "rift-cursor",
    folder: "app",
    concurrencyLimit: 2,
    ...overrides,
  };
}

describe("server-owned agent runtime policy", () => {
  it("preserves the visible profile request across hidden auto-continue turns", () => {
    const messages = [
      {
        role: "user",
        parts: [{ type: "text", text: "@agent:atlas inspect this" }],
      },
      { role: "assistant", parts: [{ type: "text", text: "Working" }] },
      {
        role: "user",
        metadata: { isAutoContinue: true },
        parts: [{ type: "text", text: "continue" }],
      },
    ];

    expect(extractAgentRuntimeRequest(messages, true)).toBe(
      "@agent:atlas inspect this",
    );
    expect(extractAgentRuntimeRequest(messages, false)).toBe("continue");
    expect(extractAgentRuntimeRequest(messages.slice(0, 2), true)).toBe(
      "@agent:atlas inspect this",
    );
  });

  it("resolves exact mentions only against the supplied owner's managed roster", () => {
    const ownerPolicy = resolveAgentRuntimePolicy(
      [managedSkillFor([customAgent()])],
      "@agent:atlas review this change",
    );
    const otherOwnerPolicy = resolveAgentRuntimePolicy(
      [
        managedSkillFor([
          customAgent({
            id: "agent-boreal",
            mention: "@agent:boreal",
            name: "Boreal",
          }),
        ]),
      ],
      "@agent:atlas review this change",
    );

    expect(ownerPolicy.activeAgentId).toBe("agent-atlas");
    expect(resolveDelegationAgent(ownerPolicy, "agent-atlas")?.name).toBe(
      "Atlas",
    );
    expect(otherOwnerPolicy.activeAgentId).toBeUndefined();
    expect(resolveDelegationAgent(otherOwnerPolicy, "agent-atlas")).toBeNull();
  });

  it("does not accept disabled, unknown, or prefix-matched profiles", () => {
    const skill = managedSkillFor([
      customAgent({ enabled: false }),
      customAgent({
        id: "agent-aria",
        mention: "@agent:aria",
        name: "Aria",
      }),
    ]);
    const policy = resolveAgentRuntimePolicy(
      [skill],
      "@agent:aria-extra and @agent:atlas",
    );

    expect(policy.activeAgentId).toBeUndefined();
    expect(resolveDelegationAgent(policy, "agent-atlas")).toBeNull();
    expect(resolveDelegationAgent(policy, "agent-unknown")).toBeNull();
    expect(resolveDelegationAgent(policy, "agent-aria")?.name).toBe("Aria");
  });

  it.each([
    "@agent:aria_extra",
    "@agent:aria.extra",
    "@agent:aria-",
    "foo@agent:aria.com",
  ])("does not activate an identifier prefix inside %s", (request) => {
    const policy = resolveAgentRuntimePolicy(
      [managedSkillFor([customAgent({ mention: "@agent:aria" })])],
      request,
    );

    expect(policy.activeAgentId).toBeUndefined();
  });

  it("fails closed for unresolved explicit mentions when the roster read is unavailable", () => {
    const unavailable = resolveAgentRuntimePolicy(
      [],
      "@agent:atlas inspect this",
      { rosterAvailable: false },
    );
    const builtin = resolveAgentRuntimePolicy([], "@agent:forge inspect this", {
      rosterAvailable: false,
    });

    expect(unavailable.source).toBe("roster-unavailable");
    expect(unavailable.failClosed).toBe(true);
    expect(unavailable.delegationAgentIds).toEqual([]);
    expect(builtin.failClosed).toBe(false);
    expect(builtin.activeAgentId).toBe("build-engineer");
  });

  it("limits an explicitly mentioned team to its enabled owned members", () => {
    const skill = managedSkillFor(
      [
        customAgent(),
        customAgent({
          id: "agent-patch",
          mention: "@agent:patch",
          name: "Patch",
        }),
      ],
      [
        {
          id: "team-delivery",
          mention: "@team:delivery",
          enabled: true,
          name: "Delivery",
          leadAgentId: "agent-atlas",
          memberAgentIds: ["agent-atlas", "quality"],
          finalReviewerAgentId: "quality",
        },
      ],
    );
    const policy = resolveAgentRuntimePolicy(
      [skill],
      "@agent:patch @team:delivery ship the change",
    );

    expect(policy.activeAgentId).toBe("agent-atlas");
    expect(policy.delegationAgentIds).toEqual(["agent-atlas", "quality"]);
    expect(resolveDelegationAgent(policy, "agent-patch")).toBeNull();
    expect(resolveDelegationAgent(policy, "quality")?.role).toBe("reviewer");

    const reminder = renderActiveAgentWorkflowReminder(policy, {
      persistentMention: "@team:delivery",
    });
    expect(reminder).toContain(
      "persistent Build-project workflow @team:delivery",
    );
    expect(reminder).toContain(
      "call delegate_task with the exact authorized id",
    );
    expect(reminder).toContain("@agent:atlas (id=agent-atlas)");
    expect(reminder).toContain("@agent:probe (id=quality)");
    expect(reminder).toContain("Final reviewer: @agent:probe (id=quality)");
  });

  it("renders an enforceable selected-agent contract without inventing participation", () => {
    const policy = resolveAgentRuntimePolicy(
      [managedSkillFor([customAgent()])],
      "@agent:atlas build the page",
    );

    expect(renderActiveAgentWorkflowReminder(policy)).toContain(
      "server-enforced model, reasoning effort, tool allowlist, MCP allowlist",
    );
    expect(renderActiveAgentWorkflowReminder(policy)).toContain(
      "Never claim a separate delegate ran without a real delegate_task result",
    );

    const unavailable = resolveAgentRuntimePolicy(
      [],
      "@agent:unknown build the page",
      { rosterAvailable: false },
    );
    expect(renderActiveAgentWorkflowReminder(unavailable)).toContain(
      "Do not claim that any agent or team participated",
    );
  });

  it("applies only a validated Build model and preserves auto or invalid values", () => {
    const selected = resolveAgentRuntimePolicy(
      [managedSkillFor([customAgent({ model: "build-fable" })])],
      "@agent:atlas implement it",
    );
    const automatic = resolveAgentRuntimePolicy(
      [managedSkillFor([customAgent({ model: "auto" })])],
      "@agent:atlas implement it",
    );
    const staleAutomatic = resolveAgentRuntimePolicy(
      [
        managedSkillFor([
          customAgent({ model: "auto", reasoningEffort: "max" }),
        ]),
      ],
      "@agent:atlas implement it",
    );

    expect(resolveActiveAgentModel(selected, "model-gpt-5.6-sol")).toBe(
      "model-fable-5.1",
    );
    expect(resolveDelegationAgent(selected, "agent-atlas")).toMatchObject({
      modelKey: "model-fable-5.1",
      reasoningEffort: "high",
      concurrencyLimit: 2,
    });
    expect(resolveActiveAgentModel(automatic, "model-gpt-5.6-sol")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(
      resolveDelegationAgent(automatic, "agent-atlas", "model-fable-5.1"),
    ).toMatchObject({
      modelKey: "model-fable-5.1",
      modelLabel: "Claude Fable 5.1",
    });
    expect(
      resolveDelegationAgent(staleAutomatic, "agent-atlas", "model-grok-4.6"),
    ).toMatchObject({
      modelKey: "model-grok-4.6",
      reasoningEffort: "high",
    });
  });
});
