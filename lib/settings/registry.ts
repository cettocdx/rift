/**
 * The settings surface, as data.
 *
 * No React, no JSX and no icon imports live here on purpose: a server
 * component reads this for `generateMetadata`, a client component reads it for
 * navigation and search, and the drift tests read it with no DOM at all. Icons
 * are a string union that each rendering surface resolves for itself.
 *
 * This replaced a table that lived inside the settings dialog, where the only
 * way to ask "what settings exist" was to render one.
 */

export type SettingsSectionId =
  | "general"
  | "appearance"
  | "workbench"
  | "agents"
  | "api-keys"
  | "privacy"
  | "billing"
  | "keyboard"
  | "account";

/** Resolved by each surface; the registry stays free of component imports. */
export type SettingsIconId =
  | "general"
  | "appearance"
  | "workbench"
  | "agents"
  | "api-keys"
  | "privacy"
  | "billing"
  | "keyboard"
  | "account";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  description: string;
  icon: SettingsIconId;
  /** Extra terms the section answers to in search. */
  keywords: readonly string[];
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    id: "general",
    label: "General",
    description: "Personal instructions and notes",
    icon: "general",
    keywords: ["personalization", "custom instructions", "notes", "memory"],
  },
  {
    id: "appearance",
    label: "Appearance",
    description: "App themes, colors, fonts, and contrast",
    icon: "appearance",
    keywords: [
      "theme",
      "color",
      "light mode",
      "dark mode",
      "system",
      "font",
      "contrast",
      "import",
    ],
  },
  {
    id: "workbench",
    label: "Workbench & terminal",
    description: "Editor, terminal, and Build access",
    icon: "workbench",
    keywords: [
      "workspace",
      "terminal",
      "editor",
      "sandbox",
      "remote control",
      "local execution",
      "internet access",
      "browser",
      "folder access",
      "consent",
    ],
  },
  {
    id: "agents",
    label: "Agents & permissions",
    description: "Crew, execution, queues, and guardrails",
    icon: "agents",
    keywords: [
      "agent roster",
      "pets",
      "permissions",
      "security guardrails",
      "queue messages",
      "execution environment",
    ],
  },
  {
    // Was "models-providers". Model choice happens in the composer that runs
    // the model; the only control this section ever owned is the API key.
    id: "api-keys",
    label: "API keys",
    description: "RIFT API access for the terminal and scripts",
    icon: "api-keys",
    keywords: ["api keys", "terminal api", "token", "provider", "models"],
  },
  {
    id: "privacy",
    label: "Privacy & security",
    description: "Shared chats, data, and destructive actions",
    icon: "privacy",
    keywords: [
      "data controls",
      "shared chats",
      "delete chats",
      "delete sandbox",
      "privacy",
      "security",
    ],
  },
  {
    id: "billing",
    label: "Usage & billing",
    description: "Plan, balance, limits, and auto-reload",
    icon: "billing",
    keywords: [
      "usage",
      "extra usage",
      "billing",
      "plan",
      "pricing",
      "spending limit",
      "credits",
      "auto-reload",
      "subscription",
    ],
  },
  {
    id: "keyboard",
    label: "Keyboard & notifications",
    description: "Shortcut reference and notification scope",
    icon: "keyboard",
    keywords: [
      "shortcuts",
      "command palette",
      "keyboard",
      "notifications",
      "mod key",
    ],
  },
  {
    id: "account",
    label: "Account & organization",
    description: "Identity, team, and account deletion",
    icon: "account",
    keywords: ["account", "email", "organization", "team", "delete account"],
  },
] as const;

const SECTION_IDS = new Set<string>(
  SETTINGS_SECTIONS.map((section) => section.id),
);

export function isSettingsSectionId(
  value: string,
): value is SettingsSectionId {
  return SECTION_IDS.has(value);
}

export function getSettingsSection(
  id: SettingsSectionId,
): SettingsSection {
  const section = SETTINGS_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`Unknown settings section: ${id}`);
  return section;
}

/**
 * Names other surfaces already use for a section, plus the labels the old
 * dialog was opened with. Every one of these has a live caller or a URL a user
 * could have bookmarked, so they resolve rather than 404.
 */
export const SETTINGS_SECTION_ALIASES: Readonly<
  Record<string, SettingsSectionId>
> = {
  personalization: "general",
  "custom instructions": "general",
  "data controls": "privacy",
  "privacy-security": "privacy",
  "privacy & security": "privacy",
  "models-providers": "api-keys",
  "models & providers": "api-keys",
  "api keys": "api-keys",
  "remote control": "workbench",
  "workbench & terminal": "workbench",
  "agents & permissions": "agents",
  // Both of these used to land on the account section, which is the wrong
  // place to read a balance: they are billing.
  usage: "billing",
  "extra usage": "billing",
  "usage & billing": "billing",
  "keyboard & notifications": "keyboard",
  "account & organization": "account",
};

