import { act, renderHook } from "@testing-library/react";
import { DataStreamProvider } from "@/app/components/DataStreamProvider";
import { useAutoResume, type UseAutoResumeParams } from "../useAutoResume";
import type { ChatMessage } from "@/types/chat";

const message = {
  id: "u",
  role: "user",
  parts: [{ type: "text", text: "Build" }],
} as ChatMessage;
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DataStreamProvider>{children}</DataStreamProvider>
);
const params = (
  overrides: Partial<UseAutoResumeParams> = {},
): UseAutoResumeParams => ({
  autoResume: true,
  initialMessages: [message],
  hasActiveStream: true,
  status: "streaming",
  resumeStream: jest.fn().mockResolvedValue(undefined),
  setMessages: jest.fn(),
  ...overrides,
});
const online = () => window.dispatchEvent(new Event("online"));
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

afterEach(() => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  jest.useRealTimers();
});

it("settles the old reader before one reconnect, including a locally started home chat", async () => {
  const stopReader = jest.fn().mockResolvedValue(undefined);
  const resumeStream = jest.fn(() => new Promise<void>(() => {}));
  const p = params({
    autoResume: false,
    initialMessages: [],
    stopReader,
    resumeStream,
  });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  act(() => {
    online();
    online();
  });
  expect(stopReader).toHaveBeenCalledTimes(1);
  await flush();
  expect(resumeStream).not.toHaveBeenCalled();
  rerender({ ...p, status: "ready" });
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(1);
  act(() => {
    online();
    online();
  });
  expect(resumeStream).toHaveBeenCalledTimes(1);
});

it("does not revive an explicitly stopped run on mount or network return", async () => {
  const p = params({
    status: "ready",
    hasManuallyStoppedRef: { current: true },
  });
  renderHook(() => useAutoResume(p), { wrapper });
  act(online);
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
});

it("waits offline and coalesces wake events while a resume is unresolved", async () => {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  const resumeStream = jest.fn(() => new Promise<void>(() => {}));
  renderHook(() => useAutoResume(params({ status: "ready", resumeStream })), {
    wrapper,
  });
  expect(resumeStream).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(() => {
    online();
    online();
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(1);
});

it("releases a dead reader when the worker finished offline without starting another run", async () => {
  const stopReader = jest.fn();
  const p = params({ hasActiveStream: false, stopReader });
  const { rerender, result } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  act(online);
  expect(stopReader).toHaveBeenCalledTimes(1);
  rerender({ ...p, status: "ready" });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
  expect(result.current).toBe(false);
});

it("cancels pending recovery when the user stops or submits another message", async () => {
  const stopped = { current: false };
  const p = params({ stopReader: jest.fn(), hasManuallyStoppedRef: stopped });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  act(online);
  stopped.current = true;
  rerender({ ...p, status: "ready" });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
  stopped.current = false;
  rerender(p);
  act(online);
  rerender({ ...p, status: "submitted" });
  rerender({ ...p, status: "ready" });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
});

it("does not attach after unmount while waiting for the old reader", async () => {
  const p = params({ stopReader: jest.fn() });
  const { unmount } = renderHook(() => useAutoResume(p), { wrapper });
  act(online);
  unmount();
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
});

it("waits for an existing resume promise to settle as well as the SDK idle status", async () => {
  let finishFirst!: () => void;
  const resumeStream = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishFirst = resolve;
        }),
    )
    .mockResolvedValue(undefined);
  const p = params({ status: "ready", resumeStream, stopReader: jest.fn() });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  rerender({ ...p, status: "streaming" });
  // A real long sleep, outside the burst coalescing window.
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 25_000);
  act(online);
  rerender(p);
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(1);
  await act(async () => finishFirst());
  expect(resumeStream).toHaveBeenCalledTimes(2);
  now.mockRestore();
});

it("resumes deferred recovery on visibility return after the old reader settled while hidden", async () => {
  const p = params({ stopReader: jest.fn() });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  act(online);
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "hidden",
  });
  rerender({ ...p, status: "ready" });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await flush();
  expect(p.resumeStream).toHaveBeenCalledTimes(1);
});

it("recovers a lost acknowledgement once only when a durable producer is confirmed", async () => {
  const resumeStream = jest.fn().mockResolvedValue(undefined);
  const p = params({ autoResume: false, status: "submitted", resumeStream });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  rerender({ ...p, status: "error", error: new TypeError("Failed to fetch") });
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(1);
  rerender({
    ...p,
    status: "error",
    error: new TypeError("Failed to fetch again"),
  });
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(1);
});

it("does not automatically retry a real run failure or an unconfirmed producer", async () => {
  const p = params({ autoResume: false, status: "submitted" });
  const { rerender } = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  rerender({
    ...p,
    status: "error",
    error: new Error("Provider rejected the request"),
  });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
  rerender({
    ...p,
    status: "error",
    hasActiveStream: false,
    error: new TypeError("Failed to fetch"),
  });
  await flush();
  expect(p.resumeStream).not.toHaveBeenCalled();
});

it("cancels a delayed reconnect on explicit stop and does not replay a finished response", async () => {
  jest.useFakeTimers();
  const stopped = { current: false };
  const resumeStream = jest
    .fn()
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const p = params({ resumeStream, hasManuallyStoppedRef: stopped });
  const view = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  view.rerender({
    ...p,
    status: "error",
    error: new TypeError("Failed to fetch"),
  });
  await flush();
  stopped.current = true;
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(resumeStream).toHaveBeenCalledTimes(1);
  view.unmount();

  stopped.current = false;
  const second = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  second.rerender({
    ...p,
    status: "error",
    error: new TypeError("Failed to fetch"),
  });
  await flush();
  second.rerender({ ...p, status: "ready" });
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(resumeStream).toHaveBeenCalledTimes(2);
  second.unmount();
});

it("pauses retry traffic while offline and resumes the same producer on return", async () => {
  jest.useFakeTimers();
  const resumeStream = jest
    .fn()
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const p = params({ resumeStream });
  const view = renderHook((value) => useAutoResume(value), {
    initialProps: p,
    wrapper,
  });
  view.rerender({
    ...p,
    status: "error",
    error: new TypeError("Failed to fetch"),
  });
  await flush();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: false,
  });
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(resumeStream).toHaveBeenCalledTimes(1);
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    value: true,
  });
  act(online);
  await flush();
  expect(resumeStream).toHaveBeenCalledTimes(2);
  view.unmount();
});
