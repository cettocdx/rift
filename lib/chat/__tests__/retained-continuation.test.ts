import { RetainedContinuationController } from "../retained-continuation";

function setup(
  context: Record<string, unknown> = { mode: "agent", purpose: "app" },
) {
  const state: {
    status: "ready" | "submitted" | "streaming" | "error";
    error: unknown;
    available: boolean;
  } = { status: "ready", error: undefined, available: true };
  const sendMessage = jest.fn().mockResolvedValue(undefined);
  const pendingChanges = jest.fn();
  const controller = new RetainedContinuationController({
    getStatus: () => state.status,
    getError: () => state.error,
    isAvailable: () => state.available,
    sendMessage,
    onChange: () => pendingChanges(controller.pending),
  });
  controller.setRequestContext(context);
  return { controller, state, sendMessage, pendingChanges };
}

const signal = (id = "leg-a", reason = "tool-calls") => ({
  type: "data-auto-continue",
  data: { shouldContinue: true, continuationId: id, reason },
});

describe("session-owned background continuations", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("continues a finished agent leg without any mounted UI callback", async () => {
    let status: "ready" | "streaming" = "streaming";
    const sendMessage = jest.fn().mockResolvedValue(undefined);
    const controller = new RetainedContinuationController({
      getStatus: () => status,
      getError: () => undefined,
      isAvailable: () => true,
      sendMessage,
    });
    controller.setRequestContext({
      mode: "agent",
      purpose: "app",
      selectedModel: "model-a",
    });
    controller.onData(signal());
    controller.onFinish();
    status = "ready";
    await jest.advanceTimersByTimeAsync(499);
    expect(sendMessage).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledWith(
      { text: "continue", metadata: { isAutoContinue: true } },
      {
        body: {
          mode: "agent",
          purpose: "app",
          selectedModel: "model-a",
          isAutoContinue: true,
          __riftRetainedContinuation: true,
        },
      },
    );
    controller.dispose();
  });

  it("waits beyond the handoff delay until the SDK response is actually ready", async () => {
    const { controller, state, sendMessage } = setup();
    state.status = "streaming";
    controller.onData(signal());
    controller.onFinish();
    expect(controller.pending).toBe(true);
    await jest.advanceTimersByTimeAsync(750);
    expect(sendMessage).not.toHaveBeenCalled();
    state.status = "ready";
    await jest.advanceTimersByTimeAsync(50);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("uses a deep request snapshot without replaying old message or regenerate envelopes", async () => {
    const context = {
      mode: "agent",
      purpose: "app",
      selectedModel: "original-model",
      reasoningEffort: "high",
      approvalMode: "ask",
      projectId: "project-a",
      sandboxPreference: "this-mac",
      workingFile: { path: "/chosen/file.ts" },
      messages: [{ text: "Old prompt" }],
      chatId: "chat-a",
      id: "message-a",
      regenerate: true,
      useClientMessagesForRegenerate: true,
      replaceActiveRun: true,
    };
    const { controller, sendMessage } = setup(context);
    context.workingFile.path = "/different/file.ts";
    context.selectedModel = "another-model";
    controller.reset();
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    const body = sendMessage.mock.calls[0][1].body;
    expect(body).toMatchObject({
      selectedModel: "original-model",
      reasoningEffort: "high",
      approvalMode: "ask",
      projectId: "project-a",
      sandboxPreference: "this-mac",
      workingFile: { path: "/chosen/file.ts" },
    });
    for (const key of [
      "messages",
      "chatId",
      "id",
      "regenerate",
      "useClientMessagesForRegenerate",
      "replaceActiveRun",
    ]) {
      expect(body).not.toHaveProperty(key);
    }
    controller.dispose();
  });

  it("deduplicates repeated signals by continuation ID across remount-style replay", async () => {
    const { controller, sendMessage } = setup();
    controller.onData(signal());
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(1_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it("deduplicates legacy signals within a request and allows the following request to continue", async () => {
    const { controller, state, sendMessage } = setup();
    const legacy = {
      type: "data-auto-continue",
      data: { shouldContinue: true },
    };
    state.status = "streaming";
    controller.onData(legacy);
    controller.onData(legacy);
    controller.onFinish();
    state.status = "ready";
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.onData(legacy);
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it.each([
    { mode: "ask", purpose: "app" },
    { mode: "image", purpose: "image" },
  ])(
    "does not dispatch in an ineligible request context %j",
    async (context) => {
      const { controller, sendMessage } = setup(context);
      controller.onData(signal());
      controller.onFinish();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(controller.pending).toBe(false);
      controller.dispose();
    },
  );

  it("continues temporary Build requests with the captured temporary context", async () => {
    const { controller, sendMessage } = setup({
      mode: "agent",
      purpose: "app",
      temporary: true,
      selectedModel: "model-a",
      todos: [{ id: "a", content: "Build", status: "in_progress" }],
    });
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][1].body).toMatchObject({
      mode: "agent",
      purpose: "app",
      temporary: true,
      selectedModel: "model-a",
      todos: [{ id: "a", content: "Build", status: "in_progress" }],
      isAutoContinue: true,
      __riftRetainedContinuation: true,
    });
    controller.dispose();
  });

  it("notifies only pending transitions from signal through handoff and completion", async () => {
    const { controller, state, pendingChanges } = setup();
    expect(pendingChanges).not.toHaveBeenCalled();
    state.status = "streaming";
    controller.onData(signal());
    controller.onData(signal());
    expect(pendingChanges.mock.calls).toEqual([[true]]);
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(pendingChanges.mock.calls).toEqual([[true]]);
    state.status = "ready";
    await jest.advanceTimersByTimeAsync(50);
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
    controller.dispose();
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
  });

  it.each(["stop", "reset", "dispose"] as const)(
    "notifies once when %s cancels a pending handoff",
    async (method) => {
      const { controller, pendingChanges, sendMessage } = setup();
      controller.onData(signal());
      controller[method]();
      controller[method]();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
      expect(sendMessage).not.toHaveBeenCalled();
      controller.dispose();
    },
  );

  it("keeps pending through a busy-run retry and notifies when a terminal failure releases it", async () => {
    const { controller, state, sendMessage, pendingChanges } = setup();
    sendMessage.mockImplementationOnce(() => {
      state.status = "error";
      state.error = { statusCode: 409, code: "run_active" };
      return Promise.resolve();
    });
    sendMessage.mockImplementationOnce(() => {
      state.error = new TypeError("Failed to fetch");
      return Promise.resolve();
    });
    controller.onData(signal());
    await jest.advanceTimersByTimeAsync(500);
    expect(pendingChanges.mock.calls).toEqual([[true]]);
    await jest.advanceTimersByTimeAsync(1_000);
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
    controller.dispose();
  });

  it("does not briefly release pending between consecutive automatic legs", async () => {
    const { controller, state, sendMessage, pendingChanges } = setup();
    let finishFirst!: () => void;
    sendMessage.mockImplementationOnce(() => {
      state.status = "streaming";
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    controller.onData(signal("first"));
    await jest.advanceTimersByTimeAsync(500);
    controller.onData(signal("second"));
    controller.onFinish();
    state.status = "ready";
    finishFirst();
    await jest.advanceTimersByTimeAsync(499);
    expect(pendingChanges.mock.calls).toEqual([[true]]);
    await jest.advanceTimersByTimeAsync(1);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
    controller.dispose();
  });

  it("releases pending when the request changes to a non-agent mode", async () => {
    const { controller, sendMessage, pendingChanges } = setup();
    controller.onData(signal());
    controller.setRequestContext({ mode: "ask", purpose: "app" });
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
    controller.dispose();
  });

  it("releases a waiting signal at the continuation cap so a queued user request can proceed", async () => {
    const { controller, state, sendMessage, pendingChanges } = setup();
    for (let index = 0; index < 5; index += 1) {
      controller.onData(signal(`leg-${index}`));
      await jest.advanceTimersByTimeAsync(500);
    }
    pendingChanges.mockClear();
    state.status = "streaming";
    controller.onData(signal("capped-leg"));
    expect(pendingChanges.mock.calls).toEqual([[true]]);
    controller.onFinish();
    state.status = "ready";
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(5);
    expect(pendingChanges.mock.calls).toEqual([[true], [false]]);
    controller.dispose();
  });

  it("honors an explicit shouldContinue false without consuming its continuation ID", async () => {
    const { controller, sendMessage } = setup();
    controller.onData({
      ...signal(),
      data: { ...signal().data, shouldContinue: false },
    });
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).not.toHaveBeenCalled();
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    controller.dispose();
  });

  it("caps ordinary continuations at five and resets the count only for a new user request", async () => {
    const { controller, sendMessage } = setup();
    for (let index = 0; index < 7; index += 1) {
      controller.onData(signal(`leg-${index}`));
      controller.onFinish();
      await jest.advanceTimersByTimeAsync(500);
    }
    expect(sendMessage).toHaveBeenCalledTimes(5);
    expect(controller.pending).toBe(false);
    controller.reset();
    controller.onData(signal("new-user-leg"));
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(6);
    controller.dispose();
  });

  it("allows at most three extra Build timeout legs beyond the ordinary cap", async () => {
    const { controller, sendMessage } = setup();
    for (let index = 0; index < 10; index += 1) {
      controller.onData(
        signal(
          `leg-${index}`,
          index < 5 ? "context-limit" : "preemptive-timeout",
        ),
      );
      controller.onFinish();
      await jest.advanceTimersByTimeAsync(500);
    }
    expect(sendMessage).toHaveBeenCalledTimes(8);
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it("never automatically chains a Studio or Hack timeout", async () => {
    for (const purpose of ["image", "security"]) {
      const { controller, sendMessage } = setup({ mode: "agent", purpose });
      controller.onData(signal("timeout-leg", "timeout"));
      controller.onFinish();
      await jest.advanceTimersByTimeAsync(500);
      expect(sendMessage).not.toHaveBeenCalled();
      controller.dispose();
    }
  });

  it("retries only known run_active conflicts after 1, 2 and 4 seconds without another hidden user turn", async () => {
    const { controller, state, sendMessage } = setup();
    const conflict = { statusCode: 409, code: "run_active" };
    sendMessage.mockImplementation(() => {
      state.status = "error";
      state.error = conflict;
      controller.onError(conflict);
      return Promise.reject(conflict);
    });
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(controller.pending).toBe(true);
    for (const [index, delay] of [1_000, 2_000, 4_000].entries()) {
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(sendMessage).toHaveBeenCalledTimes(index + 1);
      await jest.advanceTimersByTimeAsync(1);
      expect(sendMessage).toHaveBeenCalledTimes(index + 2);
    }
    expect(sendMessage.mock.calls[0][0]).toEqual({
      text: "continue",
      metadata: { isAutoContinue: true },
    });
    expect(sendMessage.mock.calls.slice(1).map((call) => call[0])).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      sendMessage.mock.calls.every(
        (call) => call[1] === sendMessage.mock.calls[0][1],
      ),
    ).toBe(true);
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it("detects SDK error state even when sendMessage resolves instead of rejecting", async () => {
    const { controller, state, sendMessage } = setup();
    sendMessage.mockImplementationOnce(() => {
      state.status = "error";
      state.error = { statusCode: 409, code: "run_active" };
      return Promise.resolve();
    });
    sendMessage.mockImplementationOnce(() => {
      state.status = "ready";
      state.error = undefined;
      return Promise.resolve();
    });
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(1_500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1][0]).toBeUndefined();
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it.each([
    new TypeError("Failed to fetch"),
    { statusCode: 500, code: "server_error" },
    { statusCode: 409, code: "other_conflict" },
  ])("does not retry an ambiguous or unrelated failure %j", async (error) => {
    const { controller, state, sendMessage } = setup();
    sendMessage.mockImplementation(() => {
      state.status = "error";
      state.error = error;
      return Promise.reject(error);
    });
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(20_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it.each(["stop", "reset", "dispose"] as const)(
    "cancels pending handoff on %s",
    async (method) => {
      const { controller, sendMessage } = setup();
      controller.onData(signal());
      controller.onFinish();
      controller[method]();
      await jest.advanceTimersByTimeAsync(2_000);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(controller.pending).toBe(false);
      controller.dispose();
    },
  );

  it("cancels a scheduled conflict retry when the user stops", async () => {
    const { controller, state, sendMessage } = setup();
    sendMessage.mockImplementation(() => {
      state.status = "error";
      state.error = { statusCode: 409, code: "run_active" };
      return Promise.resolve();
    });
    controller.onData(signal());
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    controller.stop();
    await jest.advanceTimersByTimeAsync(8_000);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it("does not dispatch after the owning authenticated session becomes unavailable", async () => {
    const { controller, state, sendMessage } = setup();
    controller.onData(signal());
    controller.onFinish();
    state.available = false;
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(controller.pending).toBe(false);
    controller.dispose();
  });

  it("continues another bounded leg when its signal arrives during an automatic request", async () => {
    const { controller, state, sendMessage } = setup();
    let finishFirst!: () => void;
    sendMessage.mockImplementationOnce(() => {
      state.status = "streaming";
      return new Promise<void>((resolve) => {
        finishFirst = resolve;
      });
    });
    controller.onData(signal("first"));
    controller.onFinish();
    await jest.advanceTimersByTimeAsync(500);
    controller.onData(signal("second"));
    controller.onFinish();
    state.status = "ready";
    finishFirst();
    await jest.advanceTimersByTimeAsync(500);
    expect(sendMessage).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
});
