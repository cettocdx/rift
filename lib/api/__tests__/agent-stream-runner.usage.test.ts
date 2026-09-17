import { withAgentLongStreamHeartbeat } from "@/lib/chat/agent-long-heartbeat";
import { tool } from "ai";
import { z } from "zod";
import {
  createAgentStream,
  makeCtx,
  mockCheckAndSummarizeIfNeeded,
  resetSummarizationMock,
  scriptedModel,
} from "./helpers/scripted-model";

it("journals individual provider steps without accumulating the receipt twice", async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: "probe", input: { n: 1 } }],
      usage: { input: 100, output: 20, cost: 0.01 },
    },
    { text: "Done.", usage: { input: 150, output: 30, cost: 0.02 } },
  ]);
  const made = makeCtx({ model });
  const record = jest.fn(async () => undefined);
  made.ctx.onProviderUsage = record;
  await (
    await createAgentStream("model-gpt-5.6-sol", made.ctx, made.state)
  ).consumeStream();
  expect(record).toHaveBeenCalledTimes(2);
  expect(record.mock.calls[0]).toEqual([
    expect.objectContaining({ inputTokens: 100 }),
    expect.any(String),
  ]);
  expect(record.mock.calls[1]).toEqual([
    expect.objectContaining({ inputTokens: 150 }),
    expect.any(String),
  ]);
  expect(made.ctx.usageTracker.inputTokens).toBe(250);
});

it("stops before the next model step when the durable receipt cannot be saved", async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: "probe", input: { n: 1 } }],
      usage: { input: 100, output: 20, cost: 0.01 },
    },
    { text: "Must not run.", usage: { input: 150, output: 30, cost: 0.02 } },
  ]);
  const made = makeCtx({ model });
  const failure = new Error("Receipt storage unavailable");
  made.ctx.onProviderUsage = async () => {
    throw failure;
  };
  await (
    await createAgentStream("model-gpt-5.6-sol", made.ctx, made.state)
  ).consumeStream();
  expect(made.ctx.abortController.signal.aborted).toBe(true);
  expect(model.calls).toHaveLength(1);
  expect(made.state.streamUsage?.inputTokens).toBe(100);
  expect(made.state.providerError).toBe(failure);
});

it("persists and logs the whole stream usage rather than the final tool step", async () => {
  const model = scriptedModel([
    {
      toolCalls: [{ name: "probe", input: { n: 1 } }],
      usage: {
        input: 100,
        output: 20,
        cacheRead: 80,
        reasoning: 5,
        cost: 0.012,
      },
    },
    {
      text: "Verified.",
      usage: {
        input: 150,
        output: 30,
        cacheRead: 120,
        reasoning: 7,
        cost: 0.018,
      },
    },
  ]);
  const made = makeCtx({ model });
  const result = await createAgentStream(
    "model-gpt-5.6-sol",
    made.ctx,
    made.state,
  );
  await result.consumeStream();
  expect(made.state.streamUsage).toMatchObject({
    inputTokens: 250,
    outputTokens: 50,
    totalTokens: 300,
    inputTokenDetails: { cacheReadTokens: 200 },
    outputTokenDetails: { reasoningTokens: 12 },
    raw: { cost: 0.03 },
  });
  // Reporting must not accumulate usage into the billing tracker again.
  expect(made.ctx.usageTracker.inputTokens).toBe(250);
  expect(made.ctx.usageTracker.modelProviderCost).toBeCloseTo(0.03);
});

it("preserves an explicit zero cost across all completed steps", async () => {
  const made = makeCtx({
    model: scriptedModel([
      {
        toolCalls: [{ name: "probe", input: { n: 1 } }],
        usage: { input: 100, output: 20, cost: 0 },
      },
      { text: "Done.", usage: { input: 150, output: 30, cost: 0 } },
    ]),
  });
  await (
    await createAgentStream("model-gpt-5.6-sol", made.ctx, made.state)
  ).consumeStream();
  expect(made.state.streamUsage).toMatchObject({
    inputTokens: 250,
    raw: { cost: 0 },
  });
});

it("does not label a partial provider cost as the cost of the whole stream", async () => {
  const made = makeCtx({
    model: scriptedModel([
      {
        toolCalls: [{ name: "probe", input: { n: 1 } }],
        usage: { input: 100, output: 20 },
      },
      { text: "Done.", usage: { input: 150, output: 30, cost: 0.018 } },
    ]),
  });
  await (
    await createAgentStream("model-gpt-5.6-sol", made.ctx, made.state)
  ).consumeStream();
  expect(made.state.streamUsage?.inputTokens).toBe(250);
  expect(made.state.streamUsage?.raw).toBeUndefined();
});

it("preserves completed usage after abort at completed-step checkpoint", async () => {
  const made = makeCtx({
    model: scriptedModel([
      {
        toolCalls: [{ name: "probe", input: { n: 1 } }],
        usage: { input: 100, output: 20, cost: 0.01 },
      },
      { text: "later", usage: { input: 200, output: 30, cost: 0.02 } },
    ]),
  });
  made.ctx.onStepCompleted = async () => {
    made.ctx.abortController.abort();
  };
  const result = await createAgentStream(
    "model-gpt-5.6-sol",
    made.ctx,
    made.state,
  );
  await result.consumeStream();
  expect(made.state.streamUsage?.inputTokens).toBe(100);
});
it("preserves completed usage after later provider error", async () => {
  const made = makeCtx({
    model: scriptedModel([
      {
        toolCalls: [{ name: "probe", input: { n: 1 } }],
        usage: { input: 100, output: 20, cost: 0.01 },
      },
      { throw: new Error("later provider failure") },
    ]),
  });
  const result = await createAgentStream(
    "model-gpt-5.6-sol",
    made.ctx,
    made.state,
  );
  await result.consumeStream();
  expect(made.state.streamUsage?.inputTokens).toBe(100);
});

