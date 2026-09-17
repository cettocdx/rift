import { StrictMode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ChatInit, ChatTransport, UIMessageChunk } from "ai";
import { RetainedChatProvider } from "@/app/contexts/RetainedChatContext";
import type { ChatMessage } from "@/types/chat";
import {
  useRetainedChat,
  useRetainedChatMessageCount,
  type RetainedChatHelpers,
} from "../useRetainedChat";

beforeAll(() => {
  if (typeof globalThis.structuredClone !== "function") {
    Object.defineProperty(globalThis, "structuredClone", {
      configurable: true,
      value: <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T,
    });
  }
});

function controlledTransport() {
  const controllers: ReadableStreamDefaultController<UIMessageChunk>[] = [];
  const signals: (AbortSignal | undefined)[] = [];
  const transport = {
    sendMessages: jest.fn(
      async ({
        abortSignal,
      }: Parameters<ChatTransport<ChatMessage>["sendMessages"]>[0]) => {
        signals.push(abortSignal);
        return new ReadableStream<UIMessageChunk>({
          start(controller) {
            controllers.push(controller);
            abortSignal?.addEventListener(
              "abort",
              () => controller.error(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          },
        });
      },
    ),
    reconnectToStream: jest.fn(async () => null),
  } satisfies ChatTransport<ChatMessage>;
  return { transport, controllers, signals };
}

function start(
  controller: ReadableStreamDefaultController<UIMessageChunk>,
  text: string,
  id = "response",
) {
  controller.enqueue({ type: "start", messageId: id });
  controller.enqueue({ type: "text-start", id: "text" });
  controller.enqueue({ type: "text-delta", id: "text", delta: text });
}

function finish(controller: ReadableStreamDefaultController<UIMessageChunk>) {
  controller.enqueue({ type: "text-end", id: "text" });
  controller.enqueue({ type: "finish" });
  controller.close();
}

function View({
  options,
  capture,
}: {
  options: ChatInit<ChatMessage>;
  capture: (chat: RetainedChatHelpers) => void;
}) {
  const retainedCount = useRetainedChatMessageCount(options.id ?? "");
  const chat = useRetainedChat(options);
  capture(chat);
  return (
    <>
      <button onClick={() => void chat.sendMessage({ text: "Build" })}>
        Send
      </button>
      <output data-testid="status">{chat.status}</output>
      <output data-testid="answer">
        {chat.messages
          .filter((message) => message.role === "assistant")
          .flatMap((message) =>
            message.parts.map((part) =>
              part.type === "text" ? part.text : "",
            ),
          )
          .join("|")}
      </output>
      <output data-testid="retained">{String(chat.retainedSession)}</output>
      <output data-testid="retained-count">{retainedCount}</output>
      <output data-testid="continuation-pending">
        {String(chat.retainedContinuationPending)}
      </output>
    </>
  );
}

it("retains the same reader and transcript through Studio navigation, without stale UI callbacks or a second resume", async () => {
  const first = controlledTransport();
  const later = controlledTransport();
  const oldData = jest.fn();
  const oldFinish = jest.fn();
  const newData = jest.fn();
  const newFinish = jest.fn();
  let current!: RetainedChatHelpers;
  const capture = (chat: RetainedChatHelpers) => {
    current = chat;
  };
  const tree = (options: ChatInit<ChatMessage> | null) => (
    <RetainedChatProvider scopeKey="account-a">
      {options ? (
        <View key={options.id} options={options} capture={capture} />
      ) : (
        <p>Studio</p>
      )}
    </RetainedChatProvider>
  );
  const initial = {
    id: "chat-a",
    transport: first.transport,
    onData: oldData,
    onFinish: oldFinish,
  };
  const view = render(tree(initial));
  expect(current.retentionEnabled).toBe(true);
  expect(current.retainedSession).toBe(false);
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(first.controllers).toHaveLength(1));
  await act(async () => start(first.controllers[0], "One"));
  expect(screen.getByTestId("answer")).toHaveTextContent("One");

  view.rerender(tree(null));
  expect(first.signals[0]?.aborted).toBe(false);
  await act(async () => {
    first.controllers[0].enqueue({
      type: "text-delta",
      id: "text",
      delta: " two",
    });
    first.controllers[0].enqueue({
      type: "data-title",
      data: { chatTitle: "Working title" },
      transient: true,
    });
    first.controllers[0].enqueue({
      type: "data-auto-continue",
      data: { continuationId: "one" },
      transient: true,
    });
    first.controllers[0].enqueue({
      type: "data-appendMessage",
      data: "{}",
      transient: true,
    });
  });
  expect(oldData).not.toHaveBeenCalled();
  const restored = {
    ...initial,
    messages: [],
    transport: later.transport,
    onData: newData,
    onFinish: newFinish,
  };
  view.rerender(tree(restored));
  // No wait for a server query/effect is necessary to see the current answer.
  expect(screen.getByTestId("answer").textContent).toBe("One two");
  expect(screen.getByTestId("status")).toHaveTextContent("streaming");
  expect(current.retainedSession).toBe(true);
  expect(current.retainedDataStream).toEqual([
    {
      type: "data-title",
      data: { chatTitle: "Working title" },
      transient: true,
    },
  ]);
  await act(async () => current.resumeStream());
  expect(first.transport.reconnectToStream).not.toHaveBeenCalled();
  expect(later.transport.reconnectToStream).not.toHaveBeenCalled();
  await act(async () => {
    first.controllers[0].enqueue({
      type: "data-context-usage",
      data: { used: 15 },
      transient: true,
    });
    first.controllers[0].enqueue({
      type: "text-delta",
      id: "text",
      delta: " three",
    });
    finish(first.controllers[0]);
  });
  expect(screen.getByTestId("answer").textContent).toBe("One two three");
  expect(newData).toHaveBeenCalledTimes(1);
  expect(newFinish).toHaveBeenCalledTimes(1);
  expect(oldFinish).not.toHaveBeenCalled();
  expect(first.transport.sendMessages).toHaveBeenCalledTimes(1);
  expect(later.transport.sendMessages).not.toHaveBeenCalled();

  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(later.controllers).toHaveLength(1));
  await act(async () => {
    start(later.controllers[0], "Latest transport", "next");
    finish(later.controllers[0]);
  });
  expect(later.transport.sendMessages).toHaveBeenCalledTimes(1);
});

