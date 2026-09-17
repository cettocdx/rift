import type { Sandbox } from "@e2b/code-interpreter";
import type { UIMessageStreamWriter } from "ai";
import type { Geo } from "@vercel/functions";
import type { TodoManager } from "@/lib/ai/tools/utils/todo-manager";
import { FileAccumulator } from "@/lib/ai/tools/utils/file-accumulator";
import type { BackgroundProcessTracker } from "@/lib/ai/tools/utils/background-process-tracker";
import type { PtySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import type { ChatMode, ChatPurpose, SubscriptionTier } from "./chat";
import type { CentrifugoSandbox } from "@/lib/ai/tools/utils/centrifugo-sandbox";
import type { SandboxFallbackInfo } from "@/lib/ai/tools/utils/hybrid-sandbox-manager";
import type { CustomAgentProfileConfig } from "@/lib/ai/agents/pet-roster";
import type { RunRecorder } from "@/lib/ai/runs/run-recorder";

// Union type for E2B Sandbox and local CentrifugoSandbox
export type AnySandbox = Sandbox | CentrifugoSandbox;

// Type guard to check if sandbox is E2B
export type IsE2BSandboxFn = (s: AnySandbox | null) => s is Sandbox;

export type SandboxType = "e2b" | "desktop" | "remote-connection";

export interface SandboxInfo {
  type: SandboxType;
  name?: string;
}

export interface SandboxManager {
  getSandbox(): Promise<{ sandbox: AnySandbox }>;
  setSandbox(sandbox: AnySandbox): void;
  getSandboxType(toolName: string): SandboxType | undefined;
  getSandboxInfo(): SandboxInfo | null;
  // Optional: only HybridSandboxManager implements this
  consumeFallbackInfo?(): SandboxFallbackInfo | null;
  /** Get the effective sandbox preference after any fallbacks (e.g. "e2b" or connectionId). */
  getEffectivePreference(): string;
  /** Track consecutive sandbox health failures across all tools. Returns true if the limit has been exceeded. */
  recordHealthFailure(): boolean;
  /** Reset the health failure counter (call on successful health check). */
  resetHealthFailures(): void;
  /** Check if the sandbox has been marked as permanently unavailable for this session. */
  isSandboxUnavailable(): boolean;
  /** Whether the effective sandbox can create interactive PTY sessions. */
  supportsInteractivePty?(): Promise<boolean>;
  /** True when an E2B sandbox instance is already booted and cached (warm). False during cold start. */
  isE2BSandboxBooted?(): boolean;
}

export interface SandboxBootInfo {
  path:
    | "reuse_existing"
    | "create_fresh"
    | "create_after_version_mismatch"
    | "create_after_expired"
    | "create_after_broken";
  duration_ms: number;
  create_attempts: number;
}

export type CaidoErrorKind =
  | "install_failed"
  | "start_timeout"
  | "auth_failed"
  | "external_unreachable"
  | "setup_failed"
  | "unknown";

export interface CaidoReadyInfo {
  path:
    | "fast"
    | "needs_start"
    | "external"
    | "locked_wait"
    | "locked_wait_error"
    | "cached_ready"
    | "windows_unsupported"
    | "setup_error";
  duration_ms: number;
  initial_script_ms?: number;
  background_start_ms?: number;
  health_poll_ms?: number;
  reauth_script_ms?: number;
  /**
   * Bounded error classification for telemetry. Raw error messages are never
   * written to the wide event — they may contain local hostnames, ports, or
   * stderr content from caido-cli. Full messages are available in console.warn
   * for debugging only.
   */
  error_kind?: CaidoErrorKind;
}

export interface SandboxContext {
  userID: string;
  /** Optional opaque workspace identity used for project-scoped E2B reuse. */
  sandboxNamespace?: string;
  setSandbox: (sandbox: Sandbox) => void;
  /** Called once when ensureSandboxConnection actually does work (creates or reconnects). */
  onBoot?: (info: SandboxBootInfo) => void;
}

/** Optional: when set, terminal chunks are awaited so the run yields and stream delivery can happen in real time. */
export type AppendMetadataStreamFn = (event: {
  type: "data-terminal";
  data: { terminal: string; toolCallId: string };
}) => Promise<void>;

export interface ToolContext {
  sandboxManager: SandboxManager;
  writer: UIMessageStreamWriter;
  userLocation: Geo;
  todoManager: TodoManager;
  userID: string;
  chatId: string;
  assistantMessageId?: string;
  fileAccumulator: FileAccumulator;
  backgroundProcessTracker: BackgroundProcessTracker;
  /** Manages interactive PTY sessions for `run_terminal_cmd` interactive actions. */
  ptySessionManager: PtySessionManager;
  mode: ChatMode;
  /** Active product surface; used to scope Build-only runtime guarantees. */
  purpose: ChatPurpose;
  /**
   * Owner-checked custom profile selected by an exact latest-request mention.
   * This is server derived and may only narrow the surrounding runtime.
   */
  activeAgentProfile?: CustomAgentProfileConfig;
  /**
   * Records what this run does as it happens -- an ordered event log plus the
   * evidence those events point at. Optional: recording is a record OF the
   * work, never a precondition FOR it, so every tool must still function when
   * this is absent.
   */
  runRecorder?: RunRecorder;
  /** Configured model key for this request, used for model-aware tool capabilities. */
  modelName?: string;
  /** Returns the currently active stream model, including provider fallback legs. */
  getCurrentModelName?: () => string | undefined;
  /** User-picked image model (OpenRouter id) for generate_image; falls back to the default. */
  imageModel?: string;
  /** Validated explicit Studio controls override model-authored choices. */
  studioSettings?: import("@/lib/console/workspaces-contract").StudioSettings;
  /** User-picked video model (OpenRouter id) for generate_video; falls back to the default. */
  videoModel?: string;
  /**
   * Public HTTPS image URLs resolved from owner-checked files attached to the
   * current user turn. Media tools consume these directly so the language
   * model never has to echo a signed storage URL into tool arguments.
   */
  mediaReferenceUrls?: readonly string[];
  /** Connected GitHub token — wired into the sandbox git credentials so the agent can clone/push repos. */
  githubToken?: string;
  /** Connected GitHub username, for git config. */
  githubUsername?: string;
  /** Server-prepared checkout for this cloud run. Shared only by its tools. */
  projectWorkingDirectory?: string;
  subscription?: SubscriptionTier;
  isE2BSandbox: IsE2BSandboxFn;
  guardrailsConfig?: string;
  /** Whether the Caido proxy is enabled (default true). When false, proxy tools are hidden and HTTP_PROXY env vars are not injected. */
  caidoEnabled: boolean;
  /** Custom Caido port for local sandbox users with an existing instance (default: 48080). */
  caidoPort?: number;
  /** When set, run_terminal_cmd awaits this for each terminal chunk so the run yields and metadata delivery can happen in real time. */
  appendMetadataStream?: AppendMetadataStreamFn;
  /** Callback to report additional tool costs (in dollars) that should be added to the request's total cost. */
  onToolCost?: (costDollars: number) => void;
  /** Called when Caido proxy setup completes (or fails). First call in a request captures the real cost; later calls measure lock-wait time. */
  onCaidoReady?: (info: CaidoReadyInfo) => void;
}
