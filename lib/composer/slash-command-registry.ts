import {
  Archive,
  Bot,
  Brain,
  CircleHelp,
  Code2,
  Copy,
  FileDiff,
  FilePlus,
  FileSearch,
  FileText,
  Flag,
  Gauge,
  GitBranch,
  Globe,
  KeyRound,
  ListTree,
  MessageSquare,
  MoonStar,
  PanelRight,
  Pause,
  Play,
  Plug,
  Power,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  SquarePen,
  SquareTerminal,
  Terminal,
  Trash2,
  UserRound,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import { GOAL_OBJECTIVE_MAX_LENGTH } from "./goal-store";
import type { ChatPurpose } from "@/types/chat";

export const SLASH_COMMAND_SURFACES = ["web", "desktop", "ide", "cli"] as const;

export type SlashCommandSurface = (typeof SLASH_COMMAND_SURFACES)[number];

export type SlashCommandCategory =
  | "Task"
  | "Agent"
  | "Context"
  | "Environment"
  | "Integrations"
  | "Session"
  | "Configuration"
  | "Appearance"
  | "Support"
  | "Developer";

export type SlashCommandActionKind =
  | "dialog"
  | "navigate"
  | "local"
  | "send"
  | "system";

export type SlashCommandAction = Readonly<{
  /** Stable runtime dispatch key. It is always the canonical command id. */
  id: string;
  kind: SlashCommandActionKind;
  path?: string;
}>;

export type SlashCommandArgumentPolicy =
  | Readonly<{ kind: "none" }>
  | Readonly<{
      kind: "optional" | "required";
      hint: string;
      maxLength?: number;
    }>;

export type SlashCommandAvailability = Readonly<{
  web: boolean;
  desktop: boolean;
  ide: boolean;
  cli: boolean;
  /** Why a command is unavailable on a client surface. */
  reason?: string;
  /** A runtime entitlement/capability required even on supported surfaces. */
  condition?: string;
}>;

export type SlashCommandDefinition = Readonly<{
  id: string;
  label: string;
  description: string;
  category: SlashCommandCategory;
  group: SlashCommandCategory;
  icon: LucideIcon;
  insert: string;
  aliases: readonly string[];
  keywords: readonly string[];
  argumentPolicy: SlashCommandArgumentPolicy;
  argumentHint?: string;
  action: SlashCommandAction;
  availability: SlashCommandAvailability;
  /** Product surfaces where dispatching this command is semantically safe. */
  purposes: readonly ChatPurpose[];
  /** Compatibility with the pre-registry palette item contract. */
  operationId?: string;
}>;

const EVERYWHERE: SlashCommandAvailability = {
  web: true,
  desktop: true,
  ide: true,
  cli: true,
};

const ALL_PURPOSES: readonly ChatPurpose[] = ["security", "app", "image"];
const NON_MEDIA_PURPOSES: readonly ChatPurpose[] = ["security", "app"];

const WEB_AND_DESKTOP: SlashCommandAvailability = {
  web: true,
  desktop: true,
  ide: false,
  cli: false,
};

function noWeb(reason: string): SlashCommandAvailability {
  // The shipping Tauri app is intentionally a lite cloud wrapper and does not
  // expose native slash-command handlers. Keep desktop false until a concrete
  // invoke-backed runtime exists; otherwise the palette would advertise an
  // action that can only end in a no-op or integration error.
  return { web: false, desktop: false, ide: true, cli: true, reason };
}

type CommandInput = Omit<
  SlashCommandDefinition,
  | "label"
  | "group"
  | "insert"
  | "aliases"
  | "keywords"
  | "argumentPolicy"
  | "action"
  | "availability"
  | "purposes"
> &
  Partial<
    Pick<
      SlashCommandDefinition,
      | "label"
      | "insert"
      | "aliases"
      | "keywords"
      | "argumentPolicy"
      | "action"
      | "availability"
      | "purposes"
    >
  >;

function formatCommandLabel(id: string): string {
  const abbreviations: Readonly<Record<string, string>> = {
    ide: "IDE",
    mcp: "MCP",
    ps: "Processes",
  };
  return id
    .split("-")
    .map(
      (part) =>
        abbreviations[part] ?? part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
}

function command<const T extends CommandInput>(
  input: T,
): SlashCommandDefinition & Readonly<{ id: T["id"] }> {
  const argumentPolicy = input.argumentPolicy ?? { kind: "none" };
  return {
    ...input,
    label: input.label ?? formatCommandLabel(input.id),
    group: input.category,
    insert: input.insert ?? `/${input.id}`,
    aliases: input.aliases ?? [],
    keywords: input.keywords ?? [],
    argumentPolicy,
    argumentHint:
      argumentPolicy.kind === "none" ? undefined : argumentPolicy.hint,
    action: input.action ?? { kind: "local", id: input.id },
    availability: input.availability ?? EVERYWHERE,
    purposes: input.purposes ?? ALL_PURPOSES,
  };
}

const optional = (
  hint: string,
  maxLength?: number,
): SlashCommandArgumentPolicy => ({ kind: "optional", hint, maxLength });
const required = (
  hint: string,
  maxLength?: number,
): SlashCommandArgumentPolicy => ({ kind: "required", hint, maxLength });
const action = (
  id: string,
  kind: SlashCommandActionKind,
  path?: string,
): SlashCommandAction => ({ id, kind, path });

/**
 * Canonical command catalog for RIFT. The first block mirrors the current
 * Codex desktop command surface; the second block adds CLI-capable controls.
 * Surface metadata is deliberately explicit so a web client never pretends a
 * terminal/OS-only command can run in the browser.
 */
export const SLASH_COMMAND_REGISTRY = [
  command({
    id: "approve",
    description: "Approve one retry of a recent automatic-review denial",
    category: "Agent",
    icon: ShieldCheck,
    action: action("approve", "system"),
    availability: noWeb(
      "RIFT web does not yet expose the automatic-review denial retry queue",
    ),
  }),
  command({
    id: "cloud-environment",
    description: "Open agent and sandbox environment settings",
    category: "Environment",
    icon: Globe,
    action: action("cloud-environment", "dialog"),
    availability: EVERYWHERE,
  }),
  command({
    id: "compact",
    description:
      "Compact the current task context while preserving key decisions",
    category: "Context",
    icon: WandSparkles,
    action: action("compact", "system"),
    availability: noWeb(
      "RIFT web compacts context automatically and does not yet expose a manual compaction action",
    ),
  }),
  command({
    id: "fast",
    description: "Select the RIFT Fast model profile",
    category: "Configuration",
    icon: Gauge,
    action: action("fast", "system"),
    availability: {
      ...EVERYWHERE,
      condition: "The selected model must advertise a Fast tier",
    },
  }),
  command({
    id: "feedback",
    description: "Open feedback and optionally include diagnostic logs",
    category: "Support",
    icon: MessageSquare,
    action: action("feedback", "dialog"),
    availability: noWeb(
      "Diagnostic feedback submission is currently available only from the native host",
    ),
  }),
  command({
    id: "fork",
    description: "Fork the current task into a new task",
    category: "Session",
    icon: GitBranch,
    action: action("fork", "system"),
  }),
  command({
    id: "goal",
    description:
      "Set, edit, pause, resume, view, or clear the persistent task goal",
    category: "Task",
    icon: Flag,
    argumentPolicy: optional(
      "[view|pause|resume|clear|edit <objective>|<objective>]",
      GOAL_OBJECTIVE_MAX_LENGTH,
    ),
    insert: "/goal ",
    action: action("goal", "system"),
    keywords: ["objective", "persistent", "long-running"],
  }),
  command({
    id: "ide-context",
    description: "Attach live IDE selection and open-file context",
    category: "Context",
    icon: Code2,
    aliases: ["editor-context"],
    action: action("ide-context", "system"),
    availability: noWeb(
      "No live IDE context provider is connected to RIFT web. Use @files to reference project files instead.",
    ),
  }),
  command({
    id: "init",
    description: "Generate an AGENTS.md scaffold for the current project",
    category: "Developer",
    icon: FilePlus,
    action: action("init", "send"),
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "mcp",
    description: "Open the integrations workbench for MCP servers and tools",
    category: "Integrations",
    icon: Plug,
    insert: "/mcp",
    action: action("mcp", "dialog"),
    keywords: ["tools", "servers", "model context protocol"],
  }),
  command({
    id: "memories",
    description: "Configure saved notes used as task memory",
    category: "Context",
    icon: Brain,
    action: action("memories", "dialog"),
    availability: {
      ...EVERYWHERE,
      condition: "Saved notes are available according to the account plan",
    },
  }),
  command({
    id: "model",
    description: "Choose the active model for the current task",
    category: "Configuration",
    icon: Bot,
    argumentPolicy: optional("[model]"),
    action: action("model", "dialog"),
  }),
  command({
    id: "pet",
    description: "Choose, wake, hide, or tuck away the RIFT pet",
    category: "Appearance",
    icon: Sparkles,
    aliases: ["pets"],
    argumentPolicy: optional("[pet|off]"),
    action: action("pet", "dialog"),
    availability: noWeb(
      "The RIFT web mascot is not yet configurable from the composer",
    ),
  }),
  command({
    id: "personality",
    description: "Choose the communication style for responses",
    category: "Configuration",
    icon: UserRound,
    action: action("personality", "dialog"),
    availability: {
      ...EVERYWHERE,
      condition: "The selected model must support personalities",
    },
  }),
  command({
    id: "plan",
    description: "Enter plan mode, optionally with a planning request",
    category: "Agent",
    icon: ListTree,
    argumentPolicy: optional("[planning request]", 8_000),
    insert: "/plan ",
    action: action("plan", "system"),
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "project",
    description: "Choose the project used for new tasks",
    category: "Environment",
    icon: FileText,
    action: action("project", "dialog"),
    availability: WEB_AND_DESKTOP,
  }),
  command({
    id: "reasoning",
    description: "Choose the reasoning effort for the current task",
    category: "Configuration",
    icon: Brain,
    argumentPolicy: optional("[effort]"),
    action: action("reasoning", "dialog"),
  }),
  command({
    id: "review",
    description: "Review uncommitted changes or compare against a base branch",
    category: "Agent",
    icon: FileSearch,
    argumentPolicy: optional("[base branch|instructions]"),
    insert: "/review ",
    action: action("review", "dialog"),
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "side",
    description:
      "Start an ephemeral side conversation without interrupting the main task",
    category: "Session",
    icon: PanelRight,
    aliases: ["btw"],
    argumentPolicy: optional("[question]", 8_000),
    insert: "/side ",
    action: action("side", "system"),
    keywords: ["aside", "temporary", "ephemeral"],
    availability: noWeb(
      "RIFT web does not yet provide a separate ephemeral side-conversation thread",
    ),
  }),
  command({
    id: "status",
    description: "Show the current mode, model, environment, and goal status",
    category: "Session",
    icon: Gauge,
    action: action("status", "dialog"),
  }),
  command({
    id: "task",
    description: "Start a task without selecting a project",
    category: "Task",
    icon: SquarePen,
    action: action("task", "system"),
    availability: WEB_AND_DESKTOP,
  }),
  command({
    id: "worktree",
    description: "Run the task in a new Git worktree",
    category: "Environment",
    icon: GitBranch,
    argumentPolicy: optional("[branch name]"),
    action: action("worktree", "dialog"),
    availability: noWeb(
      "Creating an isolated Git worktree requires a desktop, IDE, or CLI filesystem host",
    ),
  }),

  command({
    id: "agent",
    description: "Open agent activity or delegate a bounded task",
    category: "Agent",
    icon: Bot,
    aliases: ["subagents"],
    argumentPolicy: optional("[task]"),
    action: action("agent", "dialog"),
    keywords: ["delegation", "threads", "team"],
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "apps",
    description: "Browse available app and integration plugins",
    category: "Integrations",
    icon: Globe,
    action: action("apps", "navigate", "/plugins"),
  }),
  command({
    id: "plugins",
    description: "Browse, install, connect, and manage plugins",
    category: "Integrations",
    icon: Plug,
    action: action("plugins", "navigate", "/plugins"),
  }),
  command({
    id: "hooks",
    description: "Inspect and manage trusted lifecycle hooks",
    category: "Developer",
    icon: Settings,
    action: action("hooks", "dialog"),
    availability: noWeb("Lifecycle hooks require the desktop or CLI host"),
  }),
  command({
    id: "clear",
    description: "Clear the current composer text",
    category: "Session",
    icon: RefreshCw,
    action: action("clear", "local"),
  }),
  command({
    id: "rename",
    description: "Rename the current task",
    category: "Session",
    icon: SquarePen,
    argumentPolicy: optional("[name]", 120),
    insert: "/rename ",
    action: action("rename", "dialog"),
  }),
  command({
    id: "archive",
    description: "Archive the current task without deleting its transcript",
    category: "Session",
    icon: Archive,
    action: action("archive", "system"),
    availability: noWeb(
      "RIFT web does not yet expose non-destructive task archival; /delete is permanent",
    ),
  }),
  command({
    id: "delete",
    description: "Permanently delete the current task and descendants",
    category: "Session",
    icon: Trash2,
    argumentPolicy: optional("[confirm]"),
    action: action("delete", "dialog"),
  }),
  command({
    id: "copy",
    description: "Copy the latest completed RIFT output",
    category: "Session",
    icon: Copy,
    action: action("copy", "local"),
  }),
  command({
    id: "diff",
    description: "Show tracked, untracked, staged, and unstaged Git changes",
    category: "Developer",
    icon: FileDiff,
    action: action("diff", "dialog"),
    availability: {
      ...EVERYWHERE,
      condition: "The task must have a Git-backed workspace",
    },
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "exit",
    description: "Exit the hosted developer session",
    category: "Session",
    icon: Power,
    aliases: ["quit"],
    action: action("exit", "system"),
    availability: noWeb(
      "Closing a browser tab is controlled by the browser, not the web application",
    ),
  }),
  command({
    id: "experimental",
    description: "Inspect and toggle experimental developer features",
    category: "Developer",
    icon: Sparkles,
    action: action("experimental", "dialog"),
    availability: noWeb(
      "Host feature flags are managed by the desktop or CLI runtime",
    ),
  }),
  command({
    id: "skills",
    description: "Browse and inspect installed skills",
    category: "Integrations",
    icon: WandSparkles,
    action: action("skills", "navigate", "/plugins?tab=skills"),
  }),
  command({
    id: "import",
    description: "Import supported external-agent configuration and chats",
    category: "Developer",
    icon: FilePlus,
    argumentPolicy: optional("[source]"),
    action: action("import", "dialog"),
    availability: noWeb(
      "Importing local agent files requires filesystem access through desktop or CLI",
    ),
  }),
  command({
    id: "logout",
    description: "Sign out of the current RIFT account",
    category: "Session",
    icon: Power,
    argumentPolicy: optional("[confirm]"),
    action: action("logout", "system"),
  }),
  command({
    id: "mention",
    description: "Insert the @files convention for a project file or folder",
    category: "Context",
    icon: FileSearch,
    argumentPolicy: optional("[path]"),
    insert: "/mention ",
    action: action("mention", "system"),
  }),
  command({
    id: "permissions",
    description: "Inspect or change approval and sandbox permissions",
    category: "Configuration",
    icon: KeyRound,
    action: action("permissions", "dialog"),
  }),
  command({
    id: "ide",
    description: "Attach current IDE selection and open-file context",
    category: "Context",
    icon: Code2,
    action: action("ide", "system"),
    availability: noWeb(
      "Live IDE selection is only available through an IDE or desktop bridge",
    ),
  }),
  command({
    id: "keymap",
    description: "Inspect and customize developer keyboard shortcuts",
    category: "Configuration",
    icon: Settings,
    action: action("keymap", "dialog"),
    availability: noWeb("TUI keymaps only apply to the CLI host"),
  }),
  command({
    id: "vim",
    description: "Toggle Vim editing mode in the terminal composer",
    category: "Configuration",
    icon: Terminal,
    action: action("vim", "system"),
    availability: noWeb("Vim composer mode is specific to the terminal UI"),
  }),
  command({
    id: "setup-default-sandbox",
    description: "Set up the elevated Windows agent sandbox",
    category: "Environment",
    icon: ShieldCheck,
    action: action("setup-default-sandbox", "system"),
    availability: noWeb("This command is Windows desktop/CLI only"),
  }),
  command({
    id: "sandbox-add-read-dir",
    description: "Grant the Windows sandbox read access to a directory",
    category: "Environment",
    icon: FilePlus,
    argumentPolicy: required("<directory>"),
    insert: "/sandbox-add-read-dir ",
    action: action("sandbox-add-read-dir", "system"),
    availability: noWeb("This command is Windows desktop/CLI only"),
  }),
  command({
    id: "ps",
    description: "Show background terminals and their recent output",
    category: "Developer",
    icon: SquareTerminal,
    action: action("ps", "dialog"),
    purposes: NON_MEDIA_PURPOSES,
  }),
  command({
    id: "stop",
    description: "Stop the active RIFT run",
    category: "Developer",
    icon: Pause,
    aliases: ["clean"],
    action: action("stop", "system"),
  }),
  command({
    id: "app",
    description: "Start a new RIFT Build task",
    category: "Task",
    icon: Play,
    action: action("app", "system"),
    availability: EVERYWHERE,
  }),
  command({
    id: "raw",
    description: "Toggle raw terminal scrollback mode",
    category: "Appearance",
    icon: Terminal,
    action: action("raw", "system"),
    availability: noWeb("Raw scrollback is a terminal-only display mode"),
  }),
  command({
    id: "resume",
    description: "Resume a saved task from the session list",
    category: "Session",
    icon: Play,
    argumentPolicy: optional("[task]", 240),
    insert: "/resume ",
    action: action("resume", "dialog"),
  }),
  command({
    id: "new",
    description: "Start a new task in the current project",
    category: "Task",
    icon: SquarePen,
    action: action("new", "system"),
  }),
  command({
    id: "usage",
    description: "View account usage and rate-limit reset windows",
    category: "Session",
    icon: Gauge,
    action: action("usage", "navigate", "/settings?tab=usage"),
  }),
  command({
    id: "debug-config",
    description: "Show effective configuration layers and policy diagnostics",
    category: "Developer",
    icon: Code2,
    action: action("debug-config", "dialog"),
    availability: noWeb(
      "Host configuration layers are exposed only by desktop or CLI",
    ),
  }),
  command({
    id: "statusline",
    description: "Configure terminal status-line fields",
    category: "Appearance",
    icon: ListTree,
    action: action("statusline", "dialog"),
    availability: noWeb("The status line is part of the terminal UI"),
  }),
  command({
    id: "title",
    description: "Configure terminal window and tab title fields",
    category: "Appearance",
    icon: FileText,
    action: action("title", "dialog"),
    availability: noWeb(
      "Terminal title control is available only to the CLI host",
    ),
  }),
  command({
    id: "theme",
    description: "Choose and persist the RIFT light or dark theme",
    category: "Appearance",
    icon: MoonStar,
    argumentPolicy: optional("[light|dark|system]"),
    action: action("theme", "dialog"),
    keywords: ["appearance", "color", "dark mode", "light mode"],
  }),
  command({
    id: "help",
    description: "Show slash commands and keyboard shortcuts",
    category: "Support",
    icon: CircleHelp,
    aliases: ["shortcuts"],
    action: action("help", "dialog"),
  }),
] as const satisfies readonly SlashCommandDefinition[];

export type SlashCommandId = (typeof SLASH_COMMAND_REGISTRY)[number]["id"];
export type RegisteredSlashCommand = (typeof SLASH_COMMAND_REGISTRY)[number];

const commandByName = new Map<string, RegisteredSlashCommand>();
for (const definition of SLASH_COMMAND_REGISTRY) {
  commandByName.set(definition.id, definition);
  for (const alias of definition.aliases) commandByName.set(alias, definition);
}

function normalizeName(value: string): string {
  return value.trim().replace(/^\//, "").toLowerCase();
}

export function resolveSlashCommand(
  name: string,
): RegisteredSlashCommand | undefined {
  return commandByName.get(normalizeName(name));
}

export type FilterSlashCommandOptions = Readonly<{
  surface?: SlashCommandSurface;
  purpose?: ChatPurpose;
  includeUnavailable?: boolean;
}>;

export function filterSlashCommands(
  query: string,
  options: FilterSlashCommandOptions = {},
): SlashCommandDefinition[] {
  const needle = normalizeName(query);
  const includeUnavailable = options.includeUnavailable ?? true;

  const available = SLASH_COMMAND_REGISTRY.filter(
    (definition) =>
      (!options.purpose || definition.purposes.includes(options.purpose)) &&
      (!options.surface ||
        includeUnavailable ||
        definition.availability[options.surface]),
  );
  if (!needle) return [...available];

  const prefixMatches = available.filter((definition) =>
    [definition.id, ...definition.aliases].some((name) =>
      name.startsWith(needle),
    ),
  );
  if (prefixMatches.length > 0) return prefixMatches;

  return available.filter((definition) =>
    [
      definition.id,
      ...definition.aliases,
      definition.label,
      definition.description,
      definition.category,
      definition.argumentHint ?? "",
      ...definition.keywords,
    ].some((value) => value.toLowerCase().includes(needle)),
  );
}

export type SlashCommandValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      code:
        | "arguments_not_allowed"
        | "arguments_required"
        | "arguments_too_long"
        | "unterminated_quote";
      message: string;
    }>;

export type ParsedSlashCommand =
  | Readonly<{
      kind: "command";
      command: RegisteredSlashCommand;
      invokedAs: string;
      args: readonly string[];
      rawArgs: string;
      validation: SlashCommandValidation;
    }>
  | Readonly<{
      kind: "unknown";
      name: string;
      rawArgs: string;
    }>
  | Readonly<{ kind: "not_command" }>;

type TokenizeResult =
  | Readonly<{ ok: true; args: readonly string[] }>
  | Readonly<{ ok: false }>;

/** Tokenizes quoted arguments without evaluating substitutions or escapes. */
function tokenizeArguments(value: string): TokenizeResult {
  if (!value) return { ok: true, args: [] };

  const args: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let started = false;

  for (const character of value) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      started = true;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) {
        args.push(token);
        token = "";
        started = false;
      }
      continue;
    }
    token += character;
    started = true;
  }

  if (quote) return { ok: false };
  if (escaped) token += "\\";
  if (started) args.push(token);
  return { ok: true, args };
}

