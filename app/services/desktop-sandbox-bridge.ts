import {
  Centrifuge,
  disconnectedCodes,
  State,
  type Subscription,
} from "centrifuge";
import posthog from "posthog-js";
import {
  sandboxConnectionChannel,
  type SandboxMessage,
  type CommandCancelMessage,
  type CommandMessage,
  type PtyCreateMessage,
  type PtyInputMessage,
  type PtyResizeMessage,
  type PtyKillMessage,
  type DesktopLocalAccessRequestMessage,
  type DesktopLocalAccessResultMessage,
} from "@/lib/centrifugo/types";
import {
  DEFAULT_PTY_COLS,
  DEFAULT_PTY_ROWS,
} from "@/lib/ai/tools/utils/pty-constants";

type RefreshTokenResult =
  | { ok: true; centrifugoToken: string }
  | {
      ok: false;
      terminated: true;
      reason:
        | "connection_not_found"
        | "ownership_mismatch"
        | "connection_inactive";
      connectionId: string;
      clientVersion: string | null;
      status: string | null;
      disconnectReason:
        | "client_disconnect"
        | "desktop_disconnect"
        | "desktop_kicked_by_new_session"
        | "token_regenerated"
        | "presence_sweep"
        | null;
      msSinceDisconnected: number | null;
      msSinceLastHeartbeat: number | null;
      msSinceCreated: number | null;
    };

interface StreamChunk {
  type: "stdout" | "stderr" | "exit" | "error";
  data?: string;
  exitCode?: number;
  message?: string;
}

type TargetedIncomingMessage =
  | CommandMessage
  | CommandCancelMessage
  | PtyCreateMessage
  | PtyInputMessage
  | PtyResizeMessage
  | PtyKillMessage
  | DesktopLocalAccessRequestMessage;

function isTargetedIncomingMessage(
  message: unknown,
): message is TargetedIncomingMessage {
  if (typeof message !== "object" || message === null) {
    return false;
  }
  const { type, targetConnectionId } = message as {
    type?: unknown;
    targetConnectionId?: unknown;
  };
  return (
    typeof targetConnectionId === "string" &&
    (type === "command" ||
      type === "command_cancel" ||
      type === "pty_create" ||
      type === "pty_input" ||
      type === "pty_resize" ||
      type === "pty_kill" ||
      type === "desktop_local_access_request")
  );
}

// "Unauthenticated" UNAUTHORIZED still throws server-side (the user's auth
// identity is missing/expired, not a connection lifecycle event), so the
// catch path needs to recognize it as a terminate-the-loop signal too.
function isUnauthenticatedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return false;
  return (data as { code?: string }).code === "UNAUTHORIZED";
}

interface DesktopBridgeConfig {
  /** A channel subscription acknowledgement, not merely a registered session. */
  onConnectionStateChange?: (ready: boolean) => void;
  connectDesktop: (args: {
    connectionName: string;
    osInfo?: {
      platform: string;
      arch: string;
      release: string;
      hostname: string;
    };
  }) => Promise<{
    connectionId: string;
    centrifugoToken: string;
    centrifugoWsUrl: string;
  }>;
  refreshCentrifugoTokenDesktop: (args: {
    connectionId: string;
  }) => Promise<RefreshTokenResult>;
  disconnectDesktop: (args: {
    connectionId: string;
  }) => Promise<{ success: boolean }>;
}

export class DesktopSandboxBridge {
  private client: Centrifuge | null = null;
  private subscription: Subscription | null = null;
  private connectionId: string | null = null;
  private activeCommands = new Set<string>();
  private ready = false;
  private lifecycleVersion = 0;
  private reconnectAllowed = true;
  private messageSizeDisconnected = false;
  private config: DesktopBridgeConfig;
  // A native write may finish while its socket is offline. Keep its outcome
  // through reconnect so duplicate deliveries only replay the acknowledgement.
  // Requests time out after at most 120 seconds; retain dedup state for 5 min.
  private localOperations = new Map<
    string,
    {
      completedAt?: number;
      result: Promise<DesktopLocalAccessResultMessage>;
    }
  >();
  private pendingLocalResults = new Map<
    string,
    DesktopLocalAccessResultMessage
  >();

  constructor(config: DesktopBridgeConfig) {
    this.config = config;
  }

  getConnectionId(): string | null {
    return this.connectionId;
  }

  isReady(): boolean {
    return this.ready;
  }

