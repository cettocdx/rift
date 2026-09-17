import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { appendSystemReminderToLastUserMessage } from "@/lib/api/chat-stream-helpers";
import {
  extractLatestUserRequest,
  findExplicitlySelectedSkills,
  type RequestSelectedSkill,
} from "@/lib/ai/tools/find-skills";
import type { ChatPurpose } from "@/types/chat";
import { MANAGED_AGENT_ROSTER_SKILL_ID } from "@/lib/ai/agents/pet-roster";
import {
  partitionEnabledSkillsForTurn,
  type DeferredEnabledSkill,
} from "./turn-skills";
import {
  buildSkillSuggestionReminder,
  findSuggestibleSkills,
} from "@/lib/ai/skills/skill-suggestions";

/**
 * Skills injection. Persistently enabled skills are pulled from Convex and
 * explicit request-local catalog selections are resolved from the current user
 * request. Full instructions and the progressive enabled manifest are appended
 * to the last user message as a <system-reminder>, like notes.
 *
 * Additive & non-fatal: any failure degrades to "no skills", never an error.
 */

type SkillScope = "all" | "security" | "app" | "image";

export interface EnabledSkill {
  name: string;
  instructions: string;
  scope: SkillScope;
  catalog_id?: string;
}

export type EnabledSkillsRuntimeLoad =
  | { status: "available"; skills: EnabledSkill[] }
  | {
      status: "unavailable";
      skills: [];
      reason: "disabled" | "missing-service-key" | "query-failed";
    };

type Messages = Parameters<typeof appendSystemReminderToLastUserMessage>[0];

/**
 * Runtime-sensitive read that distinguishes a confirmed empty result from an
 * unavailable authorization/configuration source. Never throws.
 */
export async function loadEnabledSkillsForRuntime(
  userId: string,
): Promise<EnabledSkillsRuntimeLoad> {
  if (process.env.SKILLS_DISABLED === "true") {
    return { status: "unavailable", skills: [], reason: "disabled" };
  }
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) {
    return {
      status: "unavailable",
      skills: [],
      reason: "missing-service-key",
    };
  }
  try {
    return {
      status: "available",
      skills: await getConvexClient().query(api.skills.listEnabledForBackend, {
        serviceKey,
        userId,
      }),
    };
  } catch (error) {
    console.warn(
      "[skills] Failed to load enabled skills:",
      error instanceof Error ? error.message : error,
    );
    return { status: "unavailable", skills: [], reason: "query-failed" };
  }
}

/** Read the user's enabled skills for non-authoritative prompt injection. */
export async function loadEnabledSkills(
  userId: string,
): Promise<EnabledSkill[]> {
  return (await loadEnabledSkillsForRuntime(userId)).skills;
}

function scopeMatches(skill: EnabledSkill, purpose: ChatPurpose): boolean {
  if (skill.catalog_id === MANAGED_AGENT_ROSTER_SKILL_ID) {
    return purpose === "app" || purpose === "image";
  }
  return skill.scope === "all" || skill.scope === purpose;
}

/** Build the <active_skills> reminder for the skills applicable to `purpose`. */
export function buildSkillsReminder(
  skills: EnabledSkill[],
  purpose: ChatPurpose,
): string {
  const applicable = skills.filter((skill) => scopeMatches(skill, purpose));
  if (applicable.length === 0) return "";
  const body = applicable
    .map((s) => `## Skill: ${s.name}\n${s.instructions.trim()}`)
    .join("\n\n");
  return `<active_skills>\nThe user has enabled the following skills. Apply their guidance whenever it is relevant to the current task. If a skill does not apply to the request at hand, ignore it.\n\n${body}\n</active_skills>`;
}

