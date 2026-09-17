import {
  projectBotCatalogSkills,
  renderProjectBotSkills,
  type ProjectBotSkill,
} from "./project-bot-skills";
import {
  AGENT_PET_ROSTER,
  DEFAULT_AGENT_ROSTER_SELECTION,
  getAgentPetCatalogDefinition,
  normalizeAgentRosterConfiguration,
  parseAgentRosterConfiguration,
  type AgentPetDefinition,
  type AgentRosterConfiguration,
  type AgentReasoningEffort,
  type CustomAgentProfileConfig,
} from "./pet-roster";
import {
  loadEnabledSkillsForRuntime,
  type EnabledSkill,
} from "@/lib/ai/skills/inject-skills";
import {
  BUILD_MODELS,
  resolveBuildReasoningEffort,
  type ChatPurpose,
  type SelectedModel,
} from "@/types/chat";
import type { ModelName } from "@/lib/ai/providers";
import { extractLatestUserRequest } from "@/lib/ai/tools/find-skills";

export type DelegatedAgentRole =
  | "researcher"
  | "reviewer"
  | "planner"
  | "debugger"
  | "product_designer"
  | "security_analyst";

export interface AgentRuntimePolicy {
  /** Owner-scoped configuration loaded by the backend, never from tool input. */
  configuration: AgentRosterConfiguration;
  source: "managed-roster" | "default-roster" | "roster-unavailable";
  /**
   * An explicit custom/team-looking mention could not be authorized because
   * the owner-scoped roster source was unavailable. Expose no tools.
   */
  failClosed: boolean;
  /** Exact enabled mentions present in the latest authoritative user request. */
  requestedAgentIds: string[];
  requestedTeamIds: string[];
  /** Profile whose constraints narrow the current main Agent run. */
  activeAgentId?: string;
  activeProfile?: CustomAgentProfileConfig;
  profileSkills?: Record<string, ProjectBotSkill[]>;
  /** Exact owned/configured ids delegate_task may accept for this request. */
  delegationAgentIds: string[];
}

export interface ResolvedDelegationAgent {
  id: string;
  mention: string;
  name: string;
  roleName: string;
  mission: string;
  role: DelegatedAgentRole;
  modelKey: string;
  modelLabel: string;
  reasoningEffort: AgentReasoningEffort;
  concurrencyLimit: number;
  profile?: CustomAgentProfileConfig;
  skills?: ProjectBotSkill[];
}

const DEFAULT_DELEGATION_MODEL_KEY = "model-gpt-5.6-sol";
const DEFAULT_DELEGATION_MODEL_LABEL = "GPT-5.6 Sol";

type AgentRequestMessage = {
  role?: unknown;
  metadata?: { isAutoContinue?: unknown };
};

const BUILTIN_DELEGATION_ROLES: Record<
  AgentPetDefinition["id"],
  DelegatedAgentRole
> = {
  "build-engineer": "planner",
  "product-designer": "product_designer",
  research: "researcher",
  marketing: "researcher",
  quality: "reviewer",
  "video-director": "product_designer",
};

function builtinMention(agent: AgentPetDefinition): string {
  return `@agent:${agent.petName.toLowerCase()}`;
}

function exactMentions(requestText: string): string[] {
  return Array.from(
    new Set(
      requestText.match(
        /(?<![a-z0-9_.-])@(agent|team):[a-z0-9]+(?:-[a-z0-9]+)*(?![a-z0-9_-]|\.[a-z0-9])/g,
      ) ?? [],
    ),
  );
}

/**
 * Auto-continue is an implementation detail, not a new user intent. Preserve
 * the immediately preceding visible request so a bounded profile cannot lose
 * its server policy midway through one logical run. Persisted hidden continue
 * rows may already be absent, so this helper is intentionally idempotent.
 */
export function extractAgentRuntimeRequest(
  messages: readonly unknown[],
  isAutoContinue = false,
): string {
  const latest = extractLatestUserRequest(messages);
  if (!isAutoContinue) return latest;

  let skippedMarkedContinuation = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as AgentRequestMessage;
    if (!message || message.role !== "user") continue;
    const text = extractLatestUserRequest([message]);
    const markedContinuation = message.metadata?.isAutoContinue === true;
    const currentContinueFallback =
      !skippedMarkedContinuation && text.trim().toLowerCase() === "continue";
    if (markedContinuation || currentContinueFallback) {
      skippedMarkedContinuation = true;
      continue;
    }
    return text;
  }
  return latest;
}

function delegationRoleForProfile(
  profile: CustomAgentProfileConfig,
): DelegatedAgentRole {
  const pet = getAgentPetCatalogDefinition(profile.petId);
  return BUILTIN_DELEGATION_ROLES[pet.visualPreset];
}

