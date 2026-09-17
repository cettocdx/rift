/** @jest-environment node */
import { fetchHackChatStream, cancelHackRun } from "../hack-transport";
import {
  fetchAgentLongStream,
  resumeAgentLongStream,
} from "../agent-long-transport";
jest.mock("../agent-long-transport", () => ({
  fetchAgentLongStream: jest.fn(),
  resumeAgentLongStream: jest.fn(),
}));
const options = () => ({
  chatId: "hack-session",
  durableEnabled: true,
  hasLegacyStream: false,
  onReplay: jest.fn(),
  onRequestContext: jest.fn(),
  registerResumeAbort: jest.fn((_abort: () => void) => jest.fn()),
});
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
});
it("turns a pending HTTP attachment into a retryable connection failure without a POST", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    new Response("Reconnect pending", {
      status: 503,
      headers: {
        "x-rift-reconnect": "pending",
        "x-rift-execution-id": "exec-a",
      },
    }),
  );
  await expect(
    fetchHackChatStream(
      { ...options(), durableEnabled: false },
      { method: "GET" },
    ),
  ).rejects.toBeInstanceOf(TypeError);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});
it("does not reinterpret a normal server failure as a verified pending attachment", async () => {
  const response = new Response("Unavailable", { status: 503 });
  (fetch as jest.Mock).mockResolvedValue(response);
  expect(
    await fetchHackChatStream(
      { ...options(), durableEnabled: false },
      { method: "GET" },
    ),
  ).toBe(response);
});
it("routes a new durable turn only to its durable adapter", async () => {
  (fetchAgentLongStream as jest.Mock).mockResolvedValue(new Response("events"));
  const settings = options();
  const init = { method: "POST", body: "request" };
  await fetchHackChatStream(settings, init);
  expect(fetchAgentLongStream).toHaveBeenCalledWith(
    init,
    undefined,
    "hack",
    settings.onRequestContext,
  );
  expect(fetch).not.toHaveBeenCalled();
});
it("does not rerun work through HTTP when durable dispatch fails", async () => {
  (fetchAgentLongStream as jest.Mock).mockRejectedValue(new Error("offline"));
  await expect(
    fetchHackChatStream(options(), { method: "POST" }),
  ).rejects.toThrow("offline");
  expect(fetch).not.toHaveBeenCalled();
});
it("reconnect observes the durable run, forwards context, and releases its reader registration", async () => {
  const unregister = jest.fn();
  const settings = options();
  settings.registerResumeAbort.mockReturnValue(unregister);
  (resumeAgentLongStream as jest.Mock).mockResolvedValue(
    new Response("events"),
  );
  const response = await fetchHackChatStream(settings, { method: "GET" });
  expect(resumeAgentLongStream).toHaveBeenCalledWith(
    "/api/hack-long/resume?chatId=hack-session",
    expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
    settings.onReplay,
    settings.onRequestContext,
  );
  expect(await response.text()).toBe("events");
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});
it("an empty durable lookup can observe a known legacy stream without submitting a task", async () => {
  (resumeAgentLongStream as jest.Mock).mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  await fetchHackChatStream(
    { ...options(), hasLegacyStream: true },
    { method: "GET" },
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/chat/hack-session/stream",
    expect.objectContaining({ method: "GET" }),
  );
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});
it("retained reader Stop aborts a pending reconnect lookup", async () => {
  const settings = options();
  let signal: AbortSignal;
  (resumeAgentLongStream as jest.Mock).mockImplementation((_url, init) => {
    signal = init.signal;
    return new Promise((_, reject) =>
      init.signal.addEventListener("abort", () => reject(new Error("stopped"))),
    );
  });
  const pending = fetchHackChatStream(settings, { method: "GET" });
  settings.registerResumeAbort.mock.calls[0][0]();
  await expect(pending).rejects.toThrow("stopped");
  expect(signal!.aborted).toBe(true);
});
it.each([{ canceled: false }, {}, { canceled: false, reason: "unknown" }])(
  "does not claim Stop from an unconfirmed receipt %j",
  async (receipt) => {
    (fetch as jest.Mock).mockResolvedValue(Response.json(receipt));
    await expect(
      cancelHackRun({
        chatId: "chat",
        dispatchId: "dispatch",
        durable: true,
        cancelLegacy: jest.fn(),
      }),
    ).rejects.toThrow("not confirmed");
  },
);
it("stops only the exact durable producer, never a chat-wide legacy predecessor", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    Response.json({ canceled: true, dispatchId: "dispatch" }),
  );
  const legacy = jest.fn().mockResolvedValue(undefined);
  await cancelHackRun({
    chatId: "chat",
    dispatchId: "dispatch",
    durable: true,
    cancelLegacy: legacy,
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/hack-long/cancel",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        chatId: "chat",
        dispatchId: "dispatch",
      }),
    }),
  );
  expect(legacy).not.toHaveBeenCalled();
});
it("bounds cancellation even if its network request ignores abort", async () => {
  (fetch as jest.Mock).mockImplementation(() => new Promise(() => {}));
  await expect(
    cancelHackRun(
      {
        chatId: "chat",
        dispatchId: "dispatch",
        durable: true,
        cancelLegacy: jest.fn(),
      },
      5,
    ),
  ).rejects.toThrow("not confirmed");
});

