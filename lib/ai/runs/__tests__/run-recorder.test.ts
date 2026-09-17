const mutation = jest.fn(async () => null);

jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: () => ({ mutation }),
}));
jest.mock("@/convex/_generated/api", () => ({
  api: {
    runs: {
      startRun: "runs.startRun",
      finishRun: "runs.finishRun",
      appendRunEvent: "runs.appendRunEvent",
      appendRunEvents: "runs.appendRunEvents",
      recordEvidence: "runs.recordEvidence",
    },
  },
}));

import {
  createRunRecorder,
  startRunRecord,
  finishRunRecord,
} from "../run-recorder";

const base = { runId: "run-1", chatId: "chat-1", userId: "user-1" };

describe("run recorder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("remembers the most recent terminal command for finding attribution", () => {
    const recorder = createRunRecorder(base);

    recorder.recordTerminalCommand({ toolCallId: "a", command: "first" });
    recorder.recordTerminalCommand({ toolCallId: "b", command: "second" });

    expect(recorder.lastTerminalCommand()).toMatchObject({ command: "second" });
  });

  it("bounds how many commands it holds so a long run cannot grow without limit", () => {
    const recorder = createRunRecorder(base);
    for (let index = 0; index < 50; index += 1) {
      recorder.recordTerminalCommand({
        toolCallId: `c${index}`,
        command: `cmd ${index}`,
      });
    }
    expect(recorder.lastTerminalCommand()).toMatchObject({ command: "cmd 49" });
  });

  it("writes a finding with the command output that proves it", async () => {
    const recorder = createRunRecorder(base);
    recorder.recordTerminalCommand({
      toolCallId: "call-1",
      command: "curl -I https://target",
      exitCode: 0,
      output: "HTTP/1.1 200 OK",
    });

    await recorder.recordFinding({
      title: "Missing HSTS",
      severity: "medium",
      target: "https://target",
    });

    expect(mutation).toHaveBeenCalledWith(
      "runs.recordEvidence",
      expect.objectContaining({
        kind: "finding",
        toolCallId: "call-1",
        command: "curl -I https://target",
        event: expect.objectContaining({
          type: "finding",
          severity: "medium",
          summary: "[medium] Missing HSTS @ https://target",
        }),
      }),
    );
    const payload = mutation.mock.calls[0][1] as { content: string };
    expect(payload.content).toContain(
      "proven-by-command: curl -I https://target",
    );
    expect(payload.content).toContain("HTTP/1.1 200 OK");
  });

  it("never throws when the database write fails", async () => {
    // A run is a record OF the work, never a precondition FOR it. A failed
    // write must cost a log line, not the user's request.
    mutation.mockRejectedValueOnce(new Error("convex down"));
    const recorder = createRunRecorder(base);

    await expect(
      recorder.recordFinding({ title: "x", severity: "low" }),
    ).resolves.toBeUndefined();

    mutation.mockRejectedValueOnce(new Error("convex down"));
    await expect(
      recorder.appendEvent({ type: "terminal_command" }),
    ).resolves.toBeUndefined();
  });

  it("returns no recorder when the run cannot be opened", async () => {
    mutation.mockRejectedValueOnce(new Error("convex down"));
    await expect(startRunRecord(base)).resolves.toBeUndefined();
  });

  it("opens and closes a run with its outcome", async () => {
    const recorder = await startRunRecord({ ...base, mode: "agent" });
    expect(recorder?.runId).toBe("run-1");
    expect(mutation).toHaveBeenCalledWith(
      "runs.startRun",
      expect.objectContaining({ runId: "run-1", mode: "agent" }),
    );

    await finishRunRecord({
      runId: "run-1",
      status: "cancelled",
      stopReason: "user",
    });
    expect(mutation).toHaveBeenCalledWith(
      "runs.finishRun",
      expect.objectContaining({ status: "cancelled", stopReason: "user" }),
    );
  });

  it("swallows a failed close", async () => {
    mutation.mockRejectedValueOnce(new Error("convex down"));
    await expect(
      finishRunRecord({ runId: "run-1", status: "completed" }),
    ).resolves.toBeUndefined();
  });
});

