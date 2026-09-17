/** @jest-environment node */
/** Exercise the real request handler up to its effect boundary. Provider/tool
 * dependencies are deliberately unavailable: a rejected admission must never
 * reach them, charge, persist, or close another producer's terminals. */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function harness() {
  const events: string[] = [];
  const drainTools = jest.fn(async () => {});
  const active = {
    executionId: "execution-a",
    phase: "admitted",
    stopped: false,
    discard: false,
    canceled: false,
  };
  const execution = {
    isHackHttpExecutionId: (value: unknown) =>
      typeof value === "string" && /^[A-Za-z0-9._~-]{1,200}$/.test(value),
    admitHackHttpExecution: jest.fn(async () => ({
      admitted: true,
      status: active,
    })),
    readHackHttpExecution: jest.fn(async () => active),
    finishHackHttpExecution: jest.fn(async () => {
      events.push("finish");
      return true;
    }),
  };
  const closeAll = jest.fn(async () => {
    events.push("pty-close");
  });
  const stop = jest.fn(async () => {
    events.push("subscriber-close");
  });
  const preflight = jest.fn(async () => {
    throw new Error("preflight failure");
  });
  const refund = jest.fn(async () => {
    events.push("refund");
    return true;
  });
  const logger = {
    setRequestDetails() {},
    emitChatError() {},
    emitUnexpectedError() {},
  };
  class SDKError extends Error {
    toResponse() {
      return new Response(this.message, { status: 500 });
    }
  }
  const mocks: Record<string, unknown> = {
    "@/lib/hack/http-execution": execution,
    "@/lib/hack/http-tool-execution-drain": {
      createHttpToolExecutionDrain: () => ({
        closeAndWait: drainTools,
        wrap: (tools: unknown) => tools,
      }),
    },
    "@/lib/auth/get-user-id": {
      getUserIDAndPro: async () => ({ userId: "owner", subscription: "max" }),
    },
    "@/lib/auth/premium-access": { assertHackWorkbenchAccess() {} },
    "@/lib/desktop/working-file-context": {
      parseWorkingFileContext: () => undefined,
    },
    "@/lib/ai/approval/policy": { parseApprovalMode: () => "auto" },
    "@/types": {
      coerceSelectedModel: () => undefined,
      coerceChatPurpose: () => "security",
    },
    "@/lib/api/chat-logger": { createChatLogger: () => logger },
    "@/lib/errors": { ChatSDKError: SDKError },
    "@/lib/utils/error-utils": {
      getUserFriendlyProviderError: () => "failure",
    },
    "@/lib/suspensions": { assertUserCanMakeCostIncurringRequest: preflight },
    "@/lib/db/actions": {
      getUserCustomization: async () => null,
      getMessagesByChatId: async () => null,
    },
    "@/lib/ai/tools/utils/pty-session-manager": {
      ptySessionManager: {
        closeAll,
        closeAllConfirmed: closeAll,
        releaseConfirmedScope() {},
        withConfirmedScope: (_id: string, callback: () => unknown) =>
          callback(),
      },
    },
    "@/lib/utils/stream-cancellation": {
      createCancellationSubscriber: async () => ({ stop }),
    },
    "@/lib/rate-limit": {
      UsageRefundTracker: class {
        refund = refund;
        getDeductionSummary() {
          return {};
        }
      },
    },
    ai: {
      createUIMessageStream: ({ execute }: any) => {
        const chunks: unknown[] = [];
        execute({ writer: { write: (chunk: unknown) => chunks.push(chunk) } });
        return chunks;
      },
      createUIMessageStreamResponse: ({ stream, headers }: any) =>
        new Response(JSON.stringify(stream), { headers }),
    },
  };
  const source = fs.readFileSync(
    path.resolve(__dirname, "../chat-handler.ts"),
    "utf8",
  );
  const exports: any = {};
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }).outputText,
    {
      exports,
      require: (id: string) => mocks[id] ?? {},
      Response,
      DOMException,
      AbortController,
      console,
    },
  );
  const handler = exports.createChatHandler({
    hackWorkbenchOnly: true,
    forcedPurpose: "security",
  });
  const send = (executionId: unknown = "execution-a") =>
    handler({
      json: async () => ({
        chatId: "chat",
        mode: "agent",
        messages: [],
        executionId,
      }),
      signal: new AbortController().signal,
    });
  return {
    send,
    execution,
    active,
    preflight,
    closeAll,
    stop,
    refund,
    events,
    drainTools,
  };
}

