/** @jest-environment node */
import { NextRequest } from "next/server";
import { POST } from "../route";
import { GET } from "../../config/route";
import { getUserIDAndPro } from "@/lib/auth/get-user-id";
import { assertUserCanMakeCostIncurringRequest } from "@/lib/suspensions";
import { buildExtraUsageConfig } from "@/lib/api/chat-stream-helpers";
const mockBeginUsage = jest.fn();
jest.mock("@/lib/console/workspace-usage-server", () => ({
  beginWorkspaceUsage: (...args: unknown[]) => mockBeginUsage(...args),
}));
const mockReserve = jest.fn();
const mockStart = jest.fn();
const mockSettle = jest.fn();
const mockCapture = jest.fn();
const mockClose = jest.fn();
const mockLog = jest.fn();
let mockGranted = false;
let mockPhase = "reserved";
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/auth/get-user-id", () => ({ getUserIDAndPro: jest.fn() }));
jest.mock("@/lib/suspensions", () => ({
  assertUserCanMakeCostIncurringRequest: jest.fn(),
}));
jest.mock("@/lib/db/actions", () => ({
  getUserCustomization: jest.fn(),
  logUsageRecord: (...args: unknown[]) => mockLog(...args),
}));
jest.mock("@/lib/api/chat-stream-helpers", () => ({
  buildExtraUsageConfig: jest.fn(),
}));
jest.mock("@/lib/billing/paid-ledger-migration", () => ({
  migratePaidPlanLedger: jest.fn(),
}));
jest.mock("@/lib/billing/account-credit-lifecycle", () => ({
  AccountCreditLifecycle: {
    forProductionConsole: jest.fn(() => ({
      operationId: "server-billing-operation",
      reserve: mockReserve,
      startUse: mockStart,
      settle: mockSettle,
      captureTerminalUsage: mockCapture,
      closeBeforeUse: mockClose,
      inspect: () => ({ dispatchGranted: mockGranted, phase: mockPhase }),
    })),
  },
}));
const request = (
  body: unknown = { model: "build-codex", stream: true, input: "Hi" },
) =>
  new NextRequest("http://localhost/api/console/native/responses", {
    method: "POST",
    body: JSON.stringify(body),
  });
