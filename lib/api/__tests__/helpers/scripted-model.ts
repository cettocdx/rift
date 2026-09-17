/**
 * Test doubles for driving `createAgentStream` end to end without a network.
 *
 * `scriptedModel` returns a `MockLanguageModelV3` whose `doStream` pops the
 * next scripted step and replays it as a V3 chunk stream. Every call's
 * `prompt` and `toolChoice` is recorded in `model.calls` so a test can assert
 * on what the loop actually sent to the provider (nudges, summaries, forced
 * tool choice, ...).
 *
 * `makeCtx` builds a minimal-but-real `AgentStreamContext`: real
 * `SummarizationTracker` and `UsageTracker`, fakes for everything that would
 * touch a sandbox, Redis, Convex or the network.
 *
 * The module-level `jest.mock` calls live here (not in each suite) so every
 * suite that imports this helper gets the same isolation. They are hoisted
 * above the imports below by the jest transform, so the runner is loaded with
 * the mocks already in place.
 *
 * This file sits under `__tests__/`, which the repo's `testMatch` treats as a
 * suite, so it carries one smoke test of its own rather than failing as an
 * empty suite when the whole directory is run.
 */

import * as webStreams from "stream/web";
import {
  tool,
  type UIMessage,
  type UIMessageStreamWriter,
} from "ai";
import {
  MockLanguageModelV3,
  convertReadableStreamToArray,
  simulateReadableStream,
} from "ai/test";
import type {
  LanguageModelV3CallOptions,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";
import { z } from "zod";
import { SummarizationTracker } from "@/lib/api/chat-stream-helpers";
import { UsageTracker } from "@/lib/usage-tracker";
import type { UsageRefundTracker } from "@/lib/rate-limit";
import {
  createAgentStream,
  initAgentStreamState,
  type AgentStreamContext,
  type AgentStreamState,
} from "@/lib/api/agent-stream-runner";

/**
 * Re-exported so suites load the runner THROUGH this module. The mocks below
 * are hoisted above this file's imports, but they cannot reach a runner that a
 * test file imported before importing the helper — in that case the real
 * `checkAndSummarizeIfNeeded` is already bound and never summarizes.
 */
export { createAgentStream };

// ---------------------------------------------------------------------------
// Web Streams under jsdom
// ---------------------------------------------------------------------------
//
// jest.setup.js installs ReadableStream and TransformStream from `stream/web`
// for the jsdom environment, but not WritableStream. `streamText` pipes its
// step streams through a stitchable stream that needs WritableStream; without
// it the pipeline dies with "WritableStream is not defined" *inside* the
// stream, which surfaces as a run that never finishes rather than an error.
// Install the rest of the Node web-streams surface so the SDK can run here.
for (const name of [
  "WritableStream",
  "ReadableStream",
  "TransformStream",
  "CountQueuingStrategy",
  "ByteLengthQueuingStrategy",
  "TextEncoderStream",
  "TextDecoderStream",
] as const) {
  if (typeof (globalThis as Record<string, unknown>)[name] === "undefined") {
    (globalThis as Record<string, unknown>)[name] = (
      webStreams as unknown as Record<string, unknown>
    )[name];
  }
}

// ---------------------------------------------------------------------------
// Module mocks (hoisted)
// ---------------------------------------------------------------------------

/**
 * Default: never summarize. Suites override per test with
 * `mockCheckAndSummarizeIfNeeded.mockImplementation(...)` and call
 * `resetSummarizationMock()` in `afterEach`.
 */
const noSummarization = async (uiMessages: UIMessage[]) => ({
  needsSummarization: false,
  summarizedMessages: uiMessages,
  cutoffMessageId: null,
  summaryText: null,
});

export const mockCheckAndSummarizeIfNeeded = jest.fn(noSummarization);
export const resetSummarizationMock = () => {
  mockCheckAndSummarizeIfNeeded.mockReset();
  mockCheckAndSummarizeIfNeeded.mockImplementation(noSummarization);
};

export const mockPtyCloseAll = jest.fn(async (_chatId: string) => undefined);

jest.mock("@/lib/chat/summarization", () => ({
  checkAndSummarizeIfNeeded: (...args: unknown[]) =>
    (mockCheckAndSummarizeIfNeeded as unknown as (...a: unknown[]) => unknown)(
      ...args,
    ),
}));

jest.mock("@/lib/ai/tools/utils/pty-session-manager", () => ({
  ptySessionManager: {
    closeAll: (...args: [string]) => mockPtyCloseAll(...args),
  },
}));

jest.mock("@/lib/api/openrouter-metadata", () => ({
  extractOpenRouterMetadata: jest.fn(() => ({})),
  fetchOpenRouterGenerationMetadata: jest.fn(async () => ({})),
  mergeOpenRouterMetadata: jest.fn(
    (a?: Record<string, unknown>, b?: Record<string, unknown>) => ({
      ...(a ?? {}),
      ...(b ?? {}),
    }),
  ),
}));

jest.mock("@/lib/db/actions", () => ({
  getNotes: jest.fn(async () => []),
  logUsageRecord: jest.fn(),
  saveChatSummary: jest.fn(async () => undefined),
}));

// ---------------------------------------------------------------------------
// Scripted model
// ---------------------------------------------------------------------------

export interface ScriptedStep {
  text?: string;
  toolCalls?: Array<{ name: string; input: object }>;
  usage?: {
    input: number;
    output: number;
    reasoning?: number;
    cacheRead?: number;
    /** Provider-reported dollar cost for this step (usage.raw.cost). */
    cost?: number;
  };
  finishReason?: "stop" | "tool-calls";
  /** When set, `doStream` rejects with this error instead of streaming. */
  throw?: Error;
}

export interface RecordedCall {
  prompt: LanguageModelV3CallOptions["prompt"];
  toolChoice: LanguageModelV3CallOptions["toolChoice"];
  /** Names of the tools offered to the model on this call. */
  toolNames: string[];
}

export type ScriptedModel = MockLanguageModelV3 & {
  calls: RecordedCall[];
  /** Steps that were never consumed (useful to assert the loop stopped early). */
  remaining: () => number;
};

const DEFAULT_USAGE = { input: 10, output: 5 } as const;

function stepToChunks(
  step: ScriptedStep,
  index: number,
): LanguageModelV3StreamPart[] {
  const usage = step.usage ?? DEFAULT_USAGE;
  const toolCalls = step.toolCalls ?? [];
  const finishReason: "stop" | "tool-calls" =
    step.finishReason ?? (toolCalls.length > 0 ? "tool-calls" : "stop");

  const chunks: LanguageModelV3StreamPart[] = [
    { type: "stream-start", warnings: [] },
    {
      type: "response-metadata",
      id: `resp-${index}`,
      modelId: "scripted/model",
      timestamp: new Date(0),
    },
  ];

  if (step.text !== undefined) {
    const id = `text-${index}`;
    chunks.push({ type: "text-start", id });
    chunks.push({ type: "text-delta", id, delta: step.text });
    chunks.push({ type: "text-end", id });
  }

  toolCalls.forEach((call, callIndex) => {
    chunks.push({
      type: "tool-call",
      toolCallId: `call-${index}-${callIndex}`,
      toolName: call.name,
      input: JSON.stringify(call.input),
    });
  });

  chunks.push({
    type: "finish",
    finishReason: { unified: finishReason, raw: finishReason },
    usage: {
      inputTokens: {
        total: usage.input,
        noCache: usage.input - (usage.cacheRead ?? 0),
        cacheRead: usage.cacheRead ?? 0,
        cacheWrite: 0,
      },
      outputTokens: {
        total: usage.output,
        text: usage.output - (usage.reasoning ?? 0),
        reasoning: usage.reasoning ?? 0,
      },
      ...(usage.cost !== undefined ? { raw: { cost: usage.cost } } : {}),
    },
  });

  return chunks;
}

export function scriptedModel(steps: ScriptedStep[]): ScriptedModel {
  const queue = [...steps];
  const calls: RecordedCall[] = [];
  let callIndex = 0;

  const model = new MockLanguageModelV3({
    provider: "scripted",
    modelId: "scripted/model",
    doStream: async (options: LanguageModelV3CallOptions) => {
      calls.push({
        prompt: options.prompt,
        toolChoice: options.toolChoice,
        toolNames: (options.tools ?? []).map((t) => t.name),
      });
      const index = callIndex++;

      // A real provider rejects immediately once the signal is aborted; the
      // budget-abort scenario relies on this to stop the loop cleanly.
      if (options.abortSignal?.aborted) {
        throw new DOMException("The operation was aborted.", "AbortError");
      }

      const step = queue.shift();
      if (!step) {
        throw new Error(
          `scriptedModel: no scripted step left for call #${index + 1}`,
        );
      }
      if (step.throw) {
        throw step.throw;
      }

      return {
        stream: simulateReadableStream({
          chunks: stepToChunks(step, index),
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  }) as ScriptedModel;

  model.calls = calls;
  model.remaining = () => queue.length;
  return model;
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

export const probeTool = tool({
  description: "Echoes a number back.",
  inputSchema: z.object({ n: z.number() }),
  execute: async ({ n }) => ({ ok: true, n }),
});

export const failingTool = tool({
  description: "Always fails.",
  inputSchema: z.object({ n: z.number() }),
  execute: async () => ({ error: "boom" }),
});

export const testTools = { probe: probeTool, failing: failingTool };

export interface CollectingWriter {
  write: jest.Mock;
  merge: jest.Mock;
  onError: jest.Mock;
}

export const makeWriter = (): CollectingWriter => ({
  write: jest.fn(),
  merge: jest.fn(),
  onError: jest.fn(),
});

export const userMessage = (text = "hi", id = "u1"): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text }],
});

export type CtxOverrides = Partial<AgentStreamContext> & {
  model?: ScriptedModel;
};

export interface MadeCtx {
  ctx: AgentStreamContext;
  state: AgentStreamState;
  model: ScriptedModel;
  writer: CollectingWriter;
  budget: { checkAfterStep: jest.Mock };
  refund: jest.Mock;
}

export function makeCtx(overrides: CtxOverrides = {}): MadeCtx {
  const { model: modelOverride, ...ctxOverrides } = overrides;
  const model = modelOverride ?? scriptedModel([{ text: "done" }]);
  const writer = makeWriter();
  const budget = { checkAfterStep: jest.fn(() => "continue" as const) };
  const refund = jest.fn(async () => true);

  const ctx: AgentStreamContext = {
    // The runner only calls `languageModel(name)`; the real provider surface
    // is a customProvider, which is far more than the loop needs.
    trackedProvider: {
      languageModel: () => model,
    } as unknown as AgentStreamContext["trackedProvider"],
    currentSystemPrompt: "You are a test agent.",
    tools: testTools,
    mode: "agent",
    userId: "user_test",
    subscription: "pro",
    chatId: "chat_test",
    temporary: true,
    fileTokens: {},
    noteInjectionOpts: {
      userId: "user_test",
      subscription: "pro",
      shouldIncludeNotes: false,
      isTemporary: true,
    },
    systemPromptTokens: 100,
    ctxSystemTokens: 100,
    ctxMaxTokens: 200_000,
    streamStartTime: Date.now(),
    contextUsageOn: false,
    isReasoningModel: false,
    maxDurationMs: 10 * 60 * 1000,

    writer: writer as unknown as UIMessageStreamWriter,
    abortController: new AbortController(),
    summarizationTracker: new SummarizationTracker(),
    usageTracker: new UsageTracker(),
    budgetMonitor: budget,
    sandboxManager: {
      getSandboxType: () => "e2b",
      supportsInteractivePty: async () => true,
    },
    getTodoManager: () => ({ getAllTodos: () => [] }),
    ensureSandbox: async () => {
      throw new Error("ensureSandbox must not be called in unit tests");
    },
    chatLogger: undefined,
    usageRefundTracker: { refund } as unknown as UsageRefundTracker,
    getHardTimeoutReason: () => null,
    ...ctxOverrides,
  };

  const state = initAgentStreamState([userMessage()], {
    usedTokens: 0,
    maxTokens: 200_000,
  });

  return { ctx, state, model, writer, budget, refund };
}

// ---------------------------------------------------------------------------
// Smoke test — keeps this file a valid suite under the repo's testMatch.
// ---------------------------------------------------------------------------

describe("scriptedModel helper", () => {
  it("replays scripted steps in order and records each call", async () => {
    const model = scriptedModel([
      { toolCalls: [{ name: "probe", input: { n: 1 } }] },
      { text: "done", usage: { input: 3, output: 2 } },
    ]);

    const first = await model.doStream({
      prompt: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      toolChoice: { type: "auto" },
    } as LanguageModelV3CallOptions);
    const firstChunks = await convertReadableStreamToArray(first.stream);
    expect(firstChunks[0]).toEqual({ type: "stream-start", warnings: [] });
    expect(firstChunks.some((c) => c.type === "tool-call")).toBe(true);
    expect(firstChunks.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "tool-calls" },
    });

    const second = await model.doStream({
      prompt: [],
    } as unknown as LanguageModelV3CallOptions);
    const secondChunks = await convertReadableStreamToArray(second.stream);
    expect(secondChunks.at(-1)).toMatchObject({
      type: "finish",
      finishReason: { unified: "stop" },
      usage: { inputTokens: { total: 3 }, outputTokens: { total: 2 } },
    });

    expect(model.calls).toHaveLength(2);
    expect(model.calls[0].toolChoice).toEqual({ type: "auto" });
    expect(model.remaining()).toBe(0);
    await expect(
      model.doStream({ prompt: [] } as unknown as LanguageModelV3CallOptions),
    ).rejects.toThrow(/no scripted step left/);
  });
});
