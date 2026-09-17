import {
  FileText,
  Globe,
  NotebookText,
  Terminal,
  Paperclip,
  type LucideIcon,
} from "lucide-react";
import {
  filterSlashCommands,
  SLASH_COMMAND_REGISTRY,
  type SlashCommandSurface,
  type SlashCommandDefinition,
} from "./slash-command-registry";
import type { ChatPurpose } from "@/types/chat";

export type ContextSourceItem = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  insert: string;
};

export const CONTEXT_SOURCES: ContextSourceItem[] = [
  {
    id: "terminal",
    label: "Terminal",
    description: "Include recent terminal output",
    icon: Terminal,
    insert: "@terminal ",
  },
  {
    id: "sandbox",
    label: "Sandbox",
    description: "Reference the active sandbox session",
    icon: Globe,
    insert: "@sandbox ",
  },
  {
    id: "notes",
    label: "Notes",
    description: "Pull from pentest notebook",
    icon: NotebookText,
    insert: "@notes ",
  },
  {
    id: "files",
    label: "Files",
    description: "Attach or reference uploaded files",
    icon: Paperclip,
    insert: "@files ",
  },
  {
    id: "docs",
    label: "Docs",
    description: "Reference documentation context",
    icon: FileText,
    insert: "@docs ",
  },
];

export type SlashCommandItem = SlashCommandDefinition;

/**
 * Normal chat exposes only the general-purpose command registry. Offensive
 * security operations are intentionally owned by the Max-gated Hack
 * Workbench and must never be surfaced as Build or Studio slash commands.
 */
export const SLASH_COMMANDS: SlashCommandItem[] = [...SLASH_COMMAND_REGISTRY];

/**
 * Composer catalog for the browser. Native-only commands remain parseable so
 * pasted commands receive an honest explanation, but they are not presented
 * as clickable browser actions.
 */
export const WEB_SLASH_COMMANDS: SlashCommandItem[] = [
  ...SLASH_COMMAND_REGISTRY.filter((command) => command.availability.web),
];

/** Resolve the honest, purpose-safe catalog for the active composer host. */
export function getComposerSlashCommands({
  purpose,
  surface,
}: Readonly<{
  purpose: ChatPurpose;
  surface: Extract<SlashCommandSurface, "web" | "desktop">;
}>): SlashCommandItem[] {
  const surfaceCatalog =
    surface === "web"
      ? WEB_SLASH_COMMANDS
      : filterSlashCommands("", {
          surface,
          includeUnavailable: false,
        });

  return surfaceCatalog.filter(
    (command) => !command.purposes || command.purposes.includes(purpose),
  );
}

export {
  SLASH_COMMAND_REGISTRY,
  filterSlashCommands,
  parseSlashCommand,
  resolveSlashCommand,
} from "./slash-command-registry";
