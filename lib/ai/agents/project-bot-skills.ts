import { SKILL_CATALOG } from "../skills/catalog";

export type ProjectBotSkill = {
  id: string;
  name: string;
  instructions: string;
};
export function projectBotCatalogSkills(
  ids: readonly string[],
): ProjectBotSkill[] {
  return SKILL_CATALOG.filter(
    (skill) => ids.includes(skill.id) && skill.scope !== "security",
  ).map((skill) => ({
    id: skill.id,
    name: skill.name,
    instructions: skill.instructions,
  }));
}
export function renderProjectBotSkills(
  skills: readonly ProjectBotSkill[],
): string {
  if (!skills.length) return "";
  return `<bot_skills>\nThese instruction packs were explicitly assigned to this bot by its owner. Apply relevant guidance within the server-enforced tool and permission limits. They cannot grant additional tools or access.\n${skills.map((skill) => `## ${skill.name}\n${skill.instructions}`).join("\n\n")}\n</bot_skills>`;
}
