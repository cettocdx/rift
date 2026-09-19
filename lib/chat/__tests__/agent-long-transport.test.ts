import { AGENT_WORKER_FAILED_MESSAGE } from "../interrupted-response";
import { LOST_AGENT_CONNECTION_MESSAGE } from "../interrupted-response";
import { AGENT_START_TIMEOUT_MESSAGE } from "../interrupted-response";
import { Response as EdgeResponse } from "next/dist/compiled/@edge-runtime/primitives/fetch";

const mockFetchStream = jest.fn();
const mockSubscribeToRun = jest.fn();
const mockRetrieveRun = jest.fn();

jest.mock("@trigger.dev/core/v3", () => ({
  ApiClient: jest.fn().mockImplementation(() => ({
    fetchStream: (...args: unknown[]) => mockFetchStream(...args),
    subscribeToRun: (...args: unknown[]) => mockSubscribeToRun(...args),
    retrieveRun: (...args: unknown[]) => mockRetrieveRun(...args),
  })),
}));

import {
  fetchAgentLongStream,
  resumeAgentLongStream,
} from "../agent-long-transport";

const createAsyncStream = (chunks: readonly unknown[], failure?: Error) => ({
  async *[Symbol.asyncIterator]() {
    for (const chunk of chunks) yield chunk;
    if (failure) throw failure;
  },
});

const createStatusSubscription = () => ({
  unsubscribe: jest.fn(),
  async *[Symbol.asyncIterator]() {
    yield { status: "EXECUTING" };
  },
});

