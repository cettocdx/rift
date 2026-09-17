import {
  createAgentStream,
  makeCtx,
  scriptedModel,
  probeTool,
} from "./helpers/scripted-model";
import { resolveChatRunFinalization } from "../chat-run-finalization";

const MODEL = "model-grok-4.3";
const START = 1_000_000;
const DEADLINE = START + 370_000;

afterEach(() => jest.restoreAllMocks());

async function beginFallback() {
  let now = START;
  jest.spyOn(Date, "now").mockImplementation(() => now);
  const made = makeCtx({
    model: scriptedModel([{}]),
    requestDeadlineMs: DEADLINE,
    reportingReserveMs: 45_000,
  });
  const first = await createAgentStream(MODEL, made.ctx, made.state);
  await first.consumeStream();
  expect(await first.text).toBe("");
  expect(made.state.stoppedDueToElapsedTimeout).toBe(false);

  const fallback = scriptedModel([
    { toolCalls: [{ name: "probe", input: { n: 1 } }] },
    { text: "Verified one result. The remaining checks are incomplete." },
  ]);
  made.ctx.trackedProvider.languageModel = () => fallback;
  made.ctx.tools = {
    probe: {
      ...probeTool,
      execute: async () => {
        now = DEADLINE - 45_000;
        return { verified: "One completed check" };
      },
    },
  };
  return {
    made,
    fallback,
    advance: () => {
      now = DEADLINE;
    },
  };
}

it("an earlier-admitted fallback retains the original deadline and closes with a partial report", async () => {
  const { made, fallback } = await beginFallback();
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(fallback.calls).toHaveLength(2);
  expect(fallback.calls[1].toolNames).toEqual([]);
  expect(await result.text).toContain("remaining checks are incomplete");

  expect(
    resolveChatRunFinalization({
      isAborted: false,
      hardTimedOut: false,
      approvalStopped: false,
      stoppedDueToElapsedTimeout: made.state.stoppedDueToElapsedTimeout,
      hasProviderError: made.state.providerError !== undefined,
      finishReason: made.state.streamFinishReason,
    }),
  ).toEqual({
    status: "completed_with_warnings",
    finishReason: "preemptive-timeout",
    stopReason: undefined,
    wasPreemptiveTimeout: false,
  });
});

it("a user stop during the fallback report clears the cutoff before saving and closes as cancelled", async () => {
  const { made, fallback } = await beginFallback();
  const originalStream = fallback.doStream.bind(fallback);
  fallback.doStream = async (options) => {
    if (options.toolChoice?.type === "none") made.ctx.abortController.abort();
    return originalStream(options);
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(fallback.calls).toHaveLength(2);
  expect(made.state.stoppedDueToElapsedTimeout).toBe(true);
  expect(
    resolveChatRunFinalization({
      isAborted: made.ctx.abortController.signal.aborted,
      hardTimedOut: false,
      approvalStopped: false,
      stoppedDueToElapsedTimeout: made.state.stoppedDueToElapsedTimeout,
      hasProviderError: made.state.providerError !== undefined,
      finishReason: made.state.streamFinishReason,
    }),
  ).toEqual({
    status: "cancelled",
    stopReason: "user",
    finishReason: undefined,
    wasPreemptiveTimeout: false,
  });
});

it("the original hard abort still cuts off a fallback reporting generation", async () => {
  const { made, fallback, advance } = await beginFallback();
  let hardTimedOut = false;
  made.ctx.getHardTimeoutReason = () => (hardTimedOut ? "timeout" : null);
  const originalStream = fallback.doStream.bind(fallback);
  fallback.doStream = async (options) => {
    if (options.toolChoice?.type === "none") {
      advance();
      hardTimedOut = true;
      made.ctx.abortController.abort(
        new DOMException("Request lifecycle budget exceeded", "TimeoutError"),
      );
    }
    return originalStream(options);
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  await result.consumeStream();
  expect(fallback.calls).toHaveLength(2);
  expect(
    resolveChatRunFinalization({
      isAborted: made.ctx.abortController.signal.aborted,
      hardTimedOut,
      approvalStopped: false,
      stoppedDueToElapsedTimeout: made.state.stoppedDueToElapsedTimeout,
      hasProviderError: made.state.providerError !== undefined,
      finishReason: made.state.streamFinishReason,
    }),
  ).toMatchObject({
    status: "completed_with_warnings",
    stopReason: undefined,
    wasPreemptiveTimeout: true,
  });
});

it.each([
  {
    name: "successful response",
    flags: {},
    status: "completed",
    finishReason: "stop",
  },
  {
    name: "approval stop",
    flags: { approvalStopped: true, stoppedDueToElapsedTimeout: true },
    status: "completed",
    finishReason: "stop",
  },
  {
    name: "provider error",
    flags: { hasProviderError: true },
    status: "failed",
    finishReason: "error",
  },
  {
    name: "ordinary tool finish",
    flags: {},
    status: "completed",
    finishReason: "tool-calls",
  },
])(
  "preserves the existing $name outcome",
  ({ flags, status, finishReason }) => {
    expect(
      resolveChatRunFinalization({
        isAborted: false,
        hardTimedOut: false,
        approvalStopped: false,
        stoppedDueToElapsedTimeout: false,
        hasProviderError: false,
        finishReason,
        ...flags,
      }),
    ).toMatchObject({ status, finishReason, stopReason: undefined });
  },
);
