/** @jest-environment node */
import { MockLanguageModelV3 } from "ai/test";
import { tool } from "ai";
import { z } from "zod";
import { gateToolSet } from "@/lib/ai/approval/policy";
import {
  createDelegateTask,
  createSubagentRunLimiter,
  type DelegateTaskOptions,
  SUBAGENT_LIMITS,
} from "../delegate-task";

let mockModel: MockLanguageModelV3;
jest.mock("@/lib/ai/providers", () => ({
  createTrackedProvider: () => ({ languageModel: () => mockModel }),
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildProviderOptions: () => ({}),
}));

const finalOutput = {
  summary: "Checked the source and documentation.",
  findings: [],
  nextActions: [],
  confidence: "high",
};
function step(calls: Array<{ name: string; input: object }> = [], cost = 0.01) {
  return {
    content: calls.length
      ? calls.map((call, index) => ({
          type: "tool-call" as const,
          toolCallId: `call-${index}`,
          toolName: call.name,
          input: JSON.stringify(call.input),
        }))
      : [{ type: "text" as const, text: JSON.stringify(finalOutput) }],
    finishReason: {
      unified: calls.length ? ("tool-calls" as const) : ("stop" as const),
      raw: undefined,
    },
    usage: {
      inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 30, text: 30, reasoning: 0 },
      raw: { cost },
    },
    warnings: [],
  };
}
function modelFor(steps: ReturnType<typeof step>[]) {
  mockModel = new MockLanguageModelV3({
    doGenerate: async () => {
      const next = steps.shift();
      if (!next) throw new Error("Unexpected extra model request");
      return next;
    },
  });
}
function parentTools() {
  const read = jest.fn(async () => ({ content: "export const answer = 42;" }));
  const search = jest.fn(async () => ({
    results: [{ title: "Official docs", url: "https://example.com/docs" }],
  }));
  const mutate = jest.fn(async () => "changed");
  const gate = jest.fn(async (_request?: unknown) => undefined);
  const tools = gateToolSet(
    {
      file: tool({
        inputSchema: z.object({
          action: z.string(),
          path: z.string(),
          brief: z.string(),
        }),
        execute: read,
      }),
      web_search: tool({
        inputSchema: z.object({ query: z.string() }),
        execute: search,
      }),
      run_terminal_cmd: tool({
        inputSchema: z.object({ command: z.string() }),
        execute: mutate,
      }),
    },
    gate,
  );
  return { tools, read, search, mutate, gate };
}
async function run(
  tools = parentTools().tools,
  signal = new AbortController().signal,
  options: DelegateTaskOptions = {},
) {
  const onToolCost = jest.fn();
  const limiter = createSubagentRunLimiter();
  const delegate = createDelegateTask(
    { userID: "user", onToolCost } as never,
    limiter,
    undefined,
    {
      getReadOnlyTools: () => tools,
      ...options,
    },
  );
  const result = await delegate.execute!(
    {
      agentId: "research",
      task: "Read the source and research the relevant official docs.",
    },
    {
      toolCallId: "parent-delegate",
      messages: [],
      abortSignal: signal,
    },
  );
  return { result: result as any, onToolCost, limiter };
}