describe("agent-long transport terminal semantics", () => {
  beforeAll(() => {
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      value: EdgeResponse,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribeToRun.mockReturnValue(createStatusSubscription());
    // Default: the status probe cannot prove the run dead, so resume behaves
    // exactly as before. Tests that need a verdict override this.
    mockRetrieveRun.mockRejectedValue(new Error("unavailable"));
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({
        runId: "run_test",
        publicAccessToken: "public_test",
      }),
    );
  });

  it("passes pending Hack cleanup through without replay, subscription, or automatic retry", async () => {
    const pending = Response.json(
      {
        error: "cleanup_pending",
        delivery: "unconfirmed",
        canceled: false,
        dispatchId: "request",
      },
      { status: 409 },
    );
    global.fetch = jest.fn().mockResolvedValue(pending);
    const replay = jest.fn();
    const response = await resumeAgentLongStream(
      "/api/hack-long/resume?chatId=chat",
      { method: "GET" },
      replay,
    );
    expect(response).toBe(pending);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mockFetchStream).not.toHaveBeenCalled();
    expect(mockSubscribeToRun).not.toHaveBeenCalled();
    expect(replay).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      delivery: "unconfirmed",
      canceled: false,
    });
  });

  it.each(["FAILED", "CRASHED", "SYSTEM_FAILURE", "TIMED_OUT", "EXPIRED"])(
    "surfaces a terminal %s run on resume instead of replaying into silence",
    async (status) => {
      mockRetrieveRun.mockResolvedValue({ status });
      mockFetchStream.mockResolvedValue(
        createAsyncStream([{ type: "start", messageId: "run_test" }]),
      );
      const onReplay = jest.fn();
      const response = await resumeAgentLongStream(
        "/api/agent-long/resume?chatId=chat_test",
        undefined,
        onReplay,
      );
      const body = await response.text();
      expect(body).toContain('"type":"error"');
      expect(body).toContain(AGENT_WORKER_FAILED_MESSAGE);
      // A dead run must never be replayed or registered for the session.
      expect(mockFetchStream).not.toHaveBeenCalled();
      expect(onReplay).not.toHaveBeenCalled();
    },
  );

  it("resumes normally when the run is still executing", async () => {
    mockRetrieveRun.mockResolvedValue({ status: "EXECUTING" });
    mockFetchStream.mockResolvedValue(
      createAsyncStream([
        { type: "start", messageId: "run_test" },
        { type: "finish", finishReason: "stop" },
      ]),
    );
    const onReplay = jest.fn();
    const response = await resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      undefined,
      onReplay,
    );
    const body = await response.text();
    expect(body).toContain('"type":"finish"');
    expect(onReplay).toHaveBeenCalledWith("run_test");
  });

  it("finishes a durably completed run whose upload was interrupted without requesting a replay", async () => {
    mockSubscribeToRun.mockReturnValue({
      unsubscribe: jest.fn(),
      async *[Symbol.asyncIterator]() {
        yield {
          status: "COMPLETED",
          metadata: { uiDeliveryStatus: "interrupted", status: "done" },
        };
      },
    });
    mockFetchStream.mockResolvedValue(createAsyncStream([]));
    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();
    expect(body).toContain('"type":"finish"');
    expect(body).not.toContain('"type":"error"');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["canceled", "rate_limited", undefined])(
    "does not certify completion for worker status %s",
    async (status) => {
      mockSubscribeToRun.mockReturnValue({
        unsubscribe: jest.fn(),
        async *[Symbol.asyncIterator]() {
          yield {
            status: "COMPLETED",
            metadata: { uiDeliveryStatus: "interrupted", status },
          };
        },
      });
      mockFetchStream.mockResolvedValue(
        createAsyncStream([], new Error("delivery interrupted")),
      );
      const response = await fetchAgentLongStream(undefined);
      const body = await response.text();
      expect(body).not.toContain('"type":"finish"');
      expect(body).toContain('"type":"error"');
    },
  );

  describe.each(["start", "resume"] as const)(
    "%s run handle contract",
    (operation) => {
      const request = () =>
        operation === "start"
          ? fetchAgentLongStream(undefined)
          : resumeAgentLongStream(
              "/api/agent-long/resume?chatId=fixture",
              undefined,
            );
      it.each([
        ["null", "null"],
        ["array", "[]"],
        ["string", '"synthetic-private-marker"'],
        ["empty", "{}"],
        ["missing token", JSON.stringify({ runId: "run_fixture" })],
        [
          "missing id",
          JSON.stringify({ publicAccessToken: "synthetic-private-marker" }),
        ],
        [
          "wrong id type",
          JSON.stringify({
            runId: 23,
            publicAccessToken: "synthetic-private-marker",
          }),
        ],
        [
          "blank id",
          JSON.stringify({
            runId: " ",
            publicAccessToken: "synthetic-private-marker",
          }),
        ],
        [
          "wrong token type",
          JSON.stringify({ runId: "run_fixture", publicAccessToken: true }),
        ],
        [
          "empty token",
          JSON.stringify({ runId: "run_fixture", publicAccessToken: "" }),
        ],
        [
          "blank token",
          JSON.stringify({ runId: "run_fixture", publicAccessToken: " \t" }),
        ],
        ["malformed JSON", "synthetic-private-marker{"],
      ])(
        "rejects %s without starting a subscription or exposing response contents",
        async (_label, body) => {
          global.fetch = jest
            .fn()
            .mockResolvedValue(new Response(body, { status: 200 }));
          mockFetchStream.mockResolvedValue(
            createAsyncStream([{ type: "finish", finishReason: "stop" }]),
          );
          await expect(request()).rejects.toMatchObject({
            message: "The agent response did not include a valid run handle.",
          });
          expect(mockFetchStream).not.toHaveBeenCalled();
          expect(mockSubscribeToRun).not.toHaveBeenCalled();
          expect(global.fetch).toHaveBeenCalledTimes(1);
        },
      );
      it("accepts opaque nonempty identifiers and additional optional fields", async () => {
        global.fetch = jest.fn().mockResolvedValue(
          Response.json({
            runId: "run_fixture",
            publicAccessToken: "opaque-fixture-token",
            futureField: { version: 2 },
            requestContext: {
              mode: "agent",
              purpose: "app",
              temporary: false,
              approvalMode: "ask",
              sandboxPreference: "e2b",
              todos: [],
            },
          }),
        );
        mockFetchStream.mockResolvedValue(
          createAsyncStream([
            { type: "start", messageId: "message" },
            { type: "finish", finishReason: "stop" },
          ]),
        );
        const response = await request();
        expect(response.status).toBe(200);
        expect(await response.text()).toContain('"finish"');
        expect(mockFetchStream.mock.calls[0][0]).toBe("run_fixture");
      });
    },
  );

  describe("optional resume context", () => {
    const context = {
      mode: "agent",
      purpose: "app",
      temporary: false,
      approvalMode: "ask",
      sandboxPreference: "e2b",
      todos: [],
    };
    it.each([
      ["string", "invalid"],
      ["array", []],
      ["missing fields", {}],
      ["wrong mode", { ...context, mode: "ask" }],
      ["wrong purpose", { ...context, purpose: "invalid" }],
      ["wrong temporary", { ...context, temporary: "false" }],
      ["invalid approval", { ...context, approvalMode: "invalid" }],
      [
        "invalid working file",
        { ...context, workingFile: { path: "/private/fixture" } },
      ],
    ])(
      "omits %s context while preserving the valid run subscription",
      async (_label, requestContext) => {
        global.fetch = jest.fn().mockResolvedValue(
          Response.json({
            runId: "run_fixture",
            publicAccessToken: "opaque-token",
            requestContext,
          }),
        );
        mockFetchStream.mockResolvedValue(
          createAsyncStream([{ type: "finish", finishReason: "stop" }]),
        );
        const remember = jest.fn();
        const response = await resumeAgentLongStream(
          "/api/agent-long/resume?chatId=fixture",
          undefined,
          undefined,
          remember,
        );
        expect(response.status).toBe(200);
        await response.text();
        expect(remember).not.toHaveBeenCalled();
        expect(mockFetchStream).toHaveBeenCalledTimes(1);
      },
    );
    it("uses the existing context normalization without dropping valid todos or goal", async () => {
      const todo = {
        id: "todo-1",
        content: "Continue",
        status: "pending",
        sourceMessageId: "message-1",
      };
      const goal = { objective: "Complete the task", status: "active" };
      const expected = { ...context, todos: [todo], activeGoal: goal };
      global.fetch = jest.fn().mockResolvedValue(
        Response.json({
          runId: "run_fixture",
          publicAccessToken: "opaque-token",
          requestContext: {
            ...expected,
            todos: [todo, null, { id: "invalid" }],
            futureField: true,
          },
        }),
      );
      mockFetchStream.mockResolvedValue(
        createAsyncStream([{ type: "finish", finishReason: "stop" }]),
      );
      const remember = jest.fn();
      const response = await resumeAgentLongStream(
        "/api/agent-long/resume?chatId=fixture",
        undefined,
        undefined,
        remember,
      );
      await response.text();
      expect(remember).toHaveBeenCalledWith(expected);
    });
  });

  it("distinguishes a failed worker from a lost connection", async () => {
    mockSubscribeToRun.mockReturnValue({
      unsubscribe: jest.fn(),
      async *[Symbol.asyncIterator]() {
        yield { status: "FAILED" };
      },
    });
    mockFetchStream.mockResolvedValue(createAsyncStream([]));
    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();
    expect(body).toContain(AGENT_WORKER_FAILED_MESSAGE);
    expect(body).not.toContain(LOST_AGENT_CONNECTION_MESSAGE);
  });

  it("fails a stalled Agent start request with a retryable timeout", async () => {
    global.fetch = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            reject(abortError);
          },
          { once: true },
        );
      });
    });

    await expect(
      fetchAgentLongStream(undefined, { startRequestTimeoutMs: 10 }),
    ).rejects.toThrow(AGENT_START_TIMEOUT_MESSAGE);
  });

  it("preserves the HTTP 409 run_active contract as a typed startup error", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      Response.json(
        {
          error: "run_active",
          message: "A run is already active in this chat.",
        },
        { status: 409 },
      ),
    );
    await expect(fetchAgentLongStream(undefined)).rejects.toMatchObject({
      statusCode: 409,
      code: "run_active",
      message: "A run is already active in this chat.",
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    [500, JSON.stringify({ error: "run_active" })],
    [409, "invalid json"],
    [409, JSON.stringify({ error: "other_conflict" })],
  ])(
    "never classifies status %s body %s as a retryable busy run",
    async (status, body) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response(body, { status }));
      const response = await fetchAgentLongStream(undefined);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe(body);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("preserves ordinary ChatSDKError details on startup failure", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      Response.json(
        {
          code: "rate_limit:chat",
          cause: "Monthly limit reached",
          metadata: { remaining: 0 },
        },
        { status: 429 },
      ),
    );
    await expect(fetchAgentLongStream(undefined)).rejects.toMatchObject({
      type: "rate_limit",
      statusCode: 429,
      cause: "Monthly limit reached",
      metadata: { remaining: 0 },
    });
  });

  it("turns a run with no first UI event into a visible startup error", async () => {
    mockFetchStream.mockImplementation(
      async (
        _runId: string,
        _streamId: string,
        options: { signal: AbortSignal },
      ) => ({
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<unknown>>((resolve) => {
                if (options.signal.aborted) {
                  resolve({ done: true, value: undefined });
                  return;
                }
                options.signal.addEventListener(
                  "abort",
                  () => resolve({ done: true, value: undefined }),
                  { once: true },
                );
              }),
          };
        },
      }),
    );

    const response = await fetchAgentLongStream(undefined, {
      firstEventTimeoutMs: 10,
    });

    await expect(response.text()).resolves.toContain(
      AGENT_START_TIMEOUT_MESSAGE,
    );
  });

  it("waits out a queue instead of calling it a dropped connection", async () => {
    // A run behind the concurrency limit emits no UI chunks and is not late.
    // As long as Trigger keeps reporting a live status for it, the startup
    // clock restarts; the error is for silence, not for waiting a turn.
    mockSubscribeToRun.mockReturnValue({
      unsubscribe: jest.fn(),
      async *[Symbol.asyncIterator]() {
        for (let tick = 0; tick < 6; tick++) {
          await new Promise((resolve) => setTimeout(resolve, 10));
          yield { status: "QUEUED" };
        }
        yield { status: "EXECUTING" };
      },
    });

    let releaseChunk: (() => void) | null = null;
    const firstChunk = new Promise<void>((resolve) => {
      releaseChunk = resolve;
    });
    mockFetchStream.mockResolvedValue({
      async *[Symbol.asyncIterator]() {
        await firstChunk;
        yield { type: "start", messageId: "assistant_queued" };
        yield { type: "finish" };
      },
    });

    const response = await fetchAgentLongStream(undefined, {
      firstEventTimeoutMs: 30,
    });
    // Six status ticks at 10ms carry the run well past the raw 30ms budget.
    await new Promise((resolve) => setTimeout(resolve, 70));
    releaseChunk?.();

    const body = await response.text();
    expect(body).not.toContain(AGENT_START_TIMEOUT_MESSAGE);
    expect(body).toContain("assistant_queued");
  });

  it("reopens the UI stream when the server closes it on idle", async () => {
    // `timeoutInSeconds` asks the server to close after that much silence, and
    // the SDK reports that close as a clean end of stream -- its retry path
    // only covers errors. A run that spends a minute inside one tool call was
    // therefore reported as a dropped connection. Reopening from the last
    // event id continues the same durable stream.
    const opens: Array<string | undefined> = [];
    mockFetchStream.mockImplementation(
      async (
        _runId: string,
        _streamId: string,
        options: {
          lastEventId?: string;
          onPart?: (part: { id?: string }) => void;
        },
      ) => {
        opens.push(options.lastEventId);
        const first = opens.length === 1;
        return {
          async *[Symbol.asyncIterator]() {
            if (first) {
              options.onPart?.({ id: "7" });
              yield { type: "start", messageId: "assistant_reopen" };
              return; // server closed on idle
            }
            options.onPart?.({ id: "8" });
            yield { type: "finish" };
          },
        };
      },
    );

    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();

    expect(opens).toEqual([undefined, "7"]);
    expect(body).toContain("assistant_reopen");
    expect(body).not.toContain(LOST_AGENT_CONNECTION_MESSAGE);
  });

  it("surfaces a producer that goes quiet and never finishes as an error", async () => {
    // The first window carries a chunk, so it is not a dead stream yet; the
    // reopens after it carry nothing at all. A live run breaks its silence
    // with a heartbeat, so consecutive empty windows mean the producer is
    // gone, and that is the point where this becomes visible and retryable.
    let open = 0;
    mockFetchStream.mockImplementation(async () => {
      const first = open++ === 0;
      return {
        async *[Symbol.asyncIterator]() {
          if (first) yield { type: "start", messageId: "assistant_test" };
        },
      };
    });

    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();

    expect(open).toBeGreaterThan(1);

    expect(body).toContain('"type":"error"');
    expect(body).toContain(LOST_AGENT_CONNECTION_MESSAGE);
    expect(body).not.toContain('"type":"abort"');
  });

  it("surfaces a Trigger stream read failure as an error", async () => {
    mockFetchStream.mockResolvedValue(
      createAsyncStream([], new Error("subscription failed")),
    );

    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();

    expect(body).toContain('"type":"error"');
    expect(body).toContain(LOST_AGENT_CONNECTION_MESSAGE);
  });

  it("preserves abort semantics for a real consumer cancellation", async () => {
    mockFetchStream.mockResolvedValue(createAsyncStream([]));
    const controller = new AbortController();
    controller.abort();

    const response = await fetchAgentLongStream({ signal: controller.signal });
    const body = await response.text();

    expect(body).toContain('"type":"abort"');
    expect(body).not.toContain('"type":"error"');
  });

  it("converts cancellation during reconnect setup into a protocol abort", async () => {
    const controller = new AbortController();
    global.fetch = jest.fn((_input, init) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            const abortError = new Error("Aborted");
            abortError.name = "AbortError";
            reject(abortError);
          },
          { once: true },
        );
      });
    });

    const responsePromise = resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      { signal: controller.signal },
    );
    controller.abort();

    const body = await (await responsePromise).text();
    expect(body).toContain('"type":"abort"');
    expect(body).not.toContain('"type":"error"');
  });

  it("aborts an active reconnected stream through its external signal", async () => {
    mockFetchStream.mockResolvedValue({
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<unknown>>(() => {}),
          return: jest.fn().mockResolvedValue({ done: true }),
        };
      },
    });
    const controller = new AbortController();

    const response = await resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      { signal: controller.signal },
    );
    controller.abort();

    const body = await response.text();
    expect(body).toContain('"type":"abort"');
    expect(body).not.toContain('"type":"error"');
  });

  it("prepares the replay base before exposing a durable response to the SDK", async () => {
    mockFetchStream.mockResolvedValue(
      createAsyncStream([
        { type: "start", messageId: "run_test" },
        { type: "finish", finishReason: "stop" },
      ]),
    );
    const onReplay = jest.fn();
    const response = await resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      undefined,
      onReplay,
    );
    expect(onReplay).toHaveBeenCalledTimes(1);
    expect(onReplay).toHaveBeenCalledWith("run_test");
    await response.text();
  });

  it("restores the original request context before reading replayed continuation signals", async () => {
    const context = {
      mode: "agent",
      purpose: "app",
      temporary: false,
      approvalMode: "ask",
      sandboxPreference: "tauri",
      selectedModel: "build-astra",
      reasoningEffort: "xhigh",
      projectId: "project-a",
      todos: [],
    };
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({
        runId: "run_test",
        publicAccessToken: "public_test",
        requestContext: context,
      }),
    );
    const order: string[] = [];
    mockFetchStream.mockImplementation(async () => {
      order.push("stream");
      return createAsyncStream([
        { type: "start", messageId: "run_test" },
        {
          type: "data-auto-continue",
          data: { continuationId: "leg-1", reason: "context-limit" },
          transient: true,
        },
        { type: "finish", finishReason: "stop" },
      ]);
    });
    const remember = jest.fn(() => {
      order.push("context");
    });
    const response = await resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      undefined,
      undefined,
      remember,
    );
    await response.text();
    expect(remember).toHaveBeenCalledWith(context);
    expect(remember).toHaveBeenCalledTimes(1);
    expect(order[0]).toBe("context");
    expect(order).toContain("stream");
  });

  it.each([204, 401])(
    "preserves existing content on a %s resume response",
    async (status) => {
      global.fetch = jest
        .fn()
        .mockResolvedValue(new Response(null, { status }));
      const onReplay = jest.fn();
      const response = await resumeAgentLongStream(
        "/api/agent-long/resume?chatId=chat_test",
        undefined,
        onReplay,
      );
      expect(response.status).toBe(status);
      expect(onReplay).not.toHaveBeenCalled();
    },
  );

  it("retries an unverified run lookup with GET and restores the same stream", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        Response.json(
          { error: "run_status_unavailable" },
          { status: 503, headers: { "Retry-After": "3" } },
        ),
      )
      .mockResolvedValueOnce(
        Response.json({
          runId: "run_test",
          publicAccessToken: "public_test",
        }),
      );
    mockFetchStream.mockResolvedValue(
      createAsyncStream([
        { type: "start", messageId: "assistant_test" },
        { type: "finish", finishReason: "stop" },
      ]),
    );

    const response = await resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      undefined,
    );
    const body = await response.text();

    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(
      (global.fetch as jest.Mock).mock.calls.every(
        ([url, init]) =>
          url === "/api/agent-long/resume?chatId=chat_test" &&
          init.method === "GET",
      ),
    ).toBe(true);
    expect(body).toContain('"type":"finish"');
    expect(body).not.toContain(LOST_AGENT_CONNECTION_MESSAGE);
  });

  it("bounds stalled resume GETs without retrying the start POST or losing the saved answer", async () => {
    jest.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      global.fetch = jest.fn(
        (_input, init) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal as AbortSignal;
            if (signal) {
              signals.push(signal);
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("Aborted", "AbortError")),
                { once: true },
              );
            }
          }),
      );
      const onReplay = jest.fn();
      let settled = false;
      const result = resumeAgentLongStream(
        "/api/agent-long/resume?chatId=chat_test",
        undefined,
        onReplay,
      ).then(async (response) => {
        settled = true;
        return response.text();
      });
      await jest.advanceTimersByTimeAsync(50_000);
      expect(settled).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(3);
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      expect(onReplay).not.toHaveBeenCalled();
      expect(await result).toContain(LOST_AGENT_CONNECTION_MESSAGE);
      expect(
        (global.fetch as jest.Mock).mock.calls.every(
          ([, init]) => init.method === "GET",
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });

  it("stops durable-resume retry during an external cancellation", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response("temporarily unavailable", { status: 503 }),
      );
    const controller = new AbortController();

    const responsePromise = resumeAgentLongStream(
      "/api/agent-long/resume?chatId=chat_test",
      { signal: controller.signal },
    );
    controller.abort();

    const body = await (await responsePromise).text();
    expect(body).toContain('"type":"abort"');
    expect(body).not.toContain('"type":"error"');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("passes through a successful terminal chunk without adding an error", async () => {
    mockFetchStream.mockResolvedValue(
      createAsyncStream([
        { type: "start", messageId: "assistant_test" },
        { type: "text-start", id: "text_test" },
        { type: "text-delta", id: "text_test", delta: "Done" },
        { type: "text-end", id: "text_test" },
        { type: "finish", finishReason: "stop" },
      ]),
    );

    const response = await fetchAgentLongStream(undefined);
    const body = await response.text();

    expect(body).toContain('"type":"finish"');
    expect(body).not.toContain('"type":"error"');
    expect(body).not.toContain('"type":"abort"');
  });
});

