import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import React from "react";
import { renderHook, act } from "@testing-library/react";
import { useChat } from "@ai-sdk/react";
import type { UIMessageChunk } from "ai";
import { serialize, deserialize } from "node:v8";
import {
  DataStreamProvider,
  useDataStream,
} from "@/app/components/DataStreamProvider";
import {
  useAutoContinue,
  MAX_AUTO_CONTINUES,
  MAX_BUILD_TIME_LEGS,
} from "../useAutoContinue";
import type { UseAutoContinueParams } from "../useAutoContinue";

type DataStreamEntry = { type: string; data?: unknown };

function useTestHarness(params: UseAutoContinueParams) {
  const autoContinue = useAutoContinue(params);
  const { setDataStream, isAutoResuming, autoContinueCount } = useDataStream();
  return { ...autoContinue, setDataStream, isAutoResuming, autoContinueCount };
}

function createWrapper() {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(DataStreamProvider, null, children);
  };
}

function buildParams(
  overrides: Partial<UseAutoContinueParams> = {},
): UseAutoContinueParams {
  return {
    status: "ready",
    chatMode: "agent",
    chatPurpose: "app",
    sendMessage: jest.fn(),
    hasManuallyStoppedRef: { current: false },
    todos: [],
    temporaryChatsEnabled: false,
    sandboxPreference: "e2b",
    selectedModel: "auto",
    ...overrides,
  };
}

function pushAutoContinue(
  result: { current: ReturnType<typeof useTestHarness> },
  previous: DataStreamEntry[] = [],
): DataStreamEntry[] {
  const updated = [...previous, { type: "data-auto-continue", data: {} }];
  act(() => {
    result.current.setDataStream(updated as any);
  });
  return updated;
}

