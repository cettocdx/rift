/** @jest-environment node */
import { resolveProjectBotSkills } from "../lib/projectBotSkills";
import { createProjectBotProfile } from "../../lib/ai/agents/project-bot-templates";
import {
  resolveAgentRuntimePolicy,
  resolveDelegationAgent,
  renderActiveAgentWorkflowReminder,
} from "../../lib/ai/agents/runtime-policy";
const db = (rows: Record<string, unknown>) =>
  ({
    normalizeId: (_table: string, id: string) => id,
    get: async (id: string) => rows[id] ?? null,
  }) as never;

test("explicit bot assignment loads owned custom instructions without enabling them for ordinary chats", async () => {
  const skills = await resolveProjectBotSkills(
    db({
      mine: {
        user_id: "u1",
        name: "Brand language",
        instructions: "Use the project's precise product terminology.",
        scope: "app",
        enabled: false,
      },
    }),
    "u1",
    ["mine", "concise-expert"],
  );
  expect(skills.map((skill) => skill.id)).toEqual(["mine", "concise-expert"]);
  const profile = createProjectBotProfile("content", "test-bot");
  profile.skillIds = ["mine", "concise-expert"];
  const policy = resolveAgentRuntimePolicy(
    [{ name: "Unrelated", instructions: "UNSELECTED GLOBAL", scope: "app" }],
    "hello",
    { boundProfile: profile, boundSkills: skills },
  );
  const reminder = renderActiveAgentWorkflowReminder(policy);
  expect(reminder).toContain("precise product terminology");
  expect(reminder).not.toContain("UNSELECTED GLOBAL");
  expect(resolveDelegationAgent(policy, profile.id)?.skills).toEqual(skills);
});

test("missing, foreign, security-only and managed-roster skill references fail closed", async () => {
  for (const row of [
    null,
    { user_id: "other", scope: "app" },
    { user_id: "u1", scope: "security" },
    { user_id: "u1", scope: "app", catalog_id: "rift-agent-roster" },
  ]) {
    await expect(
      resolveProjectBotSkills(db({ picked: row }), "u1", ["picked"]),
    ).rejects.toThrow();
  }
});

test("meeting lead and delegates receive their own selected skill packs", () => {
  const lead = createProjectBotProfile("lead", "lead"),
    reviewer = createProjectBotProfile("quality", "reviewer");
  const leadSkills = [
    {
      id: "custom-lead",
      name: "Lead pack",
      instructions: "LEAD OWNED CONTRACT",
    },
  ];
  const reviewSkills = [
    {
      id: "custom-review",
      name: "Review pack",
      instructions: "REVIEWER OWNED CONTRACT",
    },
  ];
  const policy = resolveAgentRuntimePolicy([], "meet", {
    boundMeeting: {
      profiles: [lead, reviewer],
      agenda: "Plan release",
      skillsByProfile: { [lead.id]: leadSkills, [reviewer.id]: reviewSkills },
    },
  });
  const reminder = renderActiveAgentWorkflowReminder(policy);
  expect(reminder).toContain("LEAD OWNED CONTRACT");
  expect(reminder).not.toContain("REVIEWER OWNED CONTRACT");
  expect(resolveDelegationAgent(policy, reviewer.id)?.skills).toEqual(
    reviewSkills,
  );
});