describe("replay drain yielding", () => {
  it("hands the event loop back while draining a large buffered replay", async () => {
    // Resuming a long-lived run replays its whole history, and every buffered
    // chunk resolves iter.next() synchronously -- a pure microtask chain. The
    // freeze this guards against: reopening the app onto an hour-old run
    // drained tens of thousands of chunks inside ONE microtask checkpoint,
    // WebKit's content process pinned at 100%, and the window never painted.
    // The transport must take a macrotask breath on a time budget, which this
    // asserts by racing a plain setTimeout against the drain.
    const chunks = Array.from({ length: 10_000 }, (_, i) => ({
      type: "data-probe",
      id: `c${i}`,
      i,
    }));
    chunks.push({ type: "finish", id: "fin", i: -1 });
    mockFetchStream.mockResolvedValue(createAsyncStream(chunks));
    // A fresh start Response per call: the shared beforeEach mock is a single
    // body, and fetch here is called once per test invocation.
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        Response.json({ runId: "run_test", publicAccessToken: "public_test" }),
      ),
    );

    // Count the transport's own breaths: the yield is the only zero-delay
    // setTimeout in this path (the delta flush timer runs at 30ms), so
    // zero-delay calls are a direct, deterministic measure of it.
    const realSetTimeout = global.setTimeout;
    let breaths = 0;
    const spy = jest.spyOn(global, "setTimeout").mockImplementation(((
      fn: () => void,
      ms?: number,
      ...rest: unknown[]
    ) => {
      if ((ms ?? 0) === 0) breaths += 1;
      return realSetTimeout(fn, ms, ...rest);
    }) as typeof setTimeout);
    try {
      const response = await fetchAgentLongStream(undefined, {});
      await response.text();
    } finally {
      spy.mockRestore();
    }

    // Without the yield this is zero: the entire 10k-chunk drain ran as one
    // unbroken microtask chain, which is precisely the frozen-window bug.
    expect(breaths).toBeGreaterThan(0);
  });
});