describe("useAutoContinue", () => {
  beforeAll(() => {
    if (!globalThis.structuredClone) {
      globalThis.structuredClone = (value) => deserialize(serialize(value));
    }
  });
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("does not start a second continuation engine when the retained session owns it", () => {
    const sendMessage = jest.fn();
    const { result } = renderHook(() => useTestHarness(buildParams({ enabled: false, sendMessage })), { wrapper: createWrapper() });
    pushAutoContinue(result);
    act(() => { jest.advanceTimersByTime(10_000); });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.isAutoResuming).toBe(false);
  });

  it("sets isAutoResuming to true when data-auto-continue arrives", () => {
    const params = buildParams({ status: "streaming" });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });

    expect(result.current.isAutoResuming).toBe(false);

    pushAutoContinue(result);

    expect(result.current.isAutoResuming).toBe(true);
  });

  it("sends message with full body when signal arrives during streaming then status becomes ready", () => {
    const sendMessage = jest.fn();
    const todos = [{ id: "1", content: "Test", status: "pending" as const }];
    let params = buildParams({
      status: "streaming",
      sendMessage,
      todos,
      temporaryChatsEnabled: true,
      sandboxPreference: "local-123",
      selectedModel: "sonnet-4.6",
    });

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    pushAutoContinue(result);

    params = { ...params, status: "ready" };
    rerender(params);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      { text: "continue", metadata: { isAutoContinue: true } },
      {
        body: {
          mode: "agent",
          purpose: "app",
          isAutoContinue: true,
          todos,
          temporary: true,
          sandboxPreference: "local-123",
          selectedModel: "sonnet-4.6",
        },
      },
    );
  });

  it("fires auto-continue when data-auto-continue arrives after status is already ready", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    params = { ...params, status: "ready" };
    rerender(params);

    pushAutoContinue(result);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(
      { text: "continue", metadata: { isAutoContinue: true } },
      {
        body: expect.objectContaining({
          isAutoContinue: true,
          mode: "agent",
        }),
      },
    );
  });

  it("does not auto-continue a time-limit signal outside Build", () => {
    const sendMessage = jest.fn();
    const params = buildParams({
      status: "ready",
      chatPurpose: "security",
      sendMessage,
    });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setDataStream([
        {
          type: "data-auto-continue",
          data: {
            shouldContinue: true,
            continuationId: "security_timeout_1",
            reason: "preemptive-timeout",
          },
        },
      ] as any);
      jest.advanceTimersByTime(500);
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.isAutoResuming).toBe(false);
  });

  it("deduplicates replayed continuation ids", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });
    const signal = {
      type: "data-auto-continue",
      data: {
        shouldContinue: true,
        continuationId: "build_leg_1",
        reason: "preemptive-timeout",
      },
    };
    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    act(() => result.current.setDataStream([signal] as any));
    params = { ...params, status: "ready" };
    rerender(params);
    act(() => jest.advanceTimersByTime(500));

    params = { ...params, status: "streaming" };
    rerender(params);
    act(() => result.current.setDataStream([signal, signal] as any));
    params = { ...params, status: "ready" };
    rerender(params);
    act(() => jest.advanceTimersByTime(500));

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not replay an old signal after resetting for a new user turn", () => {
    const sendMessage = jest.fn();
    const params = buildParams({ status: "ready", sendMessage });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.setDataStream([
        { type: "data-auto-continue", data: { shouldContinue: true } },
      ] as any);
    });
    act(() => jest.advanceTimersByTime(500));
    expect(sendMessage).toHaveBeenCalledTimes(1);

    act(() => result.current.resetAutoContinueCount());
    act(() => {
      result.current.setDataStream(
        (previous: any[]) =>
          [...previous, { type: "data-context-usage", data: {} }] as any,
      );
    });
    act(() => jest.advanceTimersByTime(500));

    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("lets a manual Stop win during the continuation hand-off", () => {
    const sendMessage = jest.fn();
    const hasManuallyStoppedRef = { current: false };
    const params = buildParams({
      status: "ready",
      sendMessage,
      hasManuallyStoppedRef,
    });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });

    pushAutoContinue(result);
    hasManuallyStoppedRef.current = true;
    act(() => jest.advanceTimersByTime(500));

    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.isAutoResuming).toBe(false);
  });

  it.each([
    {
      label: "chatMode is not agent",
      override: { chatMode: "ask" },
    },
    {
      label: "hasManuallyStoppedRef is true",
      override: { hasManuallyStoppedRef: { current: true } },
    },
  ])("does not fire auto-continue when $label", ({ override }) => {
    const sendMessage = jest.fn();
    let params = buildParams({
      status: "streaming",
      sendMessage,
      ...override,
    });

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    pushAutoContinue(result);

    params = { ...params, status: "ready" };
    rerender(params);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("stops firing after MAX_AUTO_CONTINUES and resets isAutoResuming", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });
    let stream: DataStreamEntry[] = [];

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    for (let i = 0; i < MAX_AUTO_CONTINUES; i++) {
      params = { ...params, status: "streaming" };
      rerender(params);

      stream = pushAutoContinue(result, stream);

      params = { ...params, status: "ready" };
      rerender(params);

      act(() => {
        jest.advanceTimersByTime(500);
      });
    }

    expect(sendMessage).toHaveBeenCalledTimes(MAX_AUTO_CONTINUES);

    params = { ...params, status: "streaming" };
    rerender(params);

    stream = pushAutoContinue(result, stream);

    params = { ...params, status: "ready" };
    rerender(params);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(sendMessage).toHaveBeenCalledTimes(MAX_AUTO_CONTINUES);
    expect(result.current.isAutoResuming).toBe(false);
  });

  it("lets Build timeout hand-offs pass the ordinary cap, but only MAX_BUILD_TIME_LEGS times", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });
    let stream: DataStreamEntry[] = [];

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    const legs = MAX_AUTO_CONTINUES + MAX_BUILD_TIME_LEGS + 2;
    for (let i = 0; i < legs; i++) {
      params = { ...params, status: "streaming" };
      rerender(params);

      stream = [
        ...stream,
        {
          type: "data-auto-continue",
          data: {
            shouldContinue: true,
            continuationId: `build_timeout_${i}`,
            reason: "preemptive-timeout",
          },
        },
      ];
      act(() => result.current.setDataStream(stream as any));

      params = { ...params, status: "ready" };
      rerender(params);
      act(() => jest.advanceTimersByTime(500));
    }

    // ordinary cap + three time legs, then it stops and waits for the user
    expect(sendMessage).toHaveBeenCalledTimes(
      MAX_AUTO_CONTINUES + MAX_BUILD_TIME_LEGS,
    );
    expect(result.current.autoContinueCount).toBe(
      MAX_AUTO_CONTINUES + MAX_BUILD_TIME_LEGS,
    );
    expect(result.current.isAutoResuming).toBe(false);
  });

  it("increments autoContinueCount in context after each auto-continue", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });
    let stream: DataStreamEntry[] = [];

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    expect(result.current.autoContinueCount).toBe(0);

    for (let i = 1; i <= 3; i++) {
      params = { ...params, status: "streaming" };
      rerender(params);

      stream = pushAutoContinue(result, stream);

      params = { ...params, status: "ready" };
      rerender(params);

      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(result.current.autoContinueCount).toBe(i);
    }
  });

  it("resets autoContinueCount to 0 via resetAutoContinueCount", () => {
    const sendMessage = jest.fn();
    let params = buildParams({ status: "streaming", sendMessage });

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    pushAutoContinue(result);

    params = { ...params, status: "ready" };
    rerender(params);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    expect(result.current.autoContinueCount).toBe(1);

    act(() => {
      result.current.resetAutoContinueCount();
    });

    expect(result.current.autoContinueCount).toBe(0);
  });

  it("resets isAutoResuming to false when status transitions to streaming", () => {
    let params = buildParams({ status: "streaming" });

    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      { initialProps: params, wrapper: createWrapper() },
    );

    pushAutoContinue(result);
    expect(result.current.isAutoResuming).toBe(true);

    params = { ...params, status: "ready" };
    rerender(params);

    act(() => {
      jest.advanceTimersByTime(500);
    });

    params = { ...params, status: "streaming" };
    rerender(params);

    expect(result.current.isAutoResuming).toBe(false);
  });

  it("retries SDK-resolved run_active errors without adding another hidden user message", async () => {
    const request = jest
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("Previous run is settling"), {
          statusCode: 409,
          code: "run_active",
        }),
      )
      .mockImplementation(() =>
        Promise.resolve(
          new ReadableStream<UIMessageChunk>({
            start(controller) {
              controller.enqueue({
                type: "start",
                messageId: "continued-answer",
              });
              controller.enqueue({ type: "finish" });
              controller.close();
            },
          }),
        ),
      );
    const transport = {
      sendMessages: request,
      reconnectToStream: async () => null,
    };
    const params = buildParams();
    const { result } = renderHook(
      () => {
        const chat = useChat({ id: "continuation-race", transport });
        const state = useTestHarness({
          ...params,
          status: chat.status,
          error: chat.error,
          sendMessage: chat.sendMessage,
        });
        return {
          ...state,
          messages: chat.messages,
          status: chat.status,
          sdkError: chat.error,
        };
      },
      { wrapper: createWrapper() },
    );

    const signals = pushAutoContinue(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(result.current.status).toBe("error");
    expect(result.current.sdkError).toMatchObject({ code: "run_active" });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });

    expect(request).toHaveBeenCalledTimes(2);
    expect(result.current.sdkError).toBeUndefined();
    expect(result.current.status).toBe("ready");
    expect(
      result.current.messages.filter((message) => message.role === "user"),
    ).toHaveLength(1);
    expect(result.current.autoContinueCount).toBe(1);

    pushAutoContinue(result, signals);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    expect(request).toHaveBeenCalledTimes(3);
    expect(result.current.autoContinueCount).toBe(2);
  });

  it("preserves the continuation body and count across a retry", async () => {
    const busy = Object.assign(new Error("Still active"), {
      statusCode: 409,
      code: "run_active",
    });
    const sendMessage = jest
      .fn()
      .mockRejectedValueOnce(busy)
      .mockResolvedValue(undefined);
    const params = buildParams({
      sendMessage,
      selectedModel: "original-model",
    });
    const { result, rerender } = renderHook(
      (p: UseAutoContinueParams) => useTestHarness(p),
      {
        initialProps: params,
        wrapper: createWrapper(),
      },
    );
    pushAutoContinue(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    rerender({
      ...params,
      selectedModel: "new-selection",
      todos: [{ id: "new", content: "Unrelated", status: "pending" }],
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(1000);
    });
    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(sendMessage.mock.calls[1]).toEqual([
      undefined,
      sendMessage.mock.calls[0][1],
    ]);
    expect(sendMessage.mock.calls[1][1].body.selectedModel).toBe(
      "original-model",
    );
    expect(result.current.autoContinueCount).toBe(1);
  });

  it("bounds a busy run to three retries without consuming additional continuations", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const sendMessage = jest
      .fn()
      .mockImplementation(() =>
        Promise.reject(
          Object.assign(new Error("Still active"), {
            statusCode: 409,
            code: "run_active",
          }),
        ),
      );
    const params = buildParams({ sendMessage });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });
    pushAutoContinue(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20000);
    });
    expect(sendMessage).toHaveBeenCalledTimes(4);
    expect(result.current.autoContinueCount).toBe(1);
    expect(result.current.isAutoResuming).toBe(false);
    jest.restoreAllMocks();
  });

  it.each([
    Object.assign(new Error("Ambiguous server failure"), {
      statusCode: 500,
      code: "run_active",
    }),
    Object.assign(new Error("Different conflict"), {
      statusCode: 409,
      code: "other_conflict",
    }),
    new Error("run_active"),
  ])("never retries an unconfirmed busy response: %s", async (error) => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    const sendMessage = jest.fn().mockRejectedValue(error);
    const params = buildParams({ sendMessage });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });
    pushAutoContinue(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(20000);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result.current.isAutoResuming).toBe(false);
    jest.restoreAllMocks();
  });

  it.each(["stop", "reset", "unmount", "mode change"])(
    "cancels a scheduled busy retry after %s",
    async (action) => {
      const stopped = { current: false };
      const sendMessage = jest.fn().mockRejectedValue(
        Object.assign(new Error("Still active"), {
          statusCode: 409,
          code: "run_active",
        }),
      );
      const params = buildParams({
        sendMessage,
        hasManuallyStoppedRef: stopped,
      });
      const { result, rerender, unmount } = renderHook(
        (p: UseAutoContinueParams) => useTestHarness(p),
        {
          initialProps: params,
          wrapper: createWrapper(),
        },
      );
      pushAutoContinue(result);
      await act(async () => {
        await jest.advanceTimersByTimeAsync(500);
      });
      expect(result.current.isAutoResuming).toBe(true);
      if (action === "stop") stopped.current = true;
      if (action === "reset")
        act(() => result.current.resetAutoContinueCount());
      if (action === "unmount") unmount();
      if (action === "mode change") rerender({ ...params, chatMode: "ask" });
      await act(async () => {
        await jest.advanceTimersByTimeAsync(20000);
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores a rejected send promise that settles after unmount", async () => {
    let rejectSend: (error: Error) => void = () => {};
    const sendMessage = jest.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        }),
    );
    const params = buildParams({ sendMessage });
    const { result, unmount } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });
    pushAutoContinue(result);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(500);
    });
    unmount();
    await act(async () => {
      rejectSend(
        Object.assign(new Error("Still active"), {
          statusCode: 409,
          code: "run_active",
        }),
      );
      await jest.advanceTimersByTimeAsync(20000);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not lose a scheduled continuation when another data part arrives", () => {
    const sendMessage = jest.fn();
    const params = buildParams({ sendMessage });
    const { result } = renderHook(() => useTestHarness(params), {
      wrapper: createWrapper(),
    });
    const signal = pushAutoContinue(result);
    act(() =>
      result.current.setDataStream([
        ...signal,
        { type: "data-context-usage", data: {} },
      ] as any),
    );
    act(() => jest.advanceTimersByTime(500));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result.current.autoContinueCount).toBe(1);
  });
});