describe("run recorder event batching", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const batchCalls = () =>
    mutation.mock.calls.filter(([name]) => name === "runs.appendRunEvents");

  const batchEvents = () =>
    batchCalls().flatMap(
      ([, payload]) => (payload as { events: Array<{ type: string }> }).events,
    );

  it("holds a small batch until the timer fires, then writes it once in order", () => {
    const recorder = createRunRecorder(base);

    recorder.queueEvent({ type: "step", stepIndex: 0, inputTokens: 10 });
    recorder.queueEvent({ type: "tool_call", toolName: "bash", stepIndex: 0 });
    recorder.queueEvent({ type: "step", stepIndex: 1, status: "error" });

    // Below the count threshold and before the timer: nothing has gone out.
    expect(mutation).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_999);
    expect(mutation).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);

    expect(batchCalls()).toHaveLength(1);
    expect(mutation).toHaveBeenCalledWith(
      "runs.appendRunEvents",
      expect.objectContaining({
        runId: "run-1",
        chatId: "chat-1",
        userId: "user-1",
        events: [
          expect.objectContaining({
            type: "step",
            stepIndex: 0,
            inputTokens: 10,
          }),
          expect.objectContaining({
            type: "tool_call",
            toolName: "bash",
            stepIndex: 0,
          }),
          expect.objectContaining({
            type: "step",
            stepIndex: 1,
            status: "error",
          }),
        ],
      }),
    );
  });

  it("flushes immediately once 25 events are queued", () => {
    const recorder = createRunRecorder(base);

    for (let index = 0; index < 24; index += 1) {
      recorder.queueEvent({ type: "step", stepIndex: index });
    }
    expect(mutation).not.toHaveBeenCalled();

    recorder.queueEvent({ type: "step", stepIndex: 24 });

    expect(batchCalls()).toHaveLength(1);
    const events = batchEvents();
    expect(events).toHaveLength(25);
    expect(events.map((event: any) => event.stepIndex)).toEqual(
      Array.from({ length: 25 }, (_, index) => index),
    );

    // The count-triggered flush cleared the timer; nothing more goes out later.
    jest.advanceTimersByTime(5_000);
    expect(batchCalls()).toHaveLength(1);
  });

  it("flush() with nothing queued writes nothing", async () => {
    const recorder = createRunRecorder(base);

    await recorder.flush();

    expect(mutation).not.toHaveBeenCalled();
  });

  it("flush() cancels the pending timer so the batch is not written twice", async () => {
    const recorder = createRunRecorder(base);

    recorder.queueEvent({ type: "step", stepIndex: 0 });
    await recorder.flush();

    expect(batchCalls()).toHaveLength(1);
    expect(batchEvents()).toHaveLength(1);

    jest.advanceTimersByTime(5_000);
    expect(batchCalls()).toHaveLength(1);
  });

  it("caps a run at 300 events plus one events_capped marker and then drops the rest", async () => {
    const recorder = createRunRecorder(base);

    for (let index = 0; index < 301; index += 1) {
      recorder.queueEvent({ type: "step", stepIndex: index });
    }
    // Event 301 crossed the cap: the marker is queued but only lands on flush.
    await recorder.flush();

    const events = batchEvents();
    const real = events.filter((event) => event.type !== "events_capped");
    const capped = events.filter((event) => event.type === "events_capped");

    expect(real).toHaveLength(300);
    expect(real.map((event: any) => event.stepIndex)).toEqual(
      Array.from({ length: 300 }, (_, index) => index),
    );
    expect(capped).toHaveLength(1);
    expect(capped[0]).toMatchObject({
      summary: expect.stringContaining("300"),
    });
    // The marker is the last thing written.
    expect(events[events.length - 1].type).toBe("events_capped");

    // Past the cap, queueing is a no-op: no second marker, no extra rows.
    const callsBefore = batchCalls().length;
    for (let index = 0; index < 50; index += 1) {
      recorder.queueEvent({ type: "step", stepIndex: 400 + index });
    }
    jest.advanceTimersByTime(5_000);
    await recorder.flush();
    expect(batchCalls()).toHaveLength(callsBefore);
    expect(batchEvents()).toHaveLength(301);
  });

  it("swallows a rejected batch write and logs a warning", async () => {
    mutation.mockRejectedValueOnce(new Error("convex down"));
    const recorder = createRunRecorder(base);

    recorder.queueEvent({ type: "step", stepIndex: 0 });

    await expect(recorder.flush()).resolves.toBeUndefined();

    expect(console.warn).toHaveBeenCalledTimes(1);
    const line = (console.warn as jest.Mock).mock.calls[0][0] as string;
    expect(JSON.parse(line)).toMatchObject({
      level: "warn",
      event: "run_events_flush_failed",
      service: "run-recorder",
      run_id: "run-1",
      error: "convex down",
    });
  });

  it("does not let a failed timer flush throw out of the timer", async () => {
    mutation.mockRejectedValueOnce(new Error("convex down"));
    const recorder = createRunRecorder(base);

    recorder.queueEvent({ type: "step", stepIndex: 0 });
    expect(() => jest.advanceTimersByTime(2_000)).not.toThrow();
    // Let the rejected promise settle inside the swallowed catch.
    await Promise.resolve();
    await Promise.resolve();

    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

describe("finishRunRecord telemetry passthrough", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("forwards model, metrics and promptHash to finishRun", async () => {
    const metrics = { steps: 4, tool_calls: 2, wall_ms: 1234 };

    await finishRunRecord({
      runId: "run-1",
      status: "completed",
      finishReason: "stop",
      costDollars: 0.12,
      totalTokens: 999,
      outputCount: 1,
      model: "x-ai/grok-4.3",
      metrics,
      promptHash: "sha256:prompt",
    });

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      "runs.finishRun",
      expect.objectContaining({
        runId: "run-1",
        status: "completed",
        finishReason: "stop",
        costDollars: 0.12,
        totalTokens: 999,
        outputCount: 1,
        model: "x-ai/grok-4.3",
        metrics,
        promptHash: "sha256:prompt",
      }),
    );
  });
});
