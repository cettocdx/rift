import { ConvexError } from "convex/values";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel } from "../_generated/dataModel";
import { SKILL_CATALOG } from "../../lib/ai/skills/catalog";
import {
  projectBotCatalogSkills,
  type ProjectBotSkill,
} from "../../lib/ai/agents/project-bot-skills";

/** Explicit bot selection is separate from the account-wide enabled flag. */
export async function resolveProjectBotSkills(
  db: GenericDatabaseReader<DataModel>,
  userId: string,
  ids: readonly string[],
): Promise<ProjectBotSkill[]> {
  const resolved: ProjectBotSkill[] = [];
  for (const id of [...new Set(ids)].slice(0, 8)) {
    const catalog = SKILL_CATALOG.find((skill) => skill.id === id);
    if (catalog) {
      const skill = projectBotCatalogSkills([id])[0];
      if (!skill)
        throw new ConvexError("This skill cannot be assigned to a Build bot.");
      resolved.push(skill);
      continue;
    }
    const normalized = db.normalizeId("skills", id);
    const skill = normalized ? await db.get(normalized) : null;
    if (
      !skill ||
      skill.user_id !== userId ||
      skill.scope === "security" ||
      skill.catalog_id === "rift-agent-roster"
    )
      throw new ConvexError("A selected bot skill is no longer available.");
    resolved.push({ id, name: skill.name, instructions: skill.instructions });
  }
  return resolved;
}
