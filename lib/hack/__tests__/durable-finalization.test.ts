import {
  createAgentStream,
  makeCtx,
  scriptedModel,
} from "@/lib/api/__tests__/helpers/scripted-model";
import { resolveHackRunFinalization } from "../durable-finalization";
const MODEL = "model-gpt-5.6-sol";

it.each(["start", "complete"])(
  "records a real %s checkpoint failure as failed rather than user cancellation",
  async (phase) => {
    const model = scriptedModel([
      { text: "Interim evidence." },
      { text: "must not run" },
    ]);
    const made = makeCtx({ model });
    const fail = async () => {
      throw new Error("Checkpoint commit unavailable");
    };
    if (phase === "start") made.ctx.onStepStarted = fail;
    else made.ctx.onStepCompleted = fail;
    const result = await createAgentStream(MODEL, made.ctx, made.state);
    let final: ReturnType<typeof resolveHackRunFinalization> | undefined;
    const stream = result.toUIMessageStream({
      onFinish: ({ isAborted }) => {
        final = resolveHackRunFinalization({
          state: made.state,
          isAborted,
          manualStop: false,
        });
      },
    });
    for await (const _part of stream) {
      /* Drain the real SDK finish callback. */
    }
    expect(made.state.providerError).toBeDefined();
    expect(final).toMatchObject({
      finishReason: "error",
      outcome: { status: "failed" },
    });
    expect(final?.outcome.stopReason).not.toBe("user");
    expect(model.calls).toHaveLength(phase === "start" ? 0 : 1);
  },
);

it("preserves an authoritative Stop when checkpoint cleanup also fails", async () => {
  const model = scriptedModel([{ text: "Saved partial text." }]);
  const made = makeCtx({ model });
  const manual = new AbortController();
  made.ctx.onStepCompleted = async () => {
    manual.abort();
    made.ctx.abortController.abort(manual.signal.reason);
    throw new Error("Late checkpoint error");
  };
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  let final: ReturnType<typeof resolveHackRunFinalization> | undefined;
  for await (const _part of result.toUIMessageStream({
    onFinish: ({ isAborted }) => {
      final = resolveHackRunFinalization({
        state: made.state,
        isAborted,
        manualStop: manual.signal.aborted,
      });
    },
  })) {
  }
  expect(final).toMatchObject({
    outcome: { status: "cancelled", stopReason: "user" },
  });
  expect(final?.finishReason).toBeUndefined();
});

it("retains a successfully completed report", async () => {
  const model = scriptedModel([{ text: "The saved evidence is verified." }]);
  const made = makeCtx({ model });
  const result = await createAgentStream(MODEL, made.ctx, made.state);
  let final: ReturnType<typeof resolveHackRunFinalization> | undefined;
  for await (const _part of result.toUIMessageStream({
    onFinish: ({ isAborted }) => {
      final = resolveHackRunFinalization({
        state: made.state,
        isAborted,
        manualStop: false,
      });
    },
  })) {
  }
  expect(final).toMatchObject({
    finishReason: "stop",
    outcome: { status: "completed" },
  });
});

it.each([
  "matching",
  "other-run",
  "other-claim",
  "other-user",
  "no-cancel",
  "unavailable",
])(
  "requires exact persisted cancellation evidence for %s",
  async (condition) => {
    const helper = jest.requireActual("../durable-finalization") as {
      readHackCancellationEvidence?: (
        binding: Record<string, string>,
        read: () => Promise<unknown>,
      ) => Promise<boolean>;
    };
    expect(helper.readHackCancellationEvidence).toBeDefined();
    const binding = {
      userId: "owner",
      chatId: "chat-1",
      claimId: "claim-1",
      runId: "run-1",
    };
    const claim: Record<string, unknown> = { ...binding, cancelRequestedAt: 1 };
    if (condition === "other-run") claim.runId = "other";
    if (condition === "other-claim") claim.claimId = "other";
    if (condition === "other-user") claim.userId = "other";
    if (condition === "no-cancel") delete claim.cancelRequestedAt;
    const read = async () => {
      if (condition === "unavailable") throw new Error("offline");
      return claim;
    };
    expect(await helper.readHackCancellationEvidence!(binding, read)).toBe(
      condition === "matching",
    );
  },
);

it("bounds an unavailable cancellation lookup without inventing user intent", async () => {
  const { readHackCancellationEvidence } =
    await import("../durable-finalization");
  jest.useFakeTimers();
  try {
    const waiting = readHackCancellationEvidence(
      { userId: "owner", chatId: "chat-1", claimId: "claim-1", runId: "run-1" },
      () => new Promise(() => {}),
    );
    await jest.advanceTimersByTimeAsync(1000);
    await expect(waiting).resolves.toBe(false);
  } finally {
    jest.useRealTimers();
  }
});

it.each(["platform", "budget"])(
  "does not invent user Stop for a real %s abort",
  async (cause) => {
    const model = scriptedModel([{ text: "Partial evidence." }]);
    const made = makeCtx({ model });
    made.ctx.onStepCompleted = async () => {
      if (cause === "budget") made.state.stoppedDueToBudgetExhaustion = true;
      made.ctx.abortController.abort();
    };
    const result = await createAgentStream(MODEL, made.ctx, made.state);
    let final: ReturnType<typeof resolveHackRunFinalization> | undefined;
    for await (const _part of result.toUIMessageStream({
      onFinish: ({ isAborted }) => {
        final = resolveHackRunFinalization({
          state: made.state,
          isAborted,
          manualStop: false,
        });
      },
    })) {
    }
    expect(final?.outcome.status).toBe(
      cause === "budget" ? "completed_with_warnings" : "failed",
    );
    expect(final?.outcome.stopReason).not.toBe("user");
    expect(final?.finishReason).toBe(
      cause === "budget" ? "budget-exhausted" : "error",
    );
  },
);
