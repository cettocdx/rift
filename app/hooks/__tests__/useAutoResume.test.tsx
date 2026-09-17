import React from "react";
import {
  act,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";

import {
  DataStreamProvider,
  useDataStreamState,
} from "@/app/components/DataStreamProvider";
import type { ChatMessage } from "@/types/chat";
import { useAutoResume, type UseAutoResumeParams } from "../useAutoResume";

const persistedUserMessage = {
  id: "user_1",
  role: "user",
  parts: [{ type: "text", text: "Continue the build" }],
} as ChatMessage;

function wrapper({ children }: { children: React.ReactNode }) {
  return <DataStreamProvider>{children}</DataStreamProvider>;
}

function useHarness(params: UseAutoResumeParams) {
  useAutoResume(params);
  return useDataStreamState();
}

function AutoResumeHarness({ params }: { params: UseAutoResumeParams }) {
  useAutoResume(params);
  return null;
}

function AutoResumeState() {
  const { isAutoResuming } = useDataStreamState();
  return <span data-testid="auto-resume-state">{String(isAutoResuming)}</span>;
}

function NavigationHarness({
  chatKey,
  params,
}: {
  chatKey: string;
  params: UseAutoResumeParams;
}) {
  return (
    <DataStreamProvider>
      <AutoResumeHarness key={chatKey} params={params} />
      <AutoResumeState />
    </DataStreamProvider>
  );
}

const buildParams = (
  overrides: Partial<UseAutoResumeParams> = {},
): UseAutoResumeParams => ({
  autoResume: true,
  initialMessages: [persistedUserMessage],
  resumeStream: jest.fn().mockResolvedValue(undefined),
  setMessages: jest.fn(),
  status: "ready",
  hasActiveStream: true,
  ...overrides,
});

describe("useAutoResume", () => {
  it("leaves a retained reconnect reader alive when its chat route unmounts", async () => {
    const stopReader = jest.fn();
    const resumeStream = jest.fn(() => new Promise<void>(() => {}));
    const { unmount } = renderHook(
      () =>
        useHarness(
          buildParams({
            resumeStream,
            stopReader,
            preserveReaderOnUnmount: true,
          }),
        ),
      { wrapper },
    );
    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1));
    unmount();
    expect(stopReader).not.toHaveBeenCalled();
  });

  it("does not reconnect an unanswered turn when the server has no active producer", () => {
    const resumeStream = jest.fn().mockResolvedValue(undefined);
    renderHook(
      () => useHarness(buildParams({ resumeStream, hasActiveStream: false })),
      { wrapper },
    );

    expect(resumeStream).not.toHaveBeenCalled();
  });

  it("clears the recovery state when a 204/empty reconnect settles", async () => {
    let resolveResume!: () => void;
    const resumeStream = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveResume = resolve;
        }),
    );
    const { result } = renderHook(
      () => useHarness(buildParams({ resumeStream })),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isAutoResuming).toBe(true));

    await act(async () => resolveResume());

    await waitFor(() => expect(result.current.isAutoResuming).toBe(false));
  });

  it("observes reconnect rejection and clears the recovery state", async () => {
    const resumeStream = jest
      .fn()
      .mockRejectedValue(new Error("resume failed"));
    const { result } = renderHook(
      () => useHarness(buildParams({ resumeStream })),
      { wrapper },
    );

    await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isAutoResuming).toBe(false));
  });

  it("clears the reconnect label when the first live stream part arrives", async () => {
    const resumeStream = jest.fn(() => new Promise<void>(() => {}));
    const { result, rerender } = renderHook(
      ({ status }) => useHarness(buildParams({ resumeStream, status })),
      {
        initialProps: { status: "ready" as const },
        wrapper,
      },
    );

    await waitFor(() => expect(result.current.isAutoResuming).toBe(true));

    rerender({ status: "streaming" as const });

    await waitFor(() => expect(result.current.isAutoResuming).toBe(false));
  });

  it("ignores completion from a previous chat after navigation", async () => {
    let resolveOldResume!: () => void;
    let resolveNewResume!: () => void;
    const oldResumeStream = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveOldResume = resolve;
        }),
    );
    const newResumeStream = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveNewResume = resolve;
        }),
    );

    const view = render(
      <NavigationHarness
        chatKey="old-chat"
        params={buildParams({ resumeStream: oldResumeStream })}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("true"),
    );

    view.rerender(
      <NavigationHarness
        chatKey="new-chat"
        params={buildParams({ resumeStream: newResumeStream })}
      />,
    );
    await waitFor(() => expect(newResumeStream).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("true"),
    );

    await act(async () => resolveOldResume());
    expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("true");

    await act(async () => resolveNewResume());
    await waitFor(() =>
      expect(screen.getByTestId("auto-resume-state")).toHaveTextContent(
        "false",
      ),
    );
  });
});

/*
 * "Connecting" must not outlive the connection.
 *
 * Reattaching to a run that is mid-tool-call produces no output until that tool
 * returns — a build can take minutes — and the only early clear was a stream
 * part. The producer heartbeats every 25s, so the honest worst case was 25
 * seconds of a "Connecting" label sitting over a connection that had already
 * succeeded, and a missing heartbeat left nothing to clear it at all.
 */
