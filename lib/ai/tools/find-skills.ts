import { tool, type ToolSet } from "ai";
import { z } from "zod";

import { SKILL_CATALOG } from "@/lib/ai/skills/catalog";
import { MANDATORY_BUILD_SKILLS } from "@/lib/ai/skills/mandatory-build-skills";
import type { ChatPurpose } from "@/types";
import type { EnabledSkill } from "@/lib/ai/skills/inject-skills";
import { partitionEnabledSkillsForTurn } from "@/lib/ai/skills/turn-skills";

const MAX_DISCOVERED_SKILLS = 3;
const OPTIONAL_CATEGORIES = new Set(["Build", "General"]);
const EXCLUDED_SKILL_IDS = new Set(["find-skills", "find_skills"]);

// Matched against normalizeDiscoveryText output, so entries are lowercase and
// diacritic-stripped ("küre" arrives as "kure"). The vocabulary must carry the
// user's languages, not just English — a Turkish "bana bir dönen küre oluştur"
// is exactly the kind of visual build the quality packs exist for.
const FRONTEND_BUILD_TERMS = new Set([
  "3b",
  "3d",
  "animasyon",
  "animation",
  "app",
  "application",
  "arayuz",
  "bilesen",
  "canvas",
  "chart",
  "component",
  "css",
  "dashboard",
  "design",
  "dunya",
  "editor",
  "ekran",
  "frontend",
  "galeri",
  "gallery",
  "game",
  "gezegen",
  "globe",
  "gorsel",
  "grafik",
  "harita",
  "html",
  "interface",
  "kart",
  "kure",
  "landing",
  "map",
  "mobil",
  "mobile",
  "modal",
  "nextjs",
  "oyun",
  "page",
  "panel",
  "planet",
  "portfolyo",
  "portfolio",
  "react",
  "responsive",
  "sahne",
  "sayfa",
  "scene",
  "sidebar",
  "simulation",
  "simulasyon",
  "site",
  "tailwind",
  "tasarim",
  "threejs",
  "tsx",
  "ui",
  "uygulama",
  "ux",
  "viewport",
  "vitrin",
  "webgl",
  "website",
]);

export interface DiscoveredSkill {
  id: string;
  name: string;
  category: "Build" | "General";
  reason: string;
  applicationInstructions: string;
}

export interface RequestSelectedSkill {
  id: string;
  name: string;
  scope: "all" | ChatPurpose;
  applicationInstructions: string;
}

export interface FindSkillsInstallationResult {
  success: boolean;
  installed: string[];
  refreshed: string[];
  failed: Array<{ catalogId: string; reason: string }>;
}

export interface FindSkillsRuntimeOptions {
  /** Agent mode persists catalog packs; Plan mode remains request-local. */
  persist?: boolean;
  /** Owner-scoped snapshot shared with the enabled-skill reminder. */
  enabledSkills?: readonly EnabledSkill[];
  install?: (catalogIds: string[]) => Promise<FindSkillsInstallationResult>;
}

type MessageLike = {
  role?: unknown;
  parts?: unknown;
  content?: unknown;
};

const normalizeDiscoveryText = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[ıİ]/g, "i")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");

/**
 * Shortest term that may be matched through a suffix. Below this, only exact
 * hits count: "car" would otherwise swallow "cargo", and "app" "apple".
 */
const MIN_STEMMABLE_TERM_LENGTH = 4;
/** Longest suffix tolerated — "oyun"+"unda", "kure"+"leri", "yaris"+"inda". */
const MAX_INFLECTION_LENGTH = 4;

/**
 * Turkish is agglutinative: the bare stem almost never survives into a real
 * sentence. "oyun" arrives as "oyunu", "sayfa" as "sayfası", "küre" as
 * "küreyi" — so an exact token match, which is all this had, left the catalog
 * effectively dead in the user's own language. Caught live on 18 Aug 2026:
 * "bir araba yarışı oyunu yap" matched NO term, so a Build that is nothing but
 * a game loaded neither the game playbook nor a single quality pack.
 *
 * Prefix-with-bounded-suffix is deliberately crude — no stemmer, no word list.
 * It admits a few false positives ("kartal" hits "kart"), and that trade is the
 * right way round: a spurious match costs one extra playbook in the context,
 * while a miss costs the whole quality set on exactly the tasks that need it.
 */