it("finishes offscreen without mutating another chat and restores the complete result", async () => {
  const first = controlledTransport();
  const second = controlledTransport();
  const onFinish = jest.fn();
  let current!: RetainedChatHelpers;
  const tree = (id: string) => (
    <RetainedChatProvider scopeKey="account-a">
      <View
        key={id}
        options={{
          id,
          transport: id === "a" ? first.transport : second.transport,
          onFinish,
        }}
        capture={(chat) => {
          current = chat;
        }}
      />
    </RetainedChatProvider>
  );
  const view = render(tree("a"));
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(first.controllers).toHaveLength(1));
  await act(async () => start(first.controllers[0], "Building"));
  view.rerender(tree("b"));
  await act(async () => {
    first.controllers[0].enqueue({
      type: "text-delta",
      id: "text",
      delta: " complete",
    });
    finish(first.controllers[0]);
  });
  expect(onFinish).not.toHaveBeenCalled();
  expect(current.id).toBe("b");
  expect(current.messages).toEqual([]);
  view.rerender(tree("a"));
  expect(screen.getByTestId("answer").textContent).toBe("Building complete");
  expect(current.status).toBe("ready");
  expect(first.transport.sendMessages).toHaveBeenCalledTimes(1);
  expect(first.transport.reconnectToStream).not.toHaveBeenCalled();
});

it("clears and stops old-account readers on a scope change even when the next account uses the same chat id", async () => {
  const first = controlledTransport();
  const second = controlledTransport();
  const oldFinish = jest.fn();
  let current!: RetainedChatHelpers;
  const tree = (scopeKey: string) => (
    <RetainedChatProvider scopeKey={scopeKey}>
      <View
        options={{
          id: "same-id",
          transport: scopeKey === "a" ? first.transport : second.transport,
          onFinish: oldFinish,
        }}
        capture={(chat) => {
          current = chat;
        }}
      />
    </RetainedChatProvider>
  );
  const view = render(tree("a"));
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(first.controllers).toHaveLength(1));
  await act(async () => start(first.controllers[0], "Account A secret"));
  const oldSession = current;
  await act(async () => view.rerender(tree("b")));
  expect(first.signals[0]?.aborted).toBe(true);
  expect(current.messages).toEqual([]);
  expect(current.retainedSession).toBe(false);
  expect(oldFinish).not.toHaveBeenCalled();
  expect(() => oldSession.sendMessage({ text: "stale action" })).toThrow(
    "no longer available",
  );
  expect(first.transport.sendMessages).toHaveBeenCalledTimes(1);
  expect(current.messages).toEqual([]);
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(second.controllers).toHaveLength(1));
  await act(async () => start(second.controllers[0], "Account B"));
  await act(async () => {
    second.controllers[0].enqueue({
      type: "text-delta",
      id: "text",
      delta: " only",
    });
    finish(second.controllers[0]);
  });
  expect(screen.getByTestId("answer").textContent).toBe("Account B only");
});

