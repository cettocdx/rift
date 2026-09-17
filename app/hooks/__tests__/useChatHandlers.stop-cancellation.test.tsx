import { describeRunFailure } from "@/lib/chat/run-failure";
import {
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
} from "@/lib/chat/interrupted-response";
import { act, renderHook } from "@testing-library/react";
import { useRef } from "react";

const sendMessage = jest.fn();
const regenerate = jest.fn();
const clearInput = jest.fn();
const clearUploadedFiles = jest.fn();
const setIsAutoResuming = jest.fn();
let mockInput = "Send the replacement turn";
let mockGlobalState: Record<string, unknown>;

jest.mock("convex/react", () => ({ useMutation: () => jest.fn() }));

jest.mock("@/convex/_generated/api", () => ({
  api: {
    messages: {
      deleteLastAssistantMessage: "deleteLastAssistantMessage",
      saveAssistantMessage: "saveAssistantMessage",
      regenerateWithNewContent: "regenerateWithNewContent",
    },
    chatStreams: { cancelStreamFromClient: "cancelStreamFromClient" },
    tempStreams: { cancelTempStreamFromClient: "cancelTempStreamFromClient" },
  },
}));

jest.mock("@/app/contexts/InputContext", () => ({
  useInputApi: () => ({ inputRef: { current: mockInput }, clearInput }),
}));
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => mockGlobalState,
}));
jest.mock("@/app/components/DataStreamProvider", () => ({
  useDataStreamDispatch: () => ({ setIsAutoResuming }),
}));
jest.mock("@/app/hooks/useTauri", () => ({ isTauriEnvironment: () => false }));
jest.mock("@/lib/utils/launch-operation", () => ({
  onLaunchOperation: () => () => {},
}));
jest.mock("@/lib/utils/submit-message", () => ({
  onSubmitChatMessage: () => () => {},
}));
jest.mock("sonner", () => ({
  toast: { error: jest.fn(), info: jest.fn() },
}));

import { useChatHandlers } from "../useChatHandlers";
import { useConversationQueue } from "../useConversationQueue";
import { consumeDispatchReceiptMetadata } from "@/lib/chat/dispatch-receipt";
import type { ChatMessage } from "@/types";
import { toast } from "sonner";

const baseState = () => ({
  uploadedFiles: [],
  chatMode: "agent",
  setChatMode: jest.fn(),
  setActiveOperation: jest.fn(),
  clearUploadedFiles,
  todos: [],
  setTodos: jest.fn(),
  isUploadingFiles: false,
  subscription: "pro",
  temporaryChatsEnabled: false,
  queueMessage: jest.fn(),
  messageQueue: [],
  claimQueuedMessage: jest.fn((id: string) => {
    const message = (mockGlobalState.messageQueue as { id: string }[]).find(
      (item) => item.id === id,
    );
    return message
      ? {
          message,
          isCurrent: () => true,
          accepted: jest.fn(),
          failed: jest.fn(),
          restore: jest.fn(),
        }
      : null;
  }),
  removeQueuedMessage: jest.fn(),
  queueBehavior: "stop-and-send",
  sandboxPreference: "e2b",
  selectedModel: "build-balanced",
  setSelectedModel: jest.fn(),
  chatPurpose: "app",
});

const mount = (
  status: "streaming" | "ready",
  retryError?: Error,
  isExistingChat = true,
  messages: ChatMessage[] = [],
  manuallyStopped = { current: false },
) =>
  renderHook(() =>
    useChatHandlers({
      chatId: "chat-1",
      retryError,
      messages,
      sendMessage,
      stop: jest.fn(),
      regenerate,
      setMessages: jest.fn(),
      isExistingChat,
      status,
      isSendingNowRef: { current: false },
      hasManuallyStoppedRef: manuallyStopped,
    }),
  );