const tokenMatchesTerm = (token: string, term: string): boolean => {
  if (token === term) return true;
  if (term.length < MIN_STEMMABLE_TERM_LENGTH) return false;
  if (!token.startsWith(term)) return false;
  const inflection = token.length - term.length;
  return inflection > 0 && inflection <= MAX_INFLECTION_LENGTH;
};

export function isFrontendBuildRequest(task: string): boolean {
  const normalized = normalizeDiscoveryText(task);
  if (!normalized) return false;
  const tokens = normalized.split(" ");
  return tokens.some((token) =>
    [...FRONTEND_BUILD_TERMS].some((term) => tokenMatchesTerm(token, term)),
  );
}

/**
 * The playbooks every frontend build carries: the two quality profiles plus
 * the finish-line packs (share card, brand identity). Loaded by the agent's
 * opening find_skills call without asking — the same way Grok's builder pulls
 * its design/OG/imagine playbooks at the start of a run. Quality is not
 * opt-in; a build that did not ask for a share card still ships one.
 */
const FRONTEND_QUALITY_REASONS: Record<string, string> = {
  "ui-ux-pro-max":
    "Frontend work requires an explicit UX system, responsive states and accessibility verification.",
  "design-taste-frontend":
    "Frontend work requires an authored visual direction and an anti-generic quality preflight.",
  "og-share-card":
    "A pasted link should unfurl with a real card; the share image and meta tags are part of shipping.",
  "brand-identity":
    "A built product needs a real name, voice, and hero asset, decided during the build.",
};

const FRONTEND_QUALITY_SKILL_IDS: readonly string[] = [
  ...MANDATORY_BUILD_SKILLS.map((skill) => skill.id),
  "og-share-card",
  "brand-identity",
];

export function findFrontendQualitySkills(task: string): DiscoveredSkill[] {
  if (!isFrontendBuildRequest(task)) return [];
  return FRONTEND_QUALITY_SKILL_IDS.flatMap((id) => {
    const entry = SKILL_CATALOG.find((skill) => skill.id === id);
    if (!entry) return [];
    return [
      {
        id: entry.id,
        name: entry.name,
        category: "Build" as const,
        reason:
          FRONTEND_QUALITY_REASONS[entry.id] ??
          "Part of the standard frontend quality set.",
        applicationInstructions: entry.instructions,
      },
    ];
  });
}

const includesPhrase = (normalizedTask: string, phrase: string): boolean => {
  const normalizedPhrase = normalizeDiscoveryText(phrase);
  if (!normalizedPhrase) return false;
  return ` ${normalizedTask} `.includes(` ${normalizedPhrase} `);
};

const hasExplicitSelectionIntent = (
  normalizedTask: string,
  skillName: string,
): boolean => {
  const normalizedName = normalizeDiscoveryText(skillName);
  if (!normalizedName) return false;

  return [
    `use ${normalizedName}`,
    `using ${normalizedName}`,
    `apply ${normalizedName}`,
    `enable ${normalizedName}`,
    `activate ${normalizedName}`,
    `use the ${normalizedName} skill`,
    `apply the ${normalizedName} skill`,
    `use ${normalizedName} skill`,
    `apply ${normalizedName} skill`,
    `kullan ${normalizedName}`,
    `${normalizedName} kullan`,
    `${normalizedName} kullanarak`,
    `${normalizedName} uygula`,
    `${normalizedName} skill kullan`,
    `${normalizedName} skillini kullan`,
    `${normalizedName} skillini kullanarak`,
    `${normalizedName} skillini uygula`,
    `${normalizedName} becerisini kullan`,
    `${normalizedName} becerisini kullanarak`,
    `${normalizedName} becerisini uygula`,
    `${normalizedName} skill`,
  ].some((selection) => includesPhrase(normalizedTask, selection));
};

