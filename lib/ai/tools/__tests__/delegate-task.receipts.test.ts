/** @jest-environment node */
import { tool } from "ai";
import { MockLanguageModelV3 } from "ai/test";
import { APICallError } from "@ai-sdk/provider";
import { z } from "zod";
import { createDelegateTask, createSubagentRunLimiter } from "../delegate-task";

let mockModel: MockLanguageModelV3;
jest.mock("@/lib/ai/providers", () => ({
  createTrackedProvider: () => ({ languageModel: () => mockModel }),
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildProviderOptions: () => ({}),
}));

function response(cost: number, content: any[], reason = "stop") {
  return {
    content,
    finishReason: { unified: reason, raw: reason },
    usage: {
      inputTokens: { total: 100 },
      outputTokens: { total: 20 },
      raw: { cost },
    },
    warnings: [],
  } as any;
}
const readCall = {
  type: "tool-call",
  toolCallId: "read-1",
  toolName: "list_files",
  input: "{}",
};
const finalText = {
  type: "text",
  text: JSON.stringify({
    summary: "Read verified.",
    findings: [],
    nextActions: [],
    confidence: "high",
  }),
};
function run(
  onToolCost: jest.Mock,
  execute: () => Promise<string>,
  signal = new AbortController().signal,
) {
  const delegated = createDelegateTask(
    { userID: "test-owner", onToolCost } as never,
    createSubagentRunLimiter(),
    undefined,
    {
      getReadOnlyTools: () => ({
        list_files: tool({ inputSchema: z.object({}), execute }),
      }),
    },
  );
  return delegated.execute!(
    {
      agentId: "research",
      task: "Read the available files and summarize the evidence.",
    },
    { toolCallId: "parent", messages: [], abortSignal: signal },
  ) as Promise<any>;
}

function providerFailure(statusCode: number, isRetryable: boolean) {
  return new APICallError({
    message: "private provider payload must not be exposed",
    url: "https://provider.invalid/generate",
    requestBodyValues: { prompt: "private task" },
    statusCode,
    isRetryable,
    responseHeaders: { "retry-after": "0.001" },
  });
}

it("recovers a transient provider rejection after a read without replaying the read or charging it twice", async () => {
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      if (calls === 1) return response(0.012, [readCall], "tool-calls");
      if (calls === 2) throw providerFailure(503, true);
      return response(0.018, [finalText]);
    },
  });
  const cost = jest.fn();
  const read = jest.fn(async () => "README.md");
  const result = await run(cost, read);
  expect(result.ok).toBe(true);
  expect(calls).toBe(3);
  expect(read).toHaveBeenCalledTimes(1);
  expect(result.execution).toMatchObject({ steps: 2, toolCalls: 1 });
  expect(cost.mock.calls.map(([amount]) => amount)).toEqual([0.012, 0.018]);
  expect(JSON.stringify(mockModel.doGenerateCalls[2].prompt)).toContain(
    "README.md",
  );
});

it("does not retry a permanent provider authentication failure", async () => {
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      throw providerFailure(401, false);
    },
  });
  const cost = jest.fn();
  const read = jest.fn(async () => "README.md");
  const result = await run(cost, read);
  expect(result.ok).toBe(false);
  expect(calls).toBe(1);
  expect(read).not.toHaveBeenCalled();
  expect(cost).not.toHaveBeenCalled();
  expect(result.execution.failure).toMatchObject({
    category: "provider_4xx",
    statusCode: 401,
  });
  expect(JSON.stringify(result)).not.toContain("private");
});

it("retains evidence when provider retries are exhausted and identifies the failure", async () => {
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      if (calls === 1) return response(0.012, [readCall], "tool-calls");
      throw providerFailure(503, true);
    },
  });
  const cost = jest.fn();
  const read = jest.fn(async () => "README.md");
  const result = await run(cost, read);
  expect(result.ok).toBe(false);
  expect(calls).toBe(4);
  expect(read).toHaveBeenCalledTimes(1);
  expect(cost.mock.calls.map(([amount]) => amount)).toEqual([0.012]);
  expect(result.execution.failure).toMatchObject({
    category: "provider_5xx",
    statusCode: 503,
  });
  expect(result.execution.evidence).toEqual([
    expect.objectContaining({ content: "README.md" }),
  ]);
  expect(JSON.stringify(result)).not.toContain("private");
});

