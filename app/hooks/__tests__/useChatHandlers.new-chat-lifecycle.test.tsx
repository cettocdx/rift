import { act, renderHook } from "@testing-library/react";

const sendMessage = jest.fn();
const clearInput = jest.fn();
const clearUploadedFiles = jest.fn();
const setIsAutoResuming = jest.fn();
const mockSetChatMode = jest.fn();
const mockSetSelectedModel = jest.fn();
const mockReadWorkingFile = jest.fn();
const mockPrepareWorkingFile = jest.fn();
jest.mock("@/lib/composer/working-file-store", () => ({
  readWorkingFileRequestContext: () => mockReadWorkingFile(),
}));
jest.mock("@/lib/composer/working-file-request", () => ({
  prepareWorkingFileRequest: (...args: unknown[]) =>
    mockPrepareWorkingFile(...args),
}));
let mockSubmitListener: ((text: string) => Promise<boolean>) | undefined;
let mockLaunchOperationListener: ((detail: unknown) => void) | undefined;
let mockInput = "Build a polished dashboard";
let mockGlobalState: Record<string, unknown>;

jest.mock("convex/react", () => ({
  useMutation: () => jest.fn(),
}));

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
  useInputApi: () => ({
    inputRef: { current: mockInput },
    clearInput,
  }),
}));

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => mockGlobalState,
}));

jest.mock("@/app/components/DataStreamProvider", () => ({
  useDataStreamDispatch: () => ({ setIsAutoResuming }),
}));

jest.mock("@/app/hooks/useTauri", () => ({
  isTauriEnvironment: () => false,
}));

jest.mock("@/lib/utils/launch-operation", () => ({
  onLaunchOperation: (callback: (detail: unknown) => void) => {
    mockLaunchOperationListener = callback;
    return () => {
      mockLaunchOperationListener = undefined;
    };
  },
}));

jest.mock("@/lib/utils/submit-message", () => ({
  onSubmitChatMessage: (callback: (text: string) => Promise<boolean>) => {
    mockSubmitListener = callback;
    return () => {
      mockSubmitListener = undefined;
    };
  },
}));

jest.mock("sonner", () => ({
  toast: { error: jest.fn(), info: jest.fn() },
}));

import { useChatHandlers } from "../useChatHandlers";
import { toast } from "sonner";
import { consumeDispatchReceiptMetadata } from "@/lib/chat/dispatch-receipt";

const renderConsoleHandlers = (
  status: "ready" | "streaming" | "submitted" = "ready",
) =>
  renderHook(() =>
    useChatHandlers({
      chatId: "console-chat",
      messages: [],
      sendMessage,
      stop: jest.fn(),
      regenerate: jest.fn(),
      setMessages: jest.fn(),
      isExistingChat: true,
      status,
      isSendingNowRef: { current: false },
      hasManuallyStoppedRef: { current: false },
    }),
  );
const submitEvent = () => ({ preventDefault() {} }) as React.FormEvent;

