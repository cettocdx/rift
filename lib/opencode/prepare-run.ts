import { buildOpenCodeConfig } from "@/lib/opencode/config";
import { ensureOpenCodeServer, type SandboxLike } from "@/lib/opencode/boot";
import { createOpenCodeClient, type OpenCodeClient } from "@/lib/opencode/client";
import { createRunLease, readRunUsage, type RunUsageTotals } from "@/lib/opencode/run-lease";
import { signRunToken } from "@/lib/llm-proxy/token";
import { sandboxToolFiles } from "@/lib/opencode/sandbox-tools";
import { BRIDGE_DIR } from "@/lib/opencode/bridge-protocol";

/**
 * Everything that has to happen before the driver can stream: mint the per-run
 * proxy token, build opencode.json, make sure `opencode serve` is up in the
 * chat's sandbox, find or create the OpenCode session, and open the Redis lease
 * that authorizes the proxy to spend for this run. Returns the ready client and
 * ids; the caller persists the session binding and hands the rest to the driver.
 */

export interface PrepareOpenCodeRunArgs {
  sandbox: SandboxLike;
  runId: string;
  chatId: string;
  userId: string;
  subscription: string;
  modelKey: string;
  reasoningEffort?: string;
  ceilingDollars: number;
  workingContextTokens: number;
  maxSteps: number;
  maxOutputTokens: number;
  /** Public proxy base URL reachable from inside the sandbox. */
  proxyBaseUrl: string;
  /** Previously bound session for this chat, if any (continued when still present). */
  existingSessionId?: string;
  existingSandboxId?: string;
  /** Extra config fragment (skills/MCP/agent prompt) from the materializer. */
  configExtensions?: Record<string, unknown>;
  /** Extra files (prompt, AGENTS.md) written before boot. */
  workspaceFiles?: Array<{ path: string; content: string }>;
  fetchImpl?: typeof fetch;
}

export interface PreparedOpenCodeRun {
  client: OpenCodeClient;
  sessionId: string;
  sessionReused: boolean;
  serverBaseUrl: string;
  serverAuth: string;
  sandboxId: string;
  readUsage: () => Promise<RunUsageTotals>;
}

export async function prepareOpenCodeRun(args: PrepareOpenCodeRunArgs): Promise<PreparedOpenCodeRun> {
  const proxyToken = signRunToken({
    runId: args.runId,
    chatId: args.chatId,
    userId: args.userId,
    sandboxId: args.sandbox.sandboxId,
  });

  const config = buildOpenCodeConfig({
    proxyBaseUrl: args.proxyBaseUrl,
    proxyToken,
    workingContextTokens: args.workingContextTokens,
    maxSteps: args.maxSteps,
    maxOutputTokens: args.maxOutputTokens,
    defaultModelKey: args.modelKey,
    extensions: args.configExtensions,
  });

  // RIFT tools served through the file bridge must exist before the server
  // scans its tools directory; the bridge dir must be writable by the agent.
  const files = [...sandboxToolFiles(), ...(args.workspaceFiles ?? [])];
  await args.sandbox.commands.run(
    `mkdir -p '${BRIDGE_DIR}' ${files.map((f) => `'${f.path.slice(0, f.path.lastIndexOf("/"))}'`).join(" ")}`,
    { user: "user" },
  );
  for (const f of files) await args.sandbox.files.write(f.path, f.content, { user: "user" });

  const server = await ensureOpenCodeServer({ sandbox: args.sandbox, config, fetchImpl: args.fetchImpl });
  const client = createOpenCodeClient({
    baseUrl: server.baseUrl,
    authHeader: server.authHeader,
    directory: server.workspaceDir,
    fetchImpl: args.fetchImpl,
  });

  // Continue the chat's session when it still exists on this sandbox.
  let sessionId: string | undefined;
  let sessionReused = false;
  if (args.existingSessionId && args.existingSandboxId === args.sandbox.sandboxId) {
    try {
      await client.getSession(args.existingSessionId);
      sessionId = args.existingSessionId;
      sessionReused = true;
    } catch {
      sessionId = undefined;
    }
  }
  if (!sessionId) {
    const created = await client.createSession({ title: `rift:${args.chatId}` });
    sessionId = created.id;
  }

  await createRunLease({
    runId: args.runId,
    chatId: args.chatId,
    userId: args.userId,
    sandboxId: args.sandbox.sandboxId,
    sessionId,
    subscription: args.subscription,
    modelKey: args.modelKey,
    reasoningEffort: args.reasoningEffort,
    ceilingDollars: args.ceilingDollars,
    serverBaseUrl: server.baseUrl,
    serverAuth: server.authHeader,
    createdAt: Date.now(),
  });

  return {
    client,
    sessionId,
    sessionReused,
    serverBaseUrl: server.baseUrl,
    serverAuth: server.authHeader,
    sandboxId: args.sandbox.sandboxId,
    readUsage: () => readRunUsage(args.runId),
  };
}
