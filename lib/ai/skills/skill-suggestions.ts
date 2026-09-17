import { SKILL_CATALOG } from "./catalog";
import {
  findFrontendQualitySkills,
  findRelevantSkills,
} from "@/lib/ai/tools/find-skills";

/**
 * Skill *suggestions* — the cheap half of skill discovery.
 *
 * Matching is deterministic string work the server runs for free, so the model
 * only ever sees a name and a one-line description here; the full packs arrive
 * through `find_skills` before applicable work, an enabled-skill reminder,
 * or an explicit selection in the request. Suggestions do not force a tool
 * call for a self-contained explanation.
 */

const MAX_SUGGESTIONS = 3;

export interface SkillSuggestion {
  id: string;
  name: string;
  description: string;
}

const toSuggestion = (id: string): SkillSuggestion | null => {
  const entry = SKILL_CATALOG.find((skill) => skill.id === id);
  return entry
    ? { id: entry.id, name: entry.name, description: entry.description }
    : null;
};

/**
 * Candidate skills for `task` that are not already active, cheapest-first: the
 * frontend quality packs when the request is frontend work, then the catalog's
 * deterministic relevance matches.
 */
export function findSuggestibleSkills(
  task: string,
  opts: { excludeIds?: ReadonlySet<string> } = {},
): SkillSuggestion[] {
  const excludeIds = opts.excludeIds ?? new Set<string>();
  const candidateIds = [
    ...findFrontendQualitySkills(task).map((skill) => skill.id),
    ...findRelevantSkills(task).map((skill) => skill.id),
  ];

  const seen = new Set<string>();
  const suggestions: SkillSuggestion[] = [];
  for (const id of candidateIds) {
    if (seen.has(id) || excludeIds.has(id)) continue;
    seen.add(id);
    const suggestion = toSuggestion(id);
    if (suggestion) suggestions.push(suggestion);
    if (suggestions.length === MAX_SUGGESTIONS) break;
  }
  return suggestions;
}

/** Compact, non-activating reminder: names and one-liners, never instructions. */
export function buildSkillSuggestionReminder(
  suggestions: readonly SkillSuggestion[],
): string {
  if (suggestions.length === 0) return "";
  const body = suggestions
    .map((skill) => `- ${skill.id} (${skill.name}) — ${skill.description}`)
    .join("\n");
  return `<skill_suggestions>\nPlaybooks matching this request. Their instructions are NOT loaded yet — call find_skills before applicable implementation or planning to load the relevant ones; no permission is needed and none should be asked for.\n\n${body}\n</skill_suggestions>`;
}