describe("useChatHandlers new-chat lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadWorkingFile.mockReturnValue(undefined);
    mockPrepareWorkingFile.mockResolvedValue(undefined);
    mockLaunchOperationListener = undefined;
    mockInput = "Build a polished dashboard";
    mockGlobalState = {
      uploadedFiles: [],
      chatMode: "agent",
      setChatMode: mockSetChatMode,
      setActiveOperation: jest.fn(),
      clearUploadedFiles,
      todos: [],
      setTodos: jest.fn(),
      isUploadingFiles: false,
      subscription: "pro",
      temporaryChatsEnabled: false,
      queueMessage: jest.fn(() => ({ accepted: true, id: "queued-message" })),
      messageQueue: [],
      claimQueuedMessage: jest.fn(() => null),
      removeQueuedMessage: jest.fn(),
      queueBehavior: "queue",
      sandboxPreference: "e2b",
      selectedModel: "build-balanced",
      setSelectedModel: mockSetSelectedModel,
      chatPurpose: "app",
    };
  });

  it("acknowledges programmatic text on transport acceptance before the stream completes", async () => {
    mockGlobalState.isUploadingFiles = true;
    const files = [{ uploading: true, name: "draft.png" }];
    mockGlobalState.uploadedFiles = files;
    let accept!: () => void;
    let rejectStream!: (error: Error) => void;
    sendMessage.mockImplementationOnce((_message, options) => {
      accept = consumeDispatchReceiptMetadata(options.metadata).receipt!
        .accepted;
      return new Promise<void>((_resolve, reject) => {
        rejectStream = reject;
      });
    });
    renderConsoleHandlers();
    let settled = false;
    const submission = mockSubmitListener!("Use the second option").then(
      (value) => {
        settled = true;
        return value;
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);
    expect(await mockSubmitListener!("Duplicate answer")).toBe(false);
    await act(async () => {
      accept();
      expect(await submission).toBe(true);
      rejectStream(new Error("Later stream failure"));
      await Promise.resolve();
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      text: "Use the second option",
      files: undefined,
    });
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    expect(mockGlobalState.uploadedFiles).toBe(files);
  });

  it.each(["receipt", "promise"])(
    "rejects programmatic text on %s failure without retrying",
    async (failure) => {
      sendMessage.mockImplementationOnce((_message, options) => {
        if (failure === "receipt") {
          consumeDispatchReceiptMetadata(options.metadata).receipt!.failed(
            new Error("Offline"),
          );
          return;
        }
        return Promise.reject(new Error("SDK rejected"));
      });
      renderConsoleHandlers();
      await act(async () => {
        expect(await mockSubmitListener!("Answer")).toBe(false);
      });
      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
    },
  );

  it("rejects programmatic answers for a disconnected selected computer", async () => {
    mockGlobalState.sandboxPreference = "my-offline-mac";
    mockGlobalState.isSelectedSandboxAvailable = false;
    renderConsoleHandlers();
    await act(async () => {
      expect(await mockSubmitListener!("Answer")).toBe(false);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "The selected computer is disconnected",
      expect.any(Object),
    );
    expect(clearInput).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "returns queue acceptance %s for programmatic answers",
    async (accepted) => {
      mockGlobalState.queueMessage = jest.fn(() => ({ accepted }));
      renderConsoleHandlers("submitted");
      await act(async () => {
        expect(await mockSubmitListener!("Answer")).toBe(accepted);
      });
      expect(mockGlobalState.queueMessage).toHaveBeenCalledWith("Answer", []);
      expect(sendMessage).not.toHaveBeenCalled();
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
    },
  );

  it.each(["streaming", "submitted"] as const)(
    "keeps composer text and attachments when queue rejects during %s",
    async (status) => {
      const files = [
        {
          file: new File(["notes"], "notes.txt", { type: "text/plain" }),
          uploaded: true,
          uploading: false,
          fileId: "file-1",
          url: "https://fixture.invalid/notes.txt",
        },
      ];
      mockGlobalState.uploadedFiles = files;
      mockGlobalState.queueMessage = jest.fn(() => ({
        accepted: false,
        reason: "full",
      }));
      const { result } = renderConsoleHandlers(status);
      await act(async () => {
        expect(await result.current.handleSubmit(submitEvent())).toBe(false);
      });
      expect(mockGlobalState.queueMessage).toHaveBeenCalledWith(mockInput, [
        expect.objectContaining({
          type: "file",
          fileId: "file-1",
          name: "notes.txt",
        }),
      ]);
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
      expect(mockGlobalState.uploadedFiles).toBe(files);
      expect(sendMessage).not.toHaveBeenCalled();
    },
  );

  it("keeps the draft when a retained reader is still reconnecting", async () => {
    sendMessage.mockImplementationOnce(() => {
      const error = new Error(
        "This conversation is reconnecting. Your draft is saved; try again in a moment.",
      );
      error.name = "RetainedChatBusyError";
      throw error;
    });
    const { result } = renderConsoleHandlers();
    await act(async () => {
      await expect(result.current.handleSubmit(submitEvent())).resolves.toBe(
        false,
      );
    });
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining("Your draft is saved"),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps the draft when the selected computer disconnects instead of sending to cloud", async () => {
    mockGlobalState.sandboxPreference = "my-offline-mac";
    mockGlobalState.isSelectedSandboxAvailable = false;
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "local-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: true,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );
    await act(async () => {
      await expect(
        result.current.handleSubmit({ preventDefault() {} } as React.FormEvent),
      ).resolves.toBe(false);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "The selected computer is disconnected",
      expect.objectContaining({
        description: expect.stringContaining("Your draft is kept"),
      }),
    );
  });

  it("preserves the draft and attachments when an expired file grant rejects preflight", async () => {
    mockReadWorkingFile.mockReturnValue({ grantId: "selected-file" });
    mockPrepareWorkingFile.mockRejectedValue(
      new Error("Access to your working file has ended."),
    );
    mockGlobalState.desktopBridgeActive = true;
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "build-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: true,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );
    await act(async () => {
      await expect(
        result.current.handleSubmit({ preventDefault() {} } as React.FormEvent),
      ).resolves.toBe(false);
    });
    expect(mockPrepareWorkingFile).toHaveBeenCalledWith("build-chat-id", true);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Access to your working file has ended.",
    );
  });

  it("waits for native file preflight before dispatch and draft clearing", async () => {
    mockReadWorkingFile.mockReturnValue({ grantId: "selected-file" });
    let ready!: () => void;
    mockPrepareWorkingFile.mockReturnValue(
      new Promise<void>((resolve) => {
        ready = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "build-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: true,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );
    let dispatched: Promise<unknown>;
    act(() => {
      dispatched = result.current.handleSubmit({
        preventDefault() {},
      } as React.FormEvent);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    await act(async () => {
      ready();
      await dispatched;
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(clearInput).toHaveBeenCalledTimes(1);
  });

  it("rejects legacy pentest operation events in normal Build chat", () => {
    renderHook(() =>
      useChatHandlers({
        chatId: "build-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: false,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );

    expect(mockLaunchOperationListener).toBeDefined();
    act(() => {
      mockLaunchOperationListener?.({
        mode: "agent",
        operationId: "recon",
        operationLabel: "Recon a target",
        prompt: "Run recon on example.com",
      });
    });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(mockSetChatMode).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Security operations require Hack Workbench",
      {
        description:
          "Open Hack Workbench to run authorized pentest operations.",
      },
    );
  });

  it("keeps the active page mounted while the optimistic user turn is sent", async () => {
    const replaceState = jest.spyOn(window.history, "replaceState");
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "new-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: false,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: jest.fn(),
      } as unknown as React.FormEvent);
    });

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Build a polished dashboard",
        metadata: expect.objectContaining({ createdAt: expect.any(Number) }),
      }),
      expect.objectContaining({
        body: expect.objectContaining({
          mode: "agent",
          selectedModel: "build-balanced",
        }),
      }),
    );
    expect(clearInput).toHaveBeenCalledTimes(1);
    expect(clearUploadedFiles).toHaveBeenCalledTimes(1);
    expect(replaceState).not.toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("routes explicit video intent through the durable video model path", async () => {
    mockInput = "Turn this photo into a cinematic video";
    mockGlobalState = {
      ...mockGlobalState,
      chatMode: "ask",
      chatPurpose: "image",
      selectedModel: "image-gpt",
    };
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "media-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: false,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: jest.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockSetSelectedModel).toHaveBeenCalledWith("video-veo-fast");
    expect(mockSetChatMode).toHaveBeenCalledWith("agent");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: mockInput }),
      expect.objectContaining({
        body: expect.objectContaining({
          mode: "agent",
          selectedModel: "video-veo-fast",
        }),
      }),
    );
  });

  it.each([false, true])(
    "sends an isolated agent test without consuming the composer draft (uploading: %s)",
    async (uploading) => {
      mockGlobalState = {
        ...mockGlobalState,
        isUploadingFiles: uploading,
        uploadedFiles: [
          {
            uploaded: true,
            uploading: false,
            fileId: "unrelated-draft-file",
            url: "https://example.com/private-draft.txt",
            type: "text/plain",
            name: "private-draft.txt",
            tokens: 500000,
          },
        ],
      };
      const { result } = renderHook(() =>
        useChatHandlers({
          chatId: "agent-test-chat",
          messages: [],
          sendMessage,
          stop: jest.fn(),
          regenerate: jest.fn(),
          setMessages: jest.fn(),
          isExistingChat: false,
          status: "ready",
          isSendingNowRef: { current: false },
          hasManuallyStoppedRef: { current: false },
        }),
      );

      await act(async () => {
        await result.current.handleSubmit(
          { preventDefault: jest.fn() } as unknown as React.FormEvent,
          {
            input: "@agent:buddy Review your available tools",
            mode: "agent",
            isolated: true,
          },
        );
      });

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(sendMessage.mock.calls[0][0]).toMatchObject({
        text: "@agent:buddy Review your available tools",
        files: undefined,
      });
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
      expect(toast.error).not.toHaveBeenCalled();
    },
  );

  it("routes explicit image intent away from a selected video model", async () => {
    mockInput = "Create a clean product photo";
    mockGlobalState = {
      ...mockGlobalState,
      chatMode: "agent",
      chatPurpose: "image",
      selectedModel: "video-kling",
    };
    const { result } = renderHook(() =>
      useChatHandlers({
        chatId: "media-chat-id",
        messages: [],
        sendMessage,
        stop: jest.fn(),
        regenerate: jest.fn(),
        setMessages: jest.fn(),
        isExistingChat: false,
        status: "ready",
        isSendingNowRef: { current: false },
        hasManuallyStoppedRef: { current: false },
      }),
    );

    await act(async () => {
      await result.current.handleSubmit({
        preventDefault: jest.fn(),
      } as unknown as React.FormEvent);
    });

    expect(mockSetSelectedModel).toHaveBeenCalledWith("image-gemini");
    expect(mockSetChatMode).toHaveBeenCalledWith("ask");
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: mockInput }),
      expect.objectContaining({
        body: expect.objectContaining({
          mode: "ask",
          selectedModel: "image-gemini",
        }),
      }),
    );
  });

  it("accepts console text without sending or clearing a matching composer draft and uploads", async () => {
    mockReadWorkingFile.mockReturnValue({ grantId: "selected-file" });
    mockGlobalState.desktopBridgeActive = true;
    mockGlobalState.isUploadingFiles = true;
    mockGlobalState.uploadedFiles = [
      { uploading: true, name: "draft-only.png" },
    ];
    const { result } = renderConsoleHandlers();
    await act(async () => {
      expect(
        await result.current.handleSubmit(submitEvent(), {
          input: mockInput,
          source: "console",
        }),
      ).toBe(true);
    });
    expect(mockPrepareWorkingFile).toHaveBeenCalledWith("console-chat", true);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage.mock.calls[0][0]).toMatchObject({
      text: mockInput,
      files: undefined,
    });
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
  });

  it("does not let console submissions bypass an expired working-file capability", async () => {
    mockReadWorkingFile.mockReturnValue({ grantId: "expired-file" });
    mockPrepareWorkingFile.mockRejectedValue(
      new Error("File permission expired"),
    );
    const { result } = renderConsoleHandlers();
    await act(async () => {
      expect(
        await result.current.handleSubmit(submitEvent(), {
          input: "Edit file",
          source: "console",
          isolated: true,
        }),
      ).toBe(false);
    });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
  });

  it.each(["submitted", "streaming"] as const)(
    "accepts console text into the shared queue while %s",
    async (status) => {
      const { result } = renderConsoleHandlers(status);
      await act(async () => {
        expect(
          await result.current.handleSubmit(submitEvent(), {
            input: "Next step",
            source: "console",
          }),
        ).toBe(true);
      });
      expect(mockGlobalState.queueMessage).toHaveBeenCalledWith(
        "Next step",
        [],
      );
      expect(sendMessage).not.toHaveBeenCalled();
      expect(clearInput).not.toHaveBeenCalled();
      expect(clearUploadedFiles).not.toHaveBeenCalled();
    },
  );

  it("rejects duplicate or route-stale console sends after asynchronous file preflight", async () => {
    mockReadWorkingFile.mockReturnValue({ grantId: "selected-file" });
    let ready!: () => void;
    let current = true;
    mockPrepareWorkingFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          ready = resolve;
        }),
    );
    const { result } = renderConsoleHandlers();
    const submission = {
      input: "Edit file",
      source: "console" as const,
      isCurrent: () => current,
    };
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.handleSubmit(submitEvent(), submission);
      expect(await result.current.handleSubmit(submitEvent(), submission)).toBe(
        false,
      );
    });
    expect(mockPrepareWorkingFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      current = false;
      ready();
      expect(await pending).toBe(false);
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("returns false after dispatch failure without sending a second text-only turn", async () => {
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {});
    sendMessage.mockImplementationOnce(() => {
      throw new Error("Transport failed");
    });
    const { result } = renderConsoleHandlers();
    await act(async () => {
      expect(
        await result.current.handleSubmit(submitEvent(), {
          input: "Build",
          source: "console",
        }),
      ).toBe(false);
    });
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(clearInput).not.toHaveBeenCalled();
    expect(clearUploadedFiles).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });
});