function managedConfigurationFromSkills(skills: readonly EnabledSkill[]): {
  configuration: AgentRosterConfiguration;
  source: AgentRuntimePolicy["source"];
  valid: boolean;
} {
  const managed = skills.find(
    (skill) => skill.catalog_id === "rift-agent-roster",
  );
  const parsed = parseAgentRosterConfiguration(managed?.instructions);
  if (parsed) {
    return { configuration: parsed, source: "managed-roster", valid: true };
  }
  return {
    configuration: normalizeAgentRosterConfiguration(
      DEFAULT_AGENT_ROSTER_SELECTION,
    ),
    source: "default-roster",
    valid: !managed,
  };
}

/**
 * Resolve exact mentions against an owner-scoped backend roster. Prompt text
 * selects among those records but can never define or expand the records.
 */
export function resolveAgentRuntimePolicy(
  skills: readonly EnabledSkill[],
  requestText: string,
  options: {
    rosterAvailable?: boolean;
    boundProfile?: CustomAgentProfileConfig;
    boundSkills?: ProjectBotSkill[];
    boundMeeting?: {
      profiles: CustomAgentProfileConfig[];
      agenda: string;
      skillsByProfile?: Record<string, ProjectBotSkill[]>;
    };
  } = {},
): AgentRuntimePolicy {
  if (options.boundMeeting) {
    const { profiles, agenda } = options.boundMeeting;
    const lead = profiles[0];
    const ids = profiles.map((p) => p.id);
    const team: AgentRosterConfiguration["teams"][number] = {
      id: "project-meeting",
      mention: "@team:project-meeting",
      name: "Project meeting",
      enabled: true,
      goal: agenda,
      leadAgentId: lead.id,
      memberAgentIds: ids,
      sharedSkillIds: [],
      routing: "lead-routed",
      handoff: "explicit",
      escalationPolicy: "when-blocked",
      finalReviewerAgentId: profiles[profiles.length - 1].id,
      completionCriteria: [
        "Collect actual participant contributions; name unavailable participants.",
        "Summarize decisions and proposed owner-assigned tasks; do not claim unsaved tasks are scheduled.",
      ],
    };
    return {
      configuration: {
        ...DEFAULT_AGENT_ROSTER_SELECTION,
        workflowAgentIds: [],
        customAgents: profiles.map((p) => ({
          ...p,
          concurrencyLimit: Math.min(p.concurrencyLimit, 2),
        })),
        teams: [team],
      },
      source: "managed-roster",
      failClosed: profiles.some((p) => !p.enabled),
      requestedAgentIds: ids,
      requestedTeamIds: [team.id],
      activeAgentId: lead.id,
      activeProfile: {
        ...lead,
        concurrencyLimit: Math.min(lead.concurrencyLimit, 2),
      },
      delegationAgentIds: ids,
      profileSkills:
        options.boundMeeting.skillsByProfile ??
        Object.fromEntries(
          profiles.map((p) => [p.id, projectBotCatalogSkills(p.skillIds)]),
        ),
    };
  }
  // Only a server-validated persisted bot binding may supply this option.
  // User mentions cannot replace a bot's identity or widen its permissions.
  if (options.boundProfile) {
    const profile = options.boundProfile;
    return {
      configuration: {
        ...DEFAULT_AGENT_ROSTER_SELECTION,
        workflowAgentIds: [],
        customAgents: [profile],
        teams: [],
      },
      source: "managed-roster",
      failClosed: !profile.enabled,
      requestedAgentIds: [profile.id],
      requestedTeamIds: [],
      activeAgentId: profile.id,
      activeProfile: profile,
      profileSkills: {
        [profile.id]:
          options.boundSkills ?? projectBotCatalogSkills(profile.skillIds),
      },
      delegationAgentIds: profile.enabled ? [profile.id] : [],
    };
  }
  const rosterReadAvailable = options.rosterAvailable ?? true;
  const resolvedRoster = managedConfigurationFromSkills(skills);
  const rosterAvailable = rosterReadAvailable && resolvedRoster.valid;
  const configuration = resolvedRoster.configuration;
  const source = rosterAvailable
    ? resolvedRoster.source
    : ("roster-unavailable" as const);
  const tokens = exactMentions(requestText);
  const builtinByMention = new Map(
    configuration.workflowAgentIds.flatMap((agentId) => {
      const agent = AGENT_PET_ROSTER.find((item) => item.id === agentId);
      return agent ? [[builtinMention(agent), agent.id] as const] : [];
    }),
  );
  const customByMention = new Map(
    configuration.customAgents
      .filter((profile) => profile.enabled)
      .map((profile) => [profile.mention, profile] as const),
  );
  const teamByMention = new Map(
    configuration.teams
      .filter((team) => team.enabled)
      .map((team) => [team.mention, team] as const),
  );

  const requestedAgentIds: string[] = [];
  const requestedTeamIds: string[] = [];
  const resolvedTokens = new Set<string>();
  let activeAgentId: string | undefined;

  for (const token of tokens) {
    const builtinId = builtinByMention.get(token);
    const custom = customByMention.get(token);
    const team = teamByMention.get(token);
    const agentId = builtinId ?? custom?.id;
    if (agentId || team) resolvedTokens.add(token);
    if (agentId && !requestedAgentIds.includes(agentId)) {
      requestedAgentIds.push(agentId);
      activeAgentId ??= agentId;
    }
    if (team && !requestedTeamIds.includes(team.id)) {
      requestedTeamIds.push(team.id);
      activeAgentId ??= team.leadAgentId;
    }
  }

  const allOwnedAgentIds = [
    ...configuration.workflowAgentIds,
    ...configuration.customAgents
      .filter((profile) => profile.enabled)
      .map((profile) => profile.id),
  ];
  const requestedTeams = configuration.teams.filter((team) =>
    requestedTeamIds.includes(team.id),
  );
  if (requestedTeams.length > 0) {
    activeAgentId = requestedTeams[0].leadAgentId;
  }
  const delegationAgentIds =
    requestedTeams.length === 0
      ? allOwnedAgentIds
      : Array.from(
          new Set(requestedTeams.flatMap((team) => team.memberAgentIds)),
        ).filter((id) => allOwnedAgentIds.includes(id));
  const activeProfile = configuration.customAgents.find(
    (profile) => profile.enabled && profile.id === activeAgentId,
  );
  const failClosed =
    !rosterAvailable && tokens.some((token) => !resolvedTokens.has(token));

  return {
    configuration,
    source,
    failClosed,
    requestedAgentIds,
    requestedTeamIds,
    activeAgentId,
    activeProfile,
    delegationAgentIds: failClosed ? [] : delegationAgentIds,
  };
}

