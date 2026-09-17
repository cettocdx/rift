/**
 * Executable coverage of the agent loop in `createAgentStream`.
 *
 * Every scenario drives the real `streamText` loop against a scripted
 * `MockLanguageModelV3` (see ./helpers/scripted-model) and asserts on the
 * mutable `AgentStreamState`, the telemetry hooks, and the prompts the model
 * actually received. Nothing here touches a sandbox, Redis, Convex or the
 * network; the module mocks live in the helper.
 */

// The helper must be imported BEFORE anything that loads the runner: its
// hoisted `jest.mock` calls are what isolate summarization, PTY cleanup and
// OpenRouter metadata. `createAgentStream` is therefore taken from the helper's
// re-export rather than from the runner module directly.
import {
  createAgentStream,
  makeCtx,
  scriptedModel,
  mockCheckAndSummarizeIfNeeded,
  mockPtyCloseAll,
  probeTool,
  resetSummarizationMock,
  type MadeCtx,
  type ScriptedStep,
} from "./helpers/scripted-model";
import { gateToolSet } from "@/lib/ai/approval/policy";
import type { AgentStreamContext } from "@/lib/api/agent-stream-runner";
import { tool, type UIMessage } from "ai";
import { z } from "zod";

const MODEL = "model-grok-4.3";

const probeStep = (
  n: number,
  extra: Partial<ScriptedStep> = {},
): ScriptedStep => ({
  toolCalls: [{ name: "probe", input: { n } }],
  ...extra,
});

const failingStep = (extra: Partial<ScriptedStep> = {}): ScriptedStep => ({
  toolCalls: [{ name: "failing", input: { n: 1 } }],
  ...extra,
});

async function run(made: MadeCtx) {
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  const steps = await result.steps;
  return { result, steps };
}

/** Text of a V3 prompt message (system messages are plain strings). */
const promptText = (message: { role: string; content: unknown }): string => {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text: unknown }).text)
        : "",
    )
    .join("");
};

const noopTelemetry = () => ({
  onFirstChunk: jest.fn(),
  onFirstText: jest.fn(),
  onStepFinished: jest.fn(),
  onPrepareStep: jest.fn(),
});

let consoleLog: jest.SpyInstance;
let consoleError: jest.SpyInstance;
let consoleWarn: jest.SpyInstance;

beforeEach(() => {
  // The runner logs doom-loop and prepareStep events; keep test output clean.
  consoleLog = jest.spyOn(console, "log").mockImplementation(() => {});
  consoleError = jest.spyOn(console, "error").mockImplementation(() => {});
  consoleWarn = jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  consoleLog.mockRestore();
  consoleError.mockRestore();
  consoleWarn.mockRestore();
  resetSummarizationMock();
});

