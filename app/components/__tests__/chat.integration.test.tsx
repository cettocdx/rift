import { useLayoutEffect } from "react";
import "@testing-library/jest-dom";
import { describe, it, expect, beforeEach } from "@jest/globals";
import { act, render, screen, waitFor } from "@testing-library/react";

// ===== IMPORTANT: Mock all dependencies BEFORE importing Chat =====
// These mocks are hoisted by Jest

// Auth shim (Convex Auth) — keep the chat tree free of a real Convex provider
jest.mock("@/app/hooks/useAuth", () => ({
  __esModule: true,
  useAuth: () => ({
    user: null,
    loading: false,
    isAuthenticated: false,
    entitlements: [],
  }),
}));

// Mock @ai-sdk/react
const mockSendMessage = jest.fn();
const mockSetMessages = jest.fn();
const mockStop = jest.fn();
const mockRegenerate = jest.fn();
const mockResumeStream = jest.fn();
const mockPrepareWorkingFileRequest = jest.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue(undefined);

jest.mock("@/lib/composer/working-file-request", () => ({
  prepareWorkingFileRequest: (...args: unknown[]) => mockPrepareWorkingFileRequest(...args),
}));

jest.mock("@ai-sdk/react", () => ({
  useChat: jest.fn(() => ({
    messages: [],
    sendMessage: mockSendMessage,
    setMessages: mockSetMessages,
    status: "ready",
    stop: mockStop,
    error: null,
    regenerate: mockRegenerate,
    resumeStream: mockResumeStream,
  })),
}));

// This integration suite controls SDK state explicitly; real retained-reader
// navigation is covered by useRetainedChat's streaming transport tests.
jest.mock("../../hooks/useRetainedChat", () => ({
  useRetainedChatMessageCount: () => 0,
  useRetainedChat: (options: unknown) => ({
    ...require("@ai-sdk/react").useChat(options),
    retentionEnabled: false,
    retainedContinuationPending: false,
    retainedSession: false,
    retainedDataStream: [],
    registerResumeAbort: () => () => {},
    registerRequestContext: () => {},
    stopRetainedReader: mockStop,
    getRetainedMessages: () => [],
  }),
}));

jest.mock("convex/react", () => {
  const actual = jest.requireActual("convex/react") as Record<string, unknown>;
  return { ...actual, usePaginatedQuery: jest.fn(actual.usePaginatedQuery as (...args: unknown[]) => unknown) };
});

jest.mock("@/lib/chat/agent-long-transport", () => ({
  preloadAgentLongTransport: jest.fn(),
  fetchAgentLongStream: jest.fn(async () => ({ ok: true })),
  resumeAgentLongStream: jest.fn(),
}));

jest.mock("next/navigation", () => ({
  useParams: jest.fn(() => ({})),
  usePathname: jest.fn(() => "/"),
  useSearchParams: jest.fn(() => new URLSearchParams()),
  useRouter: jest.fn(() => ({
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    forward: jest.fn(),
    refresh: jest.fn(),
    prefetch: jest.fn(),
  })),
}));

jest.mock("react-hotkeys-hook", () => ({
  useHotkeys: jest.fn(),
}));

jest.mock("@/hooks/use-mobile", () => ({
  useIsMobile: jest.fn(() => false),
}));

jest.mock("@/lib/utils/client-storage", () => ({
  ...jest.requireActual("@/lib/utils/client-storage"),
  NULL_THREAD_DRAFT_ID: "null-thread",
  getDraftContentById: jest.fn(() => null),
  upsertDraft: jest.fn(),
  removeDraft: jest.fn(),
}));

jest.mock("../../hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    fileInputRef: { current: null },
    handleFileUploadEvent: jest.fn(),
    handleRemoveFile: jest.fn(),
    handleAttachClick: jest.fn(),
    handlePasteEvent: jest.fn(),
    isDragOver: false,
    showDragOverlay: false,
    handleDragEnter: jest.fn(),
    handleDragLeave: jest.fn(),
    handleDragOver: jest.fn(),
    handleDrop: jest.fn(),
  }),
}));

jest.mock("../../hooks/useDocumentDragAndDrop", () => ({
  useDocumentDragAndDrop: () => {},
}));

jest.mock("../../hooks/useChats", () => ({
  useChats: () => ({
    results: [],
    status: "Exhausted",
    loadMore: jest.fn(),
  }),
}));

jest.mock("../../hooks/useChatHandlers", () => ({
  useChatHandlers: () => ({
    handleSubmit: jest.fn(),
    handleStop: jest.fn(),
    handleRegenerate: jest.fn(),
    handleRetry: jest.fn(),
    handleEditMessage: jest.fn(),
  }),
}));

