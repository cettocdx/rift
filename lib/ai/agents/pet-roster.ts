import type { SkillScope } from "@/lib/ai/skills/catalog";
import {
  findBuildModel,
  resolveBuildReasoningEffort,
  type ReasoningEffort,
} from "@/types/chat";

export const MANAGED_AGENT_ROSTER_SKILL_ID = "rift-agent-roster";
export const MANAGED_AGENT_ROSTER_SKILL_NAME = "RIFT Agent Crew";
/** Kept stable so existing browser-saved v1 selections continue to hydrate. */
export const AGENT_ROSTER_STORAGE_KEY = "rift.agent-roster.v1";
export const MAX_MANAGED_AGENT_ROSTER_INSTRUCTIONS_CHARS = 24_000;

/**
 * These six personas are the original RIFT crew. Their ids and shape are a
 * compatibility contract for AgentPetRoster and AgentPetAvatar.
 */
export const AGENT_PET_ROSTER = [
  {
    id: "build-engineer",
    petName: "Forge",
    roleName: "Build Engineer",
    description:
      "Ships reliable product changes, removes bottlenecks, and keeps the codebase fast.",
    accent: "#67A2FF",
    skillIds: [
      "ui-ux-pro-max",
      "design-taste-frontend",
      "react-best-practices",
      "nextjs",
      "verification",
    ],
    responsibilities: [
      "Own architecture, implementation, and integration decisions.",
      "Measure performance and remove avoidable runtime work.",
      "Verify the complete path before marking a build ready.",
    ],
    operatingInstructions:
      "Take ownership of implementation. Inspect before editing, preserve unrelated work, prefer small composable changes, and verify types, tests, runtime behavior, and performance. For every frontend build, apply UI Pro Max and Design Taste guidance as mandatory design constraints.",
  },
  {
    id: "product-designer",
    petName: "Pixel",
    roleName: "Product Designer",
    description:
      "Turns product intent into clear interaction, hierarchy, and polished interface decisions.",
    accent: "#C58AF9",
    skillIds: [
      "ui-ux-pro-max",
      "design-taste-frontend",
      "figma-use",
      "react-best-practices",
      "accessibility-review",
    ],
    responsibilities: [
      "Define information hierarchy and interaction behavior.",
      "Keep visual language coherent across every product state.",
      "Review responsive, keyboard, contrast, and reduced-motion behavior.",
    ],
    operatingInstructions:
      "Translate intent into a coherent product experience. Audit the existing design language first, use UI Pro Max and Design Taste on every frontend task, preserve established tokens, and review loading, empty, error, responsive, keyboard, contrast, and reduced-motion states.",
  },
  {
    id: "research",
    petName: "Scout",
    roleName: "Research",
    description:
      "Finds current primary sources, tests assumptions, and returns decision-ready evidence.",
    accent: "#58B9A7",
    skillIds: [
      "browser-research",
      "openai-docs",
      "source-verification",
      "concise-expert",
    ],
    responsibilities: [
      "Find authoritative and current source material.",
      "Separate verified facts, inferences, and open questions.",
      "Return concise evidence that changes the product decision.",
    ],
    operatingInstructions:
      "Research uncertain or time-sensitive claims before the crew acts on them. Prefer primary and official sources, note dates, distinguish source-backed facts from inference, and return only evidence that materially affects the current decision.",
  },
  {
    id: "marketing",
    petName: "Echo",
    roleName: "Marketing",
    description:
      "Shapes positioning, product copy, campaigns, and launch-ready customer communication.",
    accent: "#E69A63",
    skillIds: [
      "brand-voice",
      "landing-page",
      "ui-ux-pro-max",
      "design-taste-frontend",
      "campaign-analysis",
    ],
    responsibilities: [
      "Turn product value into specific audience-facing language.",
      "Keep launch, lifecycle, and in-product messages consistent.",
      "Tie campaign ideas to a measurable customer action.",
    ],
    operatingInstructions:
      "Own positioning and customer-facing language. Use concrete claims, one consistent voice, and a clear audience and action. For marketing interfaces, apply UI Pro Max and Design Taste, then connect creative decisions to a measurable outcome without inventing metrics.",
  },
  {
    id: "quality",
    petName: "Probe",
    roleName: "QA",
    description:
      "Challenges assumptions, reproduces failures, and protects critical paths from regressions.",
    accent: "#E5BC54",
    skillIds: [
      "react-best-practices",
      "browser-verification",
      "verification",
      "accessibility-review",
      "performance-audit",
    ],
    responsibilities: [
      "Translate intent into observable acceptance criteria.",
      "Test happy paths, edge cases, recovery, and regressions.",
      "Report reproducible evidence with severity and scope.",
    ],
    operatingInstructions:
      "Act as the final quality gate. Derive observable acceptance criteria, reproduce before diagnosing, cover success, error, empty, loading, keyboard, responsive, and recovery paths, and report evidence with exact scope. Do not mark work complete while a required path is unverified.",
  },
  {
    id: "video-director",
    petName: "Frame",
    roleName: "Video Director",
    description:
      "Directs model choice, story, prompts, references, and final visual continuity.",
    accent: "#DF7F94",
    skillIds: [
      "video-production",
      "imagegen",
      "photorealistic",
      "brand-voice",
      "media-quality-control",
    ],
    responsibilities: [
      "Choose the right generation model for the intended shot.",
      "Build concise storyboards, shot prompts, and reference plans.",
      "Check continuity, framing, motion, audio intent, and delivery format.",
    ],
    operatingInstructions:
      "Direct generative video work from intent through delivery. Select models by shot requirements, define framing, camera movement, timing, continuity, reference assets, audio intent, aspect ratio, and export target, then inspect results for temporal artifacts and brand consistency.",
  },
] as const;

export type AgentPetRoleId = (typeof AGENT_PET_ROSTER)[number]["id"];
export type AgentPetDefinition = (typeof AGENT_PET_ROSTER)[number];

export interface AgentPetCatalogDefinition {
  id: string;
  speciesLabel: string;
  petName: string;
  roleName: string;
  mission: string;
  description: string;
  suggestedSkillIds: readonly string[];
  accent: string;
  visualPreset: AgentPetRoleId;
}