  canReconnect(): boolean {
    return this.reconnectAllowed;
  }

  /** Resume only WS1009/code3, which Centrifuge excludes from its retry loop. */
  reconnectTransport(): boolean {
    if (
      !this.reconnectAllowed ||
      !this.messageSizeDisconnected ||
      this.ready ||
      !this.connectionId ||
      !this.subscription ||
      this.client?.state !== State.Disconnected
    )
      return false;
    // Keep the session, subscription and operation outcomes: retrying a native
    // action to recover its acknowledgement can duplicate writes or clicks.
    this.messageSizeDisconnected = false;
    this.client.connect();
    return true;
  }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return;
    this.ready = ready;
    // Readiness observers must not interrupt transport cleanup.
    try {
      this.config.onConnectionStateChange?.(ready);
    } catch {
      // Consumer state is separate from connection ownership.
    }
  }

  private terminateClient(recoverable = false): void {
    this.lifecycleVersion += 1;
    this.reconnectAllowed = recoverable;
    this.messageSizeDisconnected = false;
    this.setReady(false);
    const client = this.client;
    const subscription = this.subscription;
    this.client = null;
    this.subscription = null;
    this.connectionId = null;
    this.localOperations.clear();
    this.pendingLocalResults.clear();
    try {
      subscription?.unsubscribe();
      subscription?.removeAllListeners();
    } catch {
      // A subscription cleanup failure must not keep the socket alive.
    }
    try {
      client?.disconnect();
    } catch {
      // Already in a terminal state.
    }
  }

  async start(): Promise<string> {
    const version = ++this.lifecycleVersion;
    this.reconnectAllowed = true;
    this.messageSizeDisconnected = false;
    this.setReady(false);
    const osInfo = await this.getOsInfo();
    if (version !== this.lifecycleVersion)
      throw new Error("Desktop relay startup was stopped.");

    const { connectionId, centrifugoToken, centrifugoWsUrl } =
      await this.config.connectDesktop({
        connectionName: osInfo?.hostname || "Desktop",
        osInfo,
      });
    if (version !== this.lifecycleVersion) {
      // stop() may run before registration resolves. Revoke the late server
      // connection instead of creating a socket after the last grant was lost.
      try {
        await this.config.disconnectDesktop({ connectionId });
      } finally {
        throw new Error("Desktop relay startup was stopped.");
      }
    }
    this.connectionId = connectionId;

    this.client = new Centrifuge(centrifugoWsUrl, {
      token: centrifugoToken,
      getToken: async () => {
        if (version !== this.lifecycleVersion || !this.connectionId) {
          throw new Error(
            "[DesktopSandboxBridge] Cannot refresh token: connectionId is null",
          );
        }
        let result: RefreshTokenResult;
        try {
          result = await this.config.refreshCentrifugoTokenDesktop({
            connectionId: this.connectionId,
          });
        } catch (error) {
          if (version !== this.lifecycleVersion) throw error;
          if (isUnauthenticatedError(error)) {
            const eventProps = {
              connectionId: this.connectionId,
              clientSurface: "desktop_bridge",
              reason: "unauthenticated" as const,
            };
            console.warn(
              "[DesktopSandboxBridge] Centrifugo refresh aborted — user not authenticated; stopping client to break retry loop",
              eventProps,
            );
            try {
              posthog.capture("sandbox_connection_terminated", eventProps);
            } catch {
              // posthog not initialized for this user
            }
            this.terminateClient();
          } else {
            console.error(
              "[DesktopSandboxBridge] Failed to refresh Centrifugo token:",
              error,
            );
          }
          throw error;
        }
        if (version !== this.lifecycleVersion)
          throw new Error("Desktop relay token refresh was stopped.");
        if (result.ok) return result.centrifugoToken;

        const eventProps = {
          connectionId: this.connectionId,
          clientSurface: "desktop_bridge",
          reason: result.reason,
          serverConnectionId: result.connectionId,
          serverClientVersion: result.clientVersion,
          serverStatus: result.status,
          disconnectReason: result.disconnectReason,
          msSinceDisconnected: result.msSinceDisconnected,
          msSinceLastHeartbeat: result.msSinceLastHeartbeat,
          msSinceCreated: result.msSinceCreated,
        };
        console.warn(
          "[DesktopSandboxBridge] Centrifugo refresh aborted — server reports connection terminated; stopping client to break retry loop",
          eventProps,
        );
        try {
          posthog.capture("sandbox_connection_terminated", eventProps);
        } catch {
          // posthog not initialized for this user
        }
        this.terminateClient(
          result.reason === "connection_not_found" ||
            result.disconnectReason === "presence_sweep",
        );
        throw new Error(`Centrifugo refresh aborted: ${result.reason}`);
      },
    });

    const userId = this.extractUserIdFromToken(centrifugoToken);
    const channel = sandboxConnectionChannel(userId, connectionId);
    this.subscription = this.client.newSubscription(channel);
    const subscription = this.subscription;
    const client = this.client;
    const updateReady = (ready: boolean) => {
      if (this.subscription === subscription && this.client === client)
        this.setReady(ready);
    };
    subscription.on("subscribed", () => {
      updateReady(true);
      for (const result of this.pendingLocalResults.values()) {
        void this.publishLocalOutcome(result, version, subscription);
      }
    });
    subscription.on("subscribing", () => updateReady(false));
    subscription.on("unsubscribed", () => updateReady(false));
    client.on("connecting", () => {
      if (this.client !== client || this.subscription !== subscription) return;
      this.messageSizeDisconnected = false;
      updateReady(false);
    });
    client.on("disconnected", ({ code }) => {
      if (this.client !== client || this.subscription !== subscription) return;
      this.messageSizeDisconnected =
        code === disconnectedCodes.messageSizeLimit;
      updateReady(false);
    });

    this.subscription.on("publication", (ctx) => {
      const message = ctx.data;

      if (!isTargetedIncomingMessage(message)) {
        return;
      }

      if (message.targetConnectionId !== this.connectionId) {
        return;
      }

      switch (message.type) {
        case "command":
          this.handleCommand(message as CommandMessage).catch((err) => {
            console.error(
              "[DesktopSandboxBridge] Command handling failed:",
              err,
            );
          });
          break;

        case "command_cancel":
          this.handleCommandCancel(message as CommandCancelMessage).catch(
            (err) => {
              console.error(
                "[DesktopSandboxBridge] Command cancel failed:",
                err,
              );
            },
          );
          break;

        case "pty_create":
          this.handlePtyCreate(message as PtyCreateMessage).catch((err) => {
            console.error("[DesktopSandboxBridge] PTY create failed:", err);
          });
          break;

        case "pty_input":
          this.handlePtyInput(message as PtyInputMessage).catch((err) => {
            console.error("[DesktopSandboxBridge] PTY input failed:", err);
          });
          break;

        case "pty_resize":
          this.handlePtyResize(message as PtyResizeMessage).catch(() => {});
          break;

        case "pty_kill":
          this.handlePtyKill(message as PtyKillMessage).catch(() => {});
          break;

        case "desktop_local_access_request":
          this.handleDesktopLocalAccess(
            message as DesktopLocalAccessRequestMessage,
          ).catch((err) => {
            console.error(
              "[DesktopSandboxBridge] Scoped local access failed:",
              err,
            );
          });
          break;

        default:
          break;
      }
    });

    this.subscription.subscribe();
    this.client.connect();

    return connectionId;
  }

  private extractUserIdFromToken(token: string): string {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT");
    let b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const payload = JSON.parse(atob(b64));
    if (!payload.sub || typeof payload.sub !== "string") {
      throw new Error("JWT missing 'sub' claim");
    }
    return payload.sub;
  }

  private async getOsInfo(): Promise<
    | { platform: string; arch: string; release: string; hostname: string }
    | undefined
  > {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<{
        platform: string;
        arch: string;
        release: string;
        hostname: string;
      }>("get_desktop_platform_info");
    } catch (error) {
      console.warn("[DesktopSandboxBridge] Failed to get OS info:", error);
    }
    return undefined;
  }

  private async handleCommand(command: CommandMessage): Promise<void> {
    const { commandId } = command;
    this.activeCommands.add(commandId);

    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");

      const channel = new Channel<StreamChunk>();
      channel.onmessage = async (chunk) => {
        await this.forwardChunk(commandId, chunk);
      };

      await invoke("execute_stream_command", {
        commandId,
        command: command.command,
        cwd: command.cwd,
        env: command.env,
        timeoutMs: command.timeout ?? 30000,
        onEvent: channel,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        "[desktop-bridge]",
        JSON.stringify({
          event: "desktop_stream_command_failed",
          service: "desktop_bridge",
          command_id: commandId,
          message,
        }),
      );
      await this.publishResult({
        type: "error",
        commandId,
        message,
      });
    } finally {
      this.activeCommands.delete(commandId);
    }
  }

  private async handleCommandCancel(
    command: CommandCancelMessage,
  ): Promise<void> {
    if (!this.activeCommands.has(command.commandId)) return;
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("cancel_stream_command", {
      commandId: command.commandId,
    });
  }

  private async forwardChunk(
    commandId: string,
    chunk: StreamChunk,
  ): Promise<void> {
    switch (chunk.type) {
      case "stdout":
        if (chunk.data) {
          await this.publishResult({
            type: "stdout",
            commandId,
            data: chunk.data,
          });
        }
        break;
      case "stderr":
        if (chunk.data) {
          await this.publishResult({
            type: "stderr",
            commandId,
            data: chunk.data,
          });
        }
        break;
      case "exit":
        if (chunk.exitCode === undefined) {
          console.warn(
            "[desktop-bridge]",
            JSON.stringify({
              event: "desktop_stream_exit_code_missing",
              service: "desktop_bridge",
              command_id: commandId,
            }),
          );
        }
        await this.publishResult({
          type: "exit",
          commandId,
          exitCode: chunk.exitCode ?? -1,
        });
        break;
      case "error":
        console.error(
          "[desktop-bridge]",
          JSON.stringify({
            event: "desktop_stream_error_chunk_received",
            service: "desktop_bridge",
            command_id: commandId,
            message: chunk.message || "Unknown error",
          }),
        );
        await this.publishResult({
          type: "error",
          commandId,
          message: chunk.message || "Unknown error",
        });
        break;
    }
  }

  private async publishResult(message: SandboxMessage): Promise<void> {
    if (!this.subscription) {
      throw new Error(
        "[DesktopSandboxBridge] Cannot publish result: subscription is null",
      );
    }
    try {
      await this.subscription.publish(message);
    } catch (error) {
      console.error("[DesktopSandboxBridge] Failed to publish result:", error);
      throw error;
    }
  }

  private async publishLocalOutcome(
    result: DesktopLocalAccessResultMessage,
    version: number,
    subscription: Subscription,
  ): Promise<void> {
    if (version !== this.lifecycleVersion || subscription !== this.subscription)
      return;
    try {
      await subscription.publish(result);
      if (
        version === this.lifecycleVersion &&
        this.pendingLocalResults.get(result.requestId) === result
      )
        this.pendingLocalResults.delete(result.requestId);
    } catch {
      // Delivery failure is not operation failure. The buffered mutation
      // outcome is retried on subscribe; never rerun the native operation.
    }
  }

  private async handleDesktopLocalAccess(
    message: DesktopLocalAccessRequestMessage,
  ): Promise<void> {
    const version = this.lifecycleVersion;
    const subscription = this.subscription;
    if (
      !subscription ||
      typeof message.requestId !== "string" ||
      !message.requestId ||
      message.requestId.length > 128
    )
      return;
    const mutates =
      message.operation === "write_file" ||
      message.operation === "open_visible_url" ||
      (message.operation === "computer_action" &&
        message.payload?.action !== "screenshot");
    const now = Date.now();
    for (const [id, record] of this.localOperations) {
      if (
        record.completedAt !== undefined &&
        now - record.completedAt > 300_000
      ) {
        this.localOperations.delete(id);
        this.pendingLocalResults.delete(id);
      }
    }
    let result: DesktopLocalAccessResultMessage;
    const existing = this.localOperations.get(message.requestId);
    if (existing) {
      result = await existing.result;
    } else if (mutates && this.localOperations.size >= 256) {
      result = {
        type: "desktop_local_access_result",
        requestId: message.requestId,
        ok: false,
        error:
          "Too many recent desktop changes are awaiting confirmation. Wait before requesting another change.",
      };
    } else {
      const operation = this.executeDesktopLocalAccess(message, version);
      if (mutates) {
        const record: {
          completedAt?: number;
          result: Promise<DesktopLocalAccessResultMessage>;
        } = { result: operation };
        this.localOperations.set(message.requestId, record);
        void operation.then(() => {
          record.completedAt = Date.now();
        });
      }
      result = await operation;
    }
    if (version !== this.lifecycleVersion || subscription !== this.subscription)
      return;
    if (mutates && this.localOperations.has(message.requestId))
      this.pendingLocalResults.set(message.requestId, result);
    await this.publishLocalOutcome(result, version, subscription);
  }

  private async executeDesktopLocalAccess(
    message: DesktopLocalAccessRequestMessage,
    version: number,
  ): Promise<DesktopLocalAccessResultMessage> {
    const payload = message.payload ?? {};
    const requiredString = (key: string): string => {
      const value = payload[key];
      if (typeof value !== "string" || !value) {
        throw new Error(`Desktop local access requires ${key}.`);
      }
      return value;
    };

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      if (version !== this.lifecycleVersion)
        throw new Error("Desktop local access was stopped.");
      let result: unknown;
      switch (message.operation) {
        case "list_grants":
          result = await invoke("list_workspace_grants");
          break;
        case "list_entries":
          result = await invoke("list_workspace_entries", {
            grantId: requiredString("grantId"),
            relativePath:
              typeof payload.relativePath === "string"
                ? payload.relativePath
                : "",
          });
          break;
        case "read_file":
          result = await invoke("read_workspace_file", {
            grantId: requiredString("grantId"),
            relativePath: requiredString("relativePath"),
          });
          break;
        case "write_file": {
          const content = payload.content;
          if (typeof content !== "string")
            throw new Error("Desktop local access requires string content.");
          if (new TextEncoder().encode(content).byteLength > 512 * 1024) {
            throw new Error(
              "Build relay writes are limited to 512 KiB per operation.",
            );
          }
          if (
            payload.expectedVersion !== undefined &&
            typeof payload.expectedVersion !== "string"
          )
            throw new Error(
              "Desktop local access requires a string expectedVersion.",
            );
          result = await invoke("write_workspace_file", {
            grantId: requiredString("grantId"),
            relativePath: requiredString("relativePath"),
            content,
            encoding: payload.encoding === "base64" ? "base64" : "utf8",
            ...(typeof payload.expectedVersion === "string"
              ? { expectedVersion: payload.expectedVersion }
              : {}),
          });
          break;
        }
        case "access_status":
          result = await invoke("desktop_access_status");
          break;
        case "computer_action":
          result = await invoke("desktop_computer_action", {
            request: payload,
          });
          break;
        case "fetch_loopback":
          result = await invoke("fetch_loopback_url", {
            url: requiredString("url"),
            method: payload.method === "HEAD" ? "HEAD" : "GET",
          });
          break;
        case "open_visible_url":
          result = {
            opened: await invoke<boolean>("open_visible_url_with_consent", {
              url: requiredString("url"),
            }),
          };
          break;
        default:
          throw new Error("Unsupported desktop local access operation.");
      }

      const serialized = JSON.stringify(result);
      if (new TextEncoder().encode(serialized).byteLength > 768 * 1024) {
        throw new Error(
          "Desktop local access result is too large for the secure relay.",
        );
      }
      return {
        type: "desktop_local_access_result",
        requestId: message.requestId,
        ok: true,
        result,
      };
    } catch (error) {
      return {
        type: "desktop_local_access_result",
        requestId: message.requestId,
        ok: false,
        error: (error instanceof Error
          ? error.message
          : String(error) || "Desktop local access failed."
        ).slice(0, 2048),
      };
    }
  }

  private async handlePtyCreate(msg: PtyCreateMessage): Promise<void> {
    const { sessionId, command, cols, rows, cwd, env } = msg;

    try {
      const { invoke, Channel } = await import("@tauri-apps/api/core");

      const channel = new Channel<string>();
      // Serialize publishes: Rust now flushes per-read (could be per-char on
      // interactive echo). Firing 12 unawaited publishes at the Centrifuge
      // client caused reordered arrival at the server, producing garbled
      // terminal rendering. Chain through this promise to preserve order.
      let publishQueue: Promise<void> = Promise.resolve();
      const enqueuePublish = (msg: SandboxMessage) => {
        publishQueue = publishQueue.then(() =>
          this.publishResult(msg).catch((err) => {
            console.error(
              "[DesktopSandboxBridge] Failed to publish",
              msg.type,
              err,
            );
          }),
        );
      };

      // Debounce buffer for PTY output - accumulate chunks before publishing
      // to reduce RPC overhead from node-pty's per-character callbacks.
      const PTY_DEBOUNCE_MS = 8;
      let ptyBuffer = "";
      let ptyDebounceTimer: ReturnType<typeof setTimeout> | null = null;

      const flushPtyBuffer = () => {
        if (ptyBuffer) {
          enqueuePublish({
            type: "pty_data",
            sessionId,
            data: ptyBuffer,
          });
          ptyBuffer = "";
        }
        ptyDebounceTimer = null;
      };

      channel.onmessage = (chunk: string) => {
        // The Tauri PTY backend sends raw output strings and a final JSON
        // exit sentinel: {"type":"exit","exitCode":N,"sessionId":"..."}.
        // We require ALL three sentinel fields before treating a chunk as an
        // exit — otherwise a program that legitimately prints
        // `{"type":"exit",...}` would be swallowed and never reach pty_data.
        try {
          const parsed = JSON.parse(chunk) as {
            type?: unknown;
            exitCode?: unknown;
            sessionId?: unknown;
          };
          if (
            parsed.type === "exit" &&
            parsed.sessionId === sessionId &&
            typeof parsed.exitCode === "number"
          ) {
            // Flush any buffered data before exit
            if (ptyDebounceTimer) {
              clearTimeout(ptyDebounceTimer);
              flushPtyBuffer();
            }
            enqueuePublish({
              type: "pty_exit",
              sessionId,
              exitCode: parsed.exitCode,
            });
            return;
          }
        } catch {
          // Not JSON — regular PTY output
        }

        // Accumulate chunks and debounce publish
        ptyBuffer += chunk;
        if (!ptyDebounceTimer) {
          ptyDebounceTimer = setTimeout(flushPtyBuffer, PTY_DEBOUNCE_MS);
        }
      };

      const result = (await invoke("execute_pty_create", {
        sessionId,
        command,
        cols: cols ?? DEFAULT_PTY_COLS,
        rows: rows ?? DEFAULT_PTY_ROWS,
        cwd,
        env,
        onData: channel,
      })) as { pid: number | null; session_id: string };

      // Rust's PtyCreateResult.pid is Option<u32> — serializes to `null` when
      // the child didn't expose a pid. Reject that case explicitly so the
      // server doesn't get a pty_ready with a bogus pid cast.
      if (typeof result.pid !== "number") {
        throw new Error(
          `execute_pty_create returned no pid for sessionId=${sessionId}`,
        );
      }

      // Route pty_ready through the same publishQueue that pty_data/pty_exit
      // use. Direct publishResult can arrive AFTER already-queued pty_data
      // chunks on fast-starting commands — the server-side adapter would then
      // see pty_data with no matching pty_ready and drop the output.
      enqueuePublish({
        type: "pty_ready",
        sessionId,
        pid: result.pid,
      });
    } catch (err) {
      // The failure path never reaches the channel.onmessage listener, so
      // no pty_data was queued for this session — publishResult direct is
      // safe here. (enqueuePublish is also out of scope in this catch.)
      await this.publishResult({
        type: "pty_error",
        sessionId,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async handlePtyInput(msg: PtyInputMessage): Promise<void> {
    const { sessionId, data } = msg;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("execute_pty_input", { sessionId, data });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err) || "unknown pty_input error";
      console.error("[desktop-bridge] execute_pty_input failed:", err);
      await this.publishResult({
        type: "pty_error",
        sessionId,
        message,
      });
    }
  }

  private async handlePtyResize(msg: PtyResizeMessage): Promise<void> {
    const { sessionId, cols, rows } = msg;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("execute_pty_resize", { sessionId, cols, rows });
    } catch (err) {
      console.warn(
        `[DesktopSandboxBridge] pty_resize failed sessionId=${sessionId}:`,
        err,
      );
    }
  }

  private async handlePtyKill(msg: PtyKillMessage): Promise<void> {
    const { sessionId } = msg;
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("execute_pty_kill", { sessionId });
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : JSON.stringify(err) || "unknown pty_kill error";
      console.error("[desktop-bridge] execute_pty_kill failed:", err);
      // Surface the failure to the server so the adapter's failTransport()
      // path can resolve `exited` — otherwise awaiters of handle.exited
      // would only escape via the 1500ms kill-timeout fallback.
      await this.publishResult({
        type: "pty_error",
        sessionId,
        message,
      });
    }
  }

  async stop(): Promise<void> {
    const connectionId = this.connectionId;
    // Clear identity/listeners synchronously, before a potentially slow server
    // disconnect, so neither ready events nor late startup can revive access.
    this.terminateClient();
    if (connectionId) {
      try {
        await this.config.disconnectDesktop({ connectionId });
      } catch (error) {
        console.warn("[DesktopSandboxBridge] Failed to disconnect:", error);
      }
    }
  }
}
