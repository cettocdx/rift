/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { createConsoleModelAgent } from "@/lib/ai/console-model-agent";
const mockStream = jest.fn();
import { checkRateLimit, deductUsage } from "@/lib/rate-limit";
import { BUILD_MODELS } from "@/types/chat";
const mockRefund = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({ getUserIDAndPro: jest.fn() }));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(),
}));
jest.mock("@/lib/db/actions", () => ({
  getUserCustomization: jest.fn().mockResolvedValue(null),
  logUsageRecord: jest.fn(),
}));
jest.mock("@/lib/ai/providers", () => ({
  createTrackedProvider: () => ({ languageModel: jest.fn() }),
  isAnthropicModel: () => false,
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildExtraUsageConfig: jest.fn(),
  buildProviderOptions: () => ({}),
  buildSystemPrompt: (system: string) => system,
  addCacheBreakpointToLastUserMessage: (messages: unknown) => messages,
}));
jest.mock("@/lib/usage-tracker", () => ({
  UsageTracker: class {
    inputTokens = 0;
    outputTokens = 0;
    providerCost = 0;
    modelProviderCost = 0;
    get hasUsage() {
      return this.inputTokens > 0;
    }
    accumulateStep(u: any) {
      this.inputTokens += u.inputTokens;
      this.outputTokens += u.outputTokens;
    }
    log() {}
  },
}));
jest.mock("@/lib/rate-limit", () => ({
  checkRateLimit: jest.fn(),
  checkBalanceLimit: jest.fn(),
  deductUsage: jest.fn(),
  deductBalanceUsage: jest.fn(),
  UsageRefundTracker: class {
    setUser() {}
    recordDeductions() {}
    refund() {
      return mockRefund();
    }
  },
}));
jest.mock("@/lib/ai/console-model-agent", () => ({
  ...jest.requireActual("@/lib/ai/console-model-agent"),
  createConsoleModelAgent: jest.fn(),
}));
const request = (body: any) =>
  new NextRequest("http://localhost/api/console/model", {
    method: "POST",
    body: JSON.stringify(body),
  });
const valid = () => ({
  model: BUILD_MODELS[0].id,
  messages: [{ role: "user", content: "hello" }],
});
test.each(["length", "content-filter", "error", "unknown"])(
  "an incomplete SDK finish (%s) cannot authorize local tools",
  async (finishReason) => {
    mockStream.mockImplementation(() => ({
      fullStream: (async function* () {
        yield { type: "text-delta", text: "Partial result" };
        yield { type: "finish", finishReason };
      })(),
      response: Promise.resolve({
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool-call",
                toolCallId: "call",
                toolName: "write_file",
                input: { path: "x", content: "partial" },
              },
            ],
          },
        ],
      }),
    }));
    const res = await POST(request(valid()));
    const events = (await res.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.some((event) => event.type === "complete")).toBe(false);
    expect(events.at(-1).type).toBe("error");
  },
);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createConsoleModelAgent).mockImplementation(
    (settings: any) =>
      ({
        stream: (call: any) => mockStream({ ...settings, ...call }),
      }) as any,
  );
  jest
    .mocked(getUserIDAndPro)
    .mockResolvedValue({ userId: "user", subscription: "ultra" } as any);
  jest
    .mocked(checkRateLimit)
    .mockResolvedValue({ servedFrom: "account", pointsDeducted: 10 } as any);
  mockRefund.mockResolvedValue(true);
});
test("unauthenticated requests cannot reserve credits or call a provider", async () => {
  jest.mocked(getUserIDAndPro).mockRejectedValue(new Error("auth"));
  expect((await POST(request(valid()))).status).toBe(401);
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(mockStream).not.toHaveBeenCalled();
});
test.each([
  () => ({ ...valid(), model: "unregistered-provider" }),
  () => ({
    ...valid(),
    messages: [
      {
        role: "user",
        content: [{ type: "image", image: "https://example.com/private" }],
      },
    ],
  }),
])("invalid models and media cannot trigger paid generation", async (body) => {
  expect((await POST(request(body()))).status).toBe(400);
  expect(checkRateLimit).not.toHaveBeenCalled();
});
test("reserves credits before generation and reconciles actual usage exactly once", async () => {
  mockStream.mockImplementation(
    (options: any) =>
      ({
        fullStream: (async function* () {
          yield { type: "text-delta", text: "OK" };
          await options.onStepFinish({
            usage: { inputTokens: 20, outputTokens: 2 },
          });
        })(),
        response: Promise.resolve({
          messages: [
            { role: "assistant", content: [{ type: "text", text: "OK" }] },
          ],
        }),
      }) as any,
  );
  const res = await POST(request(valid()));
  const events = (await res.text())
    .trim()
    .split("\n")
    .map((v) => JSON.parse(v));
  expect(events.at(-1).type).toBe("complete");
  expect(deductUsage).toHaveBeenCalledTimes(1);
  expect(jest.mocked(deductUsage).mock.calls[0].slice(3, 5)).toEqual([20, 2]);
  expect(mockRefund).not.toHaveBeenCalled();
  expect(jest.mocked(checkRateLimit).mock.invocationCallOrder[0]).toBeLessThan(
    mockStream.mock.invocationCallOrder[0],
  );
});
test("provider failure before output refunds its reservation and never reports completion", async () => {
  mockStream.mockImplementation(
    () =>
      ({
        fullStream: (async function* () {
          yield { type: "error", error: new Error("provider unavailable") };
        })(),
      }) as any,
  );
  const res = await POST(request(valid()));
  expect(await res.text()).toContain('"type":"error"');
  expect(mockRefund).toHaveBeenCalledTimes(1);
  expect(deductUsage).not.toHaveBeenCalled();
});