/** Aliases that leave settings entirely, because the surface owns itself. */
export const SETTINGS_EXTERNAL_ALIASES: Readonly<Record<string, string>> = {
  // The capability manager is the Plugins route; settings never owned it.
  extensions: "/plugins",
  "skills, plugins & mcp": "/plugins",
  plugins: "/plugins",
};

export const DEFAULT_SETTINGS_SECTION: SettingsSectionId = "general";

/**
 * The shells that host the settings routes.
 *
 * Opening settings from the IDE must not replace the file tree and the
 * terminal with a settings page, so each shell mounts its own copy of the
 * route under its own base path. A base path that is not in this list — the
 * marketing capture lab, for one — falls back to the root copy rather than
 * composing a URL that does not exist.
 */
export const SETTINGS_HOST_BASE_PATHS = [
  "/",
  "/workspace",
  "/lab/app",
] as const;

export type SettingsHostBasePath = (typeof SETTINGS_HOST_BASE_PATHS)[number];

function normalizeBasePath(basePath: string): SettingsHostBasePath {
  const trimmed = basePath.trim().replace(/\/+$/, "") || "/";
  return (SETTINGS_HOST_BASE_PATHS as readonly string[]).includes(trimmed)
    ? (trimmed as SettingsHostBasePath)
    : "/";
}

/**
 * Map anything a caller passes — a section id, a section label, an old dialog
 * tab name — onto a section. Returns null when the caller meant a surface
 * outside settings or meant nothing in particular.
 */
export function resolveSettingsSection(
  tab?: string | null,
): SettingsSectionId | null {
  if (!tab) return null;
  const normalized = tab.trim().toLowerCase();
  if (!normalized) return null;
  if (isSettingsSectionId(normalized)) return normalized;
  const byLabel = SETTINGS_SECTIONS.find(
    (section) => section.label.toLowerCase() === normalized,
  );
  if (byLabel) return byLabel.id;
  return SETTINGS_SECTION_ALIASES[normalized] ?? null;
}

/** A slug that belongs to another route, e.g. /settings/extensions. */
export function resolveExternalSettingsAlias(tab?: string | null) {
  if (!tab) return null;
  return SETTINGS_EXTERNAL_ALIASES[tab.trim().toLowerCase()] ?? null;
}

/**
 * Compose a settings URL for a shell. `basePath` comes from ProShellContext so
 * ⌘, inside the IDE stays inside the IDE instead of replacing the file tree
 * and terminal with a settings page.
 */
export function settingsHref(
  basePath: string,
  section?: SettingsSectionId | null,
): string {
  const host = normalizeBasePath(basePath);
  const root = host === "/" ? "" : host;
  return section ? `${root}/settings/${section}` : `${root}/settings`;
}

function scoreSection(section: SettingsSection, query: string): number {
  const label = section.label.toLowerCase();
  if (label === query) return 100;
  if (label.startsWith(query)) return 80;
  if (section.keywords.some((keyword) => keyword.toLowerCase() === query)) {
    return 60;
  }
  if (
    section.keywords.some((keyword) => keyword.toLowerCase().includes(query))
  ) {
    return 40;
  }
  if (label.includes(query)) return 30;
  if (section.description.toLowerCase().includes(query)) return 20;
  return 0;
}

/** Sections matching a query, best first. An empty query returns them all. */
export function searchSettingsSections(
  query: string,
): readonly SettingsSection[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return SETTINGS_SECTIONS;
  return SETTINGS_SECTIONS.map((section) => ({
    section,
    score: scoreSection(section, normalized),
  }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.section);
}

/**
 * The aliases, as routing-layer redirects.
 *
 * The `[section]` page can resolve an alias too, but it renders inside the
 * authenticated client shell: its `redirect()` reaches the browser as an
 * instruction in the RSC payload, so the reader sees the not-found body flash
 * before the navigation happens. Resolved in next.config instead, an old URL
 * is a 307 before any React runs. The page keeps its own resolution as the
 * fallback for anything the config misses.
 */
const URL_SHAPED = /^[a-z0-9-]+$/;

export function getSettingsAliasRedirects() {
  // Only the slug-shaped aliases become routes. The rest are dialog tab names
  // ("data controls", "usage & billing") that arrive through a caller rather
  // than an address bar, and the [section] page resolves those.
  return SETTINGS_HOST_BASE_PATHS.flatMap((basePath) => {
    const root = basePath === "/" ? "" : basePath;
    return [
      ...Object.entries(SETTINGS_SECTION_ALIASES)
        .filter(([alias]) => URL_SHAPED.test(alias))
        .map(([alias, section]) => ({
          source: `${root}/settings/${alias}`,
          destination: settingsHref(basePath, section),
          permanent: false,
        })),
      ...Object.entries(SETTINGS_EXTERNAL_ALIASES)
        .filter(([alias]) => URL_SHAPED.test(alias))
        .map(([alias, destination]) => ({
          source: `${root}/settings/${alias}`,
          destination,
          permanent: false,
        })),
    ];
  });
}