const done = {
  type: "response.completed",
  response: {
    id: "resp_1",
    status: "completed",
    model: "openai/gpt-5.6-sol",
    usage: { input_tokens: 10, output_tokens: 3, cost: 0.001 },
  },
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const upstream = (...events: unknown[]) =>
  new Response(events.map(frame).join(""), {
    headers: { "content-type": "text/event-stream" },
  });
beforeEach(() => {
  jest.clearAllMocks();
  mockGranted = false;
  mockPhase = "reserved";
  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "server-secret";
  jest
    .mocked(getUserIDAndPro)
    .mockResolvedValue({ userId: "owner", subscription: "pro" } as any);
  jest
    .mocked(assertUserCanMakeCostIncurringRequest)
    .mockResolvedValue(undefined);
  jest.mocked(buildExtraUsageConfig).mockResolvedValue(undefined);
  mockReserve.mockResolvedValue({
    includedRemainingPoints: 100,
    includedTotalPoints: 200,
  });
  mockStart.mockImplementation(async () => {
    mockGranted = true;
  });
  mockCapture.mockImplementation((x) => x);
  mockSettle.mockResolvedValue({
    state: "settled",
    receipt: { debtPointsAdded: 0 },
  });
  global.fetch = jest.fn().mockResolvedValue(upstream(done));
});
test("config returns owner and explicit RIFT model IDs", async () => {
  const r = await GET(
    new NextRequest("http://localhost/api/console/native/config"),
  );
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({
    ownerId: "owner",
    defaultModel: "build-codex",
    models: [{ id: "build-codex" }, { id: "build-astra" }],
  });
});
test("Responses accepts the verified OpenCode catalog but not unverified Qwen", async () => {
  const accepted = await POST(
    request({ model: "build-fable", stream: true, input: "Hi", store: false }),
  );
  expect(accepted.status).toBe(200);
  expect(
    JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string),
  ).toMatchObject({
    model: "anthropic/claude-fable-5.1",
    store: false,
  });

  jest.clearAllMocks();
  expect(
    (
      await POST(
        request({
          model: "build-qwen",
          stream: true,
          input: "Hi",
          store: false,
        }),
      )
    ).status,
  ).toBe(400);
  expect(mockReserve).not.toHaveBeenCalled();
});
test("unauthenticated and suspended requests never dispatch", async () => {
  jest.mocked(getUserIDAndPro).mockRejectedValueOnce(new Error());
  expect((await POST(request())).status).toBe(401);
  jest
    .mocked(assertUserCanMakeCostIncurringRequest)
    .mockRejectedValue(new Error());
  expect((await POST(request())).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});
test.each([
  { model: "arbitrary", stream: true, input: "Hi" },
  { model: "build-codex", stream: false, input: "Hi" },
  {
    model: "build-codex",
    stream: true,
    input: "Hi",
    reasoning: { effort: "ultra" },
  },
  {
    model: "build-codex",
    stream: true,
    input: "Hi",
    tools: [{ type: "web_search" }],
  },
  {
    model: "build-codex",
    stream: true,
    input: [
      {
        role: "user",
        content: [{ type: "input_image", image_url: "https://example.com" }],
      },
    ],
  },
  {
    model: "build-codex",
    stream: true,
    input: "Hi",
    previous_response_id: "foreign",
  },
  {
    model: "build-codex",
    stream: true,
    input: "Hi",
    provider: { allow_fallbacks: true },
  },
])("rejects unsupported request %#", async (body) => {
  expect((await POST(request(body))).status).toBe(400);
  expect(mockReserve).not.toHaveBeenCalled();
});
test.each([
  { subscription: "free" },
  { organizationId: "org" },
  { subscription: "enterprise" },
])("unsupported account fails closed %j", async (patch) => {
  jest.mocked(getUserIDAndPro).mockResolvedValue({
    userId: "owner",
    subscription: "pro",
    ...patch,
  } as any);
  expect((await POST(request())).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});
test("disabled keyed credits and auto reload fail closed", async () => {
  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "false";
  expect((await POST(request())).status).toBe(403);
  process.env.RIFT_CONSOLE_KEYED_CREDITS_ENABLED = "true";
  jest
    .mocked(buildExtraUsageConfig)
    .mockResolvedValue({ enabled: true, autoReloadEnabled: true } as any);
  expect((await POST(request())).status).toBe(403);
});
test("preserves native custom/function tools and reasoning history", async () => {
  const input = [
    { type: "reasoning", encrypted_content: "opaque", summary: [] },
    { type: "custom_tool_call_output", call_id: "call", output: "ok" },
  ];
  const tools = [
    { type: "custom", name: "apply_patch", format: { type: "text" } },
    {
      type: "function",
      name: "exec",
      parameters: { type: "object", properties: {} },
    },
  ];
  const response = await POST(
    request({
      model: "build-codex",
      stream: true,
      input,
      tools,
      reasoning: { effort: "high", summary: "auto" },
      include: ["reasoning.encrypted_content"],
    }),
  );
  expect(await response.text()).toContain("response.completed");
  const [url, init] = jest.mocked(fetch).mock.calls[0];
  expect(url).toBe("https://openrouter.ai/api/v1/responses");
  expect(JSON.parse(init!.body as string)).toMatchObject({
    model: "openai/gpt-5.6-sol",
    input,
    tools,
    reasoning: { effort: "high", summary: "auto" },
    store: false,
  });
});
test("duplicate completions settle and emit once", async () => {
  jest.mocked(fetch).mockResolvedValue(upstream(done, done));
  const text = await (await POST(request())).text();
  expect(text.match(/response.completed/g)).toHaveLength(1);
  expect(mockSettle).toHaveBeenCalledTimes(1);
});
test("streams deltas before provider finishes; completion waits for settlement", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let finishSettlement!: (v: unknown) => void;
  mockSettle.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSettlement = resolve;
      }),
  );
  jest.mocked(fetch).mockResolvedValue(
    new Response(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
  const r = await POST(request());
  const reader = r.body!.getReader();
  controller.enqueue(
    new TextEncoder().encode(
      frame({ type: "response.output_text.delta", delta: "Hello" }),
    ),
  );
  expect(new TextDecoder().decode((await reader.read()).value)).toContain(
    "Hello",
  );
  controller.enqueue(new TextEncoder().encode(frame(done)));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockSettle).toHaveBeenCalledTimes(1);
  let emitted = false;
  const pending = reader.read().then((v) => {
    emitted = true;
    return v;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(emitted).toBe(false);
  finishSettlement({ state: "settled", receipt: { debtPointsAdded: 0 } });
  expect(new TextDecoder().decode((await pending).value)).toContain(
    "response.completed",
  );
});
test.each([
  { events: [] },
  {
    events: [{ type: "response.completed", response: { status: "completed" } }],
  },
  { events: [{ type: "response.failed" }] },
])("interrupted/missing usage never completes %#", async ({ events }) => {
  jest.mocked(fetch).mockResolvedValue(upstream(...events));
  const text = await (await POST(request())).text();
  expect(text).not.toContain("response.completed");
  expect(text).toContain('"type":"error"');
  expect(mockCapture).toHaveBeenCalledWith(
    expect.objectContaining({ status: "unknown" }),
  );
});
test("settlement acknowledgement retries same snapshot without provider replay", async () => {
  mockSettle.mockImplementationOnce(async () => {
    mockPhase = "settlement_unknown";
    throw new Error();
  });
  const text = await (await POST(request())).text();
  expect(text).toContain("response.completed");
  expect(mockSettle).toHaveBeenCalledTimes(2);
  expect(mockSettle.mock.calls[0][0]).toBe(mockSettle.mock.calls[1][0]);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("unresolved settlement suppresses success and caps retries", async () => {
  mockSettle.mockImplementation(async () => {
    mockPhase = "settlement_unknown";
    throw new Error();
  });
  const text = await (await POST(request())).text();
  expect(text).not.toContain("response.completed");
  expect(mockSettle).toHaveBeenCalledTimes(2);
});
test("provider rejection reconciles started usage without retry", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response("secret provider message", { status: 400 }),
    );
  const r = await POST(request());
  expect(r.status).toBe(502);
  expect(await r.text()).not.toContain("secret");
  expect(mockCapture).toHaveBeenCalledWith({
    status: "unknown",
    reason: "provider_unavailable",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("provider capacity limits remain explicit without leaking details or retrying", async () => {
  jest
    .mocked(fetch)
    .mockResolvedValue(
      new Response("secret provider details", { status: 429 }),
    );
  const response = await POST(request());
  expect(response.status).toBe(429);
  expect(await response.text()).toBe(
    "This model is temporarily busy. Retry explicitly when ready.",
  );
  expect(mockCapture).toHaveBeenCalledWith({
    status: "unknown",
    reason: "provider_unavailable",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("malformed JSON and oversized bodies/context never reserve", async () => {
  const malformed = new NextRequest(
    "http://localhost/api/console/native/responses",
    { method: "POST", body: "{" },
  );
  expect((await POST(malformed)).status).toBe(400);
  expect(
    (
      await POST(
        request({
          model: "build-codex",
          stream: true,
          input: "x".repeat(3_000_000),
        }),
      )
    ).status,
  ).toBe(413);
  expect(
    (
      await POST(
        request({
          model: "build-codex",
          stream: true,
          input: "x".repeat(21 * 1024 * 1024),
        }),
      )
    ).status,
  ).toBe(413);
  expect(mockReserve).not.toHaveBeenCalled();
});
test("analytics failure cannot reopen a settled debit", async () => {
  mockLog.mockImplementationOnce(() => {
    throw new Error("analytics failed");
  });
  expect(await (await POST(request())).text()).toContain("response.completed");
  expect(mockSettle).toHaveBeenCalledTimes(1);
});
test("debt settlement suppresses successful completion", async () => {
  mockSettle.mockResolvedValue({
    state: "settled",
    receipt: { debtPointsAdded: 1 },
  });
  expect(await (await POST(request())).text()).not.toContain(
    "response.completed",
  );
  expect(mockSettle).toHaveBeenCalledTimes(1);
});
test("pre-dispatch admission failure closes the reservation", async () => {
  mockStart.mockImplementationOnce(async () => {
    throw new Error("denied");
  });
  expect((await POST(request())).status).toBe(429);
  expect(mockClose).toHaveBeenCalledTimes(1);
  expect(fetch).not.toHaveBeenCalled();
});
test("explicit zero usage is valid; provider model substitution is rejected", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(
    upstream({
      ...done,
      response: {
        ...done.response,
        usage: { input_tokens: 0, output_tokens: 0, cost: 0 },
      },
    }),
  );
  expect(await (await POST(request())).text()).toContain("response.completed");
  jest.mocked(fetch).mockResolvedValueOnce(
    upstream({
      ...done,
      response: { ...done.response, model: "different-model" },
    }),
  );
  expect(await (await POST(request())).text()).not.toContain(
    "response.completed",
  );
});
test("fragmented CRLF and UTF-8 SSE preserves native deltas", async () => {
  const wire = new TextEncoder().encode(
    (
      frame({ type: "response.output_text.delta", delta: "héllo" }) +
      frame(done)
    ).replaceAll("\n", "\r\n"),
  );
  jest.mocked(fetch).mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        start(c) {
          for (const byte of wire) c.enqueue(new Uint8Array([byte]));
          c.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    ),
  );
  const text = await (await POST(request())).text();
  expect(text).toContain("héllo");
  expect(text).toContain("response.completed");
});
test("disconnect aborts provider and reconciles unknown usage", async () => {
  jest.mocked(fetch).mockImplementationOnce(
    async (_url, init) =>
      new Response(
        new ReadableStream({
          start(c) {
            init!.signal!.addEventListener("abort", () =>
              c.error(new Error("aborted")),
            );
            c.enqueue(
              new TextEncoder().encode(
                frame({ type: "response.output_text.delta", delta: "hello" }),
              ),
            );
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      ),
  );
  const r = await POST(request());
  const reader = r.body!.getReader();
  await reader.read();
  await reader.cancel();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockCapture).toHaveBeenCalledWith({
    status: "unknown",
    reason: "interrupted",
  });
});
test("oversized incomplete SSE frame reconciles without success", async () => {
  jest.mocked(fetch).mockResolvedValueOnce(
    new Response("data: " + "x".repeat(8 * 1024 * 1024), {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  expect(await (await POST(request())).text()).not.toContain(
    "response.completed",
  );
  expect(mockCapture).toHaveBeenCalledWith({
    status: "unknown",
    reason: "interrupted",
  });
});
test.each([false, true])(
  "tool commitment events wait for successful settlement (%s)",
  async (fail) => {
    const call = {
      type: "function_call",
      id: "item",
      call_id: "call",
      name: "exec",
      arguments: "{}",
    };
    const toolEvents = [
      { type: "response.output_item.added", item: call },
      {
        type: "response.function_call_arguments.delta",
        item_id: "item",
        delta: "{}",
      },
      { type: "response.output_item.done", item: call },
    ];
    let release!: () => void;
    mockSettle.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          release = () => {
            if (fail) {
              mockSettle.mockRejectedValue(new Error("failed"));
              reject(new Error("failed"));
            } else
              resolve({ state: "settled", receipt: { debtPointsAdded: 0 } });
          };
        }),
    );
    jest
      .mocked(fetch)
      .mockResolvedValue(
        upstream(
          ...toolEvents,
          { type: "response.output_text.delta", delta: "working" },
          done,
        ),
      );
    const r = await POST(request());
    const reader = r.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("working");
    expect(first).not.toContain("function_call");
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    let rest = "";
    while (true) {
      const v = await reader.read();
      if (v.done) break;
      rest += new TextDecoder().decode(v.value);
    }
    if (fail) {
      expect(rest).not.toContain("function_call");
      expect(rest).not.toContain("response.completed");
    } else {
      expect(rest.indexOf("response.output_item.added")).toBeLessThan(
        rest.indexOf("response.output_item.done"),
      );
      expect(rest.indexOf("response.output_item.done")).toBeLessThan(
        rest.indexOf("response.completed"),
      );
    }
  },
);
test("compressed request is rejected before reading or billing", async () => {
  const r = new NextRequest("http://localhost/api/console/native/responses", {
    method: "POST",
    headers: { "Content-Encoding": "gzip" },
    body: "compressed",
  });
  expect((await POST(r)).status).toBe(415);
  expect(mockReserve).not.toHaveBeenCalled();
});
test("a provider cannot grow an unbounded queue with valid small frames", async () => {
  const small = frame({ type: "response.output_text.delta", delta: "" });
  jest.mocked(fetch).mockResolvedValueOnce(
    new Response(small.repeat(50_001) + frame(done), {
      headers: { "content-type": "text/event-stream" },
    }),
  );
  expect(
    (await (await POST(request())).text()).includes("response.completed"),
  ).toBe(false);
  expect(mockCapture).toHaveBeenCalledWith({
    status: "unknown",
    reason: "interrupted",
  });
});
test("native all_turns context uses full encrypted history without undocumented provider options", async () => {
  const input = [
    { type: "reasoning", encrypted_content: "opaque", summary: [] },
    { role: "user", content: "continue" },
  ];
  const r = await POST(
    request({
      model: "build-codex",
      stream: true,
      input,
      reasoning: { effort: "medium", context: "all_turns" },
    }),
  );
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("response.completed");
  const forwarded = JSON.parse(
    jest.mocked(fetch).mock.calls[0][1]!.body as string,
  );
  expect(forwarded.input).toEqual(input);
  expect(forwarded.reasoning).toEqual({ effort: "medium" });
});
test("bounded native client metadata is accepted without forwarding private desktop identifiers", async () => {
  const client_metadata = {
    root_turn_id: "r",
    thread_id: "thread",
    "x-codex-turn-metadata": "{}",
    "x-codex-installation-id": "install",
    "x-codex-window-id": "window",
    session_id: "session",
    turn_id: "turn",
  };
  const body = {
    model: "build-codex",
    stream: true,
    input: "Hi",
    client_metadata,
  };
  expect(await (await POST(request(body))).text()).toContain(
    "response.completed",
  );
  expect(
    JSON.parse(jest.mocked(fetch).mock.calls[0][1]!.body as string),
  ).not.toHaveProperty("client_metadata");
  expect(
    (
      await POST(
        request({ ...body, client_metadata: { thread_id: "x".repeat(4097) } }),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request({ ...body, client_metadata: { thread_id: { unsafe: true } } }),
      )
    ).status,
  ).toBe(400);
});

test("pinned native reasoning continuation accepts null content after read and patch outputs", async () => {
  const input = [
    {
      type: "custom_tool_call",
      id: "read",
      status: "completed",
      call_id: "read-call",
      name: "exec",
      input: "read fixture",
    },
    {
      type: "custom_tool_call_output",
      id: "read-result",
      call_id: "read-call",
      output: [{ type: "input_text", text: "value=1" }],
    },
    {
      type: "reasoning",
      id: "reasoning",
      summary: [],
      content: null,
      encrypted_content: "synthetic-opaque-token",
    },
    {
      type: "custom_tool_call",
      id: "patch",
      status: "completed",
      call_id: "patch-call",
      name: "exec",
      input: "apply_patch fixture",
    },
    {
      type: "custom_tool_call_output",
      id: "patch-result",
      call_id: "patch-call",
      output: [{ type: "input_text", text: "patch succeeded" }],
    },
  ];
  const r = await POST(request({ model: "build-codex", stream: true, input }));
  expect(r.status).toBe(200);
  expect(await r.text()).toContain("response.completed");
  const forwarded = JSON.parse(
    jest.mocked(fetch).mock.calls[0][1]!.body as string,
  );
  expect(forwarded.input[2]).toEqual({
    type: "reasoning",
    id: "reasoning",
    summary: [],
    encrypted_content: "synthetic-opaque-token",
  });
  expect(
    forwarded.input.filter(
      (item: { type: string }) => item.type !== "reasoning",
    ),
  ).toEqual(input.filter((item) => item.type !== "reasoning"));
});

test.each(
  [
    "invalid",
    7,
    {},
    [{ type: "input_image", image_url: "https://example.com/image" }],
    [{ type: "reasoning_text", text: 7 }],
  ].map((content) => ({ content })),
)(
  "reasoning continuation still rejects invalid content %#",
  async ({ content }) => {
    const r = await POST(
      request({
        model: "build-codex",
        stream: true,
        input: [
          {
            type: "reasoning",
            summary: [],
            content,
            encrypted_content: "synthetic-opaque-token",
          },
        ],
      }),
    );
    expect(r.status).toBe(400);
    expect(mockReserve).not.toHaveBeenCalled();
  },
);

it("binds usage identity before any debit and rejects operation replay", async () => {
  const req = request();
  req.headers.set("x-rift-session-id", "session");
  req.headers.set("x-rift-operation-id", "operation");
  mockBeginUsage.mockResolvedValue(false);
  const result = await POST(req);
  expect(result.status).toBe(409);
  expect(mockBeginUsage).toHaveBeenCalledWith(
    "owner",
    { sessionId: "session", operationId: "operation" },
    "server-billing-operation",
  );
  expect(mockReserve).not.toHaveBeenCalled();
  expect(global.fetch).not.toHaveBeenCalled();
});
it("rejects partial usage identity before reserve", async () => {
  const req = request();
  req.headers.set("x-rift-session-id", "session");
  expect((await POST(req)).status).toBe(400);
  expect(mockReserve).not.toHaveBeenCalled();
});
