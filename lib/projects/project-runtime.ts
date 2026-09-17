import type { ProjectBotSkill } from "@/lib/ai/agents/project-bot-skills";
import "server-only";

import { createHmac } from "node:crypto";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import type { Id } from "@/convex/_generated/dataModel";
import type { ChatPurpose } from "@/types/chat";
import { coerceChatPurpose } from "@/types/chat";
import { ChatSDKError } from "@/lib/errors";
import { parseProjectBotProfile } from "@/lib/ai/agents/project-bot-templates";
import type { CustomAgentProfileConfig } from "@/lib/ai/agents/pet-roster";
import {
  getActiveProjectForUser,
  getProjectBotForRuntime,
  getBotMeetingForRuntime,
} from "@/lib/db/actions";

type RuntimeChat = {
  id?: string;
  project_bot_id?: Id<"project_bots">;
  bot_meeting_id?: Id<"bot_meetings">;
  user_id: string;
  purpose?: string;
  project_id?: Id<"projects">;
};

export type ProjectGithubRepository = {
  id: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
};

type ActiveProject = {
  github_repository?: ProjectGithubRepository;
  _id: Id<"projects">;
  type: ChatPurpose;
  agent_mention?: string;
};

export type ProjectRuntimeContext = {
  githubRepository?: ProjectGithubRepository;
  purpose: ChatPurpose;
  projectId?: Id<"projects">;
  /** Owner-configured exact @agent/@team mention for this Build workspace. */
  agentMention?: string;
  botProfile?: CustomAgentProfileConfig;
  botSkills?: ProjectBotSkill[];
  botMeeting?: {
    profiles: CustomAgentProfileConfig[];
    agenda: string;
    skillsByProfile?: Record<string, ProjectBotSkill[]>;
  };
  /** Opaque E2B identity; absent preserves the legacy per-user workspace. */
  sandboxNamespace?: string;
};

export type ResolveProjectRuntimeDependencies = {
  getActiveProject: (args: {
    projectId: string;
    userId: string;
  }) => Promise<ActiveProject | null>;
  getBot?: typeof getProjectBotForRuntime;
  getMeeting?: typeof getBotMeetingForRuntime;
  namespaceSecret?: string;
};

/** Cache-friendly model context for an owner-configured project workflow. */
export function projectAgentAssignmentReminder(
  agentMention: string | undefined,
): string {
  if (!agentMention) return "";
  return `<project_agent_assignment>\nThis Build project is configured to use ${agentMention}. Treat this server-validated project setting as an explicit invocation for the current run. Apply the matching agent or team profile, delegation limits, permissions, handoffs, and completion criteria from the active roster.\n</project_agent_assignment>`;
}

const unavailableProject = () =>
  new ChatSDKError("forbidden:chat", "The selected project is not available.", {
    project_context_invalid: true,
  });

function requestedProjectId(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw unavailableProject();
  }
  return value;
}

function requireNamespaceSecret(secret: string | undefined): string {
  if (!secret) {
    throw new ChatSDKError(
      "bad_request:api",
      "Project workspaces are not configured on this server.",
    );
  }
  return secret;
}

function runtimeNamespaceSecret(explicit?: string): string {
  return requireNamespaceSecret(
    explicit ?? getSandboxContext().namespaceSecret,
  );
}

/**
 * Derive a stable, non-enumerable E2B identity. Neither the user ID nor the
 * project ID appears in the result, and changing either creates a new scope.
 */
export function deriveProjectSandboxNamespace(
  userId: string,
  projectId: string,
  secret?: string,
): string {
  const digest = createHmac("sha256", runtimeNamespaceSecret(secret))
    .update("rift-project-workspace\0v1\0")
    .update(userId)
    .update("\0")
    .update(projectId)
    .digest("base64url");
  return `rift-project-${digest.slice(0, 43)}`;
}

/**
 * Stable per-chat workspace identity, retained for migrated Build sessions.
 * Changing this salt or choosing a new namespace would hide existing files.
 */
export function deriveChatSandboxNamespace(
  userId: string,
  chatId: string,
  secret?: string,
): string {
  const digest = createHmac("sha256", runtimeNamespaceSecret(secret))
    .update("rift-chat-workspace\0v1\0")
    .update(userId)
    .update("\0")
    .update(chatId)
    .digest("base64url");
  return `rift-chat-${digest.slice(0, 43)}`;
}

/** Preserve stored workspace identity when switching harnesses or modes. */
export function resolveChatSandboxNamespace({
  userId,
  chatId,
  chat,
  projectNamespace,
  secret,
}: {
  userId: string;
  chatId: string;
  chat?: {
    opencode_session_id?: string | null;
    opencode_sandbox_id?: string | null;
  } | null;
  projectNamespace?: string;
  secret?: string;
}): string | undefined {
  if (projectNamespace) return projectNamespace;
  if (chat?.opencode_session_id || chat?.opencode_sandbox_id) {
    return deriveChatSandboxNamespace(userId, chatId, secret);
  }
  // Existing native sessions use the per-user workspace. Do not move it
  // implicitly: migration needs an explicit, persisted workspace binding.
  return undefined;
}

/**
 * Resolve the authoritative execution context before persistence, tools, or a
 * sandbox are touched. Existing chat bindings always win over request data.
 */
