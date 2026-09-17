/**
 * @jest-environment node
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/opencode/run-lease", () => ({
  getLeaseBySandbox: jest.fn(),
  readRunUsage: jest.fn(),
  recordProxyUsage: jest.fn().mockResolvedValue(undefined),
  acquireInflight: jest.fn().mockResolvedValue(1),
  releaseInflight: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("@/lib/ai/providers", () => ({
  patchKimiReasoningToolCalls: (body: unknown) => ({ body, changed: false }),
  sanitizeOpenRouterEncryptedReasoning: (body: unknown) => ({ body, changed: false }),
}));
jest.mock("@/lib/rate-limit/redis", () => ({ createRedisClient: jest.fn(() => null) }));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildProviderOptions: () => ({ openrouter: { reasoning: { enabled: true, effort: "medium" } } }),
}));

import { POST } from "@/app/api/llm/v1/chat/completions/route";
import { signRunToken } from "@/lib/llm-proxy/token";
import {
  getLeaseBySandbox,
  readRunUsage,
  recordProxyUsage,
  acquireInflight,
} from "@/lib/opencode/run-lease";

process.env.LLM_PROXY_SECRET = "s3cret";
process.env.OPENROUTER_API_KEY = "or-key";

const claims = { runId: "run_1", chatId: "chat_1", userId: "user_1", sandboxId: "sbx_1" };
const lease = {
  ...claims,
  subscription: "pro",
  modelKey: "model-gpt-5.6-sol",
  ceilingDollars: 5,
  serverBaseUrl: "x",
  serverAuth: "y",
  createdAt: 1,
};
const zeroUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, requests: 0, costDollars: 0 };

function req(body: unknown, token = signRunToken(claims)) {
  return new Request("http://localhost/api/llm/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
const validBody = { model: "model-gpt-5.6-sol", stream: true, messages: [{ role: "user", content: "hi" }] };

const realFetch = global.fetch;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.RIFT_LEGACY_LLM_PROXY_ENABLED = "true";
  delete process.env.LLM_PROXY_DISABLED;
  (getLeaseBySandbox as jest.Mock).mockResolvedValue(lease);
  (readRunUsage as jest.Mock).mockResolvedValue(zeroUsage);
  (acquireInflight as jest.Mock).mockResolvedValue(1);
});
afterAll(() => {
  global.fetch = realFetch;
  delete process.env.RIFT_LEGACY_LLM_PROXY_ENABLED;
  delete process.env.LLM_PROXY_DISABLED;
});

describe("LLM proxy route", () => {
  it("rejects retired-engine requests by default before leasing or spending", async () => {
    delete process.env.RIFT_LEGACY_LLM_PROXY_ENABLED;
    global.fetch = jest.fn();
    const response = await POST(req(validBody));
    expect(response.status).toBe(410);
    expect(getLeaseBySandbox).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("keeps the kill switch effective when explicitly enabled", async () => {
    process.env.LLM_PROXY_DISABLED = "true";
    expect((await POST(req(validBody))).status).toBe(503);
    expect(getLeaseBySandbox).not.toHaveBeenCalled();
  });
  it("401 without a valid token", async () => {
    const res = await POST(req(validBody, "garbage"));
    expect(res.status).toBe(401);
  });

  it("402 when there is no live lease", async () => {
    (getLeaseBySandbox as jest.Mock).mockResolvedValue(null);
    const res = await POST(req(validBody));
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("run_inactive");
  });

  it("402 when the lease belongs to a different run", async () => {
    (getLeaseBySandbox as jest.Mock).mockResolvedValue({ ...lease, runId: "other" });
    expect((await POST(req(validBody))).status).toBe(402);
  });

  it("402 budget_exhausted once the ceiling is spent", async () => {
    (readRunUsage as jest.Mock).mockResolvedValue({ ...zeroUsage, costDollars: 5.01 });
    const res = await POST(req(validBody));
    expect(res.status).toBe(402);
    expect((await res.json()).error.code).toBe("budget_exhausted");
  });

  it("400 for a model not on the allowlist", async () => {
    const res = await POST(req({ ...validBody, model: "openai/gpt-5.6-sol" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("model_not_allowed");
  });

  it("429 when too many requests are in flight", async () => {
    (acquireInflight as jest.Mock).mockResolvedValue(5);
    expect((await POST(req(validBody))).status).toBe(429);
  });

  it("streams upstream bytes through and records metered usage", async () => {
    const frames = [
      'data: {"id":"gen-9","model":"openai/gpt-5.6-sol","choices":[{"delta":{"content":"OK"}}]}\n\n',
      'data: {"id":"gen-9","model":"openai/gpt-5.6-sol","usage":{"prompt_tokens":10,"completion_tokens":2,"cost":0.004}}\n\n',
      "data: [DONE]\n\n",
    ];
    let capturedBody: any;
    global.fetch = jest.fn(async (_url: any, init: any) => {
      capturedBody = JSON.parse(init.body);
      const enc = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(c) {
          for (const f of frames) c.enqueue(enc.encode(f));
          c.close();
        },
      });
      return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
    }) as any;

    const res = await POST(req(validBody));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(frames.join(""));

    // upstream got the slug, usage flags, RIFT reasoning options, and our key
    expect(capturedBody.model).toBe("openai/gpt-5.6-sol");
    expect(capturedBody.usage).toEqual({ include: true });
    expect(capturedBody.stream_options).toEqual({ include_usage: true });
    expect(capturedBody.reasoning).toEqual({ enabled: true, effort: "medium" });
    const init = (global.fetch as jest.Mock).mock.calls[0][1];
    expect(init.headers.Authorization).toBe("Bearer or-key");

    expect(recordProxyUsage).toHaveBeenCalledWith("run_1", {
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      costMicros: 4000,
    });
  });

  it("passes an upstream error through with its status", async () => {
    global.fetch = jest.fn(async () => new Response('{"error":{"message":"nope"}}', { status: 429 })) as any;
    const res = await POST(req(validBody));
    expect(res.status).toBe(429);
  });

  it("dev-trust: with LLM_PROXY_DEV_NO_LEASE=1 and no Redis, a verified token is accepted without a lease", async () => {
    (getLeaseBySandbox as jest.Mock).mockResolvedValue(null);
    process.env.LLM_PROXY_DEV_NO_LEASE = "1";
    global.fetch = jest.fn(async () => new Response(JSON.stringify({ id: "g", model: "openai/gpt-5.6-sol", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, cost: 0.001 } }), { status: 200 })) as any;
    const res = await POST(req({ ...validBody, stream: false }));
    expect(res.status).toBe(200);
    delete process.env.LLM_PROXY_DEV_NO_LEASE;
  });

  it("dev-trust is ignored when the flag is off", async () => {
    (getLeaseBySandbox as jest.Mock).mockResolvedValue(null);
    delete process.env.LLM_PROXY_DEV_NO_LEASE;
    expect((await POST(req(validBody))).status).toBe(402);
  });
});