describe("createAgentStream — happy path", () => {
  it("reports visible text only after a nonempty text delta, never a tool call", async () => {
    const telemetry = noopTelemetry();
    const made = makeCtx({
      model: scriptedModel([probeStep(1), { text: "" }]),
      telemetry,
    });
    await run(made);
    expect(telemetry.onFirstChunk).toHaveBeenCalledTimes(1);
    expect(telemetry.onFirstText).not.toHaveBeenCalled();
  });

  it("a. runs two tool steps then text: stop, summed usage, telemetry per step", async () => {
    const telemetry = noopTelemetry();
    const model = scriptedModel([
      probeStep(1, { usage: { input: 100, output: 10 } }),
      probeStep(2, { usage: { input: 200, output: 20 } }),
      { text: "done", usage: { input: 300, output: 30 } },
    ]);
    const made = makeCtx({ model, telemetry });

    const { result, steps } = await run(made);

    expect(steps).toHaveLength(3);
    expect(await result.finishReason).toBe("stop");
    expect(made.state.streamFinishReason).toBe("stop");
    expect(made.state.providerError).toBeUndefined();
    expect(made.state.responseModel).toBe("scripted/model");

    const total = await result.totalUsage;
    expect(total.inputTokens).toBe(600);
    expect(total.outputTokens).toBe(60);
    expect(made.ctx.usageTracker.inputTokens).toBe(600);
    expect(made.ctx.usageTracker.outputTokens).toBe(60);
    expect(made.state.lastStepInputTokens).toBe(300);

    expect(telemetry.onFirstChunk).toHaveBeenCalledTimes(1);
    expect(telemetry.onFirstText).toHaveBeenCalledTimes(1);
    expect(telemetry.onStepFinished).toHaveBeenCalledTimes(3);
    const indices = telemetry.onStepFinished.mock.calls.map(
      ([info]) => info.stepIndex,
    );
    expect(indices).toEqual([1, 2, 3]);
    expect(
      telemetry.onStepFinished.mock.calls.map(([info]) => info.inputTokens),
    ).toEqual([100, 200, 300]);
    expect(telemetry.onStepFinished.mock.calls.at(-1)?.[0].finishReason).toBe(
      "stop",
    );
    // prepareStep runs before every step, including the first.
    expect(telemetry.onPrepareStep).toHaveBeenCalledTimes(3);
    expect(
      telemetry.onPrepareStep.mock.calls.map(([info]) => info.stepIndex),
    ).toEqual([1, 2, 3]);

    // Model saw the system prompt + user turn on the first call and the tool
    // exchange on later calls.
    expect(model.calls).toHaveLength(3);
    expect(model.calls[0].prompt[0]).toMatchObject({ role: "system" });
    expect(promptText(model.calls[0].prompt[0])).toBe("You are a test agent.");
    expect(model.calls[2].prompt.at(-1)?.role).toBe("tool");
    expect(model.calls[0].toolNames.sort()).toEqual(["failing", "probe"]);

    // onFinish closes the chat's PTYs exactly once on a clean run.
    expect(mockPtyCloseAll).toHaveBeenCalledTimes(1);
    expect(mockPtyCloseAll).toHaveBeenCalledWith("chat_test");
  });

  it("j. reports tool names and a non-decreasing cost total per step", async () => {
    const telemetry = noopTelemetry();
    const model = scriptedModel([
      probeStep(1, { usage: { input: 10, output: 1, cost: 0.01 } }),
      probeStep(2, { usage: { input: 10, output: 1, cost: 0.02 } }),
      probeStep(3, { usage: { input: 10, output: 1, cost: 0.03 } }),
      { text: "done", usage: { input: 10, output: 1, cost: 0.04 } },
    ]);
    const made = makeCtx({ model, telemetry });

    await run(made);

    const infos = telemetry.onStepFinished.mock.calls.map(([info]) => info);
    expect(infos.map((i) => i.toolNames)).toEqual([
      ["probe"],
      ["probe"],
      ["probe"],
      [],
    ]);
    const totals = infos.map((i) => i.costTotalDollars);
    for (let i = 1; i < totals.length; i++) {
      expect(totals[i]).toBeGreaterThanOrEqual(totals[i - 1]);
    }
    expect(totals.at(-1)).toBeCloseTo(0.1, 6);
    expect(infos.map((i) => i.costDeltaDollars)).toEqual(
      [0.01, 0.02, 0.03, 0.04].map((v) => expect.closeTo(v, 6)),
    );
    for (const info of infos) {
      expect(info.stepGapMs).toBeGreaterThanOrEqual(0);
      expect(info.contextPct).toBeCloseTo(10 / 1_000_000, 8);
    }
  });
});

