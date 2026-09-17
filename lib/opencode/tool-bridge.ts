import { BRIDGE_TOOLS, reqPath, resPath, type BridgeRequest, type BridgeResponse } from "@/lib/opencode/bridge-protocol";
import type { OpenCodeToolSnapshot } from "@/lib/opencode/tool-map";

/**
 * Driver side of the file bridge. When OpenCode reports one of our bridged
 * tools entering `running`, read its request from the sandbox, run the real
 * RIFT executor on the worker, and write the response back. Executors receive
 * the tool's args and return whatever the RIFT tool returns (serialised as the
 * tool output). One in-flight execution per callID; duplicates are ignored.
 */

export interface BridgeSandbox {
  files: {
    read: (path: string, opts?: { user?: string }) => Promise<string>;
    write: (path: string, data: string, opts?: { user?: string }) => Promise<unknown>;
  };
}

export type BridgeExecutor = (args: Record<string, unknown>, ctx: { toolCallId: string; signal: AbortSignal }) => Promise<unknown>;

export interface ToolBridge {
  /** Feed every tool snapshot; returns true when this call was claimed by the bridge. */
  onToolSnapshot: (snapshot: OpenCodeToolSnapshot) => boolean;
  /** Abort in-flight executors (leg end / cancel). */
  close: () => Promise<void>;
  /** For tests: pending call ids. */
  inflight: () => string[];
}

export function createToolBridge(deps: {
  sandbox: BridgeSandbox;
  executors: Record<string, BridgeExecutor>;
  user?: string;
  onError?: (toolName: string, error: unknown) => void;
  /** Injected for tests. */
  readRetries?: number;
  readRetryMs?: number;
}): ToolBridge {
  const user = deps.user ?? "user";
  const readRetries = deps.readRetries ?? 40;
  const readRetryMs = deps.readRetryMs ?? 250;
  const running = new Map<string, { controller: AbortController; done: Promise<void> }>();

  async function readRequest(callID: string): Promise<BridgeRequest | null> {
    for (let i = 0; i < readRetries; i++) {
      try {
        const raw = await deps.sandbox.files.read(reqPath(callID), { user });
        return JSON.parse(raw) as BridgeRequest;
      } catch {
        await new Promise((r) => setTimeout(r, readRetryMs));
      }
    }
    return null;
  }

  async function serve(callID: string, toolName: string, controller: AbortController) {
    const executor = deps.executors[toolName];
    let response: BridgeResponse;
    try {
      const req = await readRequest(callID);
      if (!req) throw new Error(`bridge request for ${toolName} (${callID}) never appeared`);
      const timeoutMs = BRIDGE_TOOLS[toolName]?.deadlineMs ?? 90_000;
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const output = await executor(req.args ?? {}, { toolCallId: callID, signal: controller.signal });
        response = { v: 1, ok: true, output: typeof output === "string" ? output : JSON.stringify(output ?? null) };
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      deps.onError?.(toolName, error);
      response = { v: 1, ok: false, output: "", error: error instanceof Error ? error.message : String(error) };
    }
    try {
      await deps.sandbox.files.write(resPath(callID), JSON.stringify(response), { user });
    } catch (error) {
      deps.onError?.(toolName, error);
    }
  }

  return {
    onToolSnapshot(snapshot) {
      if (!(snapshot.tool in deps.executors)) return false;
      if (snapshot.state.status !== "running") return running.has(snapshot.callID);
      if (running.has(snapshot.callID)) return true;
      const controller = new AbortController();
      const done = serve(snapshot.callID, snapshot.tool, controller).finally(() => running.delete(snapshot.callID));
      running.set(snapshot.callID, { controller, done });
      return true;
    },
    async close() {
      for (const { controller } of running.values()) controller.abort();
      await Promise.allSettled([...running.values()].map((r) => r.done));
    },
    inflight: () => [...running.keys()],
  };
}