describe("Stop and cancellation do not swallow the failure", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    sendMessage.mockReset();
    mockInput = "Send the replacement turn";
    mockGlobalState = baseState();
  });

  it("A4: preserves the replacement draft when durable cancellation is unconfirmed", async () => {
    // Local abort is not confirmation that the durable worker has stopped.
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { result } = mount("streaming");
    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: jest.fn(),
      } as unknown as React.FormEvent);
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "The previous task could not be stopped",
      expect.objectContaining({
        description: expect.stringContaining("draft"),
      }),
    );
  });

  it("restores an undispatched claim when ownership becomes unresolved after cancellation", async () => {
    const lease = {
      message: { id: "auth-transition", text: "Keep this", timestamp: 1 },
      isCurrent: () => false,
      restore: jest.fn(),
      accepted: jest.fn(),
      failed: jest.fn(),
    };
    mockGlobalState.claimQueuedMessage = jest.fn(() => lease);
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ canceled: true }),
    }) as unknown as typeof fetch;
    const { result } = mount("streaming");
    await act(async () => {
      await result.current.handleSendNow(lease.message.id);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(lease.restore).toHaveBeenCalledTimes(1);
    expect(lease.accepted).not.toHaveBeenCalled();
    expect(lease.failed).not.toHaveBeenCalled();
  });

  it("retains Send now queue entry when durable cancellation fails", async () => {
    const message = {
      id: "queued-one",
      text: "Keep this instruction",
      files: [{ type: "file", fileId: "file-one" }],
      timestamp: 1,
    };
    mockGlobalState.messageQueue = [message];
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;
    const manuallyStopped = { current: false };
    const { result } = mount("streaming", undefined, true, [], manuallyStopped);
    await act(async () => {
      await result.current.handleSendNow(message.id);
    });
    expect(mockGlobalState.claimQueuedMessage).toHaveBeenCalledWith(message.id);
    const lease = (mockGlobalState.claimQueuedMessage as jest.Mock).mock
      .results[0].value;
    expect(lease.restore).toHaveBeenCalledTimes(1);
    expect(lease.accepted).not.toHaveBeenCalled();
    expect(lease.failed).not.toHaveBeenCalled();
    expect(mockGlobalState.removeQueuedMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(mockGlobalState.messageQueue).toEqual([message]);
    expect(toast.error).toHaveBeenCalled();
    expect(manuallyStopped.current).toBe(true);
  });
  describe.each([
    ["null", null],
    ["empty object", {}],
    ["malformed JSON", "malformed"],
    ["truthy string", { canceled: "true" }],
    ["unqualified no-active reason", { reason: "no_active_run" }],
  ])("unconfirmed HTTP200 %s", (_label, payload) => {
    beforeEach(() => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          if (payload === "malformed") throw new SyntaxError("Bad JSON");
          return payload;
        },
      }) as unknown as typeof fetch;
    });
    it("preserves replacement text and files", async () => {
      const files = [{ fileId: "kept-upload" }];
      mockGlobalState.uploadedFiles = files;
      const manuallyStopped = { current: false };
      const { result } = mount(
        "streaming",
        undefined,
        true,
        [],
        manuallyStopped,
      );
      await act(async () => {
        expect(
          await result.current.handleSubmit({
            preventDefault() {},
          } as React.FormEvent),
        ).toBe(false);
      });
      expect(sendMessage).not.toHaveBeenCalled();
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
      expect(mockGlobalState.uploadedFiles).toBe(files);
      expect(manuallyStopped.current).toBe(true);
    });
    it("retains Send now entry and blocks automatic draining", async () => {
      const message = {
        id: "queued",
        text: "Keep this",
        files: [{ fileId: "kept-file" }],
        timestamp: 1,
      };
      mockGlobalState.messageQueue = [message];
      const manuallyStopped = { current: false };
      const { result } = mount(
        "streaming",
        undefined,
        true,
        [],
        manuallyStopped,
      );
      await act(async () => {
        await result.current.handleSendNow(message.id);
      });
      expect(mockGlobalState.claimQueuedMessage).toHaveBeenCalledWith(
        message.id,
      );
      const lease = (mockGlobalState.claimQueuedMessage as jest.Mock).mock
        .results[0].value;
      expect(lease.restore).toHaveBeenCalledTimes(1);
      expect(lease.accepted).not.toHaveBeenCalled();
      expect(lease.failed).not.toHaveBeenCalled();
      expect(mockGlobalState.removeQueuedMessage).not.toHaveBeenCalled();
      expect(mockGlobalState.messageQueue).toEqual([message]);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(manuallyStopped.current).toBe(true);
    });
  });

  it.each([{ canceled: true }, { canceled: false, reason: "no_active_run" }])(
    "sends replacement only after confirmed cancellation %j",
    async (receipt) => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => receipt,
      }) as unknown as typeof fetch;
      const { result } = mount("streaming");
      await act(async () => {
        expect(
          await result.current.handleSubmit({
            preventDefault() {},
          } as React.FormEvent),
        ).toBe(true);
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(clearInput).toHaveBeenCalledTimes(1);
    },
  );

  it("A5: warns the user when Stop cannot confirm the server cancelled", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    }) as unknown as typeof fetch;

    const { result } = mount("streaming");
    await act(async () => {
      await result.current.handleStop();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Stop may not have reached the server",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("A5: treats a 200 {canceled:false} that is not no_active_run as unconfirmed", async () => {
    // A clean HTTP 200 used to read as success even when the body admitted the
    // run was not cancelled. Only `no_active_run` is a genuine no-op.
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ canceled: false, reason: "run_cancel_timeout" }),
    }) as unknown as typeof fetch;

    const { result } = mount("streaming");
    await act(async () => {
      await result.current.handleStop();
    });

    expect(toast.error).toHaveBeenCalledWith(
      "Stop may not have reached the server",
      expect.objectContaining({ description: expect.any(String) }),
    );
  });

  it("A5: a genuine no_active_run is not reported as a failure", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ canceled: false, reason: "no_active_run" }),
    }) as unknown as typeof fetch;

    const { result } = mount("streaming");
    await act(async () => {
      await result.current.handleStop();
    });

    expect(toast.error).not.toHaveBeenCalled();
  });
});

