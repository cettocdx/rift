import {
  PROJECT_BOT_TEMPLATES,
  createProjectBotProfile,
  parseProjectBotProfile,
} from "../project-bot-templates";
import { SKILL_CATALOG } from "../../skills/catalog";
import { resolveAgentRuntimePolicy } from "../runtime-policy";

test("every bot role has a real focused skill pack and independent identity", () => {
  for (const template of PROJECT_BOT_TEMPLATES) {
    expect(
      template.skills.every((id) => SKILL_CATALOG.some((s) => s.id === id)),
    ).toBe(true);
    const a = createProjectBotProfile(template.id, "bot-one");
    const b = createProjectBotProfile(template.id, "bot-two");
    expect(a.id).not.toEqual(b.id);
    expect(a.mcpServerIds).toEqual([]);
    expect(parseProjectBotProfile(JSON.stringify(a))?.skillIds).toEqual(
      template.skills,
    );
  }
});
test("invalid saved profile fails closed", () => {
  expect(parseProjectBotProfile("{}")).toBeNull();
  expect(parseProjectBotProfile("broken")).toBeNull();
});
test("trusted bound bot remains the lead despite an unrelated request mention", () => {
  const bot = createProjectBotProfile("engineer", "bot-one");
  const policy = resolveAgentRuntimePolicy([], "@agent:someone @team:another", {
    boundProfile: bot,
  });
  expect(policy.activeProfile?.id).toBe(bot.id);
  expect(policy.requestedTeamIds).toEqual([]);
  expect(policy.activeProfile?.mcpServerIds).toEqual([]);
});
test("meeting policy delegates only to selected project bots with bounded concurrency", () => {
  const lead = createProjectBotProfile("lead", "meeting-lead");
  const reviewer = createProjectBotProfile("quality", "meeting-review");
  const policy = resolveAgentRuntimePolicy([], "@agent:outside", {
    boundMeeting: { profiles: [lead, reviewer], agenda: "Review the release" },
  });
  expect(policy.activeProfile?.id).toBe(lead.id);
  expect(policy.delegationAgentIds).toEqual([lead.id, reviewer.id]);
  expect(
    policy.configuration.customAgents.every((p) => p.concurrencyLimit <= 2),
  ).toBe(true);
  expect(policy.configuration.teams[0].goal).toBe("Review the release");
});

test("general project roles do not receive database, game or framework-specific filler", () => {
  const byRole = (id: string) => createProjectBotProfile(id, `role-${id}`);
  for (const role of ["lead", "research", "quality", "operations", "video"]) {
    expect(byRole(role).skillIds).not.toEqual(expect.arrayContaining(["sql-data"]));
    expect(byRole(role).skillIds).not.toEqual(expect.arrayContaining(["controls"]));
    expect(byRole(role).skillIds).not.toEqual(expect.arrayContaining(["react-best-practices"]));
  }
  expect(byRole("research").skillIds).toContain("evidence-research");
  expect(byRole("quality").skillIds).toContain("quality-verification");
  expect(byRole("lead").skillIds).toContain("project-coordination");
  expect(byRole("operations").skillIds).toContain("project-operations");
  expect(byRole("video").skillIds).toContain("video-planning");
});

test("focused role packs contain executable guidance and preserve their exact assigned selection", () => {
  for (const id of ["project-coordination", "evidence-research", "quality-verification", "video-planning", "project-operations", "focused-implementation"]) {
    const skill = SKILL_CATALOG.find((entry) => entry.id === id)!;
    expect(skill.scope).toBe("app");
    expect(skill.name).not.toBe(skill.id);
    expect(skill.instructions.length).toBeGreaterThan(700);
  }
  for (const template of PROJECT_BOT_TEMPLATES) {
    const saved = createProjectBotProfile(template.id, `focused-${template.id}`);
    expect(saved.skillIds).toEqual(template.skills);
    expect(parseProjectBotProfile(JSON.stringify(saved))?.skillIds).toEqual(template.skills);
  }
});