it("deduplicates a pending reconnect across remounts and stops the original explicit resume controller", async () => {
  const abort = jest.fn();
  let current!: RetainedChatHelpers;
  let rejectConnect!: (error: Error) => void;
  const transport: ChatTransport<ChatMessage> = {
    sendMessages: jest.fn(),
    reconnectToStream: jest.fn(() => {
      current.registerResumeAbort(() => {
        abort();
        rejectConnect(new DOMException("Aborted", "AbortError"));
      });
      return new Promise((_, reject) => {
        rejectConnect = reject;
      });
    }),
  };
  const tree = (visible: boolean) => (
    <RetainedChatProvider scopeKey="a">
      {visible && (
        <View
          options={{ id: "a", transport }}
          capture={(chat) => {
            current = chat;
          }}
        />
      )}
    </RetainedChatProvider>
  );
  const view = render(tree(true));
  let firstResume!: Promise<void>;
  act(() => {
    firstResume = current.resumeStream();
  });
  view.rerender(tree(false));
  expect(abort).not.toHaveBeenCalled();
  view.rerender(tree(true));
  let secondResume!: Promise<void>;
  act(() => {
    secondResume = current.resumeStream();
  });
  expect(secondResume).toBe(firstResume);
  expect(transport.reconnectToStream).toHaveBeenCalledTimes(1);
  expect(() => current.sendMessage({ text: "Keep this draft" })).toThrow(
    "Your draft is saved",
  );
  expect(() => current.regenerate()).toThrow("reconnecting");
  expect(current.getRetainedMessages()).toEqual([]);
  expect(transport.sendMessages).not.toHaveBeenCalled();
  await act(async () => {
    await current.stop();
    await firstResume;
  });
  expect(abort).toHaveBeenCalledTimes(1);
});

it("keeps message setters bound to their session after a hook changes chat id", () => {
  const transport = controlledTransport().transport;
  let current!: RetainedChatHelpers;
  const tree = (id: string) => (
    <RetainedChatProvider scopeKey="a">
      <View
        options={{ id, transport }}
        capture={(chat) => {
          current = chat;
        }}
      />
    </RetainedChatProvider>
  );
  const view = render(tree("a"));
  const firstSession = current;
  view.rerender(tree("b"));
  act(() =>
    firstSession.setMessages([
      {
        id: "old-reader",
        role: "assistant",
        parts: [{ type: "text", text: "A result" }],
      },
    ]),
  );
  expect(current.messages).toEqual([]);
  expect(firstSession.getRetainedMessages()[0].id).toBe("old-reader");
  view.rerender(tree("a"));
  expect(screen.getByTestId("answer").textContent).toBe("A result");
});

it("keeps the registry usable through StrictMode effect replay and aborts registered resume readers on final teardown", async () => {
  const controlled = controlledTransport();
  const abort = jest.fn();
  let current!: RetainedChatHelpers;
  const view = render(
    <StrictMode>
      <RetainedChatProvider scopeKey="a">
        <View
          options={{ id: "a", transport: controlled.transport }}
          capture={(chat) => {
            current = chat;
          }}
        />
      </RetainedChatProvider>
    </StrictMode>,
  );
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(controlled.controllers).toHaveLength(1));
  await act(async () => start(controlled.controllers[0], "Still connected"));
  expect(controlled.signals[0]?.aborted).toBe(false);
  const oldUnregister = current.registerResumeAbort(jest.fn());
  current.registerResumeAbort(abort);
  oldUnregister();
  await act(async () => view.unmount());
  expect(abort).toHaveBeenCalledTimes(1);
  expect(controlled.signals[0]?.aborted).toBe(true);
});