it.each([
  "The previous action cannot be safely replayed automatically.",
  INTERRUPTED_RESPONSE_MESSAGE,
  LOST_AGENT_CONNECTION_MESSAGE,
  AGENT_WORKER_FAILED_MESSAGE,
  describeRunFailure(new Error("worker exited")),
  describeRunFailure(new Error("timed out")),
])(
  "a user retry reconciles uncertain work as a new visible request: %s",
  async (message) => {
    mockGlobalState = baseState();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ canceled: false, reason: "no_active_run" }),
    });
    const { result } = mount("ready", new Error(message));
    await act(async () => {
      await result.current.handleRetry();
    });
    expect(sendMessage).toHaveBeenCalledWith(
      {
        text: expect.stringContaining(
          "Inspect the current files and saved results first",
        ),
      },
      { body: expect.objectContaining({ purpose: "app", temporary: false }) },
    );
    expect(regenerate).not.toHaveBeenCalled();
    expect(sendMessage.mock.calls.at(-1)[1].body.regenerate).toBeUndefined();
    expect(
      sendMessage.mock.calls.at(-1)[1].body.isAutoContinue,
    ).toBeUndefined();
  },
);

it.each(["handleRetry", "handleRegenerate", "handleEditMessage"] as const)(
  "%s handles denied cancellation without an unhandled rejection or replacement run",
  async (action) => {
    jest.clearAllMocks();
    sendMessage.mockReset();
    mockGlobalState = baseState();
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 403 });
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = mount("ready");
      await act(async () => {
        const pending =
          action === "handleEditMessage"
            ? result.current.handleEditMessage("message-1", "new text")
            : result.current[action]();
        await expect(pending).resolves.toBeUndefined();
      });
      expect(toast.error).toHaveBeenCalled();
      expect(sendMessage).not.toHaveBeenCalled();
      expect(regenerate).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    } finally {
      errorLog.mockRestore();
    }
  },
);

it("identifies a draft when cancelling before retrying a failed first turn", async () => {
  jest.clearAllMocks();
  mockGlobalState = baseState();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      canceled: false,
      reason: "no_active_run",
      chatMissing: true,
    }),
  });
  const draft: ChatMessage[] = [
    {
      id: "user-draft",
      role: "user",
      parts: [{ type: "text", text: "Build a timer" }],
    },
  ];
  const { result } = mount("ready", undefined, false, draft);
  await act(async () => {
    await result.current.handleRetry();
  });
  expect(
    JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body),
  ).toMatchObject({ allowMissingChat: true });
  expect(regenerate).toHaveBeenCalledWith({
    body: expect.objectContaining({ regenerate: false, messages: draft }),
  });
});

it("uses persisted history when a new-page run was accepted before disconnecting", async () => {
  jest.clearAllMocks();
  mockGlobalState = baseState();
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ canceled: true }) });
  const { result } = mount("ready", undefined, false);
  await act(async () => {
    await result.current.handleRetry();
  });
  expect(regenerate).toHaveBeenCalledWith({
    body: expect.objectContaining({ regenerate: true, messages: [] }),
  });
});

it("completed checkpoint retry creates a new reconciliation request", async () => {
  jest.clearAllMocks();
  mockGlobalState = baseState();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ canceled: false, reason: "no_active_run" }),
  });
  const { result } = mount(
    "ready",
    new Error(
      "This request has already finished. Send a new message to start another action.",
    ),
  );
  await act(async () => {
    await result.current.handleRetry();
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
  expect(regenerate).not.toHaveBeenCalled();
});
it("coalesces concurrent retry clicks", async () => {
  jest.clearAllMocks();
  mockGlobalState = baseState();
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ canceled: false, reason: "no_active_run" }),
  });
  const { result } = mount(
    "ready",
    new Error("The previous action cannot be safely replayed automatically."),
  );
  await act(async () => {
    await Promise.all([
      result.current.handleRetry(),
      result.current.handleRetry(),
    ]);
  });
  expect(sendMessage).toHaveBeenCalledTimes(1);
});

