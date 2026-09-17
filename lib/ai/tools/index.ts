import { captureRelayOrigin } from "@/lib/centrifugo/relay-origin";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import { getProviderContext } from "@/lib/ai/provider-context";
import { captureGeneratedMediaStorageOrigin } from "./utils/generated-media-storage";
import { createDesktopComputerTools } from "./desktop-computer";
import { supportsMultimodalToolResults as canReceiveDesktopImages } from "@/lib/ai/providers";
import { createMcpToolDiscovery } from "@/lib/ai/mcp/tool-discovery";
import { createExecutionLedger } from "@/packages/console/src/harness-execution";
import type { WorkingFileContext } from "@/lib/desktop/working-file-context";
import { gateToolSet, type ToolApprovalGate } from "@/lib/ai/approval/policy";
import { DefaultSandboxManager } from "./utils/sandbox-manager";
import {
  instrumentToolSet,
  type ToolCallEvent,
} from "./utils/instrument-tools";
import {
  HybridSandboxManager,
  type SandboxPreference,
} from "./utils/hybrid-sandbox-manager";
import { TodoManager } from "./utils/todo-manager";
import { createRunTerminalCmd } from "./run-terminal-cmd";
import { createInteractTerminalSession } from "./interact-terminal-session";
import { createGetTerminalFiles } from "./get-terminal-files";
import { createFile } from "./file";
import { createReadRunArchive } from "./read-run-archive";
import { createListFiles } from "./list-files";
import { createWebSearch } from "./web-search";
import { createSecuritySearch } from "./security-search";
import { createOpenUrlTool } from "./open-url";
import { createBrowseUrl, type DesktopLoopbackFetchResult } from "./browse-url";
import { createGenerateImage } from "./generate-image";
import { createGenerateVideo } from "./generate-video";
import { createExposePreview } from "./expose-preview";
import { createFindSkillsToolSet } from "./find-skills";
import type { EnabledSkill } from "@/lib/ai/skills/inject-skills";
import { createAppVerificationGate, createVerifyApp } from "./verify-app";
import { trackAppWorkspaceMutations } from "./utils/app-verification-mutations";
import {
  createDelegateTask,
  createSubagentRunLimiter,
  isDelegateTaskAvailable,
} from "./delegate-task";
import { createTodoWrite } from "./todo-write";
import { createReportFinding } from "./report-finding";
import { createDesktopWorkspaceToolSets } from "./desktop-workspace";
// Caido proxy temporarily disabled for all users — see lib/api/chat-handler.ts kill switch.
// import { createProxyTools } from "./proxy-tool";
import {
  createCreateNote,
  createListNotes,
  createUpdateNote,
  createDeleteNote,
} from "./notes";
// match tool removed — usage analytics showed it wasn't being used enough to justify
// the added complexity. The agent should use run_terminal_cmd with rg instead.
// import { createMatch } from "./match";
import type { ToolSet, UIMessageStreamWriter } from "ai";
import type {
  ChatMode,
  ToolContext,
  Todo,
  AnySandbox,
  AppendMetadataStreamFn,
  SubscriptionTier,
  ChatPurpose,
  SandboxBootInfo,
  CaidoReadyInfo,
} from "@/types";
import type { Geo } from "@vercel/functions";
import { FileAccumulator } from "./utils/file-accumulator";
import { BackgroundProcessTracker } from "./utils/background-process-tracker";
import { ptySessionManager } from "./utils/pty-session-manager";
import { isE2BSandbox } from "./utils/sandbox-types";
import type { AgentRuntimePolicy } from "@/lib/ai/agents/runtime-policy";
import type { RunRecorder } from "@/lib/ai/runs/run-recorder";
import { READ_ONLY_AGENT_BASE_TOOL_IDS } from "@/lib/ai/agents/read-only-tools";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/db/convex-client";

export { isE2BSandbox };