it("can still observe an admitted durable run when new admissions are disabled", async () => {
  (resumeAgentLongStream as jest.Mock).mockResolvedValue(
    new Response(null, { status: 204 }),
  );
  await fetchHackChatStream(
    { ...options(), durableEnabled: false, hasDurableRun: true },
    { method: "GET" },
  );
  expect(resumeAgentLongStream).toHaveBeenCalledTimes(1);
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});
it("does not fall back to HTTP or submit work when durable cleanup is unconfirmed", async () => {
  const pending = Response.json(
    { error: "cleanup_pending", delivery: "unconfirmed", canceled: false },
    { status: 409 },
  );
  (resumeAgentLongStream as jest.Mock).mockResolvedValue(pending);
  const settings = { ...options(), hasDurableRun: true, hasLegacyStream: true };
  expect(await fetchHackChatStream(settings, { method: "GET" })).toBe(pending);
  expect(settings.onReplay).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});
it("keeps the legacy execution path for users outside the rollout", async () => {
  await fetchHackChatStream(
    { ...options(), durableEnabled: false },
    { method: "POST", body: "explicit request" },
  );
  expect(fetch).toHaveBeenCalledWith(
    "/api/hack-chat",
    expect.objectContaining({ method: "POST" }),
  );
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});

it("does not start a reconnect after its Stop signal is already aborted", async () => {
  const controller = new AbortController();
  controller.abort(new Error("stopped before lookup"));
  await expect(
    fetchHackChatStream(options(), {
      method: "GET",
      signal: controller.signal,
    }),
  ).rejects.toThrow("stopped before lookup");
  expect(resumeAgentLongStream).not.toHaveBeenCalled();
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});

it("releases a failed replay reader so a later Stop cannot target stale I/O", async () => {
  const settings = options();
  const unregister = jest.fn();
  settings.registerResumeAbort.mockReturnValue(unregister);
  (resumeAgentLongStream as jest.Mock).mockResolvedValue(
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(new Error("replay disconnected"));
        },
      }),
    ),
  );
  const response = await fetchHackChatStream(settings, { method: "GET" });
  await expect(response.text()).rejects.toThrow("replay disconnected");
  expect(unregister).toHaveBeenCalledTimes(1);
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});

it("rejects no-active-run because a delayed POST can still be admitted", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    Response.json({ canceled: false, reason: "no_active_run" }),
  );
  await expect(
    cancelHackRun({
      chatId: "chat",
      dispatchId: "dispatch",
      durable: true,
      cancelLegacy: jest.fn(),
    }),
  ).rejects.toThrow("not confirmed");
});

it.each([{ canceled: true, dispatchId: "different" }, { canceled: true }])(
  "requires exact Stop acknowledgment %j",
  async (receipt) => {
    (fetch as jest.Mock).mockResolvedValue(
      Response.json(receipt, { status: 202 }),
    );
    await expect(
      cancelHackRun({
        chatId: "chat",
        dispatchId: "dispatch",
        durable: true,
        cancelLegacy: jest.fn(),
      }),
    ).rejects.toThrow("not confirmed");
  },
);
it("cannot stop an unknown durable identity by falling back to chat-wide cancellation", async () => {
  await expect(
    cancelHackRun({
      chatId: "chat",
      durable: true,
      cancelLegacy: jest.fn(),
    }),
  ).rejects.toThrow("not confirmed");
  expect(fetch).not.toHaveBeenCalled();
});