function validateArguments(
  command: SlashCommandDefinition,
  rawArgs: string,
  tokenized: TokenizeResult,
): SlashCommandValidation {
  if (!tokenized.ok) {
    return {
      valid: false,
      code: "unterminated_quote",
      message: "Close the quoted slash-command argument before running it.",
    };
  }

  const policy = command.argumentPolicy;
  // `/goal edit <objective>` has a grammar keyword before the actual objective.
  // The shared 4000-character limit applies to objective data, not to `edit `.
  const validatedArgumentLength =
    command.id === "goal" && /^edit(?:[ \t]+|$)/i.test(rawArgs)
      ? rawArgs.replace(/^edit(?:[ \t]+)?/i, "").length
      : rawArgs.length;
  if (policy.kind === "none" && rawArgs) {
    return {
      valid: false,
      code: "arguments_not_allowed",
      message: `/${command.id} does not accept arguments.`,
    };
  }
  if (policy.kind === "required" && !rawArgs) {
    return {
      valid: false,
      code: "arguments_required",
      message: `/${command.id} requires ${policy.hint}.`,
    };
  }
  if (
    policy.kind !== "none" &&
    policy.maxLength !== undefined &&
    validatedArgumentLength > policy.maxLength
  ) {
    return {
      valid: false,
      code: "arguments_too_long",
      message: `/${command.id} arguments cannot exceed ${policy.maxLength} characters.`,
    };
  }
  return { valid: true };
}

/**
 * Parses only a complete, single-line slash invocation. Embedded commands,
 * markdown, multiple lines, and shell-like substitutions are never executed.
 */
export function parseSlashCommand(input: string): ParsedSlashCommand {
  if (typeof input !== "string") return { kind: "not_command" };
  const normalized = input.trim();
  if (!normalized.startsWith("/") || /[\r\n]/.test(normalized)) {
    return { kind: "not_command" };
  }

  const match = normalized.match(
    /^\/([a-z0-9][a-z0-9-]*(?::[a-z0-9][a-z0-9-]*)?)(?:[ \t]+(.*))?$/i,
  );
  if (!match) return { kind: "not_command" };

  const invokedAs = match[1].toLowerCase();
  const rawArgs = (match[2] ?? "").trim();
  const definition = resolveSlashCommand(invokedAs);
  if (!definition) return { kind: "unknown", name: invokedAs, rawArgs };

  const tokenized = tokenizeArguments(rawArgs);
  return {
    kind: "command",
    command: definition,
    invokedAs,
    args: tokenized.ok ? tokenized.args : [],
    rawArgs,
    validation: validateArguments(definition, rawArgs, tokenized),
  };
}