jest.mock("../../hooks/useMessageScroll", () => ({
  useMessageScroll: () => ({
    scrollRef: { current: null },
    contentRef: { current: null },
    scrollToBottom: jest.fn(),
    isAtBottom: true,
  }),
}));

jest.mock("../../hooks/useAutoResume", () => ({
  useAutoResume: jest.fn(),
}));

jest.mock("../SidebarHeader", () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar-header">Sidebar Header</div>,
}));

jest.mock("../SidebarUserNav", () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar-user-nav">User Nav</div>,
}));

jest.mock("../SidebarHistory", () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar-history">Sidebar History</div>,
}));

jest.mock("../MemoizedMarkdown", () => ({
  MemoizedMarkdown: ({ children }: any) => (
    <div data-testid="memoized-markdown">{children}</div>
  ),
}));

jest.mock("../Messages", () => ({
  Messages: ({ messages }: any) => (
    <div data-testid="messages-component">{messages.length} messages</div>
  ),
}));

jest.mock("../ChatInput", () => ({
  ChatInput: () => <div data-testid="chat-input">ChatInput</div>,
}));

jest.mock("../ComputerSidebar", () => ({
  ComputerSidebar: () => <div data-testid="computer-sidebar">Sidebar</div>,
}));

jest.mock("../ChatHeader", () => ({
  __esModule: true,
  default: () => <div data-testid="chat-header">Chat Header</div>,
}));

jest.mock("../Sidebar", () => ({
  __esModule: true,
  default: () => <div data-testid="main-sidebar">Main Sidebar</div>,
}));

jest.mock("../Footer", () => ({
  __esModule: true,
  default: () => <div data-testid="footer">Footer</div>,
}));

jest.mock("../DragDropOverlay", () => ({
  DragDropOverlay: ({ isVisible }: any) =>
    isVisible ? <div data-testid="drag-overlay">Drag Overlay</div> : null,
}));

jest.mock("../ConvexErrorBoundary", () => ({
  ConvexErrorBoundary: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@/components/ui/sidebar", () => ({
  SidebarProvider: ({ children }: any) => <div>{children}</div>,
}));

// ===== NOW import components =====
import { Chat } from "../chat";
import { ChatLayout } from "../ChatLayout";
import { TestWrapper } from "../testUtils";
import { useGlobalState } from "@/app/contexts/GlobalState";

