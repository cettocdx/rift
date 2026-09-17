import {
  createAgentStream,
  makeCtx,
  scriptedModel,
} from "./helpers/scripted-model";
import type { ModelMessage } from "ai";

const MODEL = "model-gpt-5.6-sol";
const nextTool = (n: number) => ({
  toolCalls: [{ name: "probe", input: { n } }],
});

it("awaits the durable start and complete markers between tool steps", async () => {
  const events: string[] = [];
  const model = scriptedModel([
    nextTool(1),
    nextTool(2),
    { text: "Verified result." },
  ]);
  const made = makeCtx({ model });
  made.ctx.onStepStarted = async (index) => {
    events.push(`start:${index}`);
  };
  const snapshots: ModelMessage[][] = [];
  made.ctx.onStepCompleted = async ({
    stepIndex,
    initialMessages,
    responseMessages,
  }) => {
    await Promise.resolve();
    events.push(`saved:${stepIndex}`);
    snapshots.push([...initialMessages, ...responseMessages]);
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(events).toEqual([
    "start:1",
    "saved:1",
    "start:2",
    "saved:2",
    "start:3",
    "saved:3",
  ]);
  expect(snapshots[1].filter((m) => m.role === "tool")).toHaveLength(2);
  expect(snapshots[2].filter((m) => m.role === "tool")).toHaveLength(2);
});

it("does not call the provider if the durable start marker cannot be written", async () => {
  const model = scriptedModel([nextTool(1)]);
  const made = makeCtx({ model });
  made.ctx.onStepStarted = async () => {
    throw new Error("Claim lost");
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(model.calls).toHaveLength(0);
});

it("does not execute another tool step after a checkpoint commit fails", async () => {
  const model = scriptedModel([nextTool(1), nextTool(2)]);
  const made = makeCtx({ model });
  made.ctx.onStepCompleted = async () => {
    throw new Error("Checkpoint unavailable");
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(model.calls).toHaveLength(1);
});

it("resumes with completed tool results and advances absolute step numbering", async () => {
  const model = scriptedModel([{ text: "The previous result is verified." }]);
  const made = makeCtx({ model });
  made.ctx.resumeMessages = [
    { role: "user", content: "Inspect the project." },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "old-call",
          toolName: "probe",
          input: { n: 1 },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "old-call",
          toolName: "probe",
          output: { type: "text", value: "Already inspected." },
        },
      ],
    },
  ];
  made.ctx.stepIndexOffset = 3;
  const start = jest.fn();
  made.ctx.onStepStarted = start;
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(start).toHaveBeenCalledWith(4);
  expect(JSON.stringify(model.calls[0].prompt)).toContain("Already inspected.");
  expect(model.calls).toHaveLength(1);
});

it("persists denial as terminal before the later stream finish callback", async () => {
  const { gateToolSet } = await import("@/lib/ai/approval/policy");
  const model = scriptedModel([nextTool(1), { text: "must never run" }]);
  const made = makeCtx({ model });
  let stopped = false;
  made.ctx.tools = gateToolSet(made.ctx.tools, async () => {
    stopped = true;
    return { allowed: false, reason: "denied" };
  });
  made.ctx.isApprovalStopped = () => stopped;
  const completed = jest.fn(async () => {});
  made.ctx.onStepCompleted = completed;
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(model.calls).toHaveLength(1);
  expect(completed).toHaveBeenCalledWith(
    expect.objectContaining({ finishReason: "stop", stepIndex: 1 }),
  );
});

it("does not repeat a forced opening tool after recovery", async () => {
  const model = scriptedModel([
    { text: "Continue from the existing artifact." },
  ]);
  const made = makeCtx({ model, forceFirstToolName: "probe" });
  made.ctx.stepIndexOffset = 1;
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(model.calls[0].toolChoice).toEqual({ type: "auto" });
});

it("restores the current turn web verification gate from completed tool history", async () => {
  const model = scriptedModel([{ text: "A new verification is required." }]);
  const made = makeCtx({ model, isAppBuildComplete: () => false });
  made.ctx.stepIndexOffset = 1;
  made.ctx.resumeMessages = [
    { role: "user", content: "Fix the site." },
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "verify",
          toolName: "verify_app",
          input: {},
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "verify",
          toolName: "verify_app",
          output: { type: "json", value: { ok: false } },
        },
      ],
    },
  ];
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(model.calls[0].toolChoice).toEqual({ type: "required" });
});

it("includes the awaited ownership check in preparation timing", async () => {
  const model = scriptedModel([{ text: "Ready." }]);
  const made = makeCtx({ model });
  const prepare = jest.fn();
  let now = 10_000;
  const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
  made.ctx.onStepStarted = async () => {
    await Promise.resolve();
    now += 700;
  };
  made.ctx.telemetry = { onPrepareStep: prepare };
  try {
    const result = await createAgentStream(MODEL, made.ctx, made.state);
    await result.consumeStream();
    expect(model.calls).toHaveLength(1);
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        ownershipWaitMs: 700,
        durationMs: 700,
      }),
    );
  } finally {
    clock.mockRestore();
  }
});