it("does not dispatch a deferred automatic send after its UI owner has left", async () => {
  const controlled = controlledTransport();
  let allow!: (value: boolean) => void;
  const decide = jest.fn(
    () =>
      new Promise<boolean>((resolve) => {
        allow = resolve;
      }),
  );
  let current!: RetainedChatHelpers;
  const tree = (visible: boolean) => (
    <RetainedChatProvider scopeKey="a">
      {visible && (
        <View
          options={{
            id: "a",
            transport: controlled.transport,
            sendAutomaticallyWhen: decide,
          }}
          capture={(chat) => {
            current = chat;
          }}
        />
      )}
    </RetainedChatProvider>
  );
  const view = render(tree(true));
  let send!: Promise<void>;
  act(() => {
    send = current.sendMessage({ text: "Build" });
  });
  await waitFor(() => expect(controlled.controllers).toHaveLength(1));
  await act(async () => {
    start(controlled.controllers[0], "Ready");
    finish(controlled.controllers[0]);
  });
  await waitFor(() => expect(decide).toHaveBeenCalledTimes(1));
  view.rerender(tree(false));
  await act(async () => {
    allow(true);
    await send;
  });
  expect(controlled.transport.sendMessages).toHaveBeenCalledTimes(1);
});

it("starts the next Build leg while Studio is open, using the original request's model, access and working file", async () => {
  const build = controlledTransport();
  const studio = controlledTransport();
  let current!: RetainedChatHelpers;
  const tree = (id: string) => (
    <RetainedChatProvider scopeKey="a">
      <View
        key={id}
        options={{
          id,
          transport: id === "build" ? build.transport : studio.transport,
        }}
        capture={(chat) => {
          current = chat;
        }}
      />
    </RetainedChatProvider>
  );
  const view = render(tree("build"));
  const originalContext = {
    chatId: "build",
    messages: [{ stale: true }],
    purpose: "app",
    mode: "agent",
    selectedModel: "build-sol-pro",
    reasoningEffort: "xhigh",
    approvalMode: "ask",
    sandboxPreference: "tauri",
    projectId: "project-build",
    workingFile: { id: "working-file" },
    temporary: false,
  };
  current.registerRequestContext(originalContext);
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(build.controllers).toHaveLength(1));
  await act(async () => start(build.controllers[0], "First leg"));
  view.rerender(tree("studio"));
  current.registerRequestContext({
    mode: "ask",
    purpose: "image",
    selectedModel: "video-veo",
    approvalMode: "full-access",
  });
  // The stored settings are a snapshot, independent of caller-owned objects.
  originalContext.workingFile.id = "mutated-after-dispatch";
  await act(async () => {
    build.controllers[0].enqueue({
      type: "data-auto-continue",
      data: {
        shouldContinue: true,
        continuationId: "leg-1",
        reason: "context-limit",
      },
      transient: true,
    });
    finish(build.controllers[0]);
  });
  await waitFor(
    () => expect(build.transport.sendMessages).toHaveBeenCalledTimes(2),
    { timeout: 2_000 },
  );
  const request = build.transport.sendMessages.mock.calls[1][0];
  expect(request.body).toMatchObject({
    purpose: "app",
    mode: "agent",
    selectedModel: "build-sol-pro",
    reasoningEffort: "xhigh",
    approvalMode: "ask",
    sandboxPreference: "tauri",
    projectId: "project-build",
    workingFile: { id: "working-file" },
    isAutoContinue: true,
    __riftRetainedContinuation: true,
  });
  expect(request.body).not.toHaveProperty("messages");
  expect(request.body).not.toHaveProperty("chatId");
  expect(request.messages.at(-1)).toMatchObject({
    role: "user",
    metadata: { isAutoContinue: true },
    parts: [{ type: "text", text: "continue" }],
  });
  expect(studio.transport.sendMessages).not.toHaveBeenCalled();
  await act(async () => {
    start(build.controllers[1], "Second leg complete", "leg-2");
    finish(build.controllers[1]);
  });
  view.rerender(tree("build"));
  expect(screen.getByTestId("answer").textContent).toBe(
    "First leg|Second leg complete",
  );
  expect(screen.getByTestId("retained-count")).toHaveTextContent("4");
  expect(current.status).toBe("ready");
  expect(build.transport.reconnectToStream).not.toHaveBeenCalled();
});