describe("Chat Component Integration", () => {
  let mockUseChat: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPrepareWorkingFileRequest.mockResolvedValue(undefined);
    const { useParams } = require("next/navigation");
    useParams.mockReturnValue({});
    const { useChat } = require("@ai-sdk/react");
    mockUseChat = useChat as jest.Mock;

    mockUseChat.mockReturnValue({
      messages: [],
      sendMessage: mockSendMessage,
      setMessages: mockSetMessages,
      status: "ready",
      stop: mockStop,
      error: null,
      regenerate: mockRegenerate,
      resumeStream: mockResumeStream,
    });
  });

  it("keeps the originating project while working-file preflight awaits across a context change", async () => {
    let state!: ReturnType<typeof useGlobalState>;
    function Probe() { const current = useGlobalState(); useLayoutEffect(() => { state = current; }); return null; }
    render(<TestWrapper><Probe /><Chat autoResume={false} /></TestWrapper>);
    act(() => {
      state.setChatPurpose("app");
      state.setActiveProject({ id: "origin-project" as any, type: "app" });
    });
    let release!: () => void;
    mockPrepareWorkingFileRequest.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve; }));
    const options = mockUseChat.mock.calls.at(-1)?.[0] as any;
    const prepared = options.transport.prepareSendMessagesRequest({
      id: options.id,
      messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Continue this project" }] }],
      body: { mode: "agent", selectedModel: "build-codex" },
    });
    expect(mockPrepareWorkingFileRequest).toHaveBeenCalled();
    act(() => { state.setActiveProject({ id: "other-project" as any, type: "image" }); });
    release();
    await expect(prepared).resolves.toMatchObject({ body: { projectId: "origin-project", purpose: "app" } });
  });

  it("observes a submitted persistent home run even when its acknowledgement is lost", async () => {
    const convex = require("convex/react");
    const query = convex.usePaginatedQuery;
    {
      render(<TestWrapper><Chat autoResume={false} /></TestWrapper>);
      await waitFor(() => expect(mockUseChat).toHaveBeenCalled());
      const options = mockUseChat.mock.calls.at(-1)?.[0] as any;
      expect(query.mock.calls.some((args: any) => args[1]?.chatId === options.id)).toBe(false);
      const fetchAgent = require("@/lib/chat/agent-long-transport").fetchAgentLongStream;
      let rejectPost!: (error: Error) => void;
      fetchAgent.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectPost = reject; }));
      let post!: Promise<unknown>;
      await act(async () => {
        post = options.transport.fetch("/api/chat", {
          method: "POST",
          body: JSON.stringify({ chatId: options.id, mode: "agent", temporary: false }),
        }).catch(() => undefined);
      });
      expect(query.mock.calls.some((args: any) => args[1]?.chatId === options.id)).toBe(true);
      expect(screen.queryByText("Chat not found")).not.toBeInTheDocument();
      await act(async () => { rejectPost(new TypeError("Failed to fetch")); await post; });
    }
  });

  it.each(["temporary", "other-chat"])("does not observe an unrelated %s request as this home chat", async (kind) => {
    const query = require("convex/react").usePaginatedQuery;
    render(<TestWrapper><Chat autoResume={false} /></TestWrapper>);
    const options = mockUseChat.mock.calls.at(-1)?.[0] as any;
    await act(async () => {
      await options.transport.fetch("/api/chat", {
        method: "POST",
        body: JSON.stringify({ chatId: kind === "other-chat" ? "another-chat" : options.id, mode: "agent", temporary: kind === "temporary" }),
      });
    });
    expect(query.mock.calls.some((args: any) => args[1]?.chatId === options.id)).toBe(false);
  });

  describe("Basic Rendering", () => {
    it("should render new chat with welcome message", () => {
      render(
        <TestWrapper>
          <Chat autoResume={false} />
        </TestWrapper>,
      );

      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
      expect(screen.queryByTestId("rift-brand-bar")).not.toBeInTheDocument();
    });

    it("should render with provided chatId", () => {
      const { useParams } = require("next/navigation");
      useParams.mockReturnValue({ id: "test-chat-123" });

      const { container } = render(
        <TestWrapper>
          <Chat autoResume={false} />
        </TestWrapper>,
      );

      expect(
        container.querySelector(".flex.bg-transparent"),
      ).toBeInTheDocument();
    });
  });

  describe("Message Display", () => {
    it("should render with existing messages", () => {
      mockUseChat.mockReturnValue({
        messages: [
          { id: "1", role: "user", content: "Hello" },
          { id: "2", role: "assistant", content: "Hi there!" },
        ],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: "ready",
        stop: mockStop,
        error: null,
        regenerate: mockRegenerate,
        resumeStream: mockResumeStream,
      });

      const { container } = render(
        <TestWrapper>
          <Chat autoResume={false} />
        </TestWrapper>,
      );

      expect(
        container.querySelector(".flex.bg-transparent"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("rift-brand-bar")).not.toBeInTheDocument();
    });
  });

  describe("Streaming State", () => {
    it("should handle streaming status", () => {
      mockUseChat.mockReturnValue({
        messages: [{ id: "1", role: "assistant", content: "Streaming..." }],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: "streaming",
        stop: mockStop,
        error: null,
        regenerate: mockRegenerate,
        resumeStream: mockResumeStream,
      });

      const { container } = render(
        <TestWrapper>
          <Chat autoResume={false} />
        </TestWrapper>,
      );

      expect(
        container.querySelector(".flex.bg-transparent"),
      ).toBeInTheDocument();
    });
  });

  describe("Error Handling", () => {
    it("should render when error occurs", () => {
      const testError = new Error("Test error");
      mockUseChat.mockReturnValue({
        messages: [],
        sendMessage: mockSendMessage,
        setMessages: mockSetMessages,
        status: "ready",
        stop: mockStop,
        error: testError,
        regenerate: mockRegenerate,
        resumeStream: mockResumeStream,
      });

      render(
        <TestWrapper>
          <Chat autoResume={false} />
        </TestWrapper>,
      );

      expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    });
  });

  describe("Sidebar Behavior", () => {
    it("should render sidebar on desktop", () => {
      render(
        <TestWrapper>
          <ChatLayout>
            <Chat autoResume={false} />
          </ChatLayout>
        </TestWrapper>,
      );

      expect(screen.getByTestId("sidebar")).toBeInTheDocument();
    });

    // Mobile layout (sidebar hidden in main layout, shown as overlay) is covered by
    // ChatLayout structure and useIsMobile; full behavior can be asserted in e2e or ChatLayout unit tests.
  });
});