/**
 * Reusable professional archetypes. Suggested skills are ids from the local
 * skill catalog (including the two mandatory build skills), not invented
 * integrations. A profile may still select an installed custom skill id.
 */
export const AGENT_PET_CATALOG = [
  {
    id: "dog",
    speciesLabel: "Dog",
    petName: "Buddy",
    roleName: "Generalist Engineer",
    mission: "Move scoped product work from a clear plan to a verified result.",
    description: "A dependable generalist for implementation and integration.",
    suggestedSkillIds: [
      "react-best-practices",
      "concise-expert",
      "sql-data",
      "ui-ux-pro-max",
    ],
    accent: "#6E9FE8",
    visualPreset: "video-director",
  },
  {
    id: "border-collie",
    speciesLabel: "Border Collie",
    petName: "Dash",
    roleName: "Workflow Orchestrator",
    mission:
      "Decompose complex delivery into owned, parallel, verifiable work.",
    description: "A fast coordinator for multi-step engineering programs.",
    suggestedSkillIds: [
      "concise-expert",
      "react-best-practices",
      "ui-ux-pro-max",
      "design-taste-frontend",
    ],
    accent: "#5D8FE6",
    visualPreset: "build-engineer",
  },
  {
    id: "golden-retriever",
    speciesLabel: "Golden Retriever",
    petName: "Sunny",
    roleName: "Developer Advocate",
    mission: "Turn technical capability into clear, useful developer guidance.",
    description:
      "An approachable communicator for docs, onboarding, and support.",
    suggestedSkillIds: [
      "brand-voice",
      "concise-expert",
      "landing-page",
      "react-best-practices",
    ],
    accent: "#D8A84E",
    visualPreset: "marketing",
  },
  {
    id: "german-shepherd",
    speciesLabel: "German Shepherd",
    petName: "Sentinel",
    roleName: "Security Engineer",
    mission:
      "Identify and reduce security risk with scoped, evidence-led testing.",
    description: "A disciplined defender for threat review and remediation.",
    suggestedSkillIds: [
      "recon-methodology",
      "web-vuln-hunting",
      "pentest-report",
      "ctf-playbook",
    ],
    accent: "#B8895A",
    visualPreset: "quality",
  },
  {
    id: "cat",
    speciesLabel: "Cat",
    petName: "Miso",
    roleName: "Product Designer",
    mission:
      "Shape coherent interfaces with precise hierarchy and interaction.",
    description: "A detail-focused product and interaction designer.",
    suggestedSkillIds: [
      "ui-ux-pro-max",
      "design-taste-frontend",
      "logo-icon",
      "react-best-practices",
    ],
    accent: "#B882E8",
    visualPreset: "product-designer",
  },
  {
    id: "black-cat",
    speciesLabel: "Black Cat",
    petName: "Hex",
    roleName: "Debugging Specialist",
    mission: "Isolate difficult failures and prove the smallest correct fix.",
    description: "A patient investigator for subtle runtime and data defects.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#7F86B3",
    visualPreset: "product-designer",
  },
  {
    id: "fox",
    speciesLabel: "Fox",
    petName: "Scout",
    roleName: "Research Analyst",
    mission: "Find authoritative evidence that changes the product decision.",
    description: "A source-conscious researcher for uncertain questions.",
    suggestedSkillIds: [
      "concise-expert",
      "recon-methodology",
      "brand-voice",
      "sql-data",
    ],
    accent: "#E78B55",
    visualPreset: "research",
  },
  {
    id: "owl",
    speciesLabel: "Owl",
    petName: "Probe",
    roleName: "Quality Engineer",
    mission: "Convert intent into observable checks and regression evidence.",
    description: "A systematic reviewer for behavior, edge cases, and quality.",
    suggestedSkillIds: [
      "react-best-practices",
      "concise-expert",
      "web-vuln-hunting",
      "sql-data",
    ],
    accent: "#C6A34E",
    visualPreset: "quality",
  },
  {
    id: "raven",
    speciesLabel: "Raven",
    petName: "Cipher",
    roleName: "Code Reviewer",
    mission:
      "Find correctness, maintainability, and security risks before merge.",
    description: "A skeptical reviewer with a strong signal-to-noise ratio.",
    suggestedSkillIds: [
      "react-best-practices",
      "web-vuln-hunting",
      "concise-expert",
      "sql-data",
    ],
    accent: "#66739B",
    visualPreset: "quality",
  },
  {
    id: "wolf",
    speciesLabel: "Wolf",
    petName: "Axiom",
    roleName: "Systems Architect",
    mission:
      "Define durable boundaries and an executable path through complexity.",
    description: "An architecture lead for cross-cutting systems work.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#7187A4",
    visualPreset: "build-engineer",
  },
  {
    id: "turtle",
    speciesLabel: "Turtle",
    petName: "Ledger",
    roleName: "Reliability Engineer",
    mission:
      "Reduce operational risk through careful change and recovery design.",
    description: "A steady owner for resilience, migrations, and safe rollout.",
    suggestedSkillIds: [
      "sql-data",
      "react-best-practices",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#5FA487",
    visualPreset: "quality",
  },
  {
    id: "beaver",
    speciesLabel: "Beaver",
    petName: "Timber",
    roleName: "Platform Engineer",
    mission: "Build dependable developer infrastructure and paved paths.",
    description:
      "A pragmatic builder for tooling, CI, and platform foundations.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#9C7655",
    visualPreset: "build-engineer",
  },
  {
    id: "otter",
    speciesLabel: "Otter",
    petName: "Ripple",
    roleName: "Integration Engineer",
    mission: "Connect services cleanly and make failure behavior observable.",
    description: "A collaborative specialist for APIs and connected workflows.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#4FA9AE",
    visualPreset: "research",
  },
  {
    id: "octopus",
    speciesLabel: "Octopus",
    petName: "Flux",
    roleName: "Concurrency Engineer",
    mission:
      "Design parallel systems that remain bounded, legible, and correct.",
    description:
      "A multi-threaded thinker for orchestration and async systems.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#A66FD1",
    visualPreset: "build-engineer",
  },
  {
    id: "parrot",
    speciesLabel: "Parrot",
    petName: "Relay",
    roleName: "Technical Writer",
    mission: "Make complex product behavior accurate, navigable, and concise.",
    description:
      "A precise writer for documentation and release communication.",
    suggestedSkillIds: [
      "brand-voice",
      "concise-expert",
      "landing-page",
      "react-best-practices",
    ],
    accent: "#DF6E75",
    visualPreset: "marketing",
  },
  {
    id: "chameleon",
    speciesLabel: "Chameleon",
    petName: "Prism",
    roleName: "Compatibility Engineer",
    mission:
      "Adapt product behavior across environments without fragmentation.",
    description: "A cross-platform specialist for compatibility and migration.",
    suggestedSkillIds: [
      "react-best-practices",
      "design-taste-frontend",
      "concise-expert",
      "sql-data",
    ],
    accent: "#69A86A",
    visualPreset: "research",
  },
  {
    id: "rabbit",
    speciesLabel: "Rabbit",
    petName: "Echo",
    roleName: "Growth Marketer",
    mission: "Turn product value into specific messages and measurable action.",
    description: "A quick campaign and product-positioning specialist.",
    suggestedSkillIds: [
      "brand-voice",
      "landing-page",
      "ui-ux-pro-max",
      "design-taste-frontend",
    ],
    accent: "#E79472",
    visualPreset: "marketing",
  },
  {
    id: "elephant",
    speciesLabel: "Elephant",
    petName: "Atlas",
    roleName: "Knowledge Architect",
    mission:
      "Preserve durable context and make institutional knowledge usable.",
    description: "A long-context organizer for systems, decisions, and memory.",
    suggestedSkillIds: [
      "concise-expert",
      "brand-voice",
      "sql-data",
      "react-best-practices",
    ],
    accent: "#8794A8",
    visualPreset: "build-engineer",
  },
  {
    id: "hawk",
    speciesLabel: "Hawk",
    petName: "Vector",
    roleName: "Delivery Lead",
    mission:
      "Keep the critical path visible and drive work to a proven outcome.",
    description: "A high-level delivery owner for scope and decision velocity.",
    suggestedSkillIds: [
      "concise-expert",
      "react-best-practices",
      "brand-voice",
      "sql-data",
    ],
    accent: "#A5814D",
    visualPreset: "quality",
  },
  {
    id: "dolphin",
    speciesLabel: "Dolphin",
    petName: "Sonar",
    roleName: "Data Analyst",
    mission: "Turn product and operational data into decision-ready evidence.",
    description: "An analytical partner for queries, trends, and anomalies.",
    suggestedSkillIds: [
      "sql-data",
      "concise-expert",
      "brand-voice",
      "react-best-practices",
    ],
    accent: "#4E9FD1",
    visualPreset: "research",
  },
  {
    id: "panda",
    speciesLabel: "Panda",
    petName: "Patch",
    roleName: "Maintenance Engineer",
    mission:
      "Simplify existing systems while preserving behavior and user work.",
    description:
      "A calm maintainer for refactors, upgrades, and technical debt.",
    suggestedSkillIds: [
      "react-best-practices",
      "concise-expert",
      "sql-data",
      "web-vuln-hunting",
    ],
    accent: "#6E7B86",
    visualPreset: "build-engineer",
  },
  {
    id: "hedgehog",
    speciesLabel: "Hedgehog",
    petName: "Quill",
    roleName: "Edge Case Analyst",
    mission:
      "Expose boundary failures before they become customer regressions.",
    description: "A sharp tester for validation, recovery, and unusual states.",
    suggestedSkillIds: [
      "react-best-practices",
      "web-vuln-hunting",
      "concise-expert",
      "sql-data",
    ],
    accent: "#B17A58",
    visualPreset: "quality",
  },
  {
    id: "shiba",
    speciesLabel: "Shiba Inu",
    petName: "Kite",
    roleName: "Frontend Engineer",
    mission:
      "Ship fast, accessible interfaces with disciplined product detail.",
    description:
      "A focused frontend specialist for polished application flows.",
    suggestedSkillIds: [
      "react-best-practices",
      "ui-ux-pro-max",
      "design-taste-frontend",
      "concise-expert",
    ],
    accent: "#D58148",
    visualPreset: "video-director",
  },
  {
    id: "corgi",
    speciesLabel: "Corgi",
    petName: "Pip",
    roleName: "Prototype Engineer",
    mission: "Turn uncertain ideas into small, testable product increments.",
    description:
      "A compact builder for experiments and interaction prototypes.",
    suggestedSkillIds: [
      "react-best-practices",
      "ui-ux-pro-max",
      "design-taste-frontend",
      "browser-game",
    ],
    accent: "#D99B57",
    visualPreset: "video-director",
  },
  {
    id: "penguin",
    speciesLabel: "Penguin",
    petName: "Tux",
    roleName: "Release Engineer",
    mission: "Make builds reproducible and releases observable and reversible.",
    description:
      "A methodical owner for build, packaging, and release quality.",
    suggestedSkillIds: [
      "react-best-practices",
      "concise-expert",
      "web-vuln-hunting",
      "sql-data",
    ],
    accent: "#6685A8",
    visualPreset: "quality",
  },
  {
    id: "raccoon",
    speciesLabel: "Raccoon",
    petName: "Cache",
    roleName: "Tooling Engineer",
    mission: "Remove repetitive work with safe, composable developer tools.",
    description: "A resourceful automator for scripts and local tooling.",
    suggestedSkillIds: [
      "react-best-practices",
      "concise-expert",
      "sql-data",
      "ctf-playbook",
    ],
    accent: "#77818D",
    visualPreset: "build-engineer",
  },
  {
    id: "horse",
    speciesLabel: "Horse",
    petName: "Stride",
    roleName: "Migration Lead",
    mission: "Move large systems in controlled stages without service drift.",
    description: "An endurance-focused lead for upgrades and migrations.",
    suggestedSkillIds: [
      "sql-data",
      "react-best-practices",
      "concise-expert",
      "web-vuln-hunting",
    ],
    accent: "#9A7358",
    visualPreset: "build-engineer",
  },
  {
    id: "bee",
    speciesLabel: "Bee",
    petName: "Buzz",
    roleName: "Task Coordinator",
    mission:
      "Keep small work items owned, synchronized, and moving in parallel.",
    description: "A lightweight coordinator for active multi-agent execution.",
    suggestedSkillIds: [
      "concise-expert",
      "react-best-practices",
      "brand-voice",
      "sql-data",
    ],
    accent: "#D8AF3F",
    visualPreset: "marketing",
  },
  {
    id: "gecko",
    speciesLabel: "Gecko",
    petName: "Grip",
    roleName: "Performance Engineer",
    mission: "Find measurable bottlenecks and remove avoidable runtime work.",
    description: "A tenacious optimizer for frontend and service performance.",
    suggestedSkillIds: [
      "react-best-practices",
      "sql-data",
      "concise-expert",
      "design-taste-frontend",
    ],
    accent: "#5CA376",
    visualPreset: "research",
  },
] as const satisfies readonly AgentPetCatalogDefinition[];

export type AgentPetCatalogId = (typeof AGENT_PET_CATALOG)[number]["id"];
export type AgentSkillAssignmentMode = "auto" | "manual";
export type AgentAutonomy = "guided" | "balanced" | "autonomous";
export type AgentPermissionPreset = "read-only" | "workspace-write" | "trusted";
export type AgentReasoningEffort = ReasoningEffort;
export type AgentMemoryScope = "session" | "repository" | "shared";
export type AgentEscalationPolicy =
  | "when-blocked"
  | "risk-or-blocked"
  | "before-every-action";
export type AgentApprovalPolicy = "always" | "risky-actions" | "on-escalation";
export type AgentTeamRouting =
  | "lead-routed"
  | "capability-routed"
  | "parallel"
  | "sequential";
export type AgentTeamHandoff = "explicit" | "lead-mediated" | "automatic";

export interface AgentMemoryConfig {
  enabled: boolean;
  scope: AgentMemoryScope;
  instructions: string;
}

export interface CustomAgentProfileConfig {
  id: string;
  mention: string;
  enabled: boolean;
  name: string;
  petId: AgentPetCatalogId;
  roleName: string;
  mission: string;
  communicationStyle: string;
  autonomy: AgentAutonomy;
  permissionPreset: AgentPermissionPreset;
  model: string;
  reasoningEffort: AgentReasoningEffort;
  toolIds: string[];
  mcpServerIds: string[];
  skillIds: string[];
  skillAssignment: AgentSkillAssignmentMode;
  repository: string;
  folder: string;
  memory: AgentMemoryConfig;
  concurrencyLimit: number;
  escalationPolicy: AgentEscalationPolicy;
  approvalPolicy: AgentApprovalPolicy;
}

export interface AgentTeamConfig {
  id: string;
  mention: string;
  enabled: boolean;
  name: string;
  goal: string;
  leadAgentId: string;
  memberAgentIds: string[];
  sharedSkillIds: string[];
  routing: AgentTeamRouting;
  handoff: AgentTeamHandoff;
  escalationPolicy: AgentEscalationPolicy;
  finalReviewerAgentId: string;
  completionCriteria: string[];
}

export interface LegacyAgentRosterSelection {
  version: 1;
  activeAgentId: AgentPetRoleId;
  workflowAgentIds: AgentPetRoleId[];
}

/**
 * v2 retains the original selection fields so current consumers can edit the
 * built-in crew without a separate migration branch. Spreading an existing
 * selection also preserves custom agents and teams.
 */
export interface AgentRosterConfiguration {
  version: 2;
  activeAgentId: AgentPetRoleId;
  workflowAgentIds: AgentPetRoleId[];
  customAgents: CustomAgentProfileConfig[];
  teams: AgentTeamConfig[];
}

/** Compatibility name used by the existing AgentPetRoster component. */
export type AgentRosterSelection = AgentRosterConfiguration;

export const AGENT_ROSTER_LIMITS = {
  customAgents: 6,
  teams: 3,
  toolsPerAgent: 8,
  mcpServersPerAgent: 8,
  minSkillsPerAgent: 4,
  maxSkillsPerAgent: 8,
  membersPerTeam: 8,
  sharedSkillsPerTeam: 8,
  completionCriteriaPerTeam: 6,
  concurrency: 4,
  nameChars: 40,
  roleChars: 56,
  missionChars: 140,
  communicationStyleChars: 70,
  workspaceChars: 100,
  memoryInstructionsChars: 100,
  teamGoalChars: 140,
  completionCriterionChars: 90,
} as const;

const ROLE_IDS = new Set<string>(AGENT_PET_ROSTER.map((agent) => agent.id));
const PET_CATALOG_IDS = new Set<string>(AGENT_PET_CATALOG.map((pet) => pet.id));

export const DEFAULT_AGENT_ROSTER_SELECTION: AgentRosterSelection = {
  version: 2,
  activeAgentId: "build-engineer",
  workflowAgentIds: AGENT_PET_ROSTER.map((agent) => agent.id),
  customAgents: [],
  teams: [],
};

export const MANAGED_AGENT_ROSTER_SCOPE: SkillScope = "app";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDefaultConfiguration(): AgentRosterConfiguration {
  return {
    ...DEFAULT_AGENT_ROSTER_SELECTION,
    workflowAgentIds: [...DEFAULT_AGENT_ROSTER_SELECTION.workflowAgentIds],
    customAgents: [],
    teams: [],
  };
}

function clampText(value: unknown, fallback: string, maxChars: number): string {
  if (typeof value !== "string") return fallback;
  const normalized = value
    .replace(/[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return (normalized || fallback).slice(0, maxChars);
}

function clampBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function clampInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function slugify(value: unknown, fallback: string, maxChars = 48): string {
  const source = typeof value === "string" ? value : fallback;
  const slug = source
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxChars)
    .replace(/-+$/g, "");
  return slug || fallback;
}

function uniqueStableValue(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  let candidate = `${base}-${suffix}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }
  used.add(candidate);
  return candidate;
}

function enumValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  if (typeof value === "string") {
    for (const item of allowed) {
      if (item === value) return item;
    }
  }
  return fallback;
}

function normalizeIdentifier(value: unknown, maxChars = 64): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._:/-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxChars);
  return normalized || null;
}

function normalizeIdentifierList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) return [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const id = normalizeIdentifier(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
    if (normalized.length === maxItems) break;
  }
  return normalized;
}

function normalizeTextList(
  value: unknown,
  fallback: readonly string[],
  maxItems: number,
  maxChars: number,
): string[] {
  if (!Array.isArray(value)) return [...fallback];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = clampText(item, "", maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    normalized.push(text);
    if (normalized.length === maxItems) break;
  }
  return normalized.length > 0 ? normalized : [...fallback];
}

export function isAgentPetRoleId(value: unknown): value is AgentPetRoleId {
  return typeof value === "string" && ROLE_IDS.has(value);
}

export function isAgentPetCatalogId(
  value: unknown,
): value is AgentPetCatalogId {
  return typeof value === "string" && PET_CATALOG_IDS.has(value);
}

export function getAgentPetCatalogDefinition(
  id: AgentPetCatalogId,
): (typeof AGENT_PET_CATALOG)[number] {
  return AGENT_PET_CATALOG.find((pet) => pet.id === id)!;
}

function normalizeLegacySelection(value: unknown): LegacyAgentRosterSelection {
  const candidate = isRecord(value) ? value : {};
  const activeAgentId = isAgentPetRoleId(candidate.activeAgentId)
    ? candidate.activeAgentId
    : DEFAULT_AGENT_ROSTER_SELECTION.activeAgentId;
  const requestedWorkflowIds = Array.isArray(candidate.workflowAgentIds)
    ? candidate.workflowAgentIds.filter(isAgentPetRoleId)
    : [...DEFAULT_AGENT_ROSTER_SELECTION.workflowAgentIds];
  const workflowAgentIds = Array.from(new Set(requestedWorkflowIds));
  if (!workflowAgentIds.includes(activeAgentId)) {
    workflowAgentIds.unshift(activeAgentId);
  }
  return { version: 1, activeAgentId, workflowAgentIds };
}

type NormalizedAgentResult = {
  profile: CustomAgentProfileConfig;
  sourceId: string | null;
};

function normalizeCustomAgent(
  value: unknown,
  index: number,
  usedIds: Set<string>,
  usedMentions: Set<string>,
): NormalizedAgentResult {
  const candidate = isRecord(value) ? value : {};
  const petId = isAgentPetCatalogId(candidate.petId) ? candidate.petId : "dog";
  const pet = getAgentPetCatalogDefinition(petId);
  const name = clampText(
    candidate.name,
    `${pet.petName} ${index + 1}`,
    AGENT_ROSTER_LIMITS.nameChars,
  );
  const sourceId = normalizeIdentifier(candidate.id, 48);
  const idBase = slugify(sourceId ?? name, `agent-${index + 1}`);
  const id = uniqueStableValue(
    idBase.startsWith("agent-") ? idBase : `agent-${idBase}`,
    usedIds,
  );
  const mentionSource =
    typeof candidate.mention === "string"
      ? candidate.mention.replace(/^@agent:/, "").replace(/^@/, "")
      : name;
  const mentionSlug = uniqueStableValue(
    slugify(mentionSource, `agent-${index + 1}`, 40),
    usedMentions,
  );
  const selectedSkills = normalizeIdentifierList(
    candidate.skillIds,
    AGENT_ROSTER_LIMITS.maxSkillsPerAgent,
  );
  const skillIds = [...selectedSkills];
  for (const skillId of pet.suggestedSkillIds) {
    if (skillIds.length >= AGENT_ROSTER_LIMITS.minSkillsPerAgent) break;
    if (!skillIds.includes(skillId)) skillIds.push(skillId);
  }

  const memoryCandidate = isRecord(candidate.memory) ? candidate.memory : {};
  const repository = clampText(
    candidate.repository,
    "current repository",
    AGENT_ROSTER_LIMITS.workspaceChars,
  );
  const folder = clampText(
    candidate.folder,
    ".",
    AGENT_ROSTER_LIMITS.workspaceChars,
  );
  const model = clampText(candidate.model, "auto", 80);
  const reasoningEffort = enumValue(
    candidate.reasoningEffort,
    ["off", "on", "low", "medium", "high", "xhigh", "max"],
    "medium",
  );
  const modelAwareReasoningEffort = findBuildModel(model)
    ? resolveBuildReasoningEffort(model, reasoningEffort)
    : reasoningEffort;

  return {
    sourceId,
    profile: {
      id,
      mention: `@agent:${mentionSlug}`,
      enabled: clampBoolean(candidate.enabled, true),
      name,
      petId,
      roleName: clampText(
        candidate.roleName,
        pet.roleName,
        AGENT_ROSTER_LIMITS.roleChars,
      ),
      mission: clampText(
        candidate.mission,
        pet.mission,
        AGENT_ROSTER_LIMITS.missionChars,
      ),
      communicationStyle: clampText(
        candidate.communicationStyle,
        "Concise, evidence-led, and explicit about uncertainty.",
        AGENT_ROSTER_LIMITS.communicationStyleChars,
      ),
      autonomy: enumValue(
        candidate.autonomy,
        ["guided", "balanced", "autonomous"],
        "balanced",
      ),
      permissionPreset: enumValue(
        candidate.permissionPreset,
        ["read-only", "workspace-write", "trusted"],
        "workspace-write",
      ),
      model,
      reasoningEffort: modelAwareReasoningEffort,
      toolIds: normalizeIdentifierList(
        candidate.toolIds,
        AGENT_ROSTER_LIMITS.toolsPerAgent,
      ),
      mcpServerIds: normalizeIdentifierList(
        candidate.mcpServerIds,
        AGENT_ROSTER_LIMITS.mcpServersPerAgent,
      ),
      skillIds: skillIds.slice(0, AGENT_ROSTER_LIMITS.maxSkillsPerAgent),
      skillAssignment: enumValue(
        candidate.skillAssignment,
        ["auto", "manual"],
        "auto",
      ),
      repository,
      folder,
      memory: {
        enabled: clampBoolean(memoryCandidate.enabled, true),
        scope: enumValue(
          memoryCandidate.scope,
          ["session", "repository", "shared"],
          "repository",
        ),
        instructions: clampText(
          memoryCandidate.instructions,
          "Retain decisions, constraints, and verification evidence.",
          AGENT_ROSTER_LIMITS.memoryInstructionsChars,
        ),
      },
      concurrencyLimit: clampInteger(
        candidate.concurrencyLimit,
        1,
        1,
        AGENT_ROSTER_LIMITS.concurrency,
      ),
      escalationPolicy: enumValue(
        candidate.escalationPolicy,
        ["when-blocked", "risk-or-blocked", "before-every-action"],
        "risk-or-blocked",
      ),
      approvalPolicy: enumValue(
        candidate.approvalPolicy,
        ["always", "risky-actions", "on-escalation"],
        "risky-actions",
      ),
    },
  };
}

function normalizeTeam(
  value: unknown,
  index: number,
  activeAgentId: AgentPetRoleId,
  resolveAgentId: (value: unknown) => string | null,
  usedIds: Set<string>,
  usedMentions: Set<string>,
): AgentTeamConfig {
  const candidate = isRecord(value) ? value : {};
  const name = clampText(
    candidate.name,
    `Team ${index + 1}`,
    AGENT_ROSTER_LIMITS.nameChars,
  );
  const idBase = slugify(candidate.id ?? name, `team-${index + 1}`);
  const id = uniqueStableValue(
    idBase.startsWith("team-") ? idBase : `team-${idBase}`,
    usedIds,
  );
  const mentionSource =
    typeof candidate.mention === "string"
      ? candidate.mention.replace(/^@team:/, "").replace(/^@/, "")
      : name;
  const mentionSlug = uniqueStableValue(
    slugify(mentionSource, `team-${index + 1}`, 40),
    usedMentions,
  );
  const memberAgentIds: string[] = [];
  if (Array.isArray(candidate.memberAgentIds)) {
    for (const member of candidate.memberAgentIds) {
      const memberId = resolveAgentId(member);
      if (!memberId || memberAgentIds.includes(memberId)) continue;
      memberAgentIds.push(memberId);
      if (memberAgentIds.length === AGENT_ROSTER_LIMITS.membersPerTeam) break;
    }
  }
  const requestedLeadId = resolveAgentId(candidate.leadAgentId);
  const leadAgentId = requestedLeadId ?? memberAgentIds[0] ?? activeAgentId;
  if (!memberAgentIds.includes(leadAgentId))
    memberAgentIds.unshift(leadAgentId);
  const boundedMemberIds = memberAgentIds.slice(
    0,
    AGENT_ROSTER_LIMITS.membersPerTeam,
  );
  const requestedReviewerId = resolveAgentId(candidate.finalReviewerAgentId);
  const finalReviewerAgentId =
    requestedReviewerId && boundedMemberIds.includes(requestedReviewerId)
      ? requestedReviewerId
      : leadAgentId;

  return {
    id,
    mention: `@team:${mentionSlug}`,
    enabled: clampBoolean(candidate.enabled, true),
    name,
    goal: clampText(
      candidate.goal,
      "Deliver the scoped outcome with verified handoffs.",
      AGENT_ROSTER_LIMITS.teamGoalChars,
    ),
    leadAgentId,
    memberAgentIds: boundedMemberIds,
    sharedSkillIds: normalizeIdentifierList(
      candidate.sharedSkillIds,
      AGENT_ROSTER_LIMITS.sharedSkillsPerTeam,
    ),
    routing: enumValue(
      candidate.routing,
      ["lead-routed", "capability-routed", "parallel", "sequential"],
      "capability-routed",
    ),
    handoff: enumValue(
      candidate.handoff,
      ["explicit", "lead-mediated", "automatic"],
      "lead-mediated",
    ),
    escalationPolicy: enumValue(
      candidate.escalationPolicy,
      ["when-blocked", "risk-or-blocked", "before-every-action"],
      "risk-or-blocked",
    ),
    finalReviewerAgentId,
    completionCriteria: normalizeTextList(
      candidate.completionCriteria,
      ["All requested outcomes are implemented and verified."],
      AGENT_ROSTER_LIMITS.completionCriteriaPerTeam,
      AGENT_ROSTER_LIMITS.completionCriterionChars,
    ),
  };
}

/** Normalize v1, v2, or untrusted persisted JSON into a bounded v2 config. */
export function normalizeAgentRosterConfiguration(
  value: unknown,
): AgentRosterConfiguration {
  if (!isRecord(value)) return cloneDefaultConfiguration();

  const legacy = normalizeLegacySelection(value);
  const rawCustomAgents = Array.isArray(value.customAgents)
    ? value.customAgents.slice(0, AGENT_ROSTER_LIMITS.customAgents)
    : [];
  const usedAgentIds = new Set<string>(ROLE_IDS);
  const usedAgentMentions = new Set<string>(
    AGENT_PET_ROSTER.map((agent) => agent.petName.toLowerCase()),
  );
  const normalizedAgentResults = rawCustomAgents.map((agent, index) =>
    normalizeCustomAgent(agent, index, usedAgentIds, usedAgentMentions),
  );
  const customAgents = normalizedAgentResults.map((result) => result.profile);
  const sourceIdMap = new Map<string, string>();
  for (const result of normalizedAgentResults) {
    if (result.sourceId && !sourceIdMap.has(result.sourceId)) {
      sourceIdMap.set(result.sourceId, result.profile.id);
    }
    sourceIdMap.set(result.profile.id, result.profile.id);
  }
  const customAgentIds = new Set(
    customAgents.filter((agent) => agent.enabled).map((agent) => agent.id),
  );
  const enabledBuiltinIds = new Set<AgentPetRoleId>(legacy.workflowAgentIds);
  const resolveAgentId = (candidate: unknown): string | null => {
    if (isAgentPetRoleId(candidate)) {
      return enabledBuiltinIds.has(candidate) ? candidate : null;
    }
    const normalized = normalizeIdentifier(candidate, 48);
    if (!normalized) return null;
    const mapped = sourceIdMap.get(normalized) ?? normalized;
    return customAgentIds.has(mapped) ? mapped : null;
  };

  const rawTeams = Array.isArray(value.teams)
    ? value.teams.slice(0, AGENT_ROSTER_LIMITS.teams)
    : [];
  const usedTeamIds = new Set<string>();
  const usedTeamMentions = new Set<string>();
  const teams = rawTeams.map((team, index) =>
    normalizeTeam(
      team,
      index,
      legacy.activeAgentId,
      resolveAgentId,
      usedTeamIds,
      usedTeamMentions,
    ),
  );

  return {
    version: 2,
    activeAgentId: legacy.activeAgentId,
    workflowAgentIds: legacy.workflowAgentIds,
    customAgents,
    teams,
  };
}

/** Existing selection API now performs the same lossless v1-to-v2 migration. */
export function normalizeAgentRosterSelection(
  value: unknown,
): AgentRosterSelection {
  return normalizeAgentRosterConfiguration(value);
}

export function agentRosterSelectionsEqual(
  first: AgentRosterSelection,
  second: AgentRosterSelection,
): boolean {
  return (
    serializeAgentRosterConfiguration(first) ===
    serializeAgentRosterConfiguration(second)
  );
}

function safeJsonStringify(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026");
}

export function serializeAgentRosterConfiguration(
  configuration: AgentRosterConfiguration,
): string {
  return safeJsonStringify(normalizeAgentRosterConfiguration(configuration));
}

export function serializeAgentRosterSelection(
  selection: AgentRosterSelection,
): string {
  return serializeAgentRosterConfiguration(selection);
}

/**
 * The managed skill stores the same bounded values with positional fields to
 * avoid spending several kilobytes repeating property names in every profile.
 * Browser/local exports keep the descriptive JSON shape above.
 */
function serializeManagedAgentRosterConfiguration(
  configuration: AgentRosterConfiguration,
): string {
  const normalized = normalizeAgentRosterConfiguration(configuration);
  return safeJsonStringify({
    v: 2,
    a: normalized.activeAgentId,
    w: normalized.workflowAgentIds,
    c: normalized.customAgents.map((agent) => [
      agent.id,
      agent.mention,
      agent.enabled,
      agent.name,
      agent.petId,
      agent.roleName,
      agent.mission,
      agent.communicationStyle,
      agent.autonomy,
      agent.permissionPreset,
      agent.model,
      agent.reasoningEffort,
      agent.toolIds,
      agent.skillIds,
      agent.skillAssignment,
      agent.repository,
      agent.folder,
      [agent.memory.enabled, agent.memory.scope, agent.memory.instructions],
      agent.concurrencyLimit,
      agent.escalationPolicy,
      agent.approvalPolicy,
      // Append-only: preserve every existing positional field above so older
      // saved v2 tuples remain parseable.
      agent.mcpServerIds,
    ]),
    t: normalized.teams.map((team) => [
      team.id,
      team.mention,
      team.enabled,
      team.name,
      team.goal,
      team.leadAgentId,
      team.memberAgentIds,
      team.sharedSkillIds,
      team.routing,
      team.handoff,
      team.escalationPolicy,
      team.finalReviewerAgentId,
      team.completionCriteria,
    ]),
  });
}

function expandManagedAgentRosterConfiguration(value: unknown): unknown {
  if (!isRecord(value) || value.v !== 2) return value;
  const customAgents = Array.isArray(value.c)
    ? value.c.map((rawAgent) => {
        const agent = Array.isArray(rawAgent) ? rawAgent : [];
        const rawMemory = Array.isArray(agent[17]) ? agent[17] : [];
        return {
          id: agent[0],
          mention: agent[1],
          enabled: agent[2],
          name: agent[3],
          petId: agent[4],
          roleName: agent[5],
          mission: agent[6],
          communicationStyle: agent[7],
          autonomy: agent[8],
          permissionPreset: agent[9],
          model: agent[10],
          reasoningEffort: agent[11],
          toolIds: agent[12],
          skillIds: agent[13],
          skillAssignment: agent[14],
          repository: agent[15],
          folder: agent[16],
          memory: {
            enabled: rawMemory[0],
            scope: rawMemory[1],
            instructions: rawMemory[2],
          },
          concurrencyLimit: agent[18],
          escalationPolicy: agent[19],
          approvalPolicy: agent[20],
          mcpServerIds: agent[21],
        };
      })
    : [];
  const teams = Array.isArray(value.t)
    ? value.t.map((rawTeam) => {
        const team = Array.isArray(rawTeam) ? rawTeam : [];
        return {
          id: team[0],
          mention: team[1],
          enabled: team[2],
          name: team[3],
          goal: team[4],
          leadAgentId: team[5],
          memberAgentIds: team[6],
          sharedSkillIds: team[7],
          routing: team[8],
          handoff: team[9],
          escalationPolicy: team[10],
          finalReviewerAgentId: team[11],
          completionCriteria: team[12],
        };
      })
    : [];
  return {
    version: 2,
    activeAgentId: value.a,
    workflowAgentIds: value.w,
    customAgents,
    teams,
  };
}

const CONFIG_START = "<rift_agent_roster_config>";
const CONFIG_END = "</rift_agent_roster_config>";

export function parseAgentRosterConfiguration(
  instructions: string | undefined,
): AgentRosterConfiguration | null {
  if (!instructions) return null;
  const start = instructions.indexOf(CONFIG_START);
  const end = instructions.indexOf(CONFIG_END, start + CONFIG_START.length);
  if (start === -1 || end === -1 || end <= start) return null;

  const serialized = instructions.slice(start + CONFIG_START.length, end);
  try {
    return normalizeAgentRosterConfiguration(
      expandManagedAgentRosterConfiguration(JSON.parse(serialized)),
    );
  } catch {
    return null;
  }
}

export function parseAgentRosterSkillInstructions(
  instructions: string | undefined,
): AgentRosterSelection | null {
  return parseAgentRosterConfiguration(instructions);
}

export function builtinAgentMention(agent: AgentPetDefinition): string {
  return `@agent:${slugify(agent.petName, agent.id, 40)}`;
}

const builtinMention = builtinAgentMention;

function permissionInstruction(profile: CustomAgentProfileConfig): string {
  if (profile.permissionPreset === "read-only") {
    return "Read-only: inspect and advise; do not write files or run state-changing commands.";
  }
  if (profile.permissionPreset === "workspace-write") {
    return "Workspace-write ceiling: state-changing tools stay inside the active isolated workspace and existing user/runtime authority.";
  }
  return "Trusted-workspace ceiling: use only server-exposed tools inside the active isolated workspace; this preset never grants unavailable authority or bypasses user scope.";
}

function agentReferenceLabel(
  id: string,
  customAgents: readonly CustomAgentProfileConfig[],
): string {
  const builtin = AGENT_PET_ROSTER.find((agent) => agent.id === id);
  if (builtin) return builtinMention(builtin);
  return customAgents.find((agent) => agent.id === id)?.mention ?? id;
}

function renderCustomAgentPack(profile: CustomAgentProfileConfig): string {
  const pet = getAgentPetCatalogDefinition(profile.petId);
  const memory = profile.memory.enabled
    ? `${profile.memory.scope}; ${profile.memory.instructions}`
    : "disabled";
  return `### ${profile.mention} - ${profile.name}, ${profile.roleName}
id=${profile.id}; pet=${pet.speciesLabel}; mission=${profile.mission}
Guidance: ${profile.communicationStyle}; autonomy=${profile.autonomy}; skills[${profile.skillAssignment}]=${profile.skillIds.join(",")}
Delegation enforced: model=${profile.model}; reasoning=${profile.reasoningEffort}; parallel=${profile.concurrencyLimit}
Main-run ceiling: tools=${profile.toolIds.length > 0 ? profile.toolIds.join(",") : "none"}; mcp=${profile.mcpServerIds.length > 0 ? profile.mcpServerIds.join(",") : "none"}; ${permissionInstruction(profile)}
Advisory (not filesystem/persistence boundaries): repo=${profile.repository}; folder=${profile.folder}; memory=${memory}; approval=${profile.approvalPolicy}; escalation=${profile.escalationPolicy}.`;
}

function renderTeamPack(
  team: AgentTeamConfig,
  customAgents: readonly CustomAgentProfileConfig[],
): string {
  const lead = agentReferenceLabel(team.leadAgentId, customAgents);
  const members = team.memberAgentIds.map((id) =>
    agentReferenceLabel(id, customAgents),
  );
  const reviewer = agentReferenceLabel(team.finalReviewerAgentId, customAgents);
  return `### ${team.mention} - ${team.name}
id=${team.id}; goal=${team.goal}
Lead=${lead}; members=${members.join(",")}; skills=${team.sharedSkillIds.length > 0 ? team.sharedSkillIds.join(",") : "none"}
Flow: route=${team.routing}; handoff=${team.handoff}; escalation=${team.escalationPolicy}; reviewer=${reviewer}
Done when: ${team.completionCriteria.join("; ")}
Activation: When ${team.mention} is named, ${lead} owns integration and uses delegate_task with each named non-lead participant's exact id for applicable work. The server rejects ids outside this enabled team. Dispatch independent work in parallel, collect each result, complete the handoff, then have ${reviewer} check every criterion.`;
}

export function renderAgentRosterSkillInstructions(
  selection: AgentRosterSelection,
): string {
  const normalized = normalizeAgentRosterConfiguration(selection);
  const activeAgent = AGENT_PET_ROSTER.find(
    (agent) => agent.id === normalized.activeAgentId,
  )!;
  const workflowAgents = normalized.workflowAgentIds.map(
    (id) => AGENT_PET_ROSTER.find((agent) => agent.id === id)!,
  );
  const builtinPacks = workflowAgents
    .map(
      (
        agent,
      ) => `### ${builtinMention(agent)} - ${agent.petName}, ${agent.roleName} (${agent.id})
Mission: ${agent.description}
Skills: ${agent.skillIds.join(",")}
Contract: ${agent.operatingInstructions}`,
    )
    .join("\n\n");
  const customPacks = normalized.customAgents
    .filter((agent) => agent.enabled)
    .map(renderCustomAgentPack)
    .join("\n\n");
  const teamPacks = normalized.teams
    .filter((team) => team.enabled)
    .map((team) => renderTeamPack(team, normalized.customAgents))
    .join("\n\n");
  const exactAgentMentions = [
    ...workflowAgents.map(builtinMention),
    ...normalized.customAgents
      .filter((agent) => agent.enabled)
      .map((agent) => agent.mention),
  ];
  const exactTeamMentions = normalized.teams
    .filter((team) => team.enabled)
    .map((team) => team.mention);

  const instructions = `${CONFIG_START}${serializeManagedAgentRosterConfiguration(normalized)}${CONFIG_END}

<rift_agent_crew>
Configured RIFT agent crew. ${builtinMention(activeAgent)} (${activeAgent.petName}, ${activeAgent.roleName}) is the default lead.

Exact mention contract:
- Agents: ${exactAgentMentions.join(", ") || "none"}
- Teams: ${exactTeamMentions.join(", ") || "none"}
- Treat an exact enabled @agent: mention as an explicit request for that profile. Use delegate_task with the exact id printed in that profile pack when the work can be isolated; otherwise adopt its role pack in the current run and say so concisely.
- Treat an exact enabled @team: mention as an explicit request for that team. The named lead owns integration and must coordinate applicable non-lead members with delegate_task using their exact ids. Run independent delegations in parallel up to the server-enforced limits; use sequential work only for real dependencies.
- Never claim an agent participated without either adopting its pack in the current run or receiving its delegate_task result. Never create ceremonial delegates.

Global coordination and permission rules:
- Start immediately; give concise tool-work status without exposing private chain-of-thought.
- Keep one lead accountable for scope, handoffs, verification, and the final answer.
- For an exactly mentioned custom profile, the server intersects its tool and exact MCP-id allowlists with tools owned by this user. Read-only profiles get read/view file actions, read-only MCP tools, and no terminal. Bounded delegates stay tool-less.
- Model, supported reasoning, identity, team membership, and concurrency are enforced. Repository/folder, memory, autonomy, approval, escalation, and skills are advisory because there is no per-profile filesystem, memory store, or approval-resume UI.
- The most restrictive applicable user, runtime, profile, and team permission wins. A profile can narrow access but cannot expand it. Preserve user work and verify observable outcomes before completion.

Built-in role packs:
${builtinPacks}

Custom role packs:
${customPacks || "No enabled custom agents."}

Team contracts:
${teamPacks || "No enabled teams."}
</rift_agent_crew>`;

  if (instructions.length > MAX_MANAGED_AGENT_ROSTER_INSTRUCTIONS_CHARS) {
    throw new Error(
      `Normalized agent roster is ${instructions.length} characters (config ${serializeManagedAgentRosterConfiguration(normalized).length}, built-ins ${builtinPacks.length}, custom ${customPacks.length}, teams ${teamPacks.length}); maximum is ${MAX_MANAGED_AGENT_ROSTER_INSTRUCTIONS_CHARS}`,
    );
  }
  return instructions;
}

export function getAgentPetDefinition(id: AgentPetRoleId): AgentPetDefinition {
  return AGENT_PET_ROSTER.find((agent) => agent.id === id)!;
}