const hasDollarSelection = (rawTask: string, skillId: string): boolean => {
  const escapedId = skillId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_-])\\$${escapedId}(?=$|[^\\p{L}\\p{N}_-])`,
    "iu",
  ).test(rawTask);
};

const catalogEntryIsExplicitlySelected = (
  task: string,
  entry: (typeof SKILL_CATALOG)[number],
): boolean => {
  const normalizedTask = normalizeDiscoveryText(task);
  if (!normalizedTask) return false;

  const identifiers = [
    entry.id,
    entry.name,
    ...("discovery" in entry && entry.discovery?.aliases
      ? entry.discovery.aliases
      : []),
  ];

  return (
    identifiers.some((identifier) =>
      hasExplicitSelectionIntent(normalizedTask, identifier),
    ) ||
    normalizedTask === normalizeDiscoveryText(entry.id) ||
    hasDollarSelection(task, entry.id)
  );
};

/** Catalog skills explicitly activated by the user for this single request. */
export function findExplicitlySelectedSkills(
  task: string,
  purpose: ChatPurpose,
): RequestSelectedSkill[] {
  return SKILL_CATALOG.filter(
    (entry) =>
      (entry.scope === "all" || entry.scope === purpose) &&
      catalogEntryIsExplicitlySelected(task, entry),
  ).map((entry) => ({
    id: entry.id,
    name: entry.name,
    scope: entry.scope,
    applicationInstructions: entry.instructions,
  }));
}

const textFromParts = (parts: unknown): string => {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter(
      (part): part is { type: string; text: string } =>
        typeof part === "object" &&
        part !== null &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .join("\n");
};

/** Extract the authoritative current request rather than trusting tool args. */
export function extractLatestUserRequest(messages: readonly unknown[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index] as MessageLike;
    if (!message || message.role !== "user") continue;

    const partsText = textFromParts(message.parts);
    if (partsText.trim()) return partsText.trim().slice(0, 6_000);
    if (typeof message.content === "string" && message.content.trim()) {
      return message.content.trim().slice(0, 6_000);
    }
    const contentText = textFromParts(message.content);
    if (contentText.trim()) return contentText.trim().slice(0, 6_000);
  }
  return "";
}

/** Deterministic, read-only relevance pass over optional Build/General skills. */
export function findRelevantSkills(
  task: string,
  limit: number = MAX_DISCOVERED_SKILLS,
): DiscoveredSkill[] {
  const normalizedTask = normalizeDiscoveryText(task);
  if (!normalizedTask) return [];

  const explicitlySelectedIds = new Set(
    findExplicitlySelectedSkills(task, "app").map((skill) => skill.id),
  );

  const tokens = new Set(normalizedTask.split(" "));
  const cappedLimit = Math.max(
    0,
    Math.min(MAX_DISCOVERED_SKILLS, Math.trunc(limit)),
  );
  if (cappedLimit === 0) return [];

  return SKILL_CATALOG.map((entry, catalogIndex) => {
    if (
      !OPTIONAL_CATEGORIES.has(entry.category) ||
      (entry.scope !== "app" && entry.scope !== "all") ||
      EXCLUDED_SKILL_IDS.has(entry.id) ||
      !("discovery" in entry) ||
      !entry.discovery
    ) {
      return null;
    }

    // Explicitly naming a catalog skill is already a selection, not a reason
    // to recommend it again and ask for duplicate approval.
    if (explicitlySelectedIds.has(entry.id)) {
      return null;
    }

    const phraseMatches = (entry.discovery.phrases ?? []).filter((phrase) =>
      includesPhrase(normalizedTask, phrase),
    );
    const keywordMatches = (entry.discovery.keywords ?? []).filter(
      (keyword) => {
        const term = normalizeDiscoveryText(keyword);
        if (tokens.has(term)) return true;
        return [...tokens].some((token) => tokenMatchesTerm(token, term));
      },
    );
    const score = phraseMatches.length * 4 + keywordMatches.length * 3;
    if (score < 3) return null;

    return {
      catalogIndex,
      score,
      skill: {
        id: entry.id,
        name: entry.name,
        category: entry.category as "Build" | "General",
        reason: entry.discovery.reason,
        applicationInstructions: entry.instructions,
      } satisfies DiscoveredSkill,
    };
  })
    .filter((match): match is NonNullable<typeof match> => match !== null)
    .sort(
      (left, right) =>
        right.score - left.score || left.catalogIndex - right.catalogIndex,
    )
    .slice(0, cappedLimit)
    .map((match) => match.skill);
}

export const createFindSkills = (
  authoritativeTask?: string,
  runtime: FindSkillsRuntimeOptions = {},
) => {
  // Copy once: caller mutations and provider rebuilds cannot replace the
  // instruction body associated with an advertised exact ID during this run.
  const enabledSkills = (runtime.enabledSkills ?? []).map((skill) => ({
    ...skill,
  }));
  const partition = partitionEnabledSkillsForTurn(enabledSkills, {
    purpose: "app",
  });
  const loadableIds = new Set([
    ...partition.deferred.map((skill) => skill.id),
    ...partition.eager
      .filter((skill) => skill.scope === "app" || skill.scope === "all")
      .flatMap((skill) => (skill.catalog_id ? [skill.catalog_id] : [])),
  ]);
  return tool({
    description: `Load relevant Build playbooks before applicable implementation or planning, without asking permission. Self-contained explanations need no unrelated tool call.