describe("useAutoResume — the reconnect label expires", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  const params = (): UseAutoResumeParams => ({
    autoResume: true,
    initialMessages: [persistedUserMessage],
    // Reconnect starts from an idle client; the server is busy in a tool call.
    resumeStream: jest.fn(() => new Promise<void>(() => {})),
    setMessages: jest.fn(),
    status: "ready",
    hasActiveStream: true,
  });

  it("clears itself when the run is connected but silent", () => {
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={params()} />
        <AutoResumeState />
      </DataStreamProvider>,
    );

    expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("true");

    act(() => {
      jest.advanceTimersByTime(6_000);
    });

    expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("false");
  });

  it("expires before the producer's 25s heartbeat, not after it", () => {
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={params()} />
        <AutoResumeState />
      </DataStreamProvider>,
    );

    act(() => {
      jest.advanceTimersByTime(24_000);
    });

    // Already cleared long before a heartbeat would have done it.
    expect(screen.getByTestId("auto-resume-state")).toHaveTextContent("false");
  });
});

/*
 * The page comes back; the stream it left does not.
 *
 * A phone sent to the home screen, a locked screen, a background tab: the OS
 * freezes the page and tears down its connections. The run keeps going on the
 * worker; the page wakes holding a dead stream, and until now nothing told it.
 */
describe("useAutoResume — reattaches when the page becomes visible again", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => state,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };

  afterEach(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  const params = (
    over: Partial<UseAutoResumeParams> = {},
  ): UseAutoResumeParams => ({
    autoResume: true,
    initialMessages: [persistedUserMessage],
    resumeStream: jest.fn().mockResolvedValue(undefined),
    setMessages: jest.fn(),
    status: "ready",
    // The server still has a run for this chat.
    hasActiveStream: true,
    ...over,
  });

  it("reconnects on return when the client is not streaming but the server is", async () => {
    const p = params();
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={p} />
      </DataStreamProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    // Mount-time auto-resume fires once for the trailing user message.
    const callsAfterMount = (p.resumeStream as jest.Mock).mock.calls.length;

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));

    expect((p.resumeStream as jest.Mock).mock.calls.length).toBe(
      callsAfterMount + 1,
    );
  });

  it("leaves a healthy live stream alone after a brief tab switch", () => {
    const p = params({ status: "streaming" });
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={p} />
      </DataStreamProvider>,
    );
    const callsAfterMount = (p.resumeStream as jest.Mock).mock.calls.length;

    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));

    expect((p.resumeStream as jest.Mock).mock.calls.length).toBe(
      callsAfterMount,
    );
  });

  it("does nothing when the server has no run to offer", () => {
    const p = params({ hasActiveStream: false });
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={p} />
      </DataStreamProvider>,
    );
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(p.resumeStream).not.toHaveBeenCalled();
  });

  it("reconnects when the network comes back", async () => {
    const p = params();
    render(
      <DataStreamProvider>
        <AutoResumeHarness params={p} />
      </DataStreamProvider>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const callsAfterMount = (p.resumeStream as jest.Mock).mock.calls.length;
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect((p.resumeStream as jest.Mock).mock.calls.length).toBe(
      callsAfterMount + 1,
    );
  });
});

it("does not replay a locally completed new turn when persistence arrives before the active pointer clears", async () => {
  const resumeStream = jest.fn().mockResolvedValue(undefined);
  const params = buildParams({
    initialMessages: [],
    hasActiveStream: false,
    status: "ready",
    resumeStream,
  });
  const { rerender } = renderHook(
    (value: UseAutoResumeParams) => useHarness(value),
    { wrapper, initialProps: params },
  );
  rerender({ ...params, status: "submitted" });
  rerender({ ...params, status: "streaming", hasActiveStream: true });
  rerender({
    ...params,
    status: "ready",
    hasActiveStream: true,
    initialMessages: [
      persistedUserMessage,
      {
        id: "run_1",
        role: "assistant",
        parts: [{ type: "text", text: "Merhaba", state: "done" }],
      } as ChatMessage,
    ],
  });
  await act(async () => {});
  expect(resumeStream).not.toHaveBeenCalled();
});

describe("repeated transient disconnects", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("retries a failed attachment with backoff without needing another visibility event", async () => {
    const resumeStream = jest
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const params = buildParams({ status: "streaming", resumeStream });
    const view = renderHook((value: UseAutoResumeParams) => useHarness(value), {
      wrapper,
      initialProps: params,
    });
    view.rerender({
      ...params,
      status: "error",
      error: new TypeError("Failed to fetch"),
    });
    await act(async () => {});
    expect(resumeStream).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1_000);
    });
    expect(resumeStream).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(1_999);
    });
    expect(resumeStream).toHaveBeenCalledTimes(2);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(resumeStream).toHaveBeenCalledTimes(3);
    view.unmount();
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(resumeStream).toHaveBeenCalledTimes(3);
  });

  it("abandons queued recovery when the producer finishes or the user stops", async () => {
    const resumeStream = jest
      .fn()
      .mockRejectedValue(new TypeError("Failed to fetch"));
    const params = buildParams({ status: "streaming", resumeStream });
    const view = renderHook((value: UseAutoResumeParams) => useHarness(value), {
      wrapper,
      initialProps: params,
    });
    view.rerender({
      ...params,
      status: "error",
      error: new TypeError("Failed to fetch"),
    });
    await act(async () => {});
    view.rerender({ ...params, status: "ready", hasActiveStream: false });
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });
    expect(resumeStream).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});

it("reattaches to a confirmed producer before history has loaded", async () => {
  const resumeStream = jest.fn().mockResolvedValue(undefined);
  renderHook(
    () =>
      useHarness(
        buildParams({
          initialMessages: [],
          hasActiveStream: true,
          resumeStream,
        }),
      ),
    { wrapper },
  );
  await waitFor(() => expect(resumeStream).toHaveBeenCalledTimes(1));
});
