/**
 * @jest-environment node
 */
import { createOpenCodeStream } from "@/lib/opencode/driver";
import type { OpenCodeClient, OpenCodeEvent } from "@/lib/opencode/client";
import { initAgentStreamState } from "@/lib/api/agent-stream-runner";
import {
  BUDGET_EXHAUSTION_FINISH_REASON,
  DOOM_LOOP_FINISH_REASON,
} from "@/lib/chat/stop-conditions";

jest.mock("server-only", () => ({}));

const upd = (part: Record<string, unknown>): OpenCodeEvent => ({
  type: "message.part.updated",
  properties: {
    sessionID: "ses_1",
    part: { sessionID: "ses_1", messageID: "m1", ...part },
  },
});
const stepFinish = (input = 100, output = 10) =>
  upd({
    id: "sf",
    type: "step-finish",
    reason: "stop",
    cost: 0.01,
    tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
  });
const idle: OpenCodeEvent = {
  type: "session.status",
  properties: { sessionID: "ses_1", status: { type: "idle" } },
};
const connected: OpenCodeEvent = { type: "server.connected", properties: {} };

/** A fake OpenCode client: events are pushed by the test; calls are recorded. */
function fakeClient() {
  const queue: Array<OpenCodeEvent | null> = [];
  let wake: (() => void) | null = null;
  const push = (...evs: OpenCodeEvent[]) => {
    queue.push(...evs);
    wake?.();
  };
  const end = () => {
    queue.push(null);
    wake?.();
  };
  const calls: Array<{ m: string; args: unknown[] }> = [];
  const rec =
    (m: string) =>
    async (...args: unknown[]) => {
      calls.push({ m, args });
      return undefined as any;
    };
  const client = {
    async *events(signal?: AbortSignal) {
      for (;;) {
        if (signal?.aborted) return;
        if (queue.length === 0) await new Promise<void>((r) => (wake = r));
        const ev = queue.shift();
        if (ev === null) return;
        if (ev) yield ev;
      }
    },
    promptAsync: rec("promptAsync"),
    abort: rec("abort"),
    replyPermission: rec("replyPermission"),
    rejectQuestion: rec("rejectQuestion"),
  } as unknown as OpenCodeClient;
  return { client, push, end, calls };
}

function fakeCtx(over: Partial<Record<string, unknown>> = {}) {
  const usageTracker = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    steps: [] as unknown[],
    accumulateStep(u: any) {
      this.steps.push(u);
      this.inputTokens += u.inputTokens || 0;
      this.outputTokens += u.outputTokens || 0;
      this.totalTokens += u.totalTokens || 0;
    },
    computeCostDollars: () => 0.5,
  };
  const telemetry = {
    onFirstChunk: jest.fn(),
    onStepFinished: jest.fn(),
    onPrepareStep: jest.fn(),
  };
  return {
    ctx: {
      usageTracker,
      telemetry,
      budgetMonitor: { checkAfterStep: jest.fn(() => "continue") },
      abortController: new AbortController(),
      streamStartTime: Date.now(),
      maxDurationMs: 60 * 60 * 1000,
      ctxMaxTokens: 200000,
      getLiveNonModelCost: () => 0,
      ...over,
    } as any,
    usageTracker,
    telemetry,
  };
}

async function drain(stream: ReadableStream<any>) {
  const out: any[] = [];
  const r = stream.getReader();
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    out.push(value);
  }
  return out;
}

const base = (
  client: OpenCodeClient,
  over: Partial<Record<string, unknown>> = {},
) => ({
  client,
  sessionId: "ses_1",
  modelKey: "model-gpt-5.6-sol",
  promptText: "build it",
  maxSteps: 100,
  eventIdleTimeoutMs: 2000,
  abortSettleMs: 50,
  ...over,
});