describe("replay fast-forward and compaction", () => {
  const freshStartResponse = () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        Response.json({ runId: "run_test", publicAccessToken: "public_test" }),
      ),
    );
  };

  it("emits only the last message's chunks from a multi-message replay", async () => {
    freshStartResponse();
    const chunks = [
      { type: "start", id: "m1" },
      { type: "text-delta", id: "t1", delta: "old " },
      { type: "text-delta", id: "t1", delta: "message" },
      { type: "finish", id: "m1" },
      { type: "start", id: "m2" },
      { type: "text-delta", id: "t2", delta: "live" },
      { type: "finish", id: "m2" },
    ];
    mockFetchStream.mockResolvedValue(createAsyncStream(chunks));

    const response = await fetchAgentLongStream(undefined, {});
    const body = await response.text();

    // Everything before the last `start` is already persisted and already on
    // screen; re-streaming it is pure cost.
    expect(body).not.toContain("old ");
    expect(body).toContain("live");
    expect(body).toContain('"type":"start"');
  });

  it("collapses a giant single-message replay into per-part chunks", async () => {
    freshStartResponse();
    // The worst case: one assistant message carrying hours of deltas. The
    // boundary skip cannot help here -- compaction must.
    const words = Array.from({ length: 5_000 }, (_, i) => ({
      type: "text-delta",
      id: "t1",
      delta: `w${i} `,
    }));
    const chunks = [
      { type: "start", id: "m1" },
      ...words,
      { type: "finish", id: "m1" },
    ];
    mockFetchStream.mockResolvedValue(createAsyncStream(chunks));

    const response = await fetchAgentLongStream(undefined, {});
    const body = await response.text();

    const frames = body.split("\n\n").filter((f) => f.startsWith("data: "));
    // start + one merged text chunk + finish (+ tolerance for metadata),
    // never five thousand.
    expect(frames.length).toBeLessThan(20);
    expect(body).toContain("w0 w1 ");
    expect(body).toContain("w4999 ");
  });

  it("drops replayed tool-input deltas whose complete input follows", async () => {
    freshStartResponse();
    const chunks = [
      { type: "start", id: "m1" },
      { type: "tool-input-start", toolCallId: "call1", toolName: "file" },
      ...Array.from({ length: 200 }, (_, i) => ({
        type: "tool-input-delta",
        toolCallId: "call1",
        inputTextDelta: `piece${i}`,
      })),
      {
        type: "tool-input-available",
        toolCallId: "call1",
        input: { path: "/a" },
      },
      { type: "finish", id: "m1" },
    ];
    mockFetchStream.mockResolvedValue(createAsyncStream(chunks));

    const response = await fetchAgentLongStream(undefined, {});
    const body = await response.text();

    expect(body).toContain("tool-input-available");
    expect(body).not.toContain("piece7");
  });
});

