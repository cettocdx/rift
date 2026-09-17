"use client";

import { useCallback } from "react";
import { useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useChatNavigation } from "@/app/hooks/useChatNavigation";
import { useTauri } from "@/app/hooks/useTauri";
import { openShortcutsDialog } from "@/app/components/pro/ProShortcutsDialog";
import { openCommandPalette } from "@/lib/utils/command-palette";
import { useSettingsNavigation } from "@/app/components/settings/useSettingsNavigation";
import {
  openModelSelector,
  openReasoningSelector,
  requestProjectSelector,
} from "@/lib/utils/composer-controls";
import { clientLogout } from "@/lib/utils/logout";
import { dispatchChatCommand } from "@/lib/utils/chat-command-events";
import {
  executeGoalCommand,
  parseGoalCommand,
  type TaskGoal,
} from "@/lib/composer/goal-store";
import {
  browserTaskGoalStore,
  notifyTaskGoalChanged,
  readTaskGoal,
} from "@/lib/composer/browser-goal-store";
import { parseSlashCommand } from "@/lib/composer/palette-items";
import type {
  SlashCommandDefinition,
  SlashCommandId,
} from "@/lib/composer/slash-command-registry";
import {
  BUILD_MODELS,
  DEFAULT_BUILD_MODEL,
  MEDIA_MODELS,
  REASONING_EFFORT_LABELS,
  coerceSelectedModel,
  getEffectiveBuildModel,
  isBuildReasoningEffortSupported,
  parseReasoningEffort,
  type BuildModelId,
  type ChatMode,
  type ChatPurpose,
  type SelectedModel,
} from "@/types/chat";
import type { ChatStatus } from "@/types";

type SlashRuntimeOptions = Readonly<{
  taskId: string;
  status: ChatStatus;
  onStop: () => void;
  onClearComposer: () => void;
  onSetComposer: (value: string) => void;
  onSubmitPrompt: (prompt: string, mode: ChatMode) => void;
}>;

const BUILD_MODEL_ALIASES = Object.fromEntries(
  BUILD_MODELS.flatMap((model) =>
    model.aliases.map((alias) => [alias, model.id] as const),
  ),
) as Readonly<Record<string, BuildModelId>>;

const MODEL_ALIASES: Readonly<Record<string, SelectedModel>> = {
  auto: "auto",
  standard: "rift-standard",
  pro: "rift-pro",
  max: "rift-max",
};

export function resolveSlashModel(
  value: string,
  purpose: ChatPurpose,
): SelectedModel | null {
  const normalized = value.trim().toLowerCase();
  const direct = coerceSelectedModel(normalized);
  if (purpose === "app") {
    if (normalized === "auto") return DEFAULT_BUILD_MODEL;
    if (direct && BUILD_MODELS.some((model) => model.id === direct)) {
      return direct;
    }
    return BUILD_MODEL_ALIASES[normalized] ?? null;
  }
  if (purpose === "image") {
    return direct && MEDIA_MODELS.some((model) => model.id === direct)
      ? direct
      : null;
  }
  if (direct) return direct;
  const alias = MODEL_ALIASES[normalized];
  if (!alias) return null;
  if (alias === "build-fast") return "rift-standard";
  if (alias === "build-balanced" || alias === "build-codex") return "rift-pro";
  if (alias === "build-max") return "rift-max";
  return alias.startsWith("build-") ? null : alias;
}

function commandPrompt(commandId: SlashCommandId, args: string): string | null {
  switch (commandId) {
    case "init":
      return "Inspect this project and create or update its agent instructions file with concise repository-specific build, test, style, and safety guidance.";
    case "review":
      return args
        ? `Review the current work with this focus: ${args}`
        : "Review the current worktree for correctness, regressions, security issues, accessibility problems, and missing tests. Lead with concrete findings.";
    case "diff":
      return args
        ? `Inspect and explain the relevant diff for: ${args}`
        : "Inspect the current diff and summarize exactly what changed, why, and what still needs verification.";
    case "ps":
      return "List the relevant running development and agent processes, their ports or task roles, and flag stale or failed processes without stopping anything.";
    default:
      return null;
  }
}