Pass exact skill_ids from the enabled manifest to read full owner-scoped instructions without installing or refreshing anything; use this when a newly encountered domain needs an enabled pack. Omit skill_ids for existing task-based catalog discovery, anchored to the user's authoritative request: Agent mode installs/refreshes discovered packs; Plan mode loads request-locally. Full instructions already in reminders need no reload. Apply every returned pack; claim loading or installation only when the result confirms it.`,
    inputSchema: z.object({
      task: z
        .string()
        .trim()
        .min(1)
        .max(6_000)
        .describe(
          "The user's current Build request, without added assumptions.",
        ),
      skill_ids: z
        .array(z.string().trim().min(1).max(128))
        .min(1)
        .max(8)
        .optional()
        .describe(
          "Exact enabled skill IDs to load read-only, independent of task keywords. Omit for task-based catalog discovery.",
        ),
    }),
    execute: async ({
      task,
      skill_ids,
    }: {
      task: string;
      skill_ids?: string[];
    }) => {
      if (skill_ids !== undefined) {
        const requestedIds = [...new Set(skill_ids)];
        const activeSkills: DiscoveredSkill[] = [];
        const unavailableSkillIds: string[] = [];
        for (const id of requestedIds) {
          const matches = enabledSkills.filter(
            (skill) => skill.catalog_id === id,
          );
          if (!loadableIds.has(id) || matches.length !== 1) {
            unavailableSkillIds.push(id);
            continue;
          }
          const skill = matches[0];
          activeSkills.push({
            id,
            name: skill.name,
            category: skill.scope === "all" ? "General" : "Build",
            reason:
              "Loaded by exact ID from this run's owner-scoped enabled-skill snapshot.",
            applicationInstructions: skill.instructions,
          });
        }
        return {
          readOnly: true,
          matched: activeSkills.length > 0,
          count: activeSkills.length,
          frontendQualitySkillIds: [],
          optionalSkillIds: [],
          requestSelectedSkillIds: [],
          activeSkills,
          loadedSkillIds: activeSkills.map((skill) => skill.id),
          unavailableSkillIds,
          installation: {
            status: unavailableSkillIds.length ? "partial" : "loaded",
            installed: [],
            refreshed: [],
            failed: unavailableSkillIds.map((catalogId) => ({
              catalogId,
              reason:
                "Not uniquely available in this run's applicable enabled-skill snapshot.",
            })),
            reason:
              "Exact enabled-ID loading is request-local; account settings were not changed.",
          },
          note: activeSkills.length
            ? "Only the returned activeSkills instructions are loaded. Apply them now; unavailable IDs were not loaded."
            : "No requested ID could be loaded. Do not claim loading or infer missing instructions.",
        };
      }
      const analyzedTask = authoritativeTask?.trim() || task;
      const requestSelectedSkills = findExplicitlySelectedSkills(
        analyzedTask,
        "app",
      );
      const frontendQualitySkills = findFrontendQualitySkills(analyzedTask);
      const skills = findRelevantSkills(analyzedTask);
      const activeSkills = [
        ...frontendQualitySkills,
        ...requestSelectedSkills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          category: "Build" as const,
          reason: "Explicitly selected by the user for this Build request.",
          applicationInstructions: skill.applicationInstructions,
        })),
        ...skills,
      ].filter(
        (skill, index, all) =>
          all.findIndex((candidate) => candidate.id === skill.id) === index,
      );
      const catalogIds = activeSkills.map((skill) => skill.id);
      let installation:
        | {
            status: "installed";
            installed: string[];
            refreshed: string[];
            failed: Array<{ catalogId: string; reason: string }>;
          }
        | {
            status: "loaded" | "partial";
            installed: string[];
            refreshed: string[];
            failed: Array<{ catalogId: string; reason: string }>;
            reason: string;
          };

      if (runtime.persist && runtime.install && catalogIds.length > 0) {
        try {
          const result = await runtime.install(catalogIds);
          installation = result.success
            ? {
                status: "installed",
                installed: result.installed,
                refreshed: result.refreshed,
                failed: result.failed,
              }
            : {
                status: "partial",
                installed: result.installed,
                refreshed: result.refreshed,
                failed: result.failed,
                reason:
                  "Some catalog skills could not be persisted; every returned instruction pack is still loaded for this request.",
              };
        } catch (error) {
          installation = {
            status: "partial",
            installed: [],
            refreshed: [],
            failed: catalogIds.map((catalogId) => ({
              catalogId,
              reason: error instanceof Error ? error.message : "Install failed",
            })),
            reason:
              "Catalog persistence is unavailable; every returned instruction pack is still loaded for this request.",
          };
        }
      } else {
        installation = {
          status: "loaded",
          installed: [],
          refreshed: [],
          failed: [],
          reason:
            runtime.persist && !runtime.install
              ? "Catalog persistence is unavailable; the selected skills are loaded request-locally."
              : "Plan mode loads selected skills for this request without changing account settings.",
        };
      }

      // `activeSkills` holds the only full copy of every instruction pack.
      // The other groupings are id-only: repeating the same instructions under
      // `skills`/`requiredSkills`/`requestSelectedSkills` tripled this payload
      // and re-sent the duplicate on every later step of the agent loop.
      return {
        readOnly: !(runtime.persist && runtime.install),
        matched: activeSkills.length > 0,
        count: activeSkills.length,
        frontendQualitySkillIds: frontendQualitySkills.map((skill) => skill.id),
        optionalSkillIds: skills.map((skill) => skill.id),
        requestSelectedSkillIds: requestSelectedSkills.map((skill) => skill.id),
        activeSkills,
        loadedSkillIds: catalogIds,
        installation,
        note:
          activeSkills.length > 0
            ? "Every activeSkills instruction pack is loaded now. Apply them immediately without asking for confirmation, then continue the Build in this turn."
            : "No catalog skill is materially relevant. Continue the Build without inventing or padding a skill selection.",
      };
    },
  });
};

/** Purpose gate shared by Agent and Ask/Plan tool-set construction. */
export const createFindSkillsToolSet = (
  purpose: ChatPurpose,
  authoritativeTask?: string,
  runtime?: FindSkillsRuntimeOptions,
): ToolSet =>
  purpose === "app"
    ? { find_skills: createFindSkills(authoritativeTask, runtime) }
    : {};
