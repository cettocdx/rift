import type { UIMessageStreamWriter } from "ai";
import type { Sandbox } from "@e2b/code-interpreter";

import type { SandboxManager, ToolContext } from "@/types";
import { createAppVerificationGate, createVerifyApp } from "@/lib/ai/tools/verify-app";
import { createExposePreview } from "@/lib/ai/tools/expose-preview";
import { TodoManager } from "@/lib/ai/tools/utils/todo-manager";
import { FileAccumulator } from "@/lib/ai/tools/utils/file-accumulator";
import { BackgroundProcessTracker } from "@/lib/ai/tools/utils/background-process-tracker";
import { ptySessionManager } from "@/lib/ai/tools/utils/pty-session-manager";
import type { BridgeExecutor } from "@/lib/opencode/tool-bridge";
import type { RunRecorder } from "@/lib/ai/runs/run-recorder";
import { isE2BSandbox } from "@/lib/ai/tools/utils/sandbox-types";

/**
 * The real RIFT verify_app / expose_preview tools, run on the worker against
 * the chat's sandbox, exposed as bridge executors. They share one
 * AppVerificationGate per leg, so `expose_preview` still refuses until
 * `verify_app` has passed for that port — the same contract as the legacy loop.
 * verify_app writes its progress (`data-terminal`) to the run's writer, so the
 * UI sees the build/probe output exactly as before.
 */

function fixedSandboxManager(sandbox: Sandbox): SandboxManager {
  return {
    getSandbox: async () => ({ sandbox }),
    setSandbox: () => {},
    getSandboxType: () => "e2b",
    getSandboxInfo: () => ({ type: "e2b" }),
    getEffectivePreference: () => "e2b",
    recordHealthFailure: () => false,
    resetHealthFailures: () => {},
    isSandboxUnavailable: () => false,
    supportsInteractivePty: async () => false,
    isE2BSandboxBooted: () => true,
  };
}

export function createBridgeExecutors(deps: {
  sandbox: Sandbox;
  writer: UIMessageStreamWriter;
  userId: string;
  chatId: string;
  modelName?: string;
  assistantMessageId?: string;
  runRecorder?: RunRecorder;
  onToolCost?: (costDollars: number) => void;
}): Record<string, BridgeExecutor> {
  const context: ToolContext = {
    sandboxManager: fixedSandboxManager(deps.sandbox),
    writer: deps.writer,
    userLocation: {},
    todoManager: new TodoManager([]),
    userID: deps.userId,
    chatId: deps.chatId,
    assistantMessageId: deps.assistantMessageId,
    runRecorder: deps.runRecorder,
    fileAccumulator: new FileAccumulator(),
    backgroundProcessTracker: new BackgroundProcessTracker(),
    ptySessionManager,
    mode: "agent",
    purpose: "app",
    modelName: deps.modelName,
    getCurrentModelName: () => deps.modelName,
    isE2BSandbox,
    caidoEnabled: false,
    onToolCost: deps.onToolCost,
  };

  const gate = createAppVerificationGate();
  const verifyApp = createVerifyApp(context, gate);
  const exposePreview = createExposePreview(context, gate);

  const run =
    (t: { execute?: (args: never, opts: { toolCallId: string; messages: never[]; abortSignal: AbortSignal }) => unknown }): BridgeExecutor =>
    async (args, ctx) =>
      t.execute!(args as never, { toolCallId: ctx.toolCallId, messages: [], abortSignal: ctx.signal });

  return {
    verify_app: run(verifyApp as never),
    expose_preview: run(exposePreview as never),
  };
}