/*
 * The replay edge: where remembered history ends and live output begins.
 *
 * Reattaching replays the run from the start. The transport compacts that
 * history, but it still left through the same pipe as live output, so the SDK
 * called it streaming and the UI animated every replayed word as if it were
 * being typed right now -- the whole transcript re-typing itself each time the
 * user came back. The transient marker below lets the client paint history
 * instantly and animate only what genuinely arrives after it.
 */
describe("replay edge marker", () => {
  // This block lives outside the suite that installs the harness, so it
  // installs the same one: an Edge Response, a live status subscription, and
  // a start response per call.
  beforeAll(() => {
    Object.defineProperty(globalThis, "Response", {
      configurable: true,
      value: EdgeResponse,
    });
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockSubscribeToRun.mockReturnValue(createStatusSubscription());
    global.fetch = jest.fn();
  });

  const freshStartResponse = () => {
    (global.fetch as jest.Mock).mockImplementation(() =>
      Promise.resolve(
        Response.json({ runId: "run_test", publicAccessToken: "public_test" }),
      ),
    );
  };
  const framesOf = (body: string) =>
    body
      .split("\n\n")
      .filter((f) => f.startsWith("data: "))
      .map(
        (f) =>
          JSON.parse(f.slice(6)) as {
            type: string;
            delta?: string;
            transient?: boolean;
          },
      );

  it("emits the marker after the replayed suffix and before anything live", async () => {
    freshStartResponse();
    // History arrives instantly (the replay); then a quiet gap; then live.
    const live = { type: "text-delta", id: "t1", delta: " live" };
    const stream = {
      async *[Symbol.asyncIterator]() {
        yield { type: "start", id: "m1" };
        yield { type: "text-delta", id: "t1", delta: "old" };
        await new Promise((r) => setTimeout(r, 600)); // > REPLAY_EDGE_QUIET_MS
        yield live;
        yield { type: "finish", id: "m1" };
      },
    };
    mockFetchStream.mockResolvedValue(stream);

    const response = await fetchAgentLongStream(undefined, {});
    const frames = framesOf(await response.text());

    const edgeIdx = frames.findIndex(
      (f) => f.type === "data-agent-replay-edge",
    );
    const oldIdx = frames.findIndex((f) => f.delta?.includes("old"));
    const liveIdx = frames.findIndex(
      (f) => f.delta?.includes("live") && !f.delta.includes("old"),
    );
    expect(edgeIdx).toBeGreaterThan(-1);
    expect(frames[edgeIdx].transient).toBe(true);
    // History, then the edge, then the live word -- never the other way.
    expect(oldIdx).toBeLessThan(edgeIdx);
    expect(liveIdx).toBeGreaterThan(edgeIdx);
  });

  it("still emits the marker when there was nothing to replay", async () => {
    freshStartResponse();
    const stream = {
      async *[Symbol.asyncIterator]() {
        await new Promise((r) => setTimeout(r, 600));
        yield { type: "start", id: "m1" };
        yield { type: "text-delta", id: "t1", delta: "fresh" };
        yield { type: "finish", id: "m1" };
      },
    };
    mockFetchStream.mockResolvedValue(stream);

    const response = await fetchAgentLongStream(undefined, {});
    const frames = framesOf(await response.text());
    const edgeIdx = frames.findIndex(
      (f) => f.type === "data-agent-replay-edge",
    );
    const freshIdx = frames.findIndex((f) => f.delta?.includes("fresh"));
    expect(edgeIdx).toBeGreaterThan(-1);
    // The client's replay flag would otherwise wait on a marker that never came.
    expect(edgeIdx).toBeLessThan(freshIdx);
  });

  it("emits exactly one marker per subscription", async () => {
    freshStartResponse();
    const chunks = [
      { type: "start", id: "m1" },
      { type: "text-delta", id: "t1", delta: "a" },
      { type: "text-delta", id: "t1", delta: "b" },
      { type: "finish", id: "m1" },
    ];
    mockFetchStream.mockResolvedValue(createAsyncStream(chunks));
    const response = await fetchAgentLongStream(undefined, {});
    const frames = framesOf(await response.text());
    expect(
      frames.filter((f) => f.type === "data-agent-replay-edge"),
    ).toHaveLength(1);
  });
});