describe("createAgentStream — stop conditions", () => {
  it("b. caps the loop at getMaxStepsForUser (100 for agent mode)", async () => {
    const model = scriptedModel(
      Array.from({ length: 101 }, (_, i) => probeStep(i)),
    );
    const made = makeCtx({ model });

    const { result, steps } = await run(made);

    expect(steps).toHaveLength(100);
    expect(await result.finishReason).toBe("tool-calls");
    expect(made.state.streamFinishReason).toBe("tool-calls");
    expect(model.calls).toHaveLength(100);
    expect(model.remaining()).toBe(1);
    expect(made.state.stoppedDueToDoomLoop).toBe(false);
  }, 15_000);

  it("c1. doom loop: after 3 identical failing steps the 4th prompt carries the nudge", async () => {
    const telemetry = noopTelemetry();
    const model = scriptedModel([
      failingStep(),
      failingStep(),
      failingStep(),
      { text: "I will stop now." },
    ]);
    const made = makeCtx({ model, telemetry });

    const { steps } = await run(made);

    expect(steps).toHaveLength(4);
    expect(model.calls).toHaveLength(4);

    // Third call (2 identical steps so far) — no nudge yet.
    expect(model.calls[2].prompt.at(-1)?.role).toBe("tool");

    // Fourth call: trailing user message with the loop nudge.
    const last = model.calls[3].prompt.at(-1)!;
    expect(last.role).toBe("user");
    expect(promptText(last)).toContain("[LOOP DETECTED]");
    expect(promptText(last)).toContain("failing");
    expect(promptText(last)).toContain("3 times in a row");

    const prepare = telemetry.onPrepareStep.mock.calls.map(([info]) => info);
    expect(prepare.map((p) => p.loopSeverity)).toEqual([
      "none",
      "none",
      "none",
      "warning",
    ]);
    expect(prepare[3].loopToolNames).toEqual(["failing"]);
    expect(made.state.stoppedDueToDoomLoop).toBe(false);
    expect(made.state.streamFinishReason).toBe("stop");
  });

  it("c2. doom loop: 5 identical failing steps halt the run", async () => {
    const model = scriptedModel([
      failingStep(),
      failingStep(),
      failingStep(),
      failingStep(),
      failingStep(),
      failingStep(),
      { text: "never reached" },
    ]);
    const made = makeCtx({ model });

    const { steps } = await run(made);

    expect(steps).toHaveLength(5);
    expect(model.calls).toHaveLength(5);
    expect(made.state.stoppedDueToDoomLoop).toBe(true);
    expect(made.state.streamFinishReason).toBe("doom-loop");
    expect(model.remaining()).toBe(2);
  });

  it("d. budget monitor returning abort after step 2 stops the run as budget-exhausted", async () => {
    const model = scriptedModel([
      probeStep(1),
      probeStep(2),
      probeStep(3),
      probeStep(4),
    ]);
    const made = makeCtx({ model });
    made.budget.checkAfterStep
      .mockReturnValueOnce("continue")
      .mockReturnValueOnce("abort")
      .mockReturnValue("abort");

    const { steps } = await run(made);

    expect(steps).toHaveLength(2);
    expect(made.budget.checkAfterStep).toHaveBeenCalledTimes(2);
    expect(made.state.stoppedDueToBudgetExhaustion).toBe(true);
    expect(made.ctx.abortController.signal.aborted).toBe(true);
    expect(made.state.streamFinishReason).toBe("budget-exhausted");
  });

  it("e. elapsed-time ceiling fires as preemptive-timeout", async () => {
    const model = scriptedModel([probeStep(1), probeStep(2), probeStep(3)]);
    const made = makeCtx({
      model,
      streamStartTime: Date.now() - 60_000,
      maxDurationMs: 1_000,
    });

    const { steps } = await run(made);

    expect(steps).toHaveLength(1);
    expect(made.state.stoppedDueToElapsedTimeout).toBe(true);
    expect(made.state.streamFinishReason).toBe("preemptive-timeout");
    expect(model.remaining()).toBe(2);
  });
});

