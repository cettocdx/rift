import {
  AGENT_PET_CATALOG,
  AGENT_PET_ROSTER,
  AGENT_ROSTER_LIMITS,
  DEFAULT_AGENT_ROSTER_SELECTION,
  MANAGED_AGENT_ROSTER_SKILL_ID,
  MANAGED_AGENT_ROSTER_SKILL_NAME,
  MAX_MANAGED_AGENT_ROSTER_INSTRUCTIONS_CHARS,
  normalizeAgentRosterConfiguration,
  normalizeAgentRosterSelection,
  parseAgentRosterConfiguration,
  parseAgentRosterSkillInstructions,
  renderAgentRosterSkillInstructions,
  serializeAgentRosterConfiguration,
} from "../pet-roster";
import { buildSkillsReminder } from "@/lib/ai/skills/inject-skills";

const REAL_LOCAL_SKILL_IDS = new Set([
  "pentest-report",
  "recon-methodology",
  "web-vuln-hunting",
  "ctf-playbook",
  "react-best-practices",
  "landing-page",
  "browser-game",
  "photorealistic",
  "logo-icon",
  "brand-voice",
  "sql-data",
  "concise-expert",
  "ui-ux-pro-max",
  "design-taste-frontend",
]);

function customAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: "architect",
    mention: "@agent:architect",
    enabled: true,
    name: "Atlas",
    petId: "wolf",
    roleName: "Systems Architect",
    mission: "Define boundaries and deliver an executable implementation plan.",
    communicationStyle: "Concise, decisive, and evidence-led.",
    autonomy: "balanced",
    permissionPreset: "workspace-write",
    model: "auto",
    reasoningEffort: "high",
    toolIds: ["file", "run_terminal_cmd", "delegate_task", "todo_write"],
    mcpServerIds: ["github", "linear"],
    skillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    skillAssignment: "manual",
    repository: "rift-cursor",
    folder: "app",
    memory: {
      enabled: true,
      scope: "repository",
      instructions:
        "Remember architecture decisions and verification evidence.",
    },
    concurrencyLimit: 2,
    escalationPolicy: "risk-or-blocked",
    approvalPolicy: "risky-actions",
    ...overrides,
  };
}