function showGoal(goal: TaskGoal | null) {
  if (!goal) {
    toast.info("No goal is set", {
      description: "Use /goal <objective> to create one for this task.",
    });
    return;
  }
  toast.info(goal.status === "active" ? "Active goal" : "Goal paused", {
    description: goal.objective,
  });
}

function showUnavailable(command: SlashCommandDefinition) {
  toast.info(`/${command.id} is not available on this surface`, {
    description:
      command.availability.reason ||
      "This Codex command depends on a native IDE or CLI capability.",
  });
}

function showPurposeUnavailable(command: SlashCommandDefinition) {
  toast.info(`/${command.id} is not available in Studio`, {
    description:
      "Studio only runs media-safe commands. Open Build for planning, project review, process inspection, or delegated agent tasks.",
  });
}

export function useSlashCommandRuntime({
  taskId,
  status,
  onStop,
  onClearComposer,
  onSetComposer,
  onSubmitPrompt,
}: SlashRuntimeOptions) {
  const router = useRouter();
  const { isTauri } = useTauri();
  const { setTheme, resolvedTheme } = useTheme();
  const { goHome } = useChatNavigation();
  const { openSettings } = useSettingsNavigation();
  const renameChat = useMutation(api.chats.renameChat);
  const deleteChat = useMutation(api.chats.deleteChat);
  const {
    chatMode,
    setChatMode,
    chatPurpose,
    setChatPurpose,
    activeProject,
    initializeNewChat,
    selectedModel,
    setSelectedModel,
    setReasoningEffort,
    sandboxPreference,
    setSidebarOpen,
    setSidebarContent,
  } = useGlobalState();

  const execute = useCallback(
    async (input: string): Promise<boolean> => {
      const parsed = parseSlashCommand(input);
      if (parsed.kind === "not_command") return false;
      if (parsed.kind === "unknown") {
        toast.error(`Unknown command: /${parsed.name}`, {
          description: "Type / to browse available commands.",
        });
        return true;
      }

      const { command, rawArgs } = parsed;
      const activeSurface = isTauri ? "desktop" : "web";
      // Surface availability is a capability boundary. Check it before
      // argument validation so native-only commands always explain why they
      // cannot run instead of leaking into a misleading web fallback.
      if (!command.availability[activeSurface]) {
        showUnavailable(command);
        return true;
      }
      // Studio requests are routed directly into image/video generation.
      // Never transform developer-agent commands into accidental media
      // prompts, even when a command was pasted instead of chosen in the
      // purpose-filtered palette.
      if (!command.purposes.includes(chatPurpose)) {
        showPurposeUnavailable(command);
        return true;
      }
      if (!parsed.validation.valid) {
        toast.error(parsed.validation.message);
        return true;
      }
      const args = rawArgs.trim();
      const clear = () => onClearComposer();
      const send = (prompt: string, mode: ChatMode = "agent") => {
        setChatMode(mode);
        onSubmitPrompt(prompt, mode);
      };

      switch (command.id) {
        case "goal": {
          const goalCommand = parseGoalCommand(input);
          if (
            goalCommand.kind === "needs_input" ||
            goalCommand.kind === "invalid"
          ) {
            toast.error(goalCommand.message);
            return true;
          }
          if (goalCommand.kind !== "command") return false;
          const result = executeGoalCommand(
            browserTaskGoalStore,
            taskId,
            goalCommand.command,
          );
          if (!result.ok) {
            toast.error(result.message);
            return true;
          }
          clear();
          notifyTaskGoalChanged(taskId);
          showGoal(result.goal);
          return true;
        }
        case "model": {
          if (!args) {
            clear();
            // Let the originating composer Enter finish before sending the
            // nested Enter that Radix uses to open its dropdown. Otherwise the
            // outer key event can immediately close the menu again.
            await Promise.resolve();
            if (!openModelSelector()) {
              toast.info("Model selector is unavailable here", {
                description:
                  "Open a Build or Studio task to choose an available model.",
              });
            }
            return true;
          }
          const model = resolveSlashModel(args, chatPurpose);
          if (!model) {
            toast.error("Unknown or incompatible model", {
              description:
                chatPurpose === "app"
                  ? "Use sol, codex, claude, sonnet, opus, grok, kimi, qwen, fast, balanced, max, or a visible Build model id."
                  : chatPurpose === "image"
                    ? "Use a visible Studio model id, such as image-gpt, image-gemini, video-veo, or video-kling."
                    : "Use auto, standard, pro, max, or a RIFT tier id.",
            });
            return true;
          }
          setSelectedModel(model);
          if (chatPurpose === "image") {
            setChatMode(model.startsWith("video-") ? "agent" : "ask");
          }
          clear();
          toast.success(
            `Model set to ${
              chatPurpose === "app"
                ? getEffectiveBuildModel(model).model
                : model
            }`,
          );
          return true;
        }
        case "reasoning": {
          if (chatPurpose !== "app") {
            toast.info("Reasoning strength is available in Build", {
              description:
                "Open a Build task to choose a model-aware reasoning level.",
            });
            return true;
          }
          const activeModel = getEffectiveBuildModel(selectedModel);
          const supported = activeModel.reasoning.supportedEfforts;
          const supportedDescription = supported
            .map((effort) => REASONING_EFFORT_LABELS[effort])
            .join(", ");
          if (!args) {
            clear();
            await Promise.resolve();
            if (!openReasoningSelector()) {
              toast.info("Reasoning selector is unavailable here", {
                description:
                  "Open a Build task to choose a model-aware reasoning level.",
              });
            }
            return true;
          }
          const effort = parseReasoningEffort(args);
          if (
            !effort ||
            !isBuildReasoningEffortSupported(activeModel.id, effort)
          ) {
            toast.error(
              `Unsupported reasoning level for ${activeModel.model}`,
              {
                description: `Choose ${supportedDescription}.`,
              },
            );
            return true;
          }
          setReasoningEffort(effort);
          clear();
          toast.success(`Reasoning set to ${REASONING_EFFORT_LABELS[effort]}`);
          return true;
        }
        case "fast": {
          const fastModel: SelectedModel =
            chatPurpose === "app"
              ? "build-gemini"
              : chatPurpose === "image"
                ? selectedModel.startsWith("video-")
                  ? "video-veo-fast"
                  : "image-lite"
                : "rift-standard";
          setSelectedModel(fastModel);
          if (chatPurpose === "image") {
            setChatMode(fastModel.startsWith("video-") ? "agent" : "ask");
          }
          clear();
          toast.success("Fast model profile enabled");
          return true;
        }
        case "agent":
          setChatMode("agent");
          setSidebarContent(null);
          setSidebarOpen(true);
          clear();
          if (args) {
            send(
              `Delegate this bounded task to a subagent and report its progress clearly: ${args}`,
            );
          } else {
            toast.success("Agent mode enabled", {
              description: "Agent activity is open on the right.",
            });
          }
          return true;
        case "stop":
          clear();
          if (status === "streaming" || status === "submitted") onStop();
          else toast.info("No active run to stop");
          return true;
        case "clear":
          clear();
          return true;
        case "new":
          clear();
          initializeNewChat(chatPurpose, activeProject);
          goHome();
          return true;
        case "app":
          clear();
          setChatPurpose("app");
          initializeNewChat("app");
          goHome();
          return true;
        case "task":
          clear();
          initializeNewChat(chatPurpose, null);
          goHome();
          return true;
        case "apps":
          clear();
          router.push(command.action.path ?? "/plugins");
          return true;
        case "plugins":
          clear();
          router.push(command.action.path ?? "/plugins");
          return true;
        case "mcp":
          clear();
          router.push("/plugins");
          return true;
        case "skills":
          clear();
          router.push("/plugins?tab=skills");
          return true;
        case "project": {
          clear();
          if (chatPurpose !== "app") {
            toast.info("Project context is available in Build", {
              description: "Open a Build task to choose an isolated project.",
            });
            return true;
          }
          if (!requestProjectSelector()) {
            initializeNewChat("app", activeProject);
            goHome();
          }
          return true;
        }
        case "theme": {
          const theme = args.toLowerCase();
          if (!args) {
            const next = resolvedTheme === "dark" ? "light" : "dark";
            setTheme(next);
            clear();
            toast.success(
              `${next === "dark" ? "Dark" : "Light"} theme enabled`,
            );
            return true;
          }
          if (!["light", "dark", "system"].includes(theme)) {
            toast.error("Choose light, dark, or system");
            return true;
          }
          setTheme(theme);
          clear();
          return true;
        }
        case "cloud-environment":
          clear();
          openSettings("agents");
          return true;
        case "permissions":
          clear();
          openSettings("agents");
          return true;
        case "memories":
        case "personality":
          clear();
          openSettings("general");
          return true;
        case "usage":
          clear();
          // This opened the account section, which does not show usage.
          openSettings("billing");
          return true;
        case "mention":
          onSetComposer(args ? `@files ${args} ` : "@files ");
          return true;
        case "help":
          clear();
          openShortcutsDialog();
          return true;
        case "status": {
          clear();
          const goal = readTaskGoal(taskId);
          toast.info(`${chatMode} / ${selectedModel}`, {
            description: `${chatPurpose} / ${sandboxPreference}${goal ? ` / goal ${goal.status}` : " / no goal"}`,
          });
          return true;
        }
        case "fork":
          clear();
          dispatchChatCommand("fork");
          return true;
        case "rename":
          if (!args) {
            toast.error("Use /rename <new title>");
            return true;
          }
          try {
            await renameChat({ chatId: taskId, newTitle: args });
            clear();
            toast.success("Task renamed");
          } catch {
            toast.error("Could not rename this task", {
              description: "Try again after the task finishes loading.",
            });
          }
          return true;
        case "delete":
          if (args.toLowerCase() !== "confirm") {
            toast.error("Type /delete confirm to delete this task", {
              description:
                "This permanently removes the conversation and its stored files.",
            });
            return true;
          }
          try {
            await deleteChat({ chatId: taskId });
            browserTaskGoalStore.clear(taskId);
            clear();
            initializeNewChat(chatPurpose, activeProject);
            goHome();
            toast.success("Task deleted");
          } catch {
            toast.error("Could not delete this task", {
              description: "Nothing was removed. Try again in a moment.",
            });
          }
          return true;
        case "copy":
          dispatchChatCommand("copy-last-output");
          clear();
          return true;
        case "resume":
          clear();
          openCommandPalette({ query: args || undefined });
          return true;
        case "logout":
          if (args.toLowerCase() !== "confirm") {
            toast.error("Type /logout confirm to sign out");
            return true;
          }
          clear();
          clientLogout();
          return true;
        case "plan":
          if (!args) {
            setChatMode("ask");
            onSetComposer("/plan ");
            toast.info("Plan mode ready", {
              description: "Add the task after /plan and press Enter.",
            });
            return true;
          }
          clear();
          send(
            `Create a concrete step-by-step implementation plan for this task without making changes or taking actions: ${args}`,
            "ask",
          );
          return true;
      }

      const prompt = commandPrompt(command.id, args);
      if (prompt) {
        clear();
        send(prompt);
        return true;
      }

      toast.error(`/${command.id} has no web runtime handler`, {
        description: "This is a command-registry integration error.",
      });
      return true;
    },
    [
      activeProject,
      chatMode,
      openSettings,
      chatPurpose,
      deleteChat,
      goHome,
      initializeNewChat,
      isTauri,
      onClearComposer,
      onSetComposer,
      onStop,
      onSubmitPrompt,
      renameChat,
      resolvedTheme,
      router,
      sandboxPreference,
      selectedModel,
      setChatMode,
      setChatPurpose,
      setSelectedModel,
      setReasoningEffort,
      setSidebarContent,
      setSidebarOpen,
      setTheme,
      status,
      taskId,
    ],
  );

  return { execute };
}