/** Load only the authenticated user's enabled roster through the service query. */
export async function loadAgentRuntimePolicy(
  userId: string,
  requestText: string,
  purpose: ChatPurpose,
): Promise<AgentRuntimePolicy> {
  if (purpose !== "app") return resolveAgentRuntimePolicy([], requestText);
  const loaded = await loadEnabledSkillsForRuntime(userId);
  return resolveAgentRuntimePolicy(loaded.skills, requestText, {
    rosterAvailable: loaded.status === "available",
  });
}

export function resolveDelegationAgent(
  policy: AgentRuntimePolicy,
  agentId: string,
  currentModel?: string,
): ResolvedDelegationAgent | null {
  if (!policy.delegationAgentIds.includes(agentId)) return null;

  const builtin = AGENT_PET_ROSTER.find(
    (agent) =>
      agent.id === agentId &&
      policy.configuration.workflowAgentIds.includes(agent.id),
  );
  if (builtin) {
    return {
      id: builtin.id,
      mention: builtinMention(builtin),
      name: builtin.petName,
      roleName: builtin.roleName,
      mission: builtin.description,
      role: BUILTIN_DELEGATION_ROLES[builtin.id],
      modelKey: DEFAULT_DELEGATION_MODEL_KEY,
      modelLabel: DEFAULT_DELEGATION_MODEL_LABEL,
      reasoningEffort: "high",
      concurrencyLimit: 4,
    };
  }

  const profile = policy.configuration.customAgents.find(
    (candidate) => candidate.enabled && candidate.id === agentId,
  );
  if (!profile) return null;
  const configuredModel = BUILD_MODELS.find(
    (model) => model.id === profile.model,
  );
  const currentBuildModel = BUILD_MODELS.find(
    (model) => model.providerKey === currentModel,
  );
  const modelKey =
    configuredModel?.providerKey ??
    currentBuildModel?.providerKey ??
    DEFAULT_DELEGATION_MODEL_KEY;
  return {
    id: profile.id,
    mention: profile.mention,
    name: profile.name,
    roleName: profile.roleName,
    mission: profile.mission,
    role: delegationRoleForProfile(profile),
    modelKey,
    modelLabel:
      configuredModel?.model ??
      currentBuildModel?.model ??
      DEFAULT_DELEGATION_MODEL_LABEL,
    // Imported/stale profiles can predate the selected model's current
    // capability matrix. Never send an unsupported effort to a delegated run.
    reasoningEffort: resolveBuildReasoningEffort(
      modelKey,
      profile.reasoningEffort,
    ),
    concurrencyLimit: profile.concurrencyLimit,
    profile,
    skills:
      policy.profileSkills?.[profile.id] ??
      projectBotCatalogSkills(profile.skillIds),
  };
}

