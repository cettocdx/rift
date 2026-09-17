import {
  createAgentStream,
  makeCtx,
  scriptedModel,
} from "./helpers/scripted-model";
import type { UIMessage } from "ai";
import { resolveChatRunFinalization } from "../chat-run-finalization";
import { resetAgentProviderAttempt } from "../agent-stream-runner";
import fs from "node:fs";
import path from "node:path";

const MODEL = "model-grok-4.3";

it("does not treat a pre-response provider rejection as the existing step-start fallback trigger", async () => {
  const error = new Error("Provider rejected request before streaming");
  const made = makeCtx({ model: scriptedModel([{ throw: error }]) });
  const primary = await createAgentStream(MODEL, made.ctx, made.state);
  let saved: UIMessage[] = [];
  for await (const _part of primary.toUIMessageStream({
    onFinish: ({ messages }) => {
      saved = messages;
    },
  })) {
    /* drain */
  }
  expect(made.state.providerError).toBe(error);
  expect(saved.at(-1)?.parts ?? []).toEqual([]);
});

it("does not carry a streaming provider error into an admitted successful fallback", async () => {
  const error = new Error("Provider stream failed after response headers");
  const made = makeCtx();
  made.model.doStream = async () => ({
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue({ type: "stream-start", warnings: [] });
        controller.enqueue({
          type: "response-metadata",
          id: "primary",
          modelId: "scripted/model",
        });
        controller.enqueue({ type: "error", error });
        controller.close();
      },
    }),
  });
  const primary = await createAgentStream(MODEL, made.ctx, made.state);
  const fallback = scriptedModel([
    { text: "The requested result is verified." },
  ]);
  let admitted = false;
  let fallbackStatus: string | undefined;
  for await (const _part of primary.toUIMessageStream({
    onFinish: async ({ messages, isAborted }) => {
      const lastAssistant = messages.findLast(
        (message) => message.role === "assistant",
      );
      expect(lastAssistant?.parts).toEqual([{ type: "step-start" }]);
      expect(isAborted).toBe(false);
      expect(made.state.providerError).toBe(error);
      admitted = true;
      resetAgentProviderAttempt(made.state, made.ctx.abortController.signal);
      made.ctx.trackedProvider.languageModel = () => fallback;
      const retry = await createAgentStream(MODEL, made.ctx, made.state);
      await retry.consumeStream();
      expect(await retry.text).toBe("The requested result is verified.");
      fallbackStatus = resolveChatRunFinalization({
        isAborted: false,
        hardTimedOut: false,
        approvalStopped: false,
        stoppedDueToElapsedTimeout: made.state.stoppedDueToElapsedTimeout,
        hasProviderError: made.state.providerError !== undefined,
        finishReason: made.state.streamFinishReason,
      }).status;
    },
  })) {
    /* drain */
  }
  expect(admitted).toBe(true);
  expect(fallback.calls).toHaveLength(1);
  expect(fallbackStatus).toBe("completed");
});

it("does not erase a failed checkpoint or cancellation when fallback admission races Stop", () => {
  const made = makeCtx();
  const error = new Error("Checkpoint commit failed");
  made.state.providerError = error;
  made.ctx.abortController.abort();
  expect(() =>
    resetAgentProviderAttempt(made.state, made.ctx.abortController.signal),
  ).toThrow();
  expect(made.state.providerError).toBe(error);
});

it("preserves all terminal stop flags and the reporting outcome across provider bookkeeping resets", () => {
  const made = makeCtx();
  Object.assign(made.state, {
    stoppedDueToTokenExhaustion: true,
    stoppedDueToElapsedTimeout: true,
    stoppedDueToDoomLoop: true,
    stoppedDueToBudgetExhaustion: true,
    streamFinishReason: "preemptive-timeout",
  });
  const before = { ...made.state };
  resetAgentProviderAttempt(made.state, made.ctx.abortController.signal);
  expect(made.state).toEqual(before);
});

it("wires the reset only at both admitted HTTP fallback boundaries before stream creation", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../chat-handler.ts"),
    "utf8",
  );
  const boundaries = [
    ...source.matchAll(
      /isRetryWithFallback = true;\s*resetAgentProviderAttempt\(state, userStopSignal.signal\);([\s\S]*?)await createStream\(fallbackModel\)/g,
    ),
  ];
  expect(boundaries).toHaveLength(2);
  expect(source.match(/resetAgentProviderAttempt\(/g)).toHaveLength(2);
  expect(
    boundaries.every(([body]) => !/state\.stoppedDueTo\w+ = false/.test(body)),
  ).toBe(true);
});