describe("delegate_task real SDK bounded tool loop", () => {
  it("reads through the parent gate, searches, then integrates real tool evidence", async () => {
    modelFor([
      step([
        {
          name: "file",
          input: {
            action: "read",
            path: "/home/user/app.ts",
            brief: "Read source",
          },
        },
      ]),
      step([{ name: "web_search", input: { query: "official docs" } }]),
      step(),
    ]);
    const parent = parentTools();
    const { result, onToolCost, limiter } = await run(parent.tools);
    expect(result.ok).toBe(true);
    expect(parent.read).toHaveBeenCalledTimes(1);
    expect(parent.search).toHaveBeenCalledTimes(1);
    expect(parent.gate).toHaveBeenCalledTimes(2);
    const approvalIds = parent.gate.mock.calls.map(
      ([call]) => (call as { toolCallId: string }).toolCallId,
    );
    expect(new Set(approvalIds).size).toBe(2);
    expect(
      approvalIds.every((id) => id.startsWith(result.agent.id + ":")),
    ).toBe(true);
    expect(parent.mutate).not.toHaveBeenCalled();
    expect(mockModel.doGenerateCalls).toHaveLength(3);
    expect(JSON.stringify(mockModel.doGenerateCalls[1].prompt)).toContain(
      "answer = 42",
    );
    expect(mockModel.doGenerateCalls[0].tools?.map((t) => t.name)).toEqual([
      "file",
      "web_search",
    ]);
    expect(result.execution).toMatchObject({
      mode: "read-only-tools",
      steps: 3,
      toolCalls: 2,
      toolsUsed: ["file", "web_search"],
      stopReason: "completed",
      modelCostDollars: 0.03,
    });
    expect(
      onToolCost.mock.calls.reduce((sum, [cost]) => sum + cost, 0),
    ).toBeCloseTo(0.03);
    expect(limiter.active).toBe(0);
  });

  it("never executes a model-requested file mutation", async () => {
    modelFor([
      step([
        {
          name: "file",
          input: {
            action: "write",
            path: "/home/user/app.ts",
            brief: "Rewrite",
          },
        },
      ]),
      step(),
    ]);
    const parent = parentTools();
    const { result } = await run(parent.tools);
    expect(parent.read).not.toHaveBeenCalled();
    expect(parent.gate).not.toHaveBeenCalled();
    expect(result.execution.toolCalls).toBe(0);
    expect(JSON.stringify(mockModel.doGenerateCalls[1].prompt)).toContain(
      "error",
    );
  });

  it("continues past the former spend ceiling and records every request", async () => {
    modelFor([
      step([{ name: "web_search", input: { query: "bounded research" } }], 0.6),
      step(),
    ]);
    const { result, onToolCost } = await run();
    expect(mockModel.doGenerateCalls).toHaveLength(2);
    expect(result).toMatchObject({
      ok: true,
      execution: { stopReason: "completed", modelCostDollars: 0.61 },
    });
    expect(onToolCost).toHaveBeenCalledWith(0.6);
  });

  it("does not start an already cancelled delegate", async () => {
    modelFor([step()]);
    const controller = new AbortController();
    controller.abort();
    const { result } = await run(undefined, controller.signal);
    expect(mockModel.doGenerateCalls).toHaveLength(0);
    expect(result.agent.status).toBe("cancelled");
  });

  it("completes a task needing more than six model steps", async () => {
    modelFor([
      ...Array.from({ length: 10 }, () =>
        step([{ name: "web_search", input: { query: "repeat" } }]),
      ),
      step(),
    ]);
    const parent = parentTools();
    const { result } = await run(parent.tools);
    expect(mockModel.doGenerateCalls).toHaveLength(11);
    expect(parent.search).toHaveBeenCalledTimes(10);
    expect(result).toMatchObject({
      ok: true,
      execution: { stopReason: "completed" },
    });
  });

  it("stops promptly if the parent is cancelled during a read", async () => {
    modelFor([
      step([{ name: "web_search", input: { query: "slow source" } }]),
      step(),
    ]);
    let started!: () => void;
    const reading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const parent = parentTools();
    parent.search.mockImplementation(async () => {
      started();
      return new Promise(() => {});
    });
    const controller = new AbortController();
    const pending = run(parent.tools, controller.signal);
    await reading;
    controller.abort();
    const { result, limiter } = await pending;
    expect(result).toMatchObject({
      ok: false,
      agent: { status: "cancelled" },
      execution: { stopReason: "cancelled" },
    });
    expect(limiter.active).toBe(0);
    expect(mockModel.doGenerateCalls).toHaveLength(1);
  });

  it("stops the child loop when the shared parent approval gate is denied", async () => {
    modelFor([
      step([{ name: "web_search", input: { query: "source" } }]),
      step(),
    ]);
    let stopped = false;
    const parent = parentTools();
    parent.gate.mockImplementation(async () => {
      stopped = true;
      throw new Error("Approval denied");
    });
    const { result } = await run(parent.tools, undefined, {
      isApprovalStopped: () => stopped,
    });
    expect(result).toMatchObject({
      ok: false,
      execution: { stopReason: "approval-denied" },
    });
    expect(parent.search).not.toHaveBeenCalled();
    expect(mockModel.doGenerateCalls).toHaveLength(1);
  });

  it("redacts and bounds tool evidence before forwarding it to the child model", async () => {
    modelFor([
      step([
        {
          name: "file",
          input: { action: "read", path: "/home/user/app.ts", brief: "Read" },
        },
      ]),
      step(),
    ]);
    const parent = parentTools();
    parent.read.mockResolvedValue({
      content: `API_KEY=sk-1234567890abcdefghijklmnop\n${"x".repeat(30_000)}`,
    });
    const { result } = await run(parent.tools);
    const toolMessage = mockModel.doGenerateCalls[1].prompt.find(
      (m) => m.role === "tool",
    );
    const evidence = JSON.stringify(toolMessage);
    expect(evidence).not.toContain("sk-1234567890abcdefghijklmnop");
    expect(evidence).toContain("REDACTED");
    expect(evidence.length).toBeLessThan(
      SUBAGENT_LIMITS.maxToolOutputChars + 500,
    );
    expect(result.execution.evidence[0]).toMatchObject({ tool: "file" });
    expect(JSON.stringify(result.execution.evidence).length).toBeLessThan(2500);
  });

  it("executes requested reads beyond the former tool count cap", async () => {
    modelFor([
      step(
        Array.from({ length: 20 }, (_, i) => ({
          name: "web_search",
          input: { query: `source ${i}` },
        })),
      ),
      step(),
    ]);
    const parent = parentTools();
    const { result } = await run(parent.tools);
    expect(parent.search).toHaveBeenCalledTimes(20);
    expect(result).toMatchObject({
      ok: true,
      execution: { stopReason: "completed", toolCalls: 20 },
    });
    expect(mockModel.doGenerateCalls).toHaveLength(2);
  });

  it("reports returned tool errors as failed reads without inventing evidence", async () => {
    modelFor([
      step([
        {
          name: "file",
          input: { action: "read", path: "/missing", brief: "Read" },
        },
      ]),
      step(),
    ]);
    const parent = parentTools();
    parent.read.mockResolvedValue({ error: "File not found" } as never);
    const { result } = await run(parent.tools);
    expect(result.execution).toMatchObject({
      failedToolCalls: 1,
      evidence: [],
    });
  });

  it("keeps a completed answer when its final receipt reaches the token ceiling", async () => {
    const answer = step();
    answer.usage.inputTokens.total = 24000;
    answer.usage.inputTokens.noCache = 24000;
    modelFor([answer]);
    const { result, onToolCost } = await run();
    expect(result.ok).toBe(true);
    expect(result.summary).toBe(finalOutput.summary);
    expect(onToolCost).toHaveBeenCalledTimes(1);
    expect(mockModel.doGenerateCalls).toHaveLength(1);
  });

  it("continues beyond 24000 cumulative billed tokens", async () => {
    const large = step([
      { name: "web_search", input: { query: "large context" } },
    ]);
    large.usage.inputTokens.total = 24000;
    large.usage.inputTokens.noCache = 24000;
    modelFor([large, step()]);
    const { result } = await run();
    expect(result).toMatchObject({
      ok: true,
      execution: { stopReason: "completed" },
    });
    expect(mockModel.doGenerateCalls).toHaveLength(2);
  });

  it("keeps running past 90 seconds and still honors parent cancellation", async () => {
    jest.useFakeTimers();
    try {
      modelFor([
        step([{ name: "web_search", input: { query: "slow source" } }]),
        step(),
      ]);
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const parent = parentTools();
      parent.search.mockImplementation(async () => {
        started();
        return new Promise(() => {});
      });
      const controller = new AbortController();
      const pending = run(parent.tools, controller.signal);
      await reading;
      await jest.advanceTimersByTimeAsync(180000);
      expect(mockModel.doGenerateCalls).toHaveLength(1);
      controller.abort();
      const { result, limiter } = await pending;
      expect(result).toMatchObject({
        ok: false,
        execution: { stopReason: "cancelled" },
      });
      expect(limiter.active).toBe(0);
      expect(mockModel.doGenerateCalls).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
