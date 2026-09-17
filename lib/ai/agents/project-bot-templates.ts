import {
  normalizeAgentRosterConfiguration,
  type AgentPetCatalogId,
  type CustomAgentProfileConfig,
} from "./pet-roster";

export type ProjectBotTemplate = {
  id: string;
  name: string;
  role: string;
  mission: string;
  petId: AgentPetCatalogId;
  skills: string[];
  deliverable: string;
};
export const PROJECT_BOT_TEMPLATES: readonly ProjectBotTemplate[] = [
  {
    id: "lead",
    name: "Orbit",
    role: "Project lead",
    mission:
      "Own the plan, assign bounded work and integrate verified results. Avoid unnecessary delegation.",
    petId: "wolf",
    skills: ["project-coordination"],
    deliverable: "A clear plan, decisions and verified handoffs.",
  },
  {
    id: "engineer",
    name: "Forge",
    role: "Engineer",
    mission:
      "Implement focused changes, inspect existing code and verify behavior with relevant checks.",
    petId: "beaver",
    skills: ["focused-implementation", "quality-verification"],
    deliverable: "Working changes with verification evidence.",
  },
  {
    id: "designer",
    name: "Forma",
    role: "Product designer",
    mission:
      "Design coherent interfaces with clear hierarchy, accessible interaction and consistent typography.",
    petId: "cat",
    skills: ["ui-ux-pro-max", "design-taste-frontend", "brand-identity"],
    deliverable: "A usable interface and documented interaction decisions.",
  },
  {
    id: "quality",
    name: "Prism",
    role: "Quality reviewer",
    mission:
      "Reproduce defects, review changes and report only evidence-backed issues with actionable fixes.",
    petId: "owl",
    skills: ["quality-verification"],
    deliverable: "Reproduction steps, verification and remaining risks.",
  },
  {
    id: "research",
    name: "Atlas",
    role: "Researcher",
    mission:
      "Investigate questions using primary sources, compare evidence and clearly separate facts from inference.",
    petId: "fox",
    skills: ["evidence-research"],
    deliverable: "A sourced report with practical recommendations.",
  },
  {
    id: "content",
    name: "Echo",
    role: "Content specialist",
    mission:
      "Write clear, distinctive content grounded in the project, audience and verified product facts.",
    petId: "parrot",
    skills: ["brand-voice", "brand-identity"],
    deliverable: "Publication-ready drafts for review.",
  },
  {
    id: "video",
    name: "Frame",
    role: "Video director",
    mission:
      "Develop storyboards and produce coherent visual assets with deliberate pacing and brand consistency.",
    petId: "rabbit",
    skills: ["video-planning", "brand-identity"],
    deliverable: "A storyboard, production assets and reviewable cut.",
  },
  {
    id: "operations",
    name: "Relay",
    role: "Operations",
    mission:
      "Maintain project checklists, identify blockers and organize repeatable work without duplicate execution.",
    petId: "border-collie",
    skills: ["project-operations"],
    deliverable: "An actionable status update and owned next steps.",
  },
];

export function createProjectBotProfile(
  templateId: string,
  stableId: string,
  name?: string,
): CustomAgentProfileConfig {
  const template = PROJECT_BOT_TEMPLATES.find((t) => t.id === templateId);
  if (!template) throw new Error("Unknown bot template");
  const profile = normalizeAgentRosterConfiguration({
    customAgents: [
      {
        id: `agent-${stableId}`,
        mention: `@agent:${stableId}`,
        name: name?.trim() || template.name,
        petId: template.petId,
        roleName: template.role,
        mission: template.mission,
        skillIds: template.skills,
        skillAssignment: "manual",
        model: "auto",
        reasoningEffort: "medium",
        toolIds: (
          {
            lead: ["file", "todo_write", "find_skills", "delegate_task"],
            engineer: [
              "file",
              "run_terminal_cmd",
              "todo_write",
              "find_skills",
              "verify_app",
              "expose_preview",
              "delegate_task",
            ],
            designer: [
              "file",
              "run_terminal_cmd",
              "find_skills",
              "generate_image",
              "verify_app",
              "expose_preview",
            ],
            quality: [
              "file",
              "find_skills",
              "web_search",
              "browse_url",
              "todo_write",
            ],
            research: [
              "file",
              "find_skills",
              "web_search",
              "browse_url",
              "todo_write",
            ],
            content: [
              "file",
              "find_skills",
              "web_search",
              "browse_url",
              "generate_image",
            ],
            video: [
              "file",
              "run_terminal_cmd",
              "find_skills",
              "generate_image",
              "browse_url",
            ],
            operations: ["file", "todo_write", "find_skills", "delegate_task"],
          } as Record<string, string[]>
        )[template.id],
        mcpServerIds: [],
        permissionPreset:
          template.id === "research" || template.id === "quality"
            ? "read-only"
            : "workspace-write",
        concurrencyLimit: 2,
      },
    ],
  }).customAgents[0];
  // Explicit project packs are not padded with unrelated pet suggestions.
  profile.skillIds = [...template.skills];
  return profile;
}

export function parseProjectBotProfile(
  json: string,
): CustomAgentProfileConfig | null {
  try {
    if (json.length > 16_000) return null;
    const value = JSON.parse(json);
    if (
      !value ||
      typeof value.id !== "string" ||
      typeof value.name !== "string" ||
      !Array.isArray(value.skillIds)
    )
      return null;
    const profile = normalizeAgentRosterConfiguration({ customAgents: [value] })
      .customAgents[0];
    if (!profile) return null;
    profile.skillIds = value.skillIds
      .filter(
        (s: unknown): s is string => typeof s === "string" && s.length <= 100,
      )
      .slice(0, 8);
    return profile;
  } catch {
    return null;
  }
}
