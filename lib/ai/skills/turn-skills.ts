import type { EnabledSkill } from "./inject-skills";
import type { ChatPurpose } from "@/types/chat";
import { SKILL_CATALOG } from "./catalog";
import { MANAGED_AGENT_ROSTER_SKILL_ID } from "@/lib/ai/agents/pet-roster";

export interface DeferredEnabledSkill {
  id: string;
  name: string;
  description: string;
}

export interface EnabledSkillsPartition {
  eager: EnabledSkill[];
  deferred: DeferredEnabledSkill[];
}

// These catalog descriptions were reviewed for task/domain discoverability.
// New presets stay eager until reviewed. og-share-card stays eager because its
// description omits the instruction to act unprompted on every substantial app.
const DEFERABLE_BUILD_SKILL_IDS = new Set<string>([
  "ui-ux-pro-max",
  "design-taste-frontend",
  "react-best-practices",
  "landing-page",
  "browser-game",
  "controls",
  "threejs-scene",
  "brand-identity",
  "project-coordination",
  "evidence-research",
  "quality-verification",
  "video-planning",
  "project-operations",
  "focused-implementation",
]);

/**
 * Present unchanged, reviewed Build presets as loadable manifest entries.
 * This does not classify requests, load instructions or change authorization.
 * Callers retain the original owner-scoped snapshot for exact-ID loading.
 */
export function partitionEnabledSkillsForTurn(
  skills: readonly EnabledSkill[],
  context: {
    purpose: ChatPurpose;
    explicitSkillIds?: ReadonlySet<string>;
  },
): EnabledSkillsPartition {
  if (context.purpose !== "app") return { eager: [...skills], deferred: [] };

  const idCounts = new Map<string, number>();
  for (const skill of skills) {
    if (skill.catalog_id) {
      idCounts.set(skill.catalog_id, (idCounts.get(skill.catalog_id) ?? 0) + 1);
    }
  }

  const result: EnabledSkillsPartition = { eager: [], deferred: [] };
  for (const skill of skills) {
    const id = skill.catalog_id;
    const preset = SKILL_CATALOG.find((entry) => entry.id === id);
    if (
      !id ||
      skill.scope !== "app" ||
      id === MANAGED_AGENT_ROSTER_SKILL_ID ||
      context.explicitSkillIds?.has(id) ||
      idCounts.get(id) !== 1 ||
      !DEFERABLE_BUILD_SKILL_IDS.has(id) ||
      !preset ||
      preset.scope !== "app" ||
      !preset.description.trim() ||
      skill.instructions.trim() !== preset.instructions.trim()
    ) {
      result.eager.push(skill);
      continue;
    }
    result.deferred.push({
      id,
      name: skill.name,
      description: preset.description.trim(),
    });
  }
  return result;
}

export function selectEnabledSkillsForTurn(
  skills: EnabledSkill[],
  context: { purpose: ChatPurpose; standaloneGreeting?: boolean },
): EnabledSkill[] {
  if (context.purpose !== "app" || !context.standaloneGreeting) return skills;
  // The caller's conservative classifier excludes projects, bot profiles,
  // continuations, attachments and explicit skill requests. Keep all-purpose
  // guidance, unknown custom skills and edited presets intact.
  return skills.filter((skill) => {
    if (skill.scope !== "app") return true;
    if (skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID) return false;
    const preset = SKILL_CATALOG.find((entry) => entry.id === skill.catalog_id);
    return (
      !preset ||
      preset.scope !== "app" ||
      skill.instructions.trim() !== preset.instructions.trim()
    );
  });
}