it.each(["abort", "error"])(
  "aggregates two completed steps before %s without another billing accumulation",
  async (kind) => {
    const model = scriptedModel([
      {
        toolCalls: [{ name: "probe", input: { n: 1 } }],
        usage: {
          input: 100,
          output: 20,
          cacheRead: 30,
          reasoning: 5,
          cost: 0.01,
        },
      },
      {
        toolCalls: [{ name: "probe", input: { n: 2 } }],
        usage: {
          input: 200,
          output: 30,
          cacheRead: 60,
          reasoning: 7,
          cost: 0.02,
        },
      },
      { throw: new Error("third step unavailable") },
    ]);
    const made = makeCtx({ model });
    let completed = 0;
    if (kind === "abort")
      made.ctx.onStepCompleted = async () => {
        if (++completed === 2) made.ctx.abortController.abort();
      };
    await (
      await createAgentStream("model-gpt-5.6-sol", made.ctx, made.state)
    ).consumeStream();
    expect(made.state.streamUsage).toMatchObject({
      inputTokens: 300,
      outputTokens: 50,
      totalTokens: 350,
      inputTokenDetails: { cacheReadTokens: 90 },
      outputTokenDetails: { reasoningTokens: 12 },
      raw: { cost: 0.03 },
    });
    expect(made.ctx.usageTracker.inputTokens).toBe(300);
    expect(made.ctx.usageTracker.modelProviderCost).toBeCloseTo(0.03);
  },
);

it("settles UI finalization when Stop interrupts a still-running tool", async () => {
  let started!: () => void;
  let release!: () => void;
  const toolStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const toolReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  const made = makeCtx({
    model: scriptedModel([
      {
        toolCalls: [{ name: "pending", input: {} }],
        usage: {
          input: 100,
          output: 20,
          cacheRead: 80,
          reasoning: 5,
          cost: 0.012,
        },
      },
    ]),
    tools: {
      pending: tool({
        inputSchema: z.object({}),
        execute: async (_input, { abortSignal }) => {
          abortSignal?.addEventListener("abort", release, { once: true });
          started();
          try {
            await toolReleased;
            return "released";
          } finally {
            abortSignal?.removeEventListener("abort", release);
          }
        },
      }),
    },
  });
  const result = await createAgentStream(
    "model-gpt-5.6-sol",
    made.ctx,
    made.state,
  );
  let finalized = 0;
  const stream = withAgentLongStreamHeartbeat({
    source: result.toUIMessageStream({
      onFinish: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        finalized += 1;
      },
    }),
    signal: made.ctx.abortController.signal,
    heartbeat: () => ({ type: "data-agent-heartbeat", data: {} }),
    drainOnAbort: true,
  });
  const draining = (async () => {
    for await (const _ of stream) {
      /* drain */
    }
  })();
  await toolStarted;
  // Let the provider finish frame drain while execution remains blocked.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const beforeStop = made.ctx.usageTracker.modelProviderCost;
  made.ctx.abortController.abort();
  try {
    await draining;
  } finally {
    release();
  }
  expect(finalized).toBe(1);
  expect(beforeStop).toBeCloseTo(0.012);
  expect(made.ctx.usageTracker.inputTokens).toBe(100);
  expect(made.ctx.usageTracker.modelProviderCost).toBeCloseTo(0.012);
  expect(made.state.streamUsage).toMatchObject({
    inputTokens: 100,
    totalTokens: 120,
    raw: { cost: 0.012 },
  });
});

it("carries the executed fallback model into early usage accounting rather than the original selected model", async () => {
  const made = makeCtx({
    model: scriptedModel([
      { text: "Fallback response.", usage: { input: 1000, output: 200 } },
    ]),
  });
  made.ctx.usageTracker.accumulateStep({
    inputTokens: 400,
    outputTokens: 40,
    raw: { cost: 0.3 },
  });
  made.ctx.usageTracker.resetModelLeg();
  await (
    await createAgentStream("fallback-gemini-3.5-flash", made.ctx, made.state)
  ).consumeStream();
  expect(
    made.ctx.usageTracker.computeCostDollars("model-gpt-5.6-sol"),
  ).toBeCloseTo(0.0033, 8);
  expect(made.ctx.usageTracker.inputTokens).toBe(1000);
});

it("attributes accepted summary usage to the active fallback model in the actual stream lifecycle", async () => {
  mockCheckAndSummarizeIfNeeded.mockImplementation(async () => ({
    needsSummarization: true,
    summarizedMessages: [
      {
        id: "summary",
        role: "user",
        parts: [{ type: "text", text: "Earlier context." }],
      },
    ],
    cutoffMessageId: "u1",
    summaryText: "Earlier context.",
    summarizationUsage: { inputTokens: 1000, outputTokens: 2000 },
  }));
  try {
    const made = makeCtx({
      temporary: false,
      model: scriptedModel([
        { text: "Done.", usage: { input: 100, output: 20, cost: 0 } },
      ]),
    });
    await (
      await createAgentStream("fallback-gemini-3.5-flash", made.ctx, made.state)
    ).consumeStream();
    expect(made.ctx.summarizationTracker.hasSummarized).toBe(true);
    expect(
      made.ctx.usageTracker.computeCostDollars("model-gpt-5.6-sol"),
    ).toBeCloseTo(0.0195, 8);
    expect(made.ctx.usageTracker.streamOutputTokens).toBe(20);
  } finally {
    resetSummarizationMock();
  }
});