describe("createAgentStream — summarization", () => {
  const summaryMessages: UIMessage[] = [
    {
      id: "summary-1",
      role: "user",
      parts: [{ type: "text", text: "SUMMARY: earlier work condensed." }],
    },
  ];

  const summarizeOnSecondPrepare = () => {
    let calls = 0;
    mockCheckAndSummarizeIfNeeded.mockImplementation(async (uiMessages) => {
      calls += 1;
      if (calls === 2) {
        return {
          needsSummarization: true,
          summarizedMessages: summaryMessages,
          cutoffMessageId: "u1",
          summaryText: "SUMMARY: earlier work condensed.",
          summarizationUsage: { inputTokens: 50, outputTokens: 20 },
        };
      }
      return {
        needsSummarization: false,
        summarizedMessages: uiMessages,
        cutoffMessageId: null,
        summaryText: null,
      };
    });
  };

  it("f. replaces the next prompt with the summary and reports summarized once", async () => {
    summarizeOnSecondPrepare();
    const telemetry = noopTelemetry();
    const model = scriptedModel([probeStep(1), probeStep(2), { text: "done" }]);
    const made = makeCtx({ model, telemetry, temporary: false });

    const { steps } = await run(made);

    expect(steps).toHaveLength(3);
    expect(made.ctx.summarizationTracker.hasSummarized).toBe(true);
    // Once summarized, prepareStep must not ask again.
    expect(mockCheckAndSummarizeIfNeeded).toHaveBeenCalledTimes(2);

    // The second model call is [system, summary]; the summary is the first
    // conversational message.
    const second = model.calls[1].prompt;
    expect(second[0]).toMatchObject({ role: "system" });
    expect(second[1].role).toBe("user");
    expect(promptText(second[1])).toMatch(/^SUMMARY: earlier work condensed\./);

    // The third call keeps the summary in force ahead of what happened since.
    const third = model.calls[2].prompt;
    expect(promptText(third[1])).toMatch(/^SUMMARY:/);
    expect(third.at(-1)?.role).toBe("tool");

    const prepare = telemetry.onPrepareStep.mock.calls.map(([info]) => info);
    expect(prepare.filter((p) => p.summarized)).toHaveLength(1);
    expect(prepare.find((p) => p.summarized)?.stepIndex).toBe(2);

    // Summarization usage is folded into the run's usage tracker.
    expect(made.ctx.usageTracker.summarizationOutputTokens).toBe(20);
    expect(made.ctx.usageTracker.inputTokens).toBe(10 * 3 + 50);
    // Context usage is written for paid users when summarization fires.
    expect(made.writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ type: "data-context-usage" }),
    );
  });

  it("keeps Anthropic cache controls on the first summarized request and later steps", async () => {
    summarizeOnSecondPrepare();
    const model = scriptedModel([probeStep(1), probeStep(2), { text: "done" }]);
    const made = makeCtx({ model, temporary: false });
    const result = await createAgentStream(
      "model-fable-5.1",
      made.ctx,
      made.state,
    );
    await result.consumeStream();
    expect(await result.steps).toHaveLength(3);
    for (const call of model.calls.slice(1)) {
      const summary = call.prompt.find(
        (m) => m.role === "user" && promptText(m).startsWith("SUMMARY:"),
      );
      expect(summary).toMatchObject({
        providerOptions: {
          openrouter: { cacheControl: { type: "ephemeral", ttl: "1h" } },
        },
      });
    }
  });

  it("g. after summarization, input tokens above the threshold stop the run as context-limit", async () => {
    summarizeOnSecondPrepare();
    // Verified Grok 4.3 threshold: 1,000,000 * 0.9 = 900,000.
    const model = scriptedModel([
      probeStep(1),
      probeStep(2, { usage: { input: 950_000, output: 5 } }),
      probeStep(3),
      { text: "never" },
    ]);
    const made = makeCtx({ model, temporary: false });

    const { steps } = await run(made);

    expect(steps).toHaveLength(2);
    expect(made.ctx.summarizationTracker.hasSummarized).toBe(true);
    expect(made.state.lastStepInputTokens).toBe(950_000);
    expect(made.state.stoppedDueToTokenExhaustion).toBe(true);
    expect(made.state.streamFinishReason).toBe("context-limit");
    expect(model.remaining()).toBe(2);
  });

  it("does not summarize temporary chats", async () => {
    summarizeOnSecondPrepare();
    const model = scriptedModel([probeStep(1), probeStep(2), { text: "done" }]);
    const made = makeCtx({ model, temporary: true });

    await run(made);

    expect(mockCheckAndSummarizeIfNeeded).not.toHaveBeenCalled();
    expect(made.ctx.summarizationTracker.hasSummarized).toBe(false);
  });
});