describe("receipt recovery without resubmission", () => {
  const saved = process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
  const init = {
    method: "POST",
    body: JSON.stringify({
      chatId: "chat",
      messages: [{ role: "user", id: "message", parts: [] }],
    }),
  };
  beforeEach(() => {
    process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION = "true";
    jest.clearAllMocks();
    mockSubscribeToRun.mockReturnValue(createStatusSubscription());
    mockFetchStream.mockResolvedValue(
      createAsyncStream([{ type: "finish", finishReason: "stop" }]),
    );
  });
  afterEach(() => {
    if (saved === undefined)
      delete process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
    else process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION = saved;
  });
  const accepted = () =>
    Response.json({
      delivery: "accepted",
      dispatchId: "message",
      runId: "original",
      publicAccessToken: "read-token",
    });
  it.each(["network", "500", "pending", "invalid"])(
    "recovers %s from exact receipt with only one POST",
    async (kind) => {
      const fn = jest.fn();
      if (kind === "network")
        fn.mockRejectedValueOnce(new Error("response lost"));
      else if (kind === "500")
        fn.mockResolvedValueOnce(new Response("upstream", { status: 500 }));
      else if (kind === "pending")
        fn.mockResolvedValueOnce(
          Response.json({ error: "dispatch_pending" }, { status: 409 }),
        );
      else fn.mockResolvedValueOnce(Response.json({}));
      fn.mockResolvedValueOnce(accepted());
      global.fetch = fn;
      expect(await (await fetchAgentLongStream(init)).text()).toContain(
        "finish",
      );
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn.mock.calls[0][0]).toBe("/api/agent-long");
      expect(fn.mock.calls[1][0]).toBe(
        "/api/agent-long/receipt?chatId=chat&dispatchId=message",
      );
      expect(fn.mock.calls[1][1].method).toBe("GET");
    },
  );
  it("recovers a timed-out POST using a fresh bounded read signal", async () => {
    global.fetch = jest
      .fn()
      .mockImplementationOnce(
        (_url, options) =>
          new Promise((_resolve, reject) => {
            options.signal.addEventListener(
              "abort",
              () => reject(new Error("start timeout")),
              { once: true },
            );
          }),
      )
      .mockResolvedValueOnce(accepted());
    expect(
      await (
        await fetchAgentLongStream(init, { startRequestTimeoutMs: 5 })
      ).text(),
    ).toContain("finish");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("unconfirmed delivery preserves failure without resending", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(
        Response.json({ delivery: "unconfirmed", dispatchId: "message" }),
      );
    await expect(fetchAgentLongStream(init)).rejects.toThrow("response lost");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("Stop never recovers or subscribes", async () => {
    const c = new AbortController();
    global.fetch = jest.fn().mockImplementation(async () => {
      c.abort();
      throw new Error("stopped");
    });
    await expect(
      fetchAgentLongStream({ ...init, signal: c.signal }),
    ).rejects.toThrow("stopped");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mockFetchStream).not.toHaveBeenCalled();
  });
});

describe("dedicated Hack durable transport", () => {
  const savedFlag = process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
  const init = {
    method: "POST",
    body: JSON.stringify({
      chatId: "hack-chat",
      purpose: "security",
      messages: [
        {
          role: "user",
          id: "request",
          parts: [{ type: "text", text: "Review supplied evidence" }],
        },
      ],
    }),
  };
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
    mockSubscribeToRun.mockReturnValue(createStatusSubscription());
    mockFetchStream.mockResolvedValue(createAsyncStream([{ type: "finish" }]));
  });
  afterEach(() => {
    if (savedFlag === undefined)
      delete process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION;
    else process.env.NEXT_PUBLIC_RIFT_DURABLE_DISPATCH_ADMISSION = savedFlag;
  });
  it("dispatches only to Hack and restores the server-bound scope", async () => {
    const remember = jest.fn();
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({
        runId: "hack-run",
        publicAccessToken: "read-token",
        requestContext: {
          mode: "agent",
          purpose: "security",
          temporary: false,
          approvalMode: "full",
          sandboxPreference: "e2b",
          todos: [],
          scope: "authorized.example",
          dispatchId: "request",
        },
      }),
    );
    const response = await fetchAgentLongStream(
      init,
      undefined,
      "hack",
      remember,
    );
    await response.text();
    expect(fetch).toHaveBeenCalledWith(
      "/api/hack-long",
      expect.objectContaining({ method: "POST" }),
    );
    expect(remember).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "security",
        scope: "authorized.example",
        dispatchId: "request",
      }),
    );
  });
  it.each(["direct", "direct-conflict", "lost-response"])(
    "finishes a confirmed canceled dispatch without attaching a worker: %s",
    async (delivery) => {
      const stopped = () =>
        Response.json(
          {
            delivery: "canceled",
            dispatchId: "request",
            canceled: true,
          },
          { status: delivery === "direct-conflict" ? 409 : 200 },
        );
      global.fetch =
        delivery !== "lost-response"
          ? jest.fn().mockResolvedValue(stopped())
          : jest
              .fn()
              .mockRejectedValueOnce(new TypeError("response lost"))
              .mockResolvedValue(stopped());
      const response = await fetchAgentLongStream(init, undefined, "hack");
      expect(await response.text()).toContain('"type":"abort"');
      expect(mockFetchStream).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(delivery !== "lost-response" ? 1 : 2);
    },
  );
  it("does not accept another dispatch's canceled receipt", async () => {
    global.fetch = jest.fn().mockResolvedValue(
      Response.json({
        delivery: "canceled",
        dispatchId: "different",
        canceled: true,
      }),
    );
    await expect(fetchAgentLongStream(init, undefined, "hack")).rejects.toThrow(
      "valid run handle",
    );
    expect(mockFetchStream).not.toHaveBeenCalled();
  });
  it("recovers an uncertain Hack acknowledgement using its exact receipt without a second POST", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(
        Response.json({
          delivery: "accepted",
          dispatchId: "request",
          runId: "original-hack-run",
          publicAccessToken: "read-token",
        }),
      );
    const response = await fetchAgentLongStream(init, undefined, "hack");
    await response.text();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "/api/hack-long/receipt?chatId=hack-chat&dispatchId=request",
      expect.objectContaining({ method: "GET" }),
    );
  });
  it("does not send a rejected Hack request to the generic app or HTTP execution endpoint", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(new Response("Disabled", { status: 403 }));
    expect((await fetchAgentLongStream(init, undefined, "hack")).status).toBe(
      403,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/hack-long", expect.anything());
  });
});
