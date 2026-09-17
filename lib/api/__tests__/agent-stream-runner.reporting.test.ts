import {
  createAgentStream,
  makeCtx,
  scriptedModel,
  probeTool,
  mockCheckAndSummarizeIfNeeded,
  resetSummarizationMock,
  userMessage,
  type MadeCtx,
} from "./helpers/scripted-model";
import { gateToolSet } from "@/lib/ai/approval/policy";

const MODEL = "model-grok-4.3";
const START = 1_000_000;
const DEADLINE = START + 370_000;
const RESERVE = 45_000;
const nextTool = (n: number) => ({
  toolCalls: [{ name: "probe", input: { n } }],
});
let now: number;

beforeEach(() => {
  now = START;
  jest.spyOn(Date, "now").mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetSummarizationMock();
});

async function run(made: MadeCtx) {
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  return result;
}

function reportingContext() {
  return { requestDeadlineMs: DEADLINE, reportingReserveMs: RESERVE };
}

it("uses one tool-free step to report completed evidence before the hard cutoff", async () => {
  const execute = jest.fn(async () => {
    now = DEADLINE - RESERVE;
    return { verified: "Saved evidence at /workspace/report.txt" };
  });
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([
      nextTool(1),
      { text: "Verified evidence; work remains." },
    ]),
    tools: { probe: { ...probeTool, execute } },
  });
  const result = await run(made);

  expect(made.model.calls).toHaveLength(2);
  expect(made.model.calls[0].toolNames).toEqual(["probe"]);
  expect(made.model.calls[1].toolNames).toEqual([]);
  expect(made.model.calls[1].toolChoice).toEqual({ type: "none" });
  expect(JSON.stringify(made.model.calls[1].prompt)).toContain(
    "Saved evidence at /workspace/report.txt",
  );
  expect(JSON.stringify(made.model.calls[1].prompt)).toContain(
    "<time_limit_reporting>",
  );
  expect(execute).toHaveBeenCalledTimes(1);
  expect(await result.text).toBe("Verified evidence; work remains.");
  expect(made.state.streamFinishReason).toBe("preemptive-timeout");
  expect(made.state.stoppedDueToElapsedTimeout).toBe(true);
  expect(made.ctx.abortController.signal.aborted).toBe(false);
});

it("counts setup against the absolute deadline while keeping stream telemetry relative", async () => {
  now = DEADLINE - RESERVE;
  const onFirstChunk = jest.fn();
  const made = makeCtx({
    ...reportingContext(),
    streamStartTime: now - 10,
    forceFirstToolName: "probe",
    telemetry: { onFirstChunk },
    temporary: false,
  });
  await run(made);
  expect(made.model.calls[0].toolNames).toEqual([]);
  expect(made.model.calls[0].toolChoice).toEqual({ type: "none" });
  expect(made.state.streamFinishReason).toBe("preemptive-timeout");
  expect(onFirstChunk).toHaveBeenCalledWith({ firstChunkMs: 10 });
  expect(mockCheckAndSummarizeIfNeeded).not.toHaveBeenCalled();
});

it("blocks a provider-emitted tool call during reporting and never starts a third generation", async () => {
  const execute = jest.fn(async () => {
    now = DEADLINE - RESERVE;
    return { ok: true };
  });
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([nextTool(1), nextTool(2), { text: "Must not run" }]),
    tools: { probe: { ...probeTool, execute } },
  });
  await run(made);
  expect(execute).toHaveBeenCalledTimes(1);
  expect(made.model.calls).toHaveLength(2);
  expect(made.state.streamFinishReason).toBe("preemptive-timeout");
});

it("switches to reporting if normal step preparation consumes the remaining work window", async () => {
  let checks = 0;
  const made = makeCtx({
    ...reportingContext(),
    tools: { interact_terminal_session: probeTool },
    sandboxManager: {
      getSandboxType: () => "e2b",
      supportsInteractivePty: async () => {
        if (++checks > 1) now = DEADLINE - RESERVE;
        return true;
      },
    },
  });
  await run(made);
  expect(made.model.calls[0].toolNames).toEqual([]);
  expect(made.state.streamFinishReason).toBe("preemptive-timeout");
});

it("does not add reporting to other routes without an explicit reserve", async () => {
  const execute = jest.fn(async () => {
    now = DEADLINE - RESERVE;
    return { ok: true };
  });
  const made = makeCtx({
    model: scriptedModel([nextTool(1), { text: "Complete." }]),
    tools: { probe: { ...probeTool, execute } },
  });
  await run(made);
  expect(made.model.calls[1].toolNames).toEqual(["probe"]);
  expect(made.state.streamFinishReason).toBe("stop");
});

it("keeps an assessment completed before the reserve as a successful response", async () => {
  now = DEADLINE - RESERVE - 1;
  const made = makeCtx({ ...reportingContext() });
  await run(made);
  expect(made.state.streamFinishReason).toBe("stop");
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);
});

it("does not start reporting after an approval decision stopped the preceding step", async () => {
  let stopped = false;
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([nextTool(1), { text: "Must not run" }]),
    isApprovalStopped: () => stopped,
  });
  made.ctx.tools = gateToolSet(made.ctx.tools, async () => {
    stopped = true;
    now = DEADLINE - RESERVE;
    return { allowed: false, reason: "denied" };
  });
  await run(made);
  expect(made.model.calls).toHaveLength(1);
  expect(made.state.streamFinishReason).toBe("stop");
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);
});

