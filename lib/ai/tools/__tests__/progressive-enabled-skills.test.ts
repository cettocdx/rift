/** @jest-environment node */
import { createFindSkills } from "../find-skills";
import { createTools } from "../index";
import { SKILL_CATALOG } from "@/lib/ai/skills/catalog";
import {
  buildSkillsReminder,
  injectSkillsIntoMessages,
  type EnabledSkill,
} from "@/lib/ai/skills/inject-skills";
import { countTokens } from "gpt-tokenizer";
import { getConvexClient } from "@/lib/db/convex-client";
import { MANAGED_AGENT_ROSTER_SKILL_ID } from "@/lib/ai/agents/pet-roster";

jest.mock("../utils/sandbox-manager", () => ({
  DefaultSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));
jest.mock("../utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));

jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: jest.fn(),
}));

const request = "Explain closures in two sentences.";
const enabled = (id: string): EnabledSkill => {
  const skill = SKILL_CATALOG.find((entry) => entry.id === id)!;
  return {
    name: skill.name,
    instructions: skill.instructions,
    scope: skill.scope,
    catalog_id: id,
  };
};
const controls = enabled("controls");
const messages = (text = request) => [
  {
    id: "user-1",
    role: "user" as const,
    parts: [{ type: "text" as const, text }],
  },
];
const execute = (tool: ReturnType<typeof createFindSkills>, ids: string[]) =>
  (tool.execute as any)(
    { task: request, skill_ids: ids },
    { toolCallId: "skill-load", messages: [] },
  );

it("injects an enabled manifest while retaining full global, custom and authorization guidance", async () => {
  const global: EnabledSkill = {
    name: "Voice",
    instructions: "GLOBAL_PREFERENCE",
    scope: "all",
  };
  const custom = {
    ...controls,
    catalog_id: "custom-rules",
    instructions: "CUSTOM_PREFERENCE",
  };
  const roster: EnabledSkill = {
    name: "Crew",
    instructions: "AUTHORIZATION_ROSTER",
    scope: "app",
    catalog_id: MANAGED_AGENT_ROSTER_SKILL_ID,
  };
  const input = await injectSkillsIntoMessages(messages(), {
    userId: "owner",
    purpose: "app",
    enabledSkills: [controls, global, custom, roster],
    standaloneGreeting: true,
  });
  const text = input[0].parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  expect(text).toContain("<enabled_skill_manifest>");
  expect(text).toContain("controls");
  expect(text).not.toContain(controls.instructions);
  expect(text).toContain("GLOBAL_PREFERENCE");
  expect(text).toContain("CUSTOM_PREFERENCE");
  expect(text).toContain("AUTHORIZATION_ROSTER");
  expect(text).toContain("skill_ids");
  expect(text).toContain("not loaded");
});

it("keeps explicitly selected and customized instructions fully active", async () => {
  const customized = {
    ...enabled("threejs-scene"),
    instructions: "CUSTOM_SCENE_INSTRUCTIONS",
  };
  const input = await injectSkillsIntoMessages(
    messages("Use the controls skill."),
    { userId: "owner", purpose: "app", enabledSkills: [controls, customized] },
  );
  const text = input[0].parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  expect(text).toContain(controls.instructions);
  expect(text).toContain(customized.instructions);
  expect(text).not.toContain("<enabled_skill_manifest>");
  expect(text.split(controls.instructions)).toHaveLength(2);
});

it.each([false, true])(
  "loads an exact enabled ID without keyword matching or persistence (persist=%s)",
  async (persist) => {
    const install = jest.fn();
    const result = await execute(
      createFindSkills(request, {
        persist,
        install,
        enabledSkills: [controls],
      }),
      ["controls"],
    );
    expect(result).toMatchObject({
      readOnly: true,
      matched: true,
      loadedSkillIds: ["controls"],
      activeSkills: [
        { id: "controls", applicationInstructions: controls.instructions },
      ],
      installation: { status: "loaded", installed: [], refreshed: [] },
    });
    expect(install).not.toHaveBeenCalled();
  },
);

it("does not invent enabled state for missing, unknown, ambiguous or out-of-scope IDs", async () => {
  const install = jest.fn();
  const security = enabled("pentest-report");
  const tool = createFindSkills(request, {
    persist: true,
    install,
    enabledSkills: [
      controls,
      { ...controls, instructions: "CUSTOMIZED" },
      security,
    ],
  });
  const result = await execute(tool, [
    "controls",
    "pentest-report",
    "nonexistent",
  ]);
  expect(result.loadedSkillIds).toEqual([]);
  expect(result.matched).toBe(false);
  expect(result.unavailableSkillIds).toEqual([
    "controls",
    "pentest-report",
    "nonexistent",
  ]);
  expect(install).not.toHaveBeenCalled();
  const unavailable = await execute(createFindSkills(request), ["controls"]);
  expect(unavailable.loadedSkillIds).toEqual([]);
  expect(unavailable.unavailableSkillIds).toEqual(["controls"]);
});