describe("createOpenCodeStream", () => {
  it("does not arm an overflowing elapsed timer for an unlimited durable run", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx } = fakeCtx({ maxDurationMs: Number.POSITIVE_INFINITY });
    const state = initAgentStreamState([], {
      usedTokens: 0,
      maxTokens: 200000,
    });
    const timer = jest.spyOn(global, "setTimeout");
    try {
      const res = await createOpenCodeStream(
        "model-gpt-5.6-sol",
        ctx,
        state,
        base(client),
      );
      const stream = res.toUIMessageStream({
        generateMessageId: () => "unlimited",
      });
      push(connected);
      setTimeout(
        () =>
          push(
            upd({ id: "t1", type: "text", text: "done" }),
            stepFinish(),
            idle,
          ),
        20,
      );
      await drain(stream);
      expect(timer.mock.calls.some((call) => call[1] === Infinity)).toBe(false);
      expect(state.stoppedDueToElapsedTimeout).toBe(false);
      expect(calls.filter((call) => call.m === "abort")).toHaveLength(0);
    } finally {
      timer.mockRestore();
    }
  });

  it("happy path: subscribes, prompts, streams, finishes once with metadata + usage", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx, usageTracker, telemetry } = fakeCtx();
    const state = initAgentStreamState([], {
      usedTokens: 0,
      maxTokens: 200000,
    });
    const readUsage = jest
      .fn()
      .mockResolvedValue({
        inputTokens: 5973,
        outputTokens: 5,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        requests: 1,
        costDollars: 0.03,
      });
    const res = await createOpenCodeStream(
      "model-gpt-5.6-sol",
      ctx,
      state,
      base(client, { readUsage }),
    );
    const onFinish = jest.fn();
    const stream = res.toUIMessageStream({
      generateMessageId: () => "msg_1",
      messageMetadata: ({ part }) => ({ phase: part.type }),
      onFinish,
    });
    // feed after a tick so the driver has subscribed
    setTimeout(() => {
      push(connected);
      setTimeout(() => {
        push(
          {
            type: "message.part.delta",
            properties: {
              sessionID: "ses_1",
              partID: "t1",
              field: "text",
              delta: "OK",
            },
          },
          upd({
            id: "t1",
            type: "text",
            text: "OK",
            time: { start: 1, end: 2 },
          }),
          stepFinish(5973, 5),
          idle,
        );
      }, 20);
    }, 5);
    const chunks = await drain(stream);
    const types = chunks.map((c) => c.type);
    expect(types[0]).toBe("start");
    expect(chunks[0]).toMatchObject({
      messageId: "msg_1",
      messageMetadata: { phase: "start" },
    });
    expect(types).toEqual(
      expect.arrayContaining([
        "start-step",
        "text-start",
        "text-delta",
        "text-end",
        "finish-step",
        "finish",
      ]),
    );
    expect(types[types.length - 1]).toBe("finish");
    expect(chunks[chunks.length - 1]).toMatchObject({
      finishReason: "stop",
      messageMetadata: { phase: "finish" },
    });

    // prompted the right session/model, after subscribing
    expect(calls.find((c) => c.m === "promptAsync")?.args).toEqual([
      "ses_1",
      {
        parts: [{ type: "text", text: "build it" }],
        model: { providerID: "gateway", modelID: "model-gpt-5.6-sol" },
      },
    ]);
    // proxy-metered usage fed into the tracker with raw.cost
    expect(usageTracker.steps[0]).toMatchObject({
      inputTokens: 5973,
      outputTokens: 5,
      raw: { cost: 0.03 },
    });
    expect(telemetry.onStepFinished).toHaveBeenCalledWith(
      expect.objectContaining({ stepIndex: 1, costDeltaDollars: 0.03 }),
    );
    expect(telemetry.onFirstChunk).toHaveBeenCalledTimes(1);
    // state + onFinish + usage promise
    expect(state.streamFinishReason).toBe("stop");
    expect(onFinish).toHaveBeenCalledTimes(1);
    const msg = onFinish.mock.calls[0][0].messages[0];
    expect(msg.id).toBe("msg_1");
    expect(
      msg.parts.some((p: any) => p.type === "text" && p.text === "OK"),
    ).toBe(true);
    expect(onFinish.mock.calls[0][0].isAborted).toBe(false);
    await expect(res.usage).resolves.toMatchObject({ inputTokens: 5973 });
  });

  it("user abort → aborts the session, emits abort, finishReason undefined, isAborted true", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream("m", ctx, state, base(client));
    const onFinish = jest.fn();
    const stream = res.toUIMessageStream({
      generateMessageId: () => "msg",
      onFinish,
    });
    setTimeout(() => {
      push(connected);
      setTimeout(() => {
        push({
          type: "message.part.delta",
          properties: {
            sessionID: "ses_1",
            partID: "t",
            field: "text",
            delta: "wor",
          },
        });
        ctx.abortController.abort();
      }, 20);
    }, 5);
    const chunks = await drain(stream);
    expect(calls.some((c) => c.m === "abort")).toBe(true);
    expect(chunks.map((c) => c.type)).toContain("abort");
    expect(state.streamFinishReason).toBeUndefined();
    expect(onFinish.mock.calls[0][0].isAborted).toBe(true);
  });

  it("doom_loop: first ask → reject with nudge + warning; second → halt", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx, telemetry } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream("m", ctx, state, base(client));
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(() => {
        push({
          type: "permission.asked",
          properties: {
            id: "perm_1",
            sessionID: "ses_1",
            permission: "doom_loop",
          },
        });
        push({
          type: "permission.asked",
          properties: {
            id: "perm_2",
            sessionID: "ses_1",
            permission: "doom_loop",
          },
        });
        push(
          upd({ id: "x", type: "text", text: "..", time: { start: 1 } }),
          idle,
        );
      }, 20);
    }, 5);
    await drain(stream);
    const replies = calls.filter((c) => c.m === "replyPermission");
    expect(replies[0].args[0]).toBe("perm_1");
    expect(replies[0].args[1]).toBe("reject");
    expect(String(replies[0].args[2])).toMatch(/LOOP DETECTED/);
    expect(telemetry.onPrepareStep).toHaveBeenCalledWith(
      expect.objectContaining({ loopSeverity: "warning" }),
    );
    expect(state.stoppedDueToDoomLoop).toBe(true);
    expect(state.streamFinishReason).toBe(DOOM_LOOP_FINISH_REASON);
    expect(calls.some((c) => c.m === "abort")).toBe(true);
  });

  it("ordinary permission asks are approved once; questions are rejected", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream("m", ctx, state, base(client));
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(() => {
        push({
          type: "permission.asked",
          properties: { id: "p9", sessionID: "ses_1", permission: "edit" },
        });
        push({
          type: "question.asked",
          properties: { id: "q1", sessionID: "ses_1" },
        });
        push(
          upd({ id: "x", type: "text", text: "..", time: { start: 1 } }),
          idle,
        );
      }, 20);
    }, 5);
    await drain(stream);
    expect(calls).toContainEqual({
      m: "replyPermission",
      args: ["p9", "once"],
    });
    expect(calls).toContainEqual({ m: "rejectQuestion", args: ["q1"] });
  });

  it("session.error → providerError, error chunk, finishReason error", async () => {
    const { client, push } = fakeClient();
    const { ctx } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream("m", ctx, state, base(client));
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(
        () =>
          push({
            type: "session.error",
            properties: {
              sessionID: "ses_1",
              error: { name: "APIError", message: "402 budget" },
            },
          }),
        20,
      );
    }, 5);
    const chunks = await drain(stream);
    expect(
      chunks.some((c) => c.type === "error" && c.errorText === "402 budget"),
    ).toBe(true);
    expect(state.providerError).toMatchObject({ message: "402 budget" });
    expect(state.streamFinishReason).toBe("error");
  });

  it("budget monitor abort → stoppedDueToBudgetExhaustion + budget finish reason", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx } = fakeCtx({
      budgetMonitor: { checkAfterStep: jest.fn(() => "abort") },
    });
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream("m", ctx, state, base(client));
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(() => push(stepFinish(), idle), 20);
    }, 5);
    await drain(stream);
    expect(state.stoppedDueToBudgetExhaustion).toBe(true);
    expect(state.streamFinishReason).toBe(BUDGET_EXHAUSTION_FINISH_REASON);
    expect(calls.some((c) => c.m === "abort")).toBe(true);
  });

  it("step cap → aborts with tool-calls (legacy stepCountIs semantics)", async () => {
    const { client, push, calls } = fakeClient();
    const { ctx } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream(
      "m",
      ctx,
      state,
      base(client, { maxSteps: 2 }),
    );
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(() => push(stepFinish(), stepFinish(), idle), 20);
    }, 5);
    await drain(stream);
    expect(state.streamFinishReason).toBe("tool-calls");
    expect(calls.filter((c) => c.m === "abort").length).toBeGreaterThanOrEqual(
      1,
    );
  });

  it("silent event stream → error finish instead of hanging", async () => {
    const { client, push } = fakeClient();
    const { ctx } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const res = await createOpenCodeStream(
      "m",
      ctx,
      state,
      base(client, { eventIdleTimeoutMs: 100 }),
    );
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => push(connected), 5); // then silence
    const chunks = await drain(stream);
    expect(chunks[chunks.length - 1].type).toBe("finish");
    expect(state.streamFinishReason).toBe("error");
    expect(String((state.providerError as Error).message)).toMatch(/silent/);
  });

  it("falls back to OpenCode step tokens when the proxy tally has not moved (no Redis)", async () => {
    const { client, push } = fakeClient();
    const { ctx, usageTracker } = fakeCtx();
    const state = initAgentStreamState([], { usedTokens: 0, maxTokens: 1 });
    const readUsage = jest
      .fn()
      .mockResolvedValue({
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        reasoningTokens: 0,
        requests: 0,
        costDollars: 0,
      });
    const res = await createOpenCodeStream(
      "m",
      ctx,
      state,
      base(client, { readUsage }),
    );
    const stream = res.toUIMessageStream({ generateMessageId: () => "msg" });
    setTimeout(() => {
      push(connected);
      setTimeout(() => push(stepFinish(1234, 56), idle), 20);
    }, 5);
    await drain(stream);
    expect(usageTracker.steps[0]).toMatchObject({
      inputTokens: 1234,
      outputTokens: 56,
    });
  });
});