it("does not start reporting after a user stop during the preceding tool", async () => {
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([nextTool(1), { text: "Must not run" }]),
  });
  made.ctx.tools = {
    probe: {
      ...probeTool,
      execute: async () => {
        now = DEADLINE - RESERVE;
        made.ctx.abortController.abort();
        return { ok: true };
      },
    },
  };
  await run(made);
  expect(made.model.calls).toHaveLength(1);
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);
});

it("does not spend a reporting generation after the funding limit fires", async () => {
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([nextTool(1), { text: "Must not run" }]),
  });
  made.budget.checkAfterStep.mockImplementation(() => {
    now = DEADLINE - RESERVE;
    return "abort";
  });
  await run(made);
  expect(made.model.calls).toHaveLength(1);
  expect(made.state.stoppedDueToBudgetExhaustion).toBe(true);
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);
});

it("uses the absolute deadline to stop after a tool overruns the whole reporting window", async () => {
  const made = makeCtx({
    ...reportingContext(),
    streamStartTime: START + 60_000,
    model: scriptedModel([nextTool(1), { text: "Must not run" }]),
    tools: {
      probe: {
        ...probeTool,
        execute: async () => {
          now = DEADLINE;
          return { ok: true };
        },
      },
    },
  });
  await run(made);
  expect(made.model.calls).toHaveLength(1);
  expect(made.state.streamFinishReason).toBe("preemptive-timeout");
});

it("never calls the provider if setup already consumed the hard deadline", async () => {
  now = DEADLINE;
  const made = makeCtx({ ...reportingContext(), streamStartTime: now });
  await run(made);
  expect(made.model.calls).toHaveLength(0);
  expect(made.state.streamFinishReason).toBe("timeout");
  expect(made.state.stoppedDueToElapsedTimeout).toBe(true);
});

it("keeps a newly saved summary when preparation enters the reporting window", async () => {
  const onPrepareStep = jest.fn();
  mockCheckAndSummarizeIfNeeded.mockImplementation(async () => {
    now = DEADLINE - RESERVE;
    return {
      needsSummarization: true,
      summarizedMessages: [
        userMessage(
          "SUMMARY: verified output saved at /workspace/evidence.txt",
        ),
      ],
      cutoffMessageId: "u1",
      summaryText: "Verified output.",
    };
  });
  const made = makeCtx({
    ...reportingContext(),
    temporary: false,
    forceFirstToolName: "probe",
    telemetry: { onPrepareStep },
  });
  await run(made);
  expect(made.model.calls[0].toolNames).toEqual([]);
  expect(made.model.calls[0].toolChoice).toEqual({ type: "none" });
  expect(JSON.stringify(made.model.calls[0].prompt)).toContain(
    "SUMMARY: verified output saved at /workspace/evidence.txt",
  );
  expect(onPrepareStep).toHaveBeenCalledTimes(1);
});

it("still disables tools if best-effort preparation fails inside the reserve", async () => {
  mockCheckAndSummarizeIfNeeded.mockImplementation(async () => {
    now = DEADLINE - RESERVE;
    throw new Error("Context preparation unavailable");
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  const made = makeCtx({
    ...reportingContext(),
    temporary: false,
    forceFirstToolName: "probe",
  });
  await run(made);
  expect(made.model.calls[0].toolNames).toEqual([]);
  expect(made.model.calls[0].toolChoice).toEqual({ type: "none" });
});

it("does not report if the durable step-start marker fails", async () => {
  now = DEADLINE - RESERVE;
  const made = makeCtx({
    ...reportingContext(),
    onStepStarted: async () => {
      throw new Error("Claim lost");
    },
  });
  await run(made);
  expect(made.model.calls).toHaveLength(0);
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);
});

it("guards tools added lazily before reporting without losing them during ordinary work", async () => {
  const lateExecute = jest.fn(async () => ({ ok: true }));
  const made = makeCtx({
    ...reportingContext(),
    model: scriptedModel([
      nextTool(1),
      { toolCalls: [{ name: "late", input: { n: 2 } }] },
      { toolCalls: [{ name: "late", input: { n: 3 } }] },
    ]),
  });
  made.ctx.tools = {
    probe: {
      ...probeTool,
      execute: async () => {
        made.ctx.tools.late = { ...probeTool, execute: lateExecute };
        return { ok: true };
      },
    },
  };
  made.ctx.onStepCompleted = async ({ stepIndex }) => {
    if (stepIndex === 2) now = DEADLINE - RESERVE;
  };
  await run(made);
  expect(made.model.calls[1].toolNames).toContain("late");
  expect(made.model.calls[2].toolNames).toEqual([]);
  expect(lateExecute).toHaveBeenCalledTimes(1);
});

it("uses the supported low reasoning preset for reporting without changing normal steps", async () => {
  const made = makeCtx({
    ...reportingContext(),
    isReasoningModel: true,
    reasoningEffort: "high",
    model: scriptedModel([nextTool(1), { text: "Partial report." }]),
  });
  made.ctx.onStepCompleted = async () => {
    now = DEADLINE - RESERVE;
  };
  const providerOptions: unknown[] = [];
  const stream = made.model.doStream.bind(made.model);
  made.model.doStream = async (options) => {
    providerOptions.push(options.providerOptions);
    return stream(options);
  };
  const result = await createAgentStream(
    "model-gpt-5.6-sol",
    made.ctx,
    made.state,
  );
  await result.consumeStream();
  expect(providerOptions[0]).toMatchObject({
    openrouter: { reasoning: { effort: "high" } },
  });
  expect(providerOptions[1]).toMatchObject({
    openrouter: { reasoning: { effort: "low" } },
  });
});