describe("RIFT agent pet roster", () => {
  it("keeps the six legacy specialists stable and exposes the full pet catalog", () => {
    expect(AGENT_PET_ROSTER).toHaveLength(6);
    expect(new Set(AGENT_PET_ROSTER.map((agent) => agent.id))).toHaveProperty(
      "size",
      6,
    );

    const expectedCatalogIds = [
      "dog",
      "border-collie",
      "golden-retriever",
      "german-shepherd",
      "cat",
      "black-cat",
      "fox",
      "owl",
      "raven",
      "wolf",
      "turtle",
      "beaver",
      "otter",
      "octopus",
      "parrot",
      "chameleon",
      "rabbit",
      "elephant",
      "hawk",
      "dolphin",
      "panda",
      "hedgehog",
      "shiba",
      "corgi",
      "penguin",
      "raccoon",
      "horse",
      "bee",
      "gecko",
    ];
    expect(AGENT_PET_CATALOG.map((pet) => pet.id)).toEqual(expectedCatalogIds);

    const visualPresets = new Set(AGENT_PET_ROSTER.map((agent) => agent.id));
    for (const pet of AGENT_PET_CATALOG) {
      expect(pet.roleName).toBeTruthy();
      expect(pet.mission.length).toBeGreaterThan(30);
      expect(pet.description.length).toBeGreaterThan(30);
      expect(pet.suggestedSkillIds).toHaveLength(4);
      expect(visualPresets.has(pet.visualPreset)).toBe(true);
      for (const skillId of pet.suggestedSkillIds) {
        expect(REAL_LOCAL_SKILL_IDS.has(skillId)).toBe(true);
      }
    }
  });

  it("migrates persisted v1 selections to v2 without changing their crew", () => {
    const migrated = normalizeAgentRosterSelection({
      version: 1,
      activeAgentId: "product-designer",
      workflowAgentIds: ["quality", "unknown-agent", "quality"],
    });

    expect(migrated).toEqual({
      version: 2,
      activeAgentId: "product-designer",
      workflowAgentIds: ["product-designer", "quality"],
      customAgents: [],
      teams: [],
    });

    const legacyInstructions = `<rift_agent_roster_config>{"version":1,"activeAgentId":"video-director","workflowAgentIds":["marketing","quality"]}</rift_agent_roster_config>\n<rift_agent_crew>legacy</rift_agent_crew>`;
    expect(parseAgentRosterConfiguration(legacyInstructions)).toEqual({
      version: 2,
      activeAgentId: "video-director",
      workflowAgentIds: ["video-director", "marketing", "quality"],
      customAgents: [],
      teams: [],
    });
    expect(normalizeAgentRosterSelection(null)).toEqual(
      DEFAULT_AGENT_ROSTER_SELECTION,
    );
  });

  it("normalizes untrusted input with safe ids, enums, counts, and strings", () => {
    const repeatedAgents = Array.from(
      { length: AGENT_ROSTER_LIMITS.customAgents + 3 },
      (_, index) =>
        customAgent({
          id: "duplicate id<script>",
          mention: "@agent:Same Agent",
          name: `<b>${"x".repeat(100)}</b>`,
          petId: index === 0 ? "not-a-pet" : "gecko",
          roleName: "r".repeat(200),
          mission: `<rift_agent_crew>${"m".repeat(400)}`,
          autonomy: "unbounded",
          permissionPreset: "root",
          model: "m".repeat(120),
          reasoningEffort: "extreme",
          toolIds: Array.from({ length: 30 }, (_, tool) => `tool ${tool}`),
          mcpServerIds: [
            "github primary",
            "github primary",
            ...Array.from(
              { length: 20 },
              (_, server) => `mcp server ${server}`,
            ),
          ],
          skillIds: ["one", "one", 4, null],
          skillAssignment: "guess",
          repository: "r".repeat(300),
          folder: "f".repeat(300),
          memory: {
            enabled: "yes",
            scope: "global",
            instructions: `<bad>${"n".repeat(300)}`,
          },
          concurrencyLimit: 99,
          escalationPolicy: "never",
          approvalPolicy: "never",
        }),
    );

    const normalized = normalizeAgentRosterConfiguration({
      version: 987,
      activeAgentId: "unknown",
      workflowAgentIds: ["quality", "quality", "bad"],
      customAgents: repeatedAgents,
      teams: [],
    });

    expect(normalized.version).toBe(2);
    expect(normalized.activeAgentId).toBe("build-engineer");
    expect(normalized.workflowAgentIds).toEqual(["build-engineer", "quality"]);
    expect(normalized.customAgents).toHaveLength(
      AGENT_ROSTER_LIMITS.customAgents,
    );
    expect(new Set(normalized.customAgents.map((agent) => agent.id)).size).toBe(
      AGENT_ROSTER_LIMITS.customAgents,
    );
    expect(
      new Set(normalized.customAgents.map((agent) => agent.mention)).size,
    ).toBe(AGENT_ROSTER_LIMITS.customAgents);

    const first = normalized.customAgents[0];
    expect(first.petId).toBe("dog");
    expect(first.id).toMatch(/^agent-[a-z0-9-]+$/);
    expect(first.mention).toMatch(/^@agent:[a-z0-9-]+$/);
    expect(first.name).not.toMatch(/[<>]/);
    expect(first.name.length).toBeLessThanOrEqual(
      AGENT_ROSTER_LIMITS.nameChars,
    );
    expect(first.roleName.length).toBeLessThanOrEqual(
      AGENT_ROSTER_LIMITS.roleChars,
    );
    expect(first.mission.length).toBeLessThanOrEqual(
      AGENT_ROSTER_LIMITS.missionChars,
    );
    expect(first.autonomy).toBe("balanced");
    expect(first.permissionPreset).toBe("workspace-write");
    expect(first.reasoningEffort).toBe("medium");
    expect(first.toolIds).toHaveLength(AGENT_ROSTER_LIMITS.toolsPerAgent);
    expect(first.mcpServerIds).toHaveLength(
      AGENT_ROSTER_LIMITS.mcpServersPerAgent,
    );
    expect(first.mcpServerIds[0]).toBe("github-primary");
    expect(first.skillIds).toHaveLength(AGENT_ROSTER_LIMITS.minSkillsPerAgent);
    expect(first.concurrencyLimit).toBe(AGENT_ROSTER_LIMITS.concurrency);
    expect(first.memory).toEqual(
      expect.objectContaining({ enabled: true, scope: "repository" }),
    );
    expect(first.escalationPolicy).toBe("risk-or-blocked");
    expect(first.approvalPolicy).toBe("risky-actions");
  });

  it("clamps imported profile efforts to each explicit Build model", () => {
    const normalized = normalizeAgentRosterConfiguration({
      activeAgentId: "build-engineer",
      workflowAgentIds: ["build-engineer"],
      customAgents: [
        customAgent({
          id: "grok-profile",
          mention: "@agent:grok-profile",
          model: "build-grok",
          reasoningEffort: "max",
        }),
        customAgent({
          id: "codex-profile",
          mention: "@agent:codex-profile",
          model: "build-codex",
          reasoningEffort: "max",
        }),
        customAgent({
          id: "kimi-profile",
          mention: "@agent:kimi-profile",
          model: "build-kimi",
          reasoningEffort: "medium",
        }),
        customAgent({
          id: "qwen-profile",
          mention: "@agent:qwen-profile",
          model: "build-qwen",
          reasoningEffort: "high",
        }),
      ],
      teams: [],
    });

    expect(
      normalized.customAgents.map(({ model, reasoningEffort }) => ({
        model,
        reasoningEffort,
      })),
    ).toEqual([
      { model: "build-grok", reasoningEffort: "high" },
      { model: "build-codex", reasoningEffort: "max" },
      { model: "build-kimi", reasoningEffort: "max" },
      { model: "build-qwen", reasoningEffort: "on" },
    ]);
  });

  it("enforces four-to-eight unique selected skills in auto and manual modes", () => {
    const normalized = normalizeAgentRosterConfiguration({
      activeAgentId: "build-engineer",
      workflowAgentIds: ["build-engineer"],
      customAgents: [
        customAgent({
          id: "sparse",
          petId: "german-shepherd",
          skillAssignment: "auto",
          skillIds: ["pentest-report", "pentest-report"],
        }),
        customAgent({
          id: "full",
          skillAssignment: "manual",
          skillIds: Array.from({ length: 20 }, (_, index) => `custom-${index}`),
        }),
      ],
      teams: [],
    });

    expect(normalized.customAgents[0].skillIds).toEqual([
      "pentest-report",
      "recon-methodology",
      "web-vuln-hunting",
      "ctf-playbook",
    ]);
    expect(normalized.customAgents[1].skillIds).toHaveLength(
      AGENT_ROSTER_LIMITS.maxSkillsPerAgent,
    );
    expect(new Set(normalized.customAgents[1].skillIds).size).toBe(
      AGENT_ROSTER_LIMITS.maxSkillsPerAgent,
    );
  });

  it("repairs team members, leads, reviewers, duplicates, and count limits", () => {
    const normalized = normalizeAgentRosterConfiguration({
      activeAgentId: "quality",
      workflowAgentIds: ["quality"],
      customAgents: [
        customAgent({ id: "alpha", mention: "@agent:alpha", name: "Alpha" }),
        customAgent({ id: "beta", mention: "@agent:beta", name: "Beta" }),
        customAgent({
          id: "disabled",
          mention: "@agent:disabled",
          name: "Disabled",
          enabled: false,
        }),
      ],
      teams: [
        {
          id: "delivery",
          mention: "@team:delivery",
          name: "Delivery",
          goal: "Ship and verify the feature.",
          leadAgentId: "missing",
          memberAgentIds: [
            "alpha",
            "alpha",
            "missing",
            "disabled",
            "marketing",
            "beta",
          ],
          finalReviewerAgentId: "missing",
          completionCriteria: [],
        },
        {
          id: "review",
          mention: "@team:delivery",
          name: "Review",
          leadAgentId: "quality",
          memberAgentIds: ["alpha"],
          finalReviewerAgentId: "alpha",
        },
        ...Array.from({ length: 8 }, (_, index) => ({
          id: `extra-${index}`,
          name: `Extra ${index}`,
        })),
      ],
    });

    expect(normalized.teams).toHaveLength(AGENT_ROSTER_LIMITS.teams);
    expect(normalized.teams[0]).toEqual(
      expect.objectContaining({
        leadAgentId: "agent-alpha",
        memberAgentIds: ["agent-alpha", "agent-beta"],
        finalReviewerAgentId: "agent-alpha",
        completionCriteria: [
          "All requested outcomes are implemented and verified.",
        ],
      }),
    );
    expect(normalized.teams[1]).toEqual(
      expect.objectContaining({
        leadAgentId: "quality",
        memberAgentIds: ["quality", "agent-alpha"],
        finalReviewerAgentId: "agent-alpha",
        mention: "@team:delivery-2",
      }),
    );
  });

  it("round-trips normalized v2 configuration through JSON and instructions", () => {
    const configuration = normalizeAgentRosterConfiguration({
      version: 2,
      activeAgentId: "video-director",
      workflowAgentIds: ["video-director", "marketing", "quality"],
      customAgents: [customAgent()],
      teams: [
        {
          id: "launch",
          mention: "@team:launch",
          enabled: true,
          name: "Launch",
          goal: "Prepare and verify a release.",
          leadAgentId: "architect",
          memberAgentIds: ["architect", "marketing", "quality"],
          sharedSkillIds: ["brand-voice", "concise-expert"],
          routing: "parallel",
          handoff: "explicit",
          escalationPolicy: "when-blocked",
          finalReviewerAgentId: "quality",
          completionCriteria: [
            "The release path passes its checks.",
            "Customer-facing copy is reviewed.",
          ],
        },
      ],
    });
    const serialized = serializeAgentRosterConfiguration(configuration);
    const instructions = renderAgentRosterSkillInstructions(configuration);

    expect(normalizeAgentRosterConfiguration(JSON.parse(serialized))).toEqual(
      configuration,
    );
    expect(parseAgentRosterConfiguration(instructions)).toEqual(configuration);
    expect(parseAgentRosterSkillInstructions(instructions)).toEqual(
      configuration,
    );
    expect(instructions).not.toMatch(/[—–]/);
  });

  it("parses pre-MCP compact v2 tuples without shifting positional fields", () => {
    const oldCompactPayload = {
      v: 2,
      a: "build-engineer",
      w: ["build-engineer"],
      c: [
        [
          "agent-legacy",
          "@agent:legacy",
          true,
          "Legacy",
          "dog",
          "Generalist Engineer",
          "Deliver the requested change and verify it.",
          "Concise and evidence-led.",
          "balanced",
          "workspace-write",
          "auto",
          "medium",
          ["file", "run_terminal_cmd"],
          [
            "react-best-practices",
            "concise-expert",
            "sql-data",
            "ui-ux-pro-max",
          ],
          "manual",
          "rift-cursor",
          ".",
          [true, "repository", "Remember verified decisions."],
          1,
          "risk-or-blocked",
          "risky-actions",
        ],
      ],
      t: [],
    };
    const instructions = `<rift_agent_roster_config>${JSON.stringify(oldCompactPayload)}</rift_agent_roster_config>\n<rift_agent_crew>legacy v2</rift_agent_crew>`;
    const parsed = parseAgentRosterConfiguration(instructions);

    expect(parsed?.customAgents[0]).toEqual(
      expect.objectContaining({
        id: "agent-legacy",
        toolIds: ["file", "run_terminal_cmd"],
        skillAssignment: "manual",
        approvalPolicy: "risky-actions",
        mcpServerIds: [],
      }),
    );
  });

  it("renders exact agent/team mentions and executable delegation constraints", () => {
    const configuration = normalizeAgentRosterConfiguration({
      activeAgentId: "build-engineer",
      workflowAgentIds: ["build-engineer", "quality"],
      customAgents: [
        customAgent({
          mention: "@agent:architect",
          permissionPreset: "read-only",
          approvalPolicy: "always",
          mcpServerIds: ["github-primary", "linear-workspace"],
        }),
        customAgent({
          id: "implementer",
          mention: "@agent:implementer",
          name: "Patch",
        }),
      ],
      teams: [
        {
          id: "launch",
          mention: "@team:launch",
          name: "Launch Team",
          goal: "Deliver the release.",
          leadAgentId: "architect",
          memberAgentIds: ["architect", "implementer", "quality"],
          routing: "parallel",
          handoff: "lead-mediated",
          escalationPolicy: "risk-or-blocked",
          finalReviewerAgentId: "quality",
          completionCriteria: ["Tests and runtime verification pass."],
        },
      ],
    });
    const instructions = renderAgentRosterSkillInstructions(configuration);

    expect(instructions).toContain("@agent:architect");
    expect(instructions).toContain("@agent:implementer");
    expect(instructions).toContain("@team:launch");
    expect(instructions).toContain("mcp=github-primary,linear-workspace");
    expect(instructions).toContain(
      "the server intersects its tool and exact MCP-id allowlists",
    );
    expect(instructions).toContain(
      "uses delegate_task with each named non-lead participant's exact id",
    );
    expect(instructions).toContain("Run independent delegations in parallel");
    expect(instructions).toContain(
      "Read-only: inspect and advise; do not write files",
    );
    expect(instructions).toContain("approval=always");
    expect(instructions).toContain(
      "A profile can narrow access but cannot expand it.",
    );
  });

  it("keeps a maximally normalized managed roster inside its validated ceiling", () => {
    const longText = "x".repeat(500);
    const agents = Array.from(
      { length: AGENT_ROSTER_LIMITS.customAgents },
      (_, index) =>
        customAgent({
          id: `agent-${index}`,
          mention: `@agent:agent-${index}`,
          name: `Agent ${index} ${longText}`,
          roleName: longText,
          mission: longText,
          communicationStyle: longText,
          repository: longText,
          folder: longText,
          memory: {
            enabled: true,
            scope: "shared",
            instructions: longText,
          },
          toolIds: Array.from(
            { length: AGENT_ROSTER_LIMITS.toolsPerAgent },
            (_, toolIndex) => `tool-${toolIndex}-${index}`,
          ),
          mcpServerIds: Array.from(
            { length: AGENT_ROSTER_LIMITS.mcpServersPerAgent },
            (_, serverIndex) => `mcp-${serverIndex}-${index}`,
          ),
          skillIds: Array.from(
            { length: AGENT_ROSTER_LIMITS.maxSkillsPerAgent },
            (_, skillIndex) => `skill-${skillIndex}-${index}`,
          ),
        }),
    );
    const members = agents.map((agent) => String(agent.id));
    const teams = Array.from(
      { length: AGENT_ROSTER_LIMITS.teams },
      (_, index) => ({
        id: `team-${index}`,
        mention: `@team:team-${index}`,
        name: `Team ${index} ${longText}`,
        goal: longText,
        leadAgentId: members[0],
        memberAgentIds: members,
        sharedSkillIds: Array.from(
          { length: AGENT_ROSTER_LIMITS.sharedSkillsPerTeam },
          (__, skillIndex) => `shared-${skillIndex}`,
        ),
        routing: "parallel",
        handoff: "explicit",
        escalationPolicy: "risk-or-blocked",
        finalReviewerAgentId: members.at(-1),
        completionCriteria: Array.from(
          { length: AGENT_ROSTER_LIMITS.completionCriteriaPerTeam },
          () => longText,
        ),
      }),
    );
    const configuration = normalizeAgentRosterConfiguration({
      activeAgentId: "build-engineer",
      workflowAgentIds: AGENT_PET_ROSTER.map((agent) => agent.id),
      customAgents: agents,
      teams,
    });
    const instructions = renderAgentRosterSkillInstructions(configuration);

    expect(instructions.length).toBeGreaterThan(8_000);
    expect(instructions.length).toBeLessThanOrEqual(
      MAX_MANAGED_AGENT_ROSTER_INSTRUCTIONS_CHARS,
    );
  });

  it("flows through the existing enabled-skill runtime reminder", () => {
    const instructions = renderAgentRosterSkillInstructions(
      DEFAULT_AGENT_ROSTER_SELECTION,
    );
    const reminder = buildSkillsReminder(
      [
        {
          name: MANAGED_AGENT_ROSTER_SKILL_NAME,
          instructions,
          scope: "app",
          catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
        },
      ],
      "app",
    );

    expect(reminder).toContain("<active_skills>");
    expect(reminder).toContain("<rift_agent_crew>");
    expect(reminder).toContain("Forge, Build Engineer");
    expect(
      buildSkillsReminder(
        [
          {
            name: MANAGED_AGENT_ROSTER_SKILL_NAME,
            instructions,
            scope: "app",
            catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
          },
        ],
        "image",
      ),
    ).toContain("<rift_agent_crew>");
    expect(
      buildSkillsReminder(
        [
          {
            name: MANAGED_AGENT_ROSTER_SKILL_NAME,
            instructions,
            scope: "app",
            catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
          },
        ],
        "security",
      ),
    ).toBe("");
  });
});