/** Build a non-persistent reminder for skills explicitly selected this turn. */
export function buildRequestSelectedSkillsReminder(
  skills: RequestSelectedSkill[],
): string {
  if (skills.length === 0) return "";
  const body = skills
    .map(
      (skill) =>
        `## Skill: ${skill.name} (${skill.id})\n${skill.applicationInstructions.trim()}`,
    )
    .join("\n\n");
  return `<request_selected_skills>\nThe user explicitly selected the following skills for this request. Their application instructions are active now. Apply them without asking for another confirmation. This activation is request-local; do not claim the skills were persistently enabled.\n\n${body}\n</request_selected_skills>`;
}

/** Manifest entries advertise availability; their instructions are not loaded. */
export function buildEnabledSkillManifest(
  skills: readonly DeferredEnabledSkill[],
): string {
  if (skills.length === 0) return "";
  const body = skills
    .map((skill) => `- ${skill.id} (${skill.name}) — ${skill.description}`)
    .join("\n");
  return `<enabled_skill_manifest>\nThese skills are enabled, but their instructions are not loaded. Before applicable implementation or planning, call find_skills with exact skill_ids from this list and the current task. Exact enabled-ID loads are read-only and do not change account settings. Read and apply returned instructions; do not infer their contents from these descriptions. A self-contained explanation needs no unrelated skill load.\n\n${body}\n</enabled_skill_manifest>`;
}

const skillFingerprint = (name: string, instructions: string): string =>
  `${name.trim().toLowerCase()}\u0000${instructions.trim()}`;

/**
 * Inject request-local selections plus the user's enabled skills matching
 * `purpose`. Returns the (possibly updated) messages.
 */
export async function injectSkillsIntoMessages(
  messages: Messages,
  opts: {
    userId: string;
    purpose: ChatPurpose;
    requestText?: string;
    /** Reuse an owner-scoped preflight read instead of querying Convex twice. */
    enabledSkills?: EnabledSkill[];
    /** Legacy caller metadata; progressive loading never drops roster guidance. */
    standaloneGreeting?: boolean;
  },
): Promise<Messages> {
  if (process.env.SKILLS_DISABLED === "true") return messages;

  const requestText =
    opts.requestText ??
    extractLatestUserRequest(messages as readonly unknown[]);
  const requestSelectedSkills = findExplicitlySelectedSkills(
    requestText,
    opts.purpose,
  );
  const selectedFingerprints = new Set(
    requestSelectedSkills.map((skill) =>
      skillFingerprint(skill.name, skill.applicationInstructions),
    ),
  );
  // Only a caller-supplied snapshot can also be wired into the tool factory.
  // A fallback read stays eager, so we never advertise an unavailable loader.
  const enabledSkills = (
    opts.enabledSkills ?? (await loadEnabledSkills(opts.userId))
  ).filter(
    (skill) =>
      !selectedFingerprints.has(
        skillFingerprint(skill.name, skill.instructions),
      ),
  );
  const partition =
    opts.enabledSkills !== undefined
      ? partitionEnabledSkillsForTurn(enabledSkills, {
          purpose: opts.purpose,
          explicitSkillIds: new Set(
            requestSelectedSkills.map((skill) => skill.id),
          ),
        })
      : { eager: enabledSkills, deferred: [] };
  // Build gets a name-only suggestion list for skills that are not active, so
  // the model can offer one without any run paying for instructions the user
  // never asked for. Anything already active is excluded — suggesting it would
  // be noise on top of the pack that is right there in context.
  const activeSkillIds = new Set<string>([
    ...requestSelectedSkills.map((skill) => skill.id),
    ...enabledSkills.flatMap((skill) =>
      skill.catalog_id ? [skill.catalog_id] : [],
    ),
  ]);
  const suggestions =
    opts.purpose === "app"
      ? findSuggestibleSkills(requestText, { excludeIds: activeSkillIds })
      : [];

  const reminder = [
    buildRequestSelectedSkillsReminder(requestSelectedSkills),
    buildSkillsReminder(partition.eager, opts.purpose),
    buildEnabledSkillManifest(partition.deferred),
    buildSkillSuggestionReminder(suggestions),
  ]
    .filter(Boolean)
    .join("\n\n");
  if (!reminder) return messages;
  return appendSystemReminderToLastUserMessage(messages, reminder);
}
