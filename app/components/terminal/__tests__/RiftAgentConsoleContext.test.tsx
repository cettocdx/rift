import { StrictMode, useLayoutEffect } from "react";
import { act, render } from "@testing-library/react";
import {
  RiftAgentConsoleProvider,
  useOptionalRiftAgentConsole,
  usePublishRiftAgentConsole,
  type RiftAgentConsole,
  type RiftAgentConsoleSnapshot,
} from "../RiftAgentConsoleContext";

let observed: RiftAgentConsole | null = null;
const initial: RiftAgentConsoleSnapshot = {
  chatId: "chat-a",
  messages: [
    { id: "user-a", role: "user", parts: [{ type: "text", text: "Build" }] },
  ],
  status: "ready",
};
const submit = jest.fn<Promise<boolean>, [string, () => boolean]>();
const stop = jest.fn<Promise<void>, []>();

function Publisher({
  snapshot,
}: {
  snapshot: RiftAgentConsoleSnapshot | null;
}) {
  usePublishRiftAgentConsole(snapshot, { submit, stop });
  return null;
}

function Consumer() {
  const controller = useOptionalRiftAgentConsole();
  useLayoutEffect(() => {
    observed = controller;
  }, [controller]);
  return null;
}

function Fixture({
  route = "/c/chat-a",
  snapshot = initial,
  mounted = true,
}: {
  route?: string;
  snapshot?: RiftAgentConsoleSnapshot | null;
  mounted?: boolean;
}) {
  return (
    <RiftAgentConsoleProvider routeKey={route}>
      {mounted && <Publisher snapshot={snapshot} />}
      <Consumer />
    </RiftAgentConsoleProvider>
  );
}

beforeEach(() => {
  observed = null;
  submit.mockReset().mockResolvedValue(true);
  stop.mockReset().mockResolvedValue(undefined);
});

it("is unavailable outside a provider or without a mounted chat", () => {
  const { unmount } = render(<Consumer />);
  expect(observed).toBeNull();
  unmount();
  render(<Fixture mounted={false} />);
  expect(observed).toBeNull();
});

it("mirrors the real messages and status and uses the current chat actions", async () => {
  const { rerender } = render(<Fixture />);
  expect(observed?.snapshot.messages).toBe(initial.messages);
  const messages = [
    ...initial.messages,
    {
      id: "assistant-a",
      role: "assistant" as const,
      parts: [{ type: "text" as const, text: "Working" }],
    },
  ];
  rerender(
    <Fixture snapshot={{ ...initial, messages, status: "streaming" }} />,
  );
  expect(observed?.snapshot).toEqual({
    ...initial,
    messages,
    status: "streaming",
  });
  await act(async () => {
    expect(await observed!.submit("Continue")).toBe(true);
    await observed!.stop();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(submit.mock.calls[0][0]).toBe("Continue");
  expect(submit.mock.calls[0][1]()).toBe(true);
  expect(stop).toHaveBeenCalledTimes(1);
});

it("rejects duplicate dispatch while preflight is pending and releases the lock", async () => {
  let accept!: (accepted: boolean) => void;
  submit.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        accept = resolve;
      }),
  );
  render(<Fixture />);
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = observed!.submit("Build");
    expect(await observed!.submit("Build")).toBe(false);
    expect(await observed!.submit("   ")).toBe(false);
  });
  expect(submit).toHaveBeenCalledTimes(1);
  await act(async () => {
    accept(true);
    expect(await pending).toBe(true);
    expect(await observed!.submit("Next task")).toBe(true);
  });
});

it("invalidates captured actions and async preflight when the route changes", async () => {
  let release!: () => void;
  submit.mockImplementationOnce(async (_text, isCurrent) => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return isCurrent();
  });
  const { rerender } = render(<Fixture />);
  const stale = observed!;
  let pending!: Promise<boolean>;
  act(() => {
    pending = stale.submit("Old task");
  });
  rerender(<Fixture route="/plugins" mounted={false} />);
  expect(observed).toBeNull();
  await act(async () => {
    release();
    expect(await pending).toBe(false);
    expect(await stale.submit("Another old task")).toBe(false);
    await stale.stop();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(stop).not.toHaveBeenCalled();
});

it("clears a chat binding before another chat can receive its captured actions", async () => {
  const { rerender } = render(<Fixture />);
  const stale = observed!;
  rerender(<Fixture snapshot={{ ...initial, chatId: "chat-b" }} />);
  expect(observed?.snapshot.chatId).toBe("chat-b");
  await act(async () => {
    expect(await stale.submit("Wrong chat")).toBe(false);
    await stale.stop();
    expect(await observed!.submit("Right chat")).toBe(true);
  });
  expect(submit.mock.calls.map(([text]) => text)).toEqual(["Right chat"]);
  expect(stop).not.toHaveBeenCalled();
  rerender(<Fixture snapshot={null} />);
  expect(observed).toBeNull();
});

it("stays usable after StrictMode registration cleanup and returns false on rejection", async () => {
  render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
  submit.mockRejectedValueOnce(new Error("Preflight failed"));
  await act(async () => {
    expect(await observed!.submit("First")).toBe(false);
    expect(await observed!.submit("Retry")).toBe(true);
  });
  expect(submit).toHaveBeenCalledTimes(2);
});