it("cancels during provider backoff without starting another request", async () => {
  const abort = new AbortController();
  let rejected!: () => void;
  const firstRejection = new Promise<void>((resolve) => {
    rejected = resolve;
  });
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      calls += 1;
      const error = new APICallError({
        message: "Temporarily unavailable",
        url: "https://provider.invalid/generate",
        requestBodyValues: {},
        statusCode: 503,
        isRetryable: true,
        responseHeaders: { "retry-after": "1" },
      });
      rejected();
      throw error;
    },
  });
  const cost = jest.fn();
  const resultPromise = run(cost, async () => "README.md", abort.signal);
  await firstRejection;
  await new Promise((resolve) => setImmediate(resolve));
  abort.abort();
  const result = await resultPromise;
  expect(result).toMatchObject({ ok: false, agent: { status: "cancelled" } });
  expect(calls).toBe(1);
  expect(cost).not.toHaveBeenCalled();
});

it("retains a completed provider receipt when cancellation interrupts the subsequent read", async () => {
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => response(0.012, [readCall], "tool-calls"),
  });
  const cost = jest.fn();
  const abort = new AbortController();
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => {
    started = r;
  });
  const pending = new Promise<string>((r) => {
    release = () => r("late read");
  });
  const resultPromise = run(
    cost,
    async () => {
      started();
      return pending;
    },
    abort.signal,
  );
  try {
    await entered;
    // This must already exist while the SDK is still waiting for its tool.
    expect(cost).toHaveBeenCalledTimes(1);
    expect(cost).toHaveBeenCalledWith(0.012);
  } finally {
    abort.abort();
    release();
  }
  const result = await resultPromise;
  expect(result).toMatchObject({
    ok: false,
    agent: { status: "cancelled" },
    execution: { modelCostDollars: 0.012, inputTokens: 100, outputTokens: 20 },
  });
  expect(cost).toHaveBeenCalledTimes(1);
});

it("counts each generation once across tool completion and final structured output", async () => {
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () =>
      ++calls === 1
        ? response(0.012, [readCall], "tool-calls")
        : response(0.018, [finalText]),
  });
  const cost = jest.fn();
  const result = await run(cost, async () => "README.md");
  expect(result.ok).toBe(true);
  expect(result.execution).toMatchObject({
    steps: 2,
    inputTokens: 200,
    outputTokens: 40,
  });
  expect(result.execution.modelCostDollars).toBeCloseTo(0.03);
  expect(cost.mock.calls.map(([amount]) => amount)).toEqual([0.012, 0.018]);
});

it("retains the second receipt when final structured-output validation fails", async () => {
  let calls = 0;
  mockModel = new MockLanguageModelV3({
    doGenerate: async () =>
      ++calls === 1
        ? response(0.012, [readCall], "tool-calls")
        : response(0.018, [{ type: "text", text: "invalid JSON" }]),
  });
  const cost = jest.fn();
  const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await run(cost, async () => "README.md");
    expect(result.ok).toBe(false);
    expect(result.execution.failure).toMatchObject({
      category: "invalid_output",
    });
    expect(result.error).toContain("result format");
    expect(result.execution.modelCostDollars).toBeCloseTo(0.03);
    expect(cost.mock.calls.map(([amount]) => amount)).toEqual([0.012, 0.018]);
  } finally {
    errorLog.mockRestore();
  }
});

it("records spend beyond the former cap without rejecting a child read", async () => {
  mockModel = new MockLanguageModelV3({
    doGenerate: async () =>
      read.mock.calls.length === 0
        ? response(0.6, [readCall], "tool-calls")
        : response(0.01, [
            {
              type: "text",
              text: JSON.stringify({
                summary: "Done",
                findings: [],
                nextActions: [],
                confidence: "high",
              }),
            },
          ]),
  });
  const cost = jest.fn();
  const read = jest.fn(async () => "should not run");
  const result = await run(cost, read);
  expect(result).toMatchObject({
    ok: true,
    execution: { stopReason: "completed", modelCostDollars: 0.61 },
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(cost).toHaveBeenCalledTimes(2);
});