/** Apply a validated custom-profile model to the main run when explicitly named. */
export function resolveActiveAgentModel(
  policy: AgentRuntimePolicy,
  currentModel: ModelName,
): ModelName {
  if (!policy.activeProfile || policy.activeProfile.model === "auto") {
    return currentModel;
  }
  return (
    (BUILD_MODELS.find((model) => model.id === policy.activeProfile?.model)
      ?.providerKey as ModelName | undefined) ?? currentModel
  );
}

/** Resolve the same model before message processing/provider sanitization. */
export function resolveActiveAgentModelSelection(
  policy: AgentRuntimePolicy,
  currentModel?: SelectedModel,
): SelectedModel | undefined {
  if (!policy.activeProfile || policy.activeProfile.model === "auto") {
    return currentModel;
  }
  return (
    BUILD_MODELS.find((model) => model.id === policy.activeProfile?.model)
      ?.id ?? currentModel
  );
}

function workflowParticipantLabel(
  policy: AgentRuntimePolicy,
  agentId: string,
): string {
  const builtin = AGENT_PET_ROSTER.find((agent) => agent.id === agentId);
  if (builtin) return `${builtinMention(builtin)} (id=${builtin.id})`;
  const custom = policy.configuration.customAgents.find(
    (agent) => agent.id === agentId,
  );
  return custom ? `${custom.mention} (id=${custom.id})` : `id=${agentId}`;
}

/**
 * Render the exact server-authorized workflow selected for this request. The
 * reminder turns a persisted project choice into execution policy, rather than
 * leaving it as decorative project metadata.
 */
export function renderActiveAgentWorkflowReminder(
  policy: AgentRuntimePolicy,
  options: { persistentMention?: string } = {},
): string {
  if (policy.failClosed) {
    return `<active_agent_workflow>\nAn explicit agent workflow was requested, but the owner-scoped roster could not be verified. Do not claim that any agent or team participated and do not invent ids. Continue only with the non-delegated tools the server exposed.\n</active_agent_workflow>`;
  }

  const selectedTeams = policy.configuration.teams.filter((team) =>
    policy.requestedTeamIds.includes(team.id),
  );
  const source = options.persistentMention
    ? `persistent Build-project workflow ${options.persistentMention}`
    : "an exact mention in the current Build request";

  if (selectedTeams.length > 0) {
    const contracts = selectedTeams
      .map((team) => {
        const lead = workflowParticipantLabel(policy, team.leadAgentId);
        const members = team.memberAgentIds
          .map((id) => workflowParticipantLabel(policy, id))
          .join(", ");
        const reviewer = workflowParticipantLabel(
          policy,
          team.finalReviewerAgentId,
        );
        return `## ${team.mention} - ${team.name}\nGoal: ${team.goal}\nLead: ${lead}\nAuthorized participants: ${members}\nRouting: ${team.routing}; handoff: ${team.handoff}; escalation: ${team.escalationPolicy}\nFinal reviewer: ${reviewer}\nCompletion criteria: ${team.completionCriteria.join("; ") || "Verify the user's acceptance criteria and observable result."}`;
      })
      .join("\n\n");

    return `<active_agent_workflow>\nThis run was activated by ${source}. The workflow is executable server policy, not display metadata. The lead owns the plan, integration, tool execution, and final answer. For every applicable non-lead specialty, call delegate_task with the exact authorized id below; dispatch independent tasks in one parallel batch, collect their real outputs, and complete the configured handoff. Do not create ceremonial calls for irrelevant work. If a named participant is not delegated, do not claim it ran. The configured final reviewer must check the completion criteria before the run is reported complete.\n\n${contracts}\n${policy.activeProfile ? renderProjectBotSkills(policy.profileSkills?.[policy.activeProfile.id] ?? projectBotCatalogSkills(policy.activeProfile.skillIds)) : ""}\n</active_agent_workflow>`;
  }

  if (policy.activeAgentId) {
    const participant = workflowParticipantLabel(policy, policy.activeAgentId);
    const profile = policy.activeProfile;
    const roleContract = profile
      ? `\nName: ${profile.name}\nRole: ${profile.roleName}\nResponsibility: ${profile.mission}\nCommunication: ${profile.communicationStyle}\n${renderProjectBotSkills(policy.profileSkills?.[profile.id] ?? projectBotCatalogSkills(profile.skillIds))}`
      : "";
    return `<active_agent_workflow>\nThis run was activated by ${source}. Apply ${participant} as the accountable Build lead. ${profile ? `Its server-enforced model, reasoning effort, tool allowlist, MCP allowlist, permission ceiling, and concurrency are active.` : "Adopt its managed role contract in the main run."} Use delegate_task with its exact id only when a bounded independent task materially improves the result; otherwise execute as that lead directly. Never claim a separate delegate ran without a real delegate_task result.${roleContract}\n</active_agent_workflow>`;
  }

  return "";
}