describe("createAgentStream — tool choice", () => {
  it.each([
    ["run_terminal_cmd", { command: "pwd" }],
    ["file", { action: "edit", path: "/app/lib/parser.ts" }],
    ["generate_image", { prompt: "A logo" }],
  ])(
    "lets %s work finish without requiring a web preview",
    async (name, input) => {
      const execute = jest.fn(async () => ({ success: true }));
      const model = scriptedModel([
        { toolCalls: [{ name, input }] },
        { text: "Finished the requested task." },
      ]);
      const made = makeCtx({
        model,
        tools: {
          [name]: tool({ inputSchema: z.object({}).passthrough(), execute }),
        },
        isAppBuildComplete: () => false,
      });

      const { steps } = await run(made);

      expect(execute).toHaveBeenCalledTimes(1);
      expect(steps).toHaveLength(2);
      expect(made.state.streamFinishReason).toBe("stop");
      expect(model.calls.map((call) => call.toolChoice)).toEqual([
        { type: "auto" },
        { type: "auto" },
      ]);
    },
  );

  it("keeps an explicitly requested preview gated until verification and exposure succeed", async () => {
    let complete = false;
    let verificationAttempts = 0;
    const model = scriptedModel([
      { toolCalls: [{ name: "verify_app", input: {} }] },
      { toolCalls: [{ name: "verify_app", input: {} }] },
      { toolCalls: [{ name: "expose_preview", input: {} }] },
      { text: "The verified preview is ready." },
    ]);
    const made = makeCtx({
      model,
      tools: {
        verify_app: tool({
          inputSchema: z.object({}),
          execute: async () => ({ verified: ++verificationAttempts > 1 }),
        }),
        expose_preview: tool({
          inputSchema: z.object({}),
          execute: async () => {
            complete = verificationAttempts > 1;
            return { success: complete };
          },
        }),
      },
      isAppBuildComplete: () => complete,
    });

    await run(made);

    expect(complete).toBe(true);
    expect(model.calls.map((call) => call.toolChoice)).toEqual([
      { type: "auto" },
      { type: "required" },
      { type: "required" },
      { type: "auto" },
    ]);
  });

  it("h. forceFirstToolName forces the first call and releases later ones to auto", async () => {
    const model = scriptedModel([probeStep(1), probeStep(2), { text: "done" }]);
    const made = makeCtx({ model, forceFirstToolName: "probe" });

    await run(made);

    expect(model.calls).toHaveLength(3);
    expect(model.calls[0].toolChoice).toEqual({
      type: "tool",
      toolName: "probe",
    });
    expect(model.calls[1].toolChoice).toEqual({ type: "auto" });
    expect(model.calls[2].toolChoice).toEqual({ type: "auto" });
  });

  it("without forceFirstToolName every call is auto", async () => {
    const model = scriptedModel([probeStep(1), { text: "done" }]);
    const made = makeCtx({ model });

    await run(made);

    expect(model.calls.map((c) => c.toolChoice)).toEqual([
      { type: "auto" },
      { type: "auto" },
    ]);
  });

  it.each([{}, { probe: probeTool }])(
    "does not connect a local runner when no PTY tool is offered",
    async (tools) => {
      const supportsInteractivePty = jest.fn(async () => true);
      const made = makeCtx({
        model: scriptedModel([{ text: "hello" }]),
        tools,
        sandboxManager: {
          getSandboxType: () => undefined,
          supportsInteractivePty,
        },
      });
      await run(made);
      expect(supportsInteractivePty).not.toHaveBeenCalled();
    },
  );

  it("drops interact_terminal_session from activeTools when the sandbox has no PTY", async () => {
    const model = scriptedModel([{ text: "done" }]);
    const made = makeCtx({
      model,
      tools: {
        probe: probeTool,
        interact_terminal_session: probeTool,
      },
      sandboxManager: {
        getSandboxType: () => "e2b",
        supportsInteractivePty: async () => false,
      } satisfies AgentStreamContext["sandboxManager"],
    });

    await run(made);

    expect(model.calls[0].toolNames).toEqual(["probe"]);
  });
});

describe("createAgentStream — provider errors", () => {
  it("i. a provider throw on step 2 sets providerError and does not refund when usage exists", async () => {
    const model = scriptedModel([
      probeStep(1, { usage: { input: 100, output: 10 } }),
      { throw: new Error("boom-step-2") },
    ]);
    const made = makeCtx({ model });

    const result = await createAgentStream(MODEL, made.ctx, made.state);
    const streamErrors: unknown[] = [];
    await result.consumeStream({ onError: (e) => streamErrors.push(e) });
    const steps = await result.steps;

    expect(steps).toHaveLength(1);
    expect(made.state.providerError).toBeInstanceOf(Error);
    expect((made.state.providerError as Error).message).toBe("boom-step-2");
    expect(made.ctx.usageTracker.hasUsage).toBe(true);
    expect(made.refund).not.toHaveBeenCalled();
    // onFinish still ran for the recorded step.
    expect(made.state.streamFinishReason).toBeDefined();
  });

  it("refunds when the provider fails before any usage was recorded", async () => {
    const model = scriptedModel([{ throw: new Error("boom-step-1") }]);
    const made = makeCtx({ model });

    const result = await createAgentStream(MODEL, made.ctx, made.state);
    await result.consumeStream({ onError: () => {} });
    // No step was recorded, so the SDK rejects the steps promise.
    await expect(result.steps).rejects.toBeDefined();

    expect((made.state.providerError as Error).message).toBe("boom-step-1");
    expect(made.ctx.usageTracker.hasUsage).toBe(false);
    expect(made.refund).toHaveBeenCalledTimes(1);
  });

  it("a hard platform timeout reason overrides the SDK finish reason", async () => {
    const model = scriptedModel([{ text: "done" }]);
    const made = makeCtx({
      model,
      getHardTimeoutReason: () => "hard-timeout",
    });

    await run(made);

    expect(made.state.streamFinishReason).toBe("hard-timeout");
  });
});