it("returns each exact enabled pack once and preserves owner-customized contents", async () => {
  const custom = { ...controls, instructions: "OWNER_CUSTOMIZED_CONTROLS" };
  const result = await execute(
    createFindSkills(request, { enabledSkills: [custom] }),
    ["controls", "controls", "unknown"],
  );
  expect(result.loadedSkillIds).toEqual(["controls"]);
  expect(result.activeSkills).toHaveLength(1);
  expect(result.activeSkills[0].applicationInstructions).toBe(
    custom.instructions,
  );
  expect(result.unavailableSkillIds).toEqual(["unknown"]);
});

it.each(["agent", "ask"] as const)(
  "wires a stable snapshot through factory fallback (%s)",
  async (mode) => {
    const snapshot = [{ ...controls }];
    const args: Parameters<typeof createTools> = [
      "owner",
      "chat",
      { write: jest.fn() } as never,
      mode,
      {} as never,
    ];
    args[26] = "app";
    args[27] = request;
    args[35] = snapshot;
    const runtime = createTools(...args);
    snapshot[0].instructions = "LATER_MUTATION";
    for (const tools of [
      runtime.tools,
      runtime.getToolsForModel("agent-model"),
    ]) {
      const result = await execute(
        tools.find_skills as ReturnType<typeof createFindSkills>,
        ["controls"],
      );
      expect(result.readOnly).toBe(true);
      expect(result.activeSkills[0].applicationInstructions).toBe(
        controls.instructions,
      );
    }
  },
);

it("keeps fallback-fetched skills eager when no shared loader snapshot was supplied", async () => {
  const previousKey = process.env.CONVEX_SERVICE_ROLE_KEY;
  const previousDisabled = process.env.SKILLS_DISABLED;
  process.env.CONVEX_SERVICE_ROLE_KEY = "offline-fixture";
  delete process.env.SKILLS_DISABLED;
  const query = jest.fn().mockResolvedValue([controls]);
  (getConvexClient as jest.Mock).mockReturnValue({ query });
  try {
    const input = await injectSkillsIntoMessages(messages(), {
      userId: "owner",
      purpose: "app",
    });
    const text = input[0].parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    expect(query).toHaveBeenCalledTimes(1);
    expect(text).toContain(controls.instructions);
    expect(text).not.toContain("<enabled_skill_manifest>");
  } finally {
    if (previousKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
    else process.env.CONVEX_SERVICE_ROLE_KEY = previousKey;
    if (previousDisabled === undefined) delete process.env.SKILLS_DISABLED;
    else process.env.SKILLS_DISABLED = previousDisabled;
  }
});

it("advertises complete loadability while substantially reducing unchanged game presets", async () => {
  const snapshot = [
    controls,
    enabled("threejs-scene"),
    enabled("browser-game"),
  ];
  const input = await injectSkillsIntoMessages(messages(), {
    userId: "owner",
    purpose: "app",
    enabledSkills: snapshot,
  });
  const text = input[0].parts
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("");
  expect(countTokens(text)).toBeLessThan(
    countTokens(buildSkillsReminder(snapshot, "app")) / 2,
  );
  const result = await execute(
    createFindSkills(request, { enabledSkills: snapshot }),
    snapshot.map((skill) => skill.catalog_id!),
  );
  expect(result.unavailableSkillIds).toEqual([]);
  expect(
    result.activeSkills.map(
      (skill: { applicationInstructions: string }) =>
        skill.applicationInstructions,
    ),
  ).toEqual(snapshot.map((skill) => skill.instructions));
});

it.each([
  ["security", "pentest-report"],
  ["image", "photorealistic"],
] as const)(
  "keeps full matching instructions on the %s surface",
  async (purpose, id) => {
    const skill = enabled(id);
    const input = await injectSkillsIntoMessages(messages(), {
      userId: "owner",
      purpose,
      enabledSkills: [skill],
    });
    const text = input[0].parts
      .map((part) => (part.type === "text" ? part.text : ""))
      .join("");
    expect(text).toContain(skill.instructions);
    expect(text).not.toContain("<enabled_skill_manifest>");
  },
);

it("bounds exact-ID requests while preserving the existing task-only input", () => {
  const schema = createFindSkills().inputSchema as import("zod").ZodType;
  expect(schema.safeParse({ task: request }).success).toBe(true);
  expect(
    schema.safeParse({ task: request, skill_ids: ["controls"] }).success,
  ).toBe(true);
  expect(schema.safeParse({ task: request, skill_ids: [] }).success).toBe(
    false,
  );
  expect(
    schema.safeParse({ task: request, skill_ids: Array(9).fill("controls") })
      .success,
  ).toBe(false);
});