export async function resolveProjectRuntimeContext(
  {
    userId,
    chat,
    requestedProject,
    requestedPurpose,
  }: {
    userId: string;
    chat?: RuntimeChat | null;
    requestedProject?: unknown;
    requestedPurpose?: string | null;
  },
  dependencies: ResolveProjectRuntimeDependencies = {
    getActiveProject: getActiveProjectForUser,
  },
): Promise<ProjectRuntimeContext> {
  // Copy authority before any await, including for callers without a worker
  // scope. Validate it only at the existing signing step after authorization.
  const namespaceSecret =
    dependencies.namespaceSecret ?? getSandboxContext().namespaceSecret;
  if (chat && chat.user_id !== userId) {
    throw new ChatSDKError(
      "forbidden:chat",
      "You don't have permission to access this chat",
    );
  }

  const requestedId = requestedProjectId(requestedProject);
  const persistedId = chat?.project_id;

  if (persistedId && requestedId && persistedId !== requestedId) {
    throw unavailableProject();
  }

  // Existing unbound chats cannot be retroactively attached by a request.
  // This keeps the durable chat row as the authority and blocks ID spoofing.
  if (chat && !persistedId && requestedId) {
    throw unavailableProject();
  }

  const effectiveProjectId = persistedId ?? (!chat ? requestedId : undefined);
  if (!effectiveProjectId) {
    if (chat?.project_bot_id || chat?.bot_meeting_id)
      throw unavailableProject();
    return {
      purpose: chat
        ? coerceChatPurpose(chat.purpose)
        : coerceChatPurpose(requestedPurpose),
    };
  }

  const project = await dependencies.getActiveProject({
    projectId: effectiveProjectId,
    userId,
  });
  if (!project || project._id !== effectiveProjectId) {
    throw unavailableProject();
  }

  if (chat?.project_bot_id && chat?.bot_meeting_id) throw unavailableProject();
  let botMeeting: ProjectRuntimeContext["botMeeting"];
  if (chat?.bot_meeting_id) {
    if (!chat.id || project.type !== "app") throw unavailableProject();
    const saved = await (dependencies.getMeeting ?? getBotMeetingForRuntime)({
      userId,
      id: chat.bot_meeting_id,
      chatId: chat.id,
      projectId: project._id,
    });
    const profiles = saved.profilesJson.map(parseProjectBotProfile);
    if (
      profiles.length < 2 ||
      profiles.length > 6 ||
      profiles.some((p) => !p?.enabled)
    )
      throw unavailableProject();
    botMeeting = {
      profiles: profiles as CustomAgentProfileConfig[],
      agenda: saved.agenda,
      skillsByProfile: saved.skillsByProfile,
    };
  }
  let botProfile: CustomAgentProfileConfig | undefined;
  let botSkills: ProjectBotSkill[] | undefined;
  if (chat?.project_bot_id) {
    if (!chat.id || project.type !== "app") throw unavailableProject();
    const saved = await (dependencies.getBot ?? getProjectBotForRuntime)({
      userId,
      id: chat.project_bot_id,
      chatId: chat.id,
      projectId: project._id,
    });
    const parsed = saved && parseProjectBotProfile(saved.profileJson);
    if (!parsed || !parsed.enabled) throw unavailableProject();
    botProfile = parsed;
    botSkills = saved.skills;
  }
  return {
    ...(botProfile ? { botProfile, botSkills } : {}),
    ...(botMeeting ? { botMeeting } : {}),
    // The validated project type is authoritative. A spoofed/missing request
    // purpose can never select a different prompt or tool persona.
    ...(project.github_repository
      ? { githubRepository: project.github_repository }
      : {}),
    purpose: project.type,
    projectId: project._id,
    ...(project.agent_mention ? { agentMention: project.agent_mention } : {}),
    sandboxNamespace: deriveProjectSandboxNamespace(
      userId,
      project._id,
      requireNamespaceSecret(namespaceSecret),
    ),
  };
}

/** Repository names come from a server-verified GitHub response, never request text. */
export function projectGithubRepositoryReminder(
  repository: ProjectGithubRepository | undefined,
  checkoutPath?: string,
): string {
  if (!repository) return "";
  // Fail closed on malformed persisted values before constructing a URL or prompt.
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/(?!\.{1,2}$)[A-Za-z0-9_.-]{1,100}(?![\s\S])/.test(
      repository.fullName,
    )
  )
    return "";
  const checkoutInstruction =
    checkoutPath && /^\/home\/user(?:\/[A-Za-z0-9_.-]+)?$/.test(checkoutPath)
      ? `RIFT verified GitHub access and prepared the checkout at ${checkoutPath}. Cloud terminal commands and relative file paths default to this checkout. Run all project commands in that checkout and preserve uncommitted work. Inspect its files and repository instructions before making changes.`
      : "First inspect the workspace for an existing checkout and check its origin. Reuse the matching checkout and preserve uncommitted work. If absent, clone the URL into a new repository directory inside the workspace using the terminal, then run all project commands in that checkout.";
  return `<project_github_repository>
The user selected GitHub repository ${repository.fullName} for this Build project. Its clone URL is https://github.com/${repository.fullName}.git.
Work on this repository for the current task in this project's isolated workspace. ${checkoutInstruction} Do not overwrite another repository, reset existing changes, or create an unrelated scaffold. Read the repository instructions and use its existing stack and checks. RIFT supplies connected GitHub credentials to the cloud terminal; a local environment uses its existing Git authentication. Never request or print a token. If cloud authentication fails, ask the user to reconnect GitHub from the sidebar. If local authentication fails, explain that Git access must be configured in that local environment. Commit or push only when the user asks.
</project_github_repository>`;
}