it("cancels exact HTTP execution without touching legacy or durable cancellation", async () => {
  const cancelLegacy = jest.fn();
  (fetch as jest.Mock).mockResolvedValue(
    Response.json({ canceled: true, executionId: "http-one" }),
  );
  await cancelHackRun({
    chatId: "hack-session",
    durable: false,
    executionId: "http-one",
    cancelLegacy,
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/hack-chat/cancel",
    expect.objectContaining({
      body: JSON.stringify({ chatId: "hack-session", executionId: "http-one" }),
    }),
  );
  expect(cancelLegacy).not.toHaveBeenCalled();
});
it.each([202, 200])(
  "does not confirm pending or mismatched HTTP Stop (%s)",
  async (status) => {
    (fetch as jest.Mock).mockResolvedValue(
      Response.json({ canceled: true, executionId: "different" }, { status }),
    );
    await expect(
      cancelHackRun({
        chatId: "hack-session",
        durable: false,
        executionId: "http-one",
        cancelLegacy: jest.fn(),
      }),
    ).rejects.toThrow("not confirmed");
  },
);
it("restores exact HTTP identity from an observed response header", async () => {
  const onHttpExecution = jest.fn();
  (fetch as jest.Mock).mockResolvedValue(
    new Response("events", { headers: { "x-rift-execution-id": "http-one" } }),
  );
  const response = await fetchHackChatStream(
    { ...options(), durableEnabled: false, onHttpExecution },
    { method: "GET" },
  );
  expect(onHttpExecution).toHaveBeenCalledWith("http-one");
  await response.text();
});
it("rejects a response bound to another HTTP request", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    new Response("events", { headers: { "x-rift-execution-id": "different" } }),
  );
  await expect(
    fetchHackChatStream(
      { ...options(), durableEnabled: false },
      { method: "POST", body: JSON.stringify({ executionId: "http-one" }) },
    ),
  ).rejects.toThrow("identity");
});

it("preserves one HTTP execution ID across delivery retries without redispatching durably", async () => {
  const init = {
    method: "POST",
    body: JSON.stringify({ executionId: "http-stable", messages: [] }),
  };
  (fetch as jest.Mock)
    .mockRejectedValueOnce(new Error("lost response"))
    .mockResolvedValueOnce(
      new Response("events", {
        headers: { "x-rift-execution-id": "http-stable" },
      }),
    );
  const settings = { ...options(), durableEnabled: false };
  await expect(fetchHackChatStream(settings, init)).rejects.toThrow(
    "lost response",
  );
  await fetchHackChatStream(settings, init);
  expect(
    (fetch as jest.Mock).mock.calls.map(
      (call) => JSON.parse(call[1].body).executionId,
    ),
  ).toEqual(["http-stable", "http-stable"]);
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});

it.each(["http", "durable"])(
  "polls pending %s Stop until exact acknowledgment",
  async (kind) => {
    jest.useFakeTimers();
    try {
      const key = kind === "http" ? "executionId" : "dispatchId";
      (fetch as jest.Mock)
        .mockResolvedValueOnce(
          Response.json({ canceled: false, [key]: "one" }, { status: 202 }),
        )
        .mockResolvedValueOnce(Response.json({ canceled: true, [key]: "one" }));
      const legacy = jest.fn();
      let settled = false;
      const pending = cancelHackRun(
        {
          chatId: "chat",
          durable: kind === "durable",
          ...(kind === "http" ? { executionId: "one" } : { dispatchId: "one" }),
          cancelLegacy: legacy,
        },
        2000,
      ).then(() => {
        settled = true;
      });
      await jest.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(750);
      await pending;
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((fetch as jest.Mock).mock.calls[0][1].body).toBe(
        (fetch as jest.Mock).mock.calls[1][1].body,
      );
      expect(legacy).not.toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  },
);
it("bounds pending Stop polling and cancels its delay at the overall deadline", async () => {
  jest.useFakeTimers();
  try {
    (fetch as jest.Mock).mockImplementation(async () =>
      Response.json({ canceled: false, executionId: "one" }, { status: 202 }),
    );
    const pending = cancelHackRun(
      {
        chatId: "chat",
        durable: false,
        executionId: "one",
        cancelLegacy: jest.fn(),
      },
      1000,
    );
    const assertion = expect(pending).rejects.toThrow("not confirmed");
    await jest.advanceTimersByTimeAsync(1000);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((fetch as jest.Mock).mock.calls[0][1].signal.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(2000);
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});

it("retries a chat-bound saved-answer lookup failure using observation only", async () => {
  (fetch as jest.Mock).mockResolvedValue(
    new Response("Replay pending", {
      status: 503,
      headers: {
        "x-rift-reconnect": "replay-pending",
        "x-rift-chat-id": "hack-session",
      },
    }),
  );
  const settings = {
    ...options(),
    durableEnabled: false,
    onHttpExecution: jest.fn(),
  };
  await expect(
    fetchHackChatStream(settings, { method: "GET" }),
  ).rejects.toBeInstanceOf(TypeError);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(settings.onHttpExecution).not.toHaveBeenCalled();
  expect(fetchAgentLongStream).not.toHaveBeenCalled();
});
it.each([null, "other-chat"])(
  "does not trust replay-pending for unrelated chat %s",
  async (chatId) => {
    const headers: Record<string, string> = {
      "x-rift-reconnect": "replay-pending",
    };
    if (chatId) headers["x-rift-chat-id"] = chatId;
    const response = new Response("Replay pending", { status: 503, headers });
    (fetch as jest.Mock).mockResolvedValue(response);
    expect(
      await fetchHackChatStream(
        { ...options(), durableEnabled: false },
        { method: "GET" },
      ),
    ).toBe(response);
  },
);