it("honors explicit Stop during an offscreen continuation hand-off", async () => {
  const build = controlledTransport();
  let current!: RetainedChatHelpers;
  const tree = (visible: boolean) => (
    <RetainedChatProvider scopeKey="a">
      {visible && (
        <View
          options={{ id: "build", transport: build.transport }}
          capture={(chat) => {
            current = chat;
          }}
        />
      )}
    </RetainedChatProvider>
  );
  const view = render(tree(true));
  current.registerRequestContext({
    mode: "agent",
    purpose: "app",
    temporary: false,
  });
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(build.controllers).toHaveLength(1));
  view.rerender(tree(false));
  await act(async () => {
    start(build.controllers[0], "First leg");
    build.controllers[0].enqueue({
      type: "data-auto-continue",
      data: { continuationId: "leg-1", reason: "context-limit" },
      transient: true,
    });
    finish(build.controllers[0]);
  });
  await act(async () => {
    await current.stop();
    await new Promise((resolve) => setTimeout(resolve, 600));
  });
  expect(build.transport.sendMessages).toHaveBeenCalledTimes(1);
});

it("publishes continuation hand-off and cancellation independently of SDK message or status changes", async () => {
  const build = controlledTransport();
  let current!: RetainedChatHelpers;
  render(
    <RetainedChatProvider scopeKey="a">
      <View
        options={{ id: "build", transport: build.transport }}
        capture={(chat) => {
          current = chat;
        }}
      />
    </RetainedChatProvider>,
  );
  current.registerRequestContext({
    mode: "agent",
    purpose: "app",
    temporary: false,
  });
  fireEvent.click(screen.getByText("Send"));
  await waitFor(() => expect(build.controllers).toHaveLength(1));
  await act(async () => start(build.controllers[0], "Building"));
  const originalMessages = current.messages;
  expect(screen.getByTestId("continuation-pending")).toHaveTextContent("false");
  await act(async () => {
    build.controllers[0].enqueue({
      type: "data-auto-continue",
      data: { continuationId: "leg-1", reason: "context-limit" },
      transient: true,
    });
  });
  expect(current.messages).toBe(originalMessages);
  expect(current.status).toBe("streaming");
  expect(screen.getByTestId("continuation-pending")).toHaveTextContent("true");
  await act(async () => finish(build.controllers[0]));
  expect(current.status).toBe("ready");
  expect(screen.getByTestId("continuation-pending")).toHaveTextContent("true");
  // SDK stop() does nothing in ready. Only the continuation subscription can
  // notify the UI that the queue is now allowed to consume its next message.
  await act(async () => current.stop());
  expect(current.status).toBe("ready");
  expect(screen.getByTestId("continuation-pending")).toHaveTextContent("false");
  expect(build.transport.sendMessages).toHaveBeenCalledTimes(1);
});

it("keeps an unresolved Hack Stop with its retained session across navigation and newer history", async () => {
  let current!: RetainedChatHelpers;
  const transport = controlledTransport().transport;
  const tree = (shown: boolean, scopeKey = "owner") => (
    <RetainedChatProvider scopeKey={scopeKey}>
      {shown ? (
        <View
          options={{ id: "hack", transport }}
          capture={(chat) => {
            current = chat;
          }}
        />
      ) : (
        <p>Elsewhere</p>
      )}
    </RetainedChatProvider>
  );
  const view = render(tree(true));
  const original = current.hackDispatch;
  original.begin("original");
  await expect(
    original.cancel(undefined, async () => {
      throw new Error("response lost");
    }),
  ).rejects.toThrow("response lost");
  view.rerender(tree(false));
  await act(async () =>
    current.setMessages([{ id: "newer-history", role: "user", parts: [] }]),
  );
  view.rerender(tree(true));
  expect(current.hackDispatch).toBe(original);
  expect(current.hackDispatch.getSnapshot()).toMatchObject({
    status: "failed",
    stoppingDispatchId: "original",
  });
  const cancel = jest.fn().mockResolvedValue(undefined);
  await current.hackDispatch.cancel("newer-history", cancel);
  expect(cancel).toHaveBeenCalledWith("original");
  view.rerender(tree(true, "other-owner"));
  expect(current.hackDispatch).not.toBe(original);
  expect(current.hackDispatch.getSnapshot()).toEqual({ status: "idle" });
});