test("canceling the response aborts the SDK model request and refunds once without completion", async () => {
  let options: any;
  mockStream.mockImplementation((value: any) => {
    options = value;
    return {
      fullStream: (async function* () {
        await new Promise<void>((done) =>
          value.abortSignal.addEventListener("abort", () => done(), {
            once: true,
          }),
        );
        yield { type: "error", error: new Error("aborted") };
      })(),
    };
  });
  const response = await POST(request(valid()));
  expect(options.abortSignal.aborted).toBe(false);
  await response.body!.cancel();
  expect(options.abortSignal.aborted).toBe(true);
  // Let the stream's settlement finish, including the refund promise.
  for (let i = 0; i < 20 && mockRefund.mock.calls.length === 0; i++)
    await new Promise((resolve) => setImmediate(resolve));
  expect(mockRefund).toHaveBeenCalledTimes(1);
  expect(deductUsage).not.toHaveBeenCalled();
});

test("an aborted SDK stream cannot report a successful completion even if it returns partial messages", async () => {
  const controller = new AbortController();
  mockStream.mockImplementation((options: any) => ({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "partial" };
      controller.abort();
    })(),
    response: Promise.resolve({
      messages: [{ role: "assistant", content: "partial" }],
    }),
  }));
  const req = new NextRequest("http://localhost/api/console/model", {
    method: "POST",
    body: JSON.stringify(valid()),
    signal: controller.signal,
  });
  const text = await (await POST(req)).text();
  expect(text).toContain('"type":"error"');
  expect(text).not.toContain('"type":"complete"');
  expect(deductUsage).toHaveBeenCalledTimes(1);
});

test("SDK timeout abort chunks never become successful partial completions", async () => {
  mockStream.mockImplementation(() => ({
    fullStream: (async function* () {
      yield { type: "text-delta", text: "partial" };
      yield { type: "abort", reason: "timeout" };
    })(),
    response: Promise.resolve({
      messages: [{ role: "assistant", content: "partial" }],
    }),
  }));
  const text = await (await POST(request(valid()))).text();
  expect(text).toContain('"type":"error"');
  expect(text).not.toContain('"type":"complete"');
  expect(deductUsage).toHaveBeenCalledTimes(1);
});

test("forwards provider reasoning deltas in order without inventing content", async () => {
  mockStream.mockImplementation(() => ({
    fullStream: (async function* () {
      yield { type: "reasoning-start" };
      yield { type: "reasoning-delta", text: "Checking the request." };
      yield { type: "text-delta", text: "Hello" };
    })(),
    response: Promise.resolve({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "Hello" }] },
      ],
    }),
  }));
  const res = await POST(request(valid()));
  const events = (await res.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.slice(0, 3)).toEqual([
    { type: "thinking" },
    { type: "reasoning", text: "Checking the request." },
    { type: "text", text: "Hello" },
  ]);
  expect(events.at(-1).type).toBe("complete");
});