test.each([undefined, "bad\r\nheader", "", "a".repeat(201)])(
  "rejects invalid identity without any effects (%p)",
  async (id) => {
    const h = harness();
    const response = await h.send(id === undefined ? null : id);
    expect(response.status).toBe(400);
    expect(h.execution.admitHackHttpExecution).not.toHaveBeenCalled();
    expect(h.preflight).not.toHaveBeenCalled();
    expect(h.closeAll).not.toHaveBeenCalled();
  },
);

test("Stop before POST becomes an exact terminal stream without billing or persistence", async () => {
  const h = harness();
  h.execution.admitHackHttpExecution.mockResolvedValue({
    admitted: false,
    reason: "stopped",
    status: { ...h.active, phase: "stopped", stopped: true, canceled: true },
  } as any);
  const response = await h.send();
  expect(response.status).toBe(200);
  expect(response.headers.get("x-rift-execution-id")).toBe("execution-a");
  expect(await response.json()).toEqual([{ type: "abort" }]);
  expect(h.preflight).not.toHaveBeenCalled();
  expect(h.execution.finishHackHttpExecution).not.toHaveBeenCalled();
});

test.each(["busy", "duplicate", "stopped"])(
  "%s admission cannot execute or finalize the other producer",
  async (reason) => {
    const h = harness();
    h.execution.admitHackHttpExecution.mockResolvedValue({
      admitted: false,
      reason,
      status: h.active,
    } as any);
    expect((await h.send()).status).toBe(409);
    expect(h.preflight).not.toHaveBeenCalled();
    expect(h.closeAll).not.toHaveBeenCalled();
    expect(h.execution.finishHackHttpExecution).not.toHaveBeenCalled();
  },
);

test("an admitted preflight failure refunds and closes its observer before terminal acknowledgment", async () => {
  const h = harness();
  expect((await h.send()).status).toBe(500);
  expect(h.events).toEqual([
    "pty-close",
    "refund",
    "subscriber-close",
    "finish",
  ]);
  expect(h.execution.finishHackHttpExecution).toHaveBeenCalledWith({
    userId: "owner",
    chatId: "chat",
    executionId: "execution-a",
  });
});

test("an admission authority failure cannot close another producer's terminals", async () => {
  const h = harness();
  h.execution.admitHackHttpExecution.mockRejectedValue(new Error("forbidden"));
  expect((await h.send()).status).toBe(500);
  expect(h.closeAll).not.toHaveBeenCalled();
  expect(h.execution.finishHackHttpExecution).not.toHaveBeenCalled();
});

test("terminal acknowledgment waits for PTY cleanup even when SDK abort callbacks are detached", async () => {
  const h = harness();
  let release!: () => void;
  let started!: () => void;
  const cleanupStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  h.closeAll.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
        started();
      }),
  );
  const request = h.send();
  await cleanupStarted;
  expect(h.closeAll).toHaveBeenCalledTimes(1);
  expect(h.execution.finishHackHttpExecution).not.toHaveBeenCalled();
  release();
  await request;
  expect(h.execution.finishHackHttpExecution).toHaveBeenCalledTimes(1);
});

test("terminal shutdown can unblock an in-flight tool while finalization waits for both", async () => {
  const h = harness();
  let exited!: () => void;
  h.drainTools.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        exited = resolve;
      }),
  );
  h.closeAll.mockImplementation(async () => {
    exited();
  });
  expect((await h.send()).status).toBe(500);
  expect(h.execution.finishHackHttpExecution).toHaveBeenCalledTimes(1);
});