export interface McpToolBundle {
  discover?: (query: string) => Promise<{ servers: string[] }>;
  all: ToolSet;
  planReadOnly: ToolSet;
  byServerId?: Record<string, ToolSet>;
  planReadOnlyByServerId?: Record<string, ToolSet>;
}

const mergeToolSets = (sets: readonly ToolSet[]): ToolSet =>
  Object.assign({}, ...sets);

/**
 * Positive allowlist for a profile whose permission ceiling is read-only.
 * File receives its own read-only schema; MCP tools are independently reduced
 * to server-annotated read-only operations before reaching this filter.
 */

// Factory function to create tools with context
export const createTools = (
  userID: string,
  chatId: string,
  writer: UIMessageStreamWriter,
  mode: ChatMode = "agent",
  userLocation: Geo,
  initialTodos?: Todo[],
  memoryEnabled: boolean = true,
  isTemporary: boolean = false,
  assistantMessageId?: string,
  sandboxPreference?: SandboxPreference,
  serviceKey?: string,
  guardrailsConfig?: string,
  caidoEnabled: boolean = false,
  caidoPort?: number,
  appendMetadataStream?: AppendMetadataStreamFn,
  onToolCost?: (costDollars: number) => void,
  subscription?: SubscriptionTier,
  onSandboxBoot?: (info: SandboxBootInfo) => void,
  onCaidoReady?: (info: CaidoReadyInfo) => void,
  modelName?: string,
  // Tools contributed by the user's connected MCP servers (see lib/ai/mcp/*).
  // Already namespaced + AI-SDK-ready; merged into every rebuilt tool set so
  // provider-fallback legs keep them too.
  mcpTools?: McpToolBundle,
  // Server-resolved Media Studio models. Each tool independently checks its
  // own allowlist and derives provider cost server-side.
  imageModel?: string,
  videoModel?: string,
  // Connected GitHub token/username — wired into the sandbox git credentials by
  // run_terminal_cmd so the agent can clone/push the user's repos.
  githubToken?: string,
  githubUsername?: string,
  // Server-derived HMAC namespace for a validated project. Undefined keeps
  // legacy chats on their existing per-user sandbox.
  sandboxNamespace?: string,
  // Active product surface. Build mode gets a mandatory verification gate;
  // security/image preserve their existing preview behavior.
  purpose: ChatPurpose = "security",
  // Server-extracted latest user request. Build skill discovery receives this
  // authoritative text instead of trusting model-authored tool arguments.
  currentBuildRequest?: string,
  // Owner-checked, current-turn image attachments for Media Studio tools.
  mediaReferenceUrls?: readonly string[],
  // Backend-owned roster policy resolved from the latest exact mention. The
  // client request cannot define profiles, tools, models, or MCP ids here.
  agentRuntimePolicy?: AgentRuntimePolicy,
  // Records what this run does. Optional throughout: every tool must work
  // unchanged when nothing is recording.
  runRecorder?: RunRecorder,
  // Per-call measurement (duration, ok/error class, size). Applied to every
  // set this factory builds -- including provider-fallback rebuilds and MCP
  // tools -- so a tool cannot exist outside the measurement. Optional: the
  // tools behave identically with nothing listening.
  onToolCall?: (event: ToolCallEvent) => void,
  approvalGate?: ToolApprovalGate,
  workingFile?: WorkingFileContext,
  beforeToolExecution?: ToolApprovalGate,
  // Same owner-scoped skills used by the turn reminder; retained across fallback.
  enabledSkills?: readonly EnabledSkill[],
  // Keep every provider rebuild and discovered tool within the HTTP producer's
  // drain barrier, without changing the registry object used by discovery.
  wrapExecutionTools?: (tools: ToolSet) => ToolSet,
  studioSettings?: ToolContext["studioSettings"],
) => {
  const providerOrigin = getProviderContext();
  const sandboxOrigin = getSandboxContext();
  const relayOrigin = captureRelayOrigin(serviceKey, sandboxOrigin.relay);
  const storageOrigin = captureGeneratedMediaStorageOrigin();
  const enabledSkillSnapshot = enabledSkills?.map((skill) => ({ ...skill }));
  let sandbox: AnySandbox | null = null;
  let sandboxFirstUsedAt: number | null = null;
  let currentModelName = modelName;

  // E2B sandbox cost: ~$0.05/hour for 4-core 2GB
  const E2B_COST_PER_MS = 0.05 / (60 * 60 * 1000);

  const trackSandboxUsage = (newSandbox: AnySandbox) => {
    sandbox = newSandbox;
    if (!sandboxFirstUsedAt && isE2BSandbox(newSandbox)) {
      sandboxFirstUsedAt = Date.now();
    }
  };

  // Subscription tiers were removed, so cloud E2B Agent mode is available to
  // every signed-in user. The old "free agent must use a local sandbox, E2B is
  // paid-only" gate no longer applies.

  // Keep explicit local selection in the validating manager even when relay
  // configuration is missing; it must never silently become a cloud sandbox.
  const sandboxManager = sandboxPreference
    ? new HybridSandboxManager(
        userID,
        trackSandboxUsage,
        sandboxPreference,
        serviceKey ?? "",
        isE2BSandbox(sandbox) ? sandbox : null,
        subscription,
        onSandboxBoot,
        sandboxNamespace,
        sandboxOrigin,
        relayOrigin,
      )
    : new DefaultSandboxManager(
        userID,
        trackSandboxUsage,
        isE2BSandbox(sandbox) ? sandbox : null,
        onSandboxBoot,
        sandboxNamespace,
        sandboxOrigin,
      );

  const todoManager = new TodoManager(initialTodos);
  const fileAccumulator = new FileAccumulator();
  const backgroundProcessTracker = new BackgroundProcessTracker();
  // Provider fallback rebuilds the tool set, so keep verification proof outside
  // buildTools and share it between verify_app and expose_preview.
  const appVerificationGate = createAppVerificationGate();
  // Provider fallback rebuilds the tool set. Keep one request-scoped limiter so
  // retries cannot start a fresh set of subagents or exceed concurrency caps.
  const subagentRunLimiter = createSubagentRunLimiter();

  const context: ToolContext = {
    sandboxManager,
    writer,
    userLocation,
    todoManager,
    userID,
    chatId,
    assistantMessageId,
    runRecorder,
    fileAccumulator,
    backgroundProcessTracker,
    ptySessionManager,
    mode,
    purpose,
    activeAgentProfile: agentRuntimePolicy?.activeProfile,
    modelName,
    getCurrentModelName: () => currentModelName,
    imageModel,
    videoModel,
    mediaReferenceUrls,
    studioSettings,
    githubToken,
    githubUsername,
    subscription,
    isE2BSandbox,
    guardrailsConfig,
    caidoEnabled,
    caidoPort,
    appendMetadataStream,
    onToolCost,
    onCaidoReady,
  };

  // Preserve pending visual receipts across provider toolset rebuilds, while
  // keeping their cache scoped to this run instead of module-global call IDs.
  const verifyApp = createVerifyApp(context, appVerificationGate);

  const desktopLoopbackFetch = serviceKey
    ? async (url: string, options: { signal?: AbortSignal }) => {
        const { requestDesktopLocalAccess } =
          await import("@/lib/desktop/local-access-relay");
        return requestDesktopLocalAccess<DesktopLoopbackFetchResult>(
          {
            userId: userID,
            serviceKey,
            operation: "fetch_loopback",
            payload: { url, method: "GET" },
            timeoutMs: 25_000,
            signal: options.signal,
          },
          relayOrigin,
        );
      }
    : undefined;

  const activeProfile = agentRuntimePolicy?.activeProfile;
  const selectedMcpServerIds = activeProfile?.mcpServerIds ?? [];
  let selectedMcpTools: ToolSet = {};
  let selectedReadOnlyMcpTools: ToolSet = {};
  let effectiveAgentMcpTools: ToolSet = {};
  const refreshMcpTools = () => {
    selectedMcpTools = activeProfile
      ? mergeToolSets(
          selectedMcpServerIds.map(
            (serverId) => mcpTools?.byServerId?.[serverId] ?? {},
          ),
        )
      : (mcpTools?.all ?? {});
    selectedReadOnlyMcpTools = activeProfile
      ? mergeToolSets(
          selectedMcpServerIds.map(
            (serverId) => mcpTools?.planReadOnlyByServerId?.[serverId] ?? {},
          ),
        )
      : (mcpTools?.planReadOnly ?? {});
    effectiveAgentMcpTools =
      activeProfile?.permissionPreset === "read-only"
        ? selectedReadOnlyMcpTools
        : selectedMcpTools;
  };
  refreshMcpTools();
  const mcpDiscovery = createMcpToolDiscovery(
    () => Object.keys(selectedMcpTools),
    mcpTools?.discover &&
      !agentRuntimePolicy?.failClosed &&
      (!activeProfile || selectedMcpServerIds.length > 0)
      ? { discover: mcpTools.discover, rebuild: () => buildInstrumentedTools() }
      : undefined,
  );
  const activeToolIds = new Set(activeProfile?.toolIds ?? []);
  // Keep the Build skill loader available within every custom execution
  // profile. Narrowing workspace tools must not make advertised packs unloadable.
  const mandatoryControlToolIds = new Set(
    purpose === "app" ? ["find_skills"] : [],
  );

  const enforceActiveProfileToolPolicy = (candidate: ToolSet): ToolSet => {
    if (agentRuntimePolicy?.failClosed) {
      return Object.fromEntries(
        Object.entries(candidate).filter(([toolName]) =>
          mandatoryControlToolIds.has(toolName),
        ),
      );
    }
    if (!activeProfile) return candidate;
    const allowedMcpNames = new Set(Object.keys(effectiveAgentMcpTools));
    return Object.fromEntries(
      Object.entries(candidate).filter(([toolName]) => {
        if (mandatoryControlToolIds.has(toolName)) return true;
        if (allowedMcpNames.has(toolName)) return true;
        if (activeProfile.permissionPreset === "read-only") {
          return (
            READ_ONLY_AGENT_BASE_TOOL_IDS.has(toolName) &&
            activeToolIds.has(toolName)
          );
        }
        return activeToolIds.has(toolName);
      }),
    );
  };

  // Delegates receive only the final parent tool set, including its approval
  // and profile limits, even after a provider fallback rebuild.
  const latestTools: ToolSet = {};
  const executionLedger = createExecutionLedger();
  const buildTools = (): ToolSet => {
    refreshMcpTools();
    // Create all available tools. This is intentionally a factory rather than a
    // one-time object so model-specific tool schemas can be rebuilt for
    // provider fallback legs.
    const findSkillsTools = createFindSkillsToolSet(
      purpose,
      currentBuildRequest,
      {
        enabledSkills: enabledSkillSnapshot,
        persist: mode !== "ask",
        install:
          mode !== "ask" && serviceKey
            ? async (catalogIds) =>
                getConvexClient().mutation(
                  api.skills.installCatalogForBackend,
                  {
                    serviceKey,
                    userId: userID,
                    catalogIds,
                  },
                )
            : undefined,
      },
    );
    const desktopWorkspaceTools =
      purpose === "app" && serviceKey
        ? createDesktopWorkspaceToolSets(
            {
              userId: userID,
              serviceKey,
              workingFile,
            },
            relayOrigin,
          )
        : undefined;
    const desktopComputerTools =
      (purpose === "app" || purpose === "security") && serviceKey
        ? createDesktopComputerTools(
            {
              userId: userID,
              serviceKey,
              canViewScreenshots: () =>
                canReceiveDesktopImages(currentModelName),
            },
            relayOrigin,
          )
        : undefined;
    const allTools = {
      ...findSkillsTools,
      run_terminal_cmd: createRunTerminalCmd(context, sandboxOrigin),
      interact_terminal_session: createInteractTerminalSession(context),
      get_terminal_files: createGetTerminalFiles(context),
      file: createFile(context),
      ...(mode === "agent" && {
        read_run_archive: createReadRunArchive(context, storageOrigin),
      }),
      ...((purpose === "app" || purpose === "security") && {
        list_files: createListFiles(context),
      }),
      todo_write: createTodoWrite(context),
      ...(desktopWorkspaceTools?.all ?? {}),
      ...(desktopComputerTools?.all ?? {}),
      ...(isDelegateTaskAvailable(mode, purpose) && {
        delegate_task: createDelegateTask(
          context,
          subagentRunLimiter,
          agentRuntimePolicy,
          {
            getReadOnlyTools: () => latestTools,
            isApprovalStopped: () => approvalGate?.isStopped?.() ?? false,
          },
        ),
      }),
      // Evidence-backed findings and the curated security corpus are part of
      // the Max-gated Hack Workbench. Do not leak those product capabilities
      // into a forged/ordinary Build request just because both surfaces share
      // the same tool factory.
      ...(purpose === "security" && {
        report_finding: createReportFinding(context),
      }),
      ...(!isTemporary &&
        memoryEnabled && {
          create_note: createCreateNote(context),
          list_notes: createListNotes(context),
          update_note: createUpdateNote(context),
          delete_note: createDeleteNote(context),
        }),
      ...(providerOrigin.perplexityApiKey && {
        web_search: createWebSearch(context, providerOrigin),
      }),
      // Curated web-security RAG (preview.is). Read-only knowledge retrieval.
      ...(purpose === "security" &&
        providerOrigin.previewRagApiKey && {
          security_search: createSecuritySearch(providerOrigin),
        }),
      // Caido proxy temporarily disabled for all users.
      // ...(caidoEnabled && createProxyTools(context)),
      ...(providerOrigin.jinaApiKey && {
        open_url: createOpenUrlTool(providerOrigin),
      }),
      // Build and Hack receive a keyless, read-only Chromium browser. Its transport
      // independently validates every public HTTPS request and redirect;
      // explicit loopback URLs use the owner-checked desktop grant relay.
      ...((purpose === "app" || purpose === "security") && {
        browse_url: createBrowseUrl(context, { desktopLoopbackFetch }),
      }),
      // Image generation via OpenRouter (reuses the existing key, no new
      // provider). Available in every mode.
      ...(providerOrigin.openrouterApiKey && {
        generate_image: createGenerateImage(
          context,
          providerOrigin,
          storageOrigin,
        ),
        generate_video: createGenerateVideo(
          context,
          providerOrigin,
          storageOrigin,
        ),
      }),
      // App-builder: expose a sandbox dev-server port as a live preview URL.
      verify_app: verifyApp,
      expose_preview: createExposePreview(
        context,
        purpose === "app" ? appVerificationGate : undefined,
      ),
      // Agent mode receives the complete connected MCP set. Build Plan mode is
      // filtered separately below so a connector cannot silently mutate state.
      ...effectiveAgentMcpTools,
    };

    // Filter tools based on mode
    if (mode !== "ask") return enforceActiveProfileToolPolicy(allTools);

    if (purpose === "app") {
      return enforceActiveProfileToolPolicy({
        ...findSkillsTools,
        file: allTools.file,
        list_files: createListFiles(context),
        ...(desktopWorkspaceTools?.readOnly ?? {}),
        ...(desktopComputerTools?.readOnly ?? {}),
        ...(providerOrigin.perplexityApiKey && {
          web_search: createWebSearch(context, providerOrigin),
        }),
        ...(providerOrigin.jinaApiKey && {
          open_url: createOpenUrlTool(providerOrigin),
        }),
        browse_url: createBrowseUrl(context, { desktopLoopbackFetch }),
        ...selectedReadOnlyMcpTools,
      });
    }

    return {
      ...findSkillsTools,
      ...(!isTemporary &&
        memoryEnabled && {
          create_note: allTools.create_note,
          list_notes: allTools.list_notes,
          update_note: allTools.update_note,
          delete_note: allTools.delete_note,
        }),
      ...(providerOrigin.perplexityApiKey && {
        web_search: createWebSearch(context, providerOrigin),
      }),
      ...(purpose === "security" &&
        providerOrigin.previewRagApiKey && {
          security_search: createSecuritySearch(providerOrigin),
        }),
      ...(providerOrigin.jinaApiKey && {
        open_url: createOpenUrlTool(providerOrigin),
      }),
      ...(providerOrigin.openrouterApiKey && {
        generate_image: createGenerateImage(
          context,
          providerOrigin,
          storageOrigin,
        ),
        generate_video: createGenerateVideo(
          context,
          providerOrigin,
          storageOrigin,
        ),
      }),
      ...selectedMcpTools,
    };
  };

  // Every set leaves through the instrument, whichever branch built it.
  const buildToolsRaw = buildTools;
  const buildInstrumentedTools = () => {
    const raw = mcpDiscovery.augment(buildToolsRaw());
    const workspaceTracked =
      purpose === "app"
        ? trackAppWorkspaceMutations(raw, appVerificationGate)
        : raw;
    // Approval must finish BEFORE the durable execution barrier is crossed.
    const executionTracked = beforeToolExecution
      ? gateToolSet(workspaceTracked, beforeToolExecution)
      : workspaceTracked;
    const guarded = approvalGate
      ? gateToolSet(executionTracked, approvalGate)
      : executionTracked;
    const measured = onToolCall
      ? instrumentToolSet(guarded, onToolCall)
      : guarded;
    const nextTools = Object.fromEntries(
      Object.entries(measured).map(([name, definition]) => {
        const execute = definition.execute;
        if (!execute) return [name, definition];
        return [
          name,
          {
            ...definition,
            execute: (
              input: unknown,
              options: Parameters<NonNullable<typeof execute>>[1],
            ) => {
              options.abortSignal?.throwIfAborted();
              return executionLedger.run(
                { id: options.toolCallId, name, input },
                () => Promise.resolve(execute(input, options)),
              );
            },
          },
        ];
      }),
    );
    // The SDK retains this object across steps. Publish only fully gated tools.
    for (const name of Object.keys(latestTools)) delete latestTools[name];
    Object.assign(
      latestTools,
      wrapExecutionTools ? wrapExecutionTools(nextTools) : nextTools,
    );
    mcpDiscovery.register(latestTools);
    return latestTools;
  };

  const tools = buildInstrumentedTools();

  const getSandbox = () => sandbox;
  const ensureSandbox = async () => {
    const { sandbox: ensured } = await sandboxManager.getSandbox();
    return ensured;
  };
  const getTodoManager = () => todoManager;
  const getFileAccumulator = () => fileAccumulator;
  const setCurrentModelName = (nextModelName: string | undefined) => {
    currentModelName = nextModelName;
  };
  const setProjectWorkingDirectory = (path: string | undefined) => {
    context.projectWorkingDirectory = path;
  };

  const getToolsForModel = (nextModelName: string | undefined) => {
    setCurrentModelName(nextModelName);
    return buildInstrumentedTools();
  };

  const getSandboxSessionCost = (): number => {
    if (!sandboxFirstUsedAt) return 0;
    return (Date.now() - sandboxFirstUsedAt) * E2B_COST_PER_MS;
  };
  const isAppBuildComplete = () =>
    purpose !== "app" || appVerificationGate.isComplete();

  return {
    tools,
    getSandbox,
    ensureSandbox,
    getTodoManager,
    getFileAccumulator,
    sandboxManager,
    getSandboxSessionCost,
    setCurrentModelName,
    setProjectWorkingDirectory,
    getToolsForModel,
    isAppBuildComplete,
  };
};

// Re-export types for external use
export type { SandboxPreference };