describe("approval ends the tool loop", () => {
  it("does not call the model again after a rejected tool, even with an incomplete build", async () => {
    let stopped = false;
    const model = scriptedModel([
      probeStep(1),
      { text: "must not generate again" },
    ]);
    const made = makeCtx({
      model,
      isApprovalStopped: () => stopped,
      isAppBuildComplete: () => false,
    });
    made.ctx.tools = gateToolSet(made.ctx.tools, async () => {
      stopped = true;
      throw new Error(
        "Action denied. Do not retry it without a new user instruction.",
      );
    });
    const { steps } = await run(made);
    expect(steps).toHaveLength(1);
    expect(model.calls).toHaveLength(1);
    expect(made.state.streamFinishReason).toBe("stop");
    expect(made.state.providerError).toBeUndefined();
  });
});

describe("deferred connected tools in the real SDK loop", () => {
  it("starts without remote schemas and exposes a gated tool on the step after discovery", async () => {
    const { createMcpToolDiscovery } =
      await import("@/lib/ai/mcp/tool-discovery");
    const tools: import("ai").ToolSet = {};
    const names: string[] = [];
    const approval = jest.fn(async () => {});
    const execute = jest.fn(async () => ({ ok: true }));
    const discovery = createMcpToolDiscovery(() => names, {
      discover: async () => {
        names.push("mcp_github_read");
        return { servers: ["GitHub"] };
      },
      rebuild: () => {
        Object.assign(
          tools,
          gateToolSet(
            {
              mcp_github_read: tool({
                description: "GitHub read",
                inputSchema: z.object({}),
                execute,
              }),
            },
            approval,
          ),
        );
        return tools;
      },
    });
    Object.assign(tools, discovery.augment(tools));
    discovery.register(tools);
    const model = scriptedModel([
      {
        toolCalls: [
          { name: "search_connected_tools", input: { query: "GitHub" } },
        ],
      },
      { toolCalls: [{ name: "mcp_github_read", input: {} }] },
      { text: "Read complete" },
    ]);
    const { result } = await run(makeCtx({ model, tools }));
    expect(await result.text).toBe("Read complete");
    expect(model.calls[0].toolNames).toEqual(["search_connected_tools"]);
    expect(model.calls[1].toolNames).toContain("mcp_github_read");
    expect(approval).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(approval.mock.invocationCallOrder[0]).toBeLessThan(
      execute.mock.invocationCallOrder[0],
    );
  });
});

describe("execution plan reconciliation", () => {
  it("reminds the real model of remaining work and drops the reminder after explicit completion", async () => {
    let status: "in_progress" | "completed" = "in_progress";
    const todoWrite = tool({
      inputSchema: z.object({}),
      execute: async () => {
        status = "completed";
        return { ok: true };
      },
    });
    const model = scriptedModel([
      probeStep(1),
      { toolCalls: [{ name: "todo_write", input: {} }] },
      { text: "Verified and complete." },
    ]);
    const made = makeCtx({
      model,
      getTodoManager: () => ({
        getAllTodos: () => [
          {
            id: "verify",
            content: "Verify the game",
            status,
            sourceMessageId: "assistant_1",
          },
        ],
      }),
    });
    made.ctx.tools = { ...made.ctx.tools, todo_write: todoWrite };
    await run(made);
    expect(model.calls[1].prompt.map(promptText).join("\n")).toContain(
      "saved execution plan still has 1 unfinished",
    );
    expect(model.calls[2].prompt.map(promptText).join("\n")).not.toContain(
      "rift-plan-progress",
    );
    expect(status).toBe("completed");
  });
});