// Real queue hook + real handler + real private receipt envelope. Only external
// cancellation and SDK transport boundaries are controlled in these tests.
describe("Send now queue acceptance integration", () => {
  const originalFetch = global.fetch;
  beforeEach(() => {
    jest.clearAllMocks();
    sendMessage.mockReset();
    mockGlobalState = baseState();
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  const canceled = () => ({
    ok: true,
    status: 200,
    json: async () => ({ canceled: true }),
  });
  function setup() {
    const hook = renderHook(
      ({ owner }) => {
        const queue = useConversationQueue(owner);
        mockGlobalState = { ...mockGlobalState, ...queue };
        const sending = useRef(false);
        const stopped = useRef(false);
        const handlers = useChatHandlers({
          chatId: "chat-1",
          messages: [],
          sendMessage,
          stop: jest.fn(),
          regenerate,
          setMessages: jest.fn(),
          isExistingChat: true,
          status: "streaming",
          isSendingNowRef: sending,
          hasManuallyStoppedRef: stopped,
        });
        return { queue, handlers, stopped };
      },
      { initialProps: { owner: "account-a" } },
    );
    act(() => {
      hook.result.current.queue.setActiveQueueChat("chat-1");
    });
    act(() => {
      hook.result.current.queue.queueMessage("Keep exact instruction", [
        {
          type: "file",
          fileId: "file-one",
          mediaType: "text/plain",
          name: "notes.txt",
          size: 10,
        },
      ]);
    });
    return { ...hook, message: hook.result.current.queue.messageQueue[0] };
  }

  it("claims once across two Send now clicks while durable stop is pending", async () => {
    const stop = deferred<ReturnType<typeof canceled>>();
    global.fetch = jest.fn(() => stop.promise) as unknown as typeof fetch;
    const stream = deferred<void>();
    sendMessage.mockReturnValue(stream.promise);
    const { result, message } = setup();
    let first!: Promise<void>;
    act(() => {
      first = result.current.handlers.handleSendNow(message.id);
    });
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.queue.messageQueue[0].dispatchState).toBe("sending");
    await act(async () => {
      stop.resolve(canceled());
      await first;
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toEqual({
      id: message.id,
      role: "user",
      parts: [...message.files!, { type: "text", text: message.text }],
      metadata: { createdAt: message.timestamp },
    });
    expect(result.current.queue.messageQueue).toHaveLength(1);
    await act(async () => {
      stream.resolve();
      await stream.promise;
    });
    expect(result.current.queue.messageQueue[0].dispatchState).toBe(
      "unconfirmed",
    );
  });

  it("restores the lease and attachments when stop fails, allowing a later explicit attempt", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    const { result, message } = setup();
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.queue.messageQueue[0]).toMatchObject(message);
    expect(result.current.queue.messageQueue[0].dispatchState).toBeUndefined();
    expect(result.current.stopped.current).toBe(true);
    global.fetch = jest
      .fn()
      .mockResolvedValue(canceled()) as unknown as typeof fetch;
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch a retired account's lease after awaited cancellation", async () => {
    const stop = deferred<ReturnType<typeof canceled>>();
    global.fetch = jest.fn(() => stop.promise) as unknown as typeof fetch;
    const { result, rerender, message } = setup();
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.handlers.handleSendNow(message.id);
    });
    rerender({ owner: "account-b" });
    act(() => {
      result.current.queue.setActiveQueueChat("chat-1");
    });
    act(() => {
      result.current.queue.queueMessage("Account B instruction");
    });
    await act(async () => {
      stop.resolve(canceled());
      await sending;
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(result.current.queue.messageQueue.map((item) => item.text)).toEqual([
      "Account B instruction",
    ]);
  });

  it("consumes only on transport acceptance and never restores after later stream failure", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(canceled()) as unknown as typeof fetch;
    const stream = deferred<void>();
    sendMessage.mockReturnValue(stream.promise);
    const { result, message } = setup();
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(result.current.queue.messageQueue).toHaveLength(1);
    const { receipt, metadata } = consumeDispatchReceiptMetadata(
      sendMessage.mock.calls[0][1].metadata,
    );
    expect(receipt).toBeDefined();
    expect(metadata).toBeUndefined();
    act(() => {
      receipt!.accepted();
    });
    expect(result.current.queue.messageQueue).toEqual([]);
    await act(async () => {
      receipt!.failed(new Error("later disconnect"));
      stream.resolve();
      await stream.promise;
    });
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(result.current.queue.messageQueue).toEqual([]);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps SDK-swallowed errors unconfirmed instead of interpreting resolved send as acceptance", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(canceled()) as unknown as typeof fetch;
    sendMessage.mockImplementation((_message, options) => {
      consumeDispatchReceiptMetadata(options.metadata).receipt!.failed(
        new Error("request failed"),
      );
      return Promise.resolve();
    });
    const { result, message } = setup();
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(result.current.queue.messageQueue[0].dispatchState).toBe(
      "unconfirmed",
    );
    expect(result.current.queue.messageQueue[0].id).toBe(message.id);
    expect(result.current.queue.messageQueue[0].files).toEqual(message.files);
    await act(async () => {
      await result.current.handlers.handleSendNow(message.id);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
