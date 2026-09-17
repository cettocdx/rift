import { fireEvent, render, screen } from "@testing-library/react";
import { MessageItem } from "../MessageItem";
import type { ChatMessage, ChatMode, ChatStatus } from "@/types";

jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ openSidebar: jest.fn() }),
}));

jest.mock("../MessagePartHandler", () => ({
  MessagePartHandler: ({ part }: { part: any }) => (
    <div data-testid={`part-${part.type}`}>
      {part.text ?? (typeof part.input === "string" ? part.input : part.type)}
    </div>
  ),
}));

jest.mock("../MessageActions", () => ({
  MessageActions: () => <div data-testid="message-actions" />,
}));

jest.mock("../FilePartRenderer", () => ({
  FilePartRenderer: () => <div data-testid="file-part" />,
}));

jest.mock("../MessageEditor", () => ({
  MessageEditor: () => <div data-testid="message-editor" />,
}));

jest.mock("../FeedbackInput", () => ({
  FeedbackInput: () => <div data-testid="feedback-input" />,
}));

jest.mock("../BranchIndicator", () => ({
  BranchIndicator: () => <div data-testid="branch-indicator" />,
}));

jest.mock("../FinishReasonNotice", () => ({
  FinishReasonNotice: () => null,
}));

const assistantMessage = {
  id: "assistant-1",
  role: "assistant",
  parts: [
    {
      type: "tool-shell",
      input: "ran command",
      state: "output-available",
    },
    {
      type: "text",
      text: "final answer",
    },
  ],
  metadata: {
    mode: "agent",
    generationTimeMs: 1_500,
  },
} as unknown as ChatMessage;

const createUserMessage = (text: string) =>
  ({
    id: "user-1",
    role: "user",
    parts: [
      {
        type: "text",
        text,
      },
    ],
  }) as unknown as ChatMessage;

const renderMessageItem = ({
  mode,
  message = assistantMessage,
  status = "ready",
}: {
  mode: ChatMode;
  message?: ChatMessage;
  status?: ChatStatus;
}) =>
  render(
    <MessageItem
      message={message}
      isLastMessage
      isLastAssistantMessage={message.role === "assistant"}
      isBranchBoundary={false}
      status={status}
      isHovered={false}
      isEditing={false}
      feedbackInputMessageId={null}
      mode={mode}
      onMouseEnter={jest.fn()}
      onMouseLeave={jest.fn()}
      onStartEdit={jest.fn()}
      onSaveEdit={jest.fn()}
      onCancelEdit={jest.fn()}
      onRegenerate={jest.fn()}
      onFeedback={jest.fn()}
      onFeedbackSubmit={jest.fn()}
      onFeedbackCancel={jest.fn()}
      onShowAllFiles={jest.fn()}
      getCachedUrl={jest.fn()}
    />,
  );

describe("MessageItem chronological agent rendering", () => {
  it("presents skill discovery as general work instead of terminal execution", () => {
    renderMessageItem({
      mode: "agent",
      status: "streaming",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "tool-find_skills",
            input: "Build the requested interface",
            state: "input-available",
          },
        ],
        metadata: {
          mode: "agent",
          generationStartedAt: Date.now(),
        },
      } as unknown as ChatMessage,
    });

    expect(
      screen.getByRole("status", {
        name: /Loading skills\. Live agent activity/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: /Running command/i }),
    ).not.toBeInTheDocument();
  });

  it("does not describe file work as a terminal command", () => {
    renderMessageItem({
      mode: "agent",
      status: "streaming",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "tool-file",
            input: { action: "edit", path: "/app/page.tsx" },
            state: "input-available",
          },
        ],
        metadata: {
          mode: "agent",
          generationStartedAt: Date.now(),
        },
      } as unknown as ChatMessage,
    });

    expect(
      screen.getByRole("status", {
        name: /Updating page\.tsx\. Live agent activity/i,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("status", { name: /Running command/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /working for/i }),
    ).not.toBeInTheDocument();
  });

  it("reserves the terminal phase for real terminal stream parts", () => {
    renderMessageItem({
      mode: "agent",
      status: "streaming",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "tool-shell",
            input: { action: "exec", command: "pnpm test" },
            state: "input-available",
          },
        ],
        metadata: {
          mode: "agent",
          generationStartedAt: Date.now(),
        },
      } as unknown as ChatMessage,
    });

    expect(
      screen.getByRole("status", {
        name: /Running focused tests\. Live agent activity/i,
      }),
    ).toBeInTheDocument();
  });

  it("does not repeat a visible live reasoning status in the footer", () => {
    const { container } = renderMessageItem({
      mode: "agent",
      status: "streaming",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "reasoning",
            text: "Reviewing the navigation",
            state: "streaming",
          },
          { type: "data-agent-heartbeat", data: { phase: "running" } },
        ],
      } as unknown as ChatMessage,
    });
    expect(screen.getByTestId("part-reasoning")).toBeVisible();
    expect(container.querySelector('[data-ui="live-agent-status"]')).toBeNull();
  });

  it.each(["", "   ", "[REDACTED]"])(
    "retains live feedback when reasoning is not visible: %j",
    (text) => {
      const { container } = renderMessageItem({
        mode: "agent",
        status: "streaming",
        message: {
          ...assistantMessage,
          parts: [{ type: "reasoning", text, state: "streaming" }],
        } as unknown as ChatMessage,
      });
      expect(
        container.querySelector('[data-ui="live-agent-status"]'),
      ).not.toBeNull();
    },
  );

  it("keeps file-only generation visibly active", () => {
    renderMessageItem({
      mode: "agent",
      status: "streaming",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "file",
            mediaType: "image/png",
            filename: "concept.png",
            url: "https://example.test/concept.png",
          },
        ],
        metadata: {
          mode: "agent",
          generationStartedAt: Date.now(),
        },
      } as unknown as ChatMessage,
    });

    expect(screen.getByTestId("file-part")).toBeInTheDocument();
    expect(
      screen.getByRole("status", {
        name: /Reviewing generated files\. Live agent activity/i,
      }),
    ).toBeInTheDocument();
  });

  it("renders work inline for messages generated in ask mode", () => {
    renderMessageItem({
      mode: "agent",
      message: {
        ...assistantMessage,
        metadata: {
          mode: "ask",
          generationTimeMs: 1_500,
        },
      } as ChatMessage,
    });

    expect(screen.queryByText(/worked for/i)).not.toBeInTheDocument();
    expect(screen.getByText("ran command")).toBeInTheDocument();
    expect(screen.getByText("final answer")).toBeInTheDocument();
  });

  it("folds tool evidence locally for messages generated in agent mode", () => {
    renderMessageItem({ mode: "ask" });

    expect(
      screen.getByRole("button", { name: /Ran a command/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ran command")).not.toBeInTheDocument();
    expect(screen.getByText("final answer")).toBeInTheDocument();
  });

  it("keeps a completed Studio video visible outside Worked for", () => {
    renderMessageItem({
      mode: "agent",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "reasoning",
            text: "Rendering frames",
            state: "done",
          },
          {
            type: "tool-generate_video",
            toolCallId: "video-1",
            state: "output-available",
            output: {
              fileId: "file-video",
              storageId: "storage-video",
              mediaType: "video/mp4",
            },
          },
          { type: "text", text: "Your video is ready." },
        ],
        fileDetails: [
          {
            fileId: "file-video",
            storageId: "storage-video",
            mediaType: "video/mp4",
            name: "rift-video.mp4",
          },
        ],
        metadata: { mode: "agent", generationTimeMs: 3_000 },
      } as unknown as ChatMessage,
    });

    expect(
      screen.getByRole("region", { name: "Generated media" }),
    ).toBeVisible();
    expect(screen.getByTestId("part-tool-generate_video")).toBeVisible();
    expect(screen.getByTestId("part-reasoning")).toBeInTheDocument();
    expect(screen.queryByTestId("file-part")).not.toBeInTheDocument();
  });

  it("keeps stopped agent evidence available without final text", () => {
    renderMessageItem({
      mode: "agent",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "tool-shell",
            input: "ran command",
            state: "output-available",
          },
        ],
        metadata: {
          mode: "agent",
          generationStartedAt: 1_000,
          generationTimeMs: 2_500,
        },
      } as unknown as ChatMessage,
      status: "ready",
    });

    expect(screen.queryByRole("button", { name: /worked for/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Ran a command/i }));
    expect(screen.getByText("ran command")).toBeInTheDocument();
  });

  it("keeps regenerated final text visible when stream metadata trails it", () => {
    renderMessageItem({
      mode: "agent",
      message: {
        ...assistantMessage,
        parts: [
          {
            type: "tool-shell",
            input: "ran command",
            state: "output-available",
          },
          {
            type: "text",
            text: "regenerated final answer",
          },
          {
            type: "data-context-usage",
            data: {},
          },
        ],
        metadata: {
          mode: "agent",
          generationTimeMs: 1_500,
        },
      } as unknown as ChatMessage,
      status: "ready",
    });

    expect(
      screen.getByRole("button", { name: /Ran a command/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ran command")).not.toBeInTheDocument();
    expect(screen.getByText("regenerated final answer")).toBeInTheDocument();
  });

  it("keeps saved message mode stable when the current picker mode changes", () => {
    const { rerender } = renderMessageItem({ mode: "ask" });

    expect(
      screen.getByRole("button", { name: /Ran a command/i }),
    ).toBeInTheDocument();

    rerender(
      <MessageItem
        message={assistantMessage}
        isLastMessage
        isLastAssistantMessage
        isBranchBoundary={false}
        status="ready"
        isHovered={false}
        isEditing={false}
        feedbackInputMessageId={null}
        mode="agent"
        onMouseEnter={jest.fn()}
        onMouseLeave={jest.fn()}
        onStartEdit={jest.fn()}
        onSaveEdit={jest.fn()}
        onCancelEdit={jest.fn()}
        onRegenerate={jest.fn()}
        onFeedback={jest.fn()}
        onFeedbackSubmit={jest.fn()}
        onFeedbackCancel={jest.fn()}
        onShowAllFiles={jest.fn()}
        getCachedUrl={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: /Ran a command/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("ran command")).not.toBeInTheDocument();
    expect(screen.getByText("final answer")).toBeInTheDocument();
  });

  it("renders legacy messages without saved mode inline", () => {
    renderMessageItem({
      mode: "agent",
      message: {
        ...assistantMessage,
        metadata: {
          generationTimeMs: 1_500,
        },
      } as ChatMessage,
    });

    expect(screen.queryByText(/worked for/i)).not.toBeInTheDocument();
    expect(screen.getByText("ran command")).toBeInTheDocument();
  });
});

describe("Agent message stream updates", () => {
  const props = {
    isLastMessage: true,
    isLastAssistantMessage: true,
    isBranchBoundary: false,
    status: "streaming" as const,
    isHovered: false,
    isEditing: false,
    feedbackInputMessageId: null,
    onMouseEnter: jest.fn(),
    onMouseLeave: jest.fn(),
    onStartEdit: jest.fn(),
    onSaveEdit: jest.fn(),
    onCancelEdit: jest.fn(),
    onRegenerate: jest.fn(),
    onFeedback: jest.fn(),
    onFeedbackSubmit: jest.fn(),
    onFeedbackCancel: jest.fn(),
    onShowAllFiles: jest.fn(),
    getCachedUrl: jest.fn(),
  };
  it("updates earlier tool results when trailing prose has not changed", () => {
    const finalText = { type: "text", text: "Reviewing the result." };
    const pending = {
      ...assistantMessage,
      parts: [{ type: "tool-shell", state: "input-available" }, finalText],
    } as unknown as ChatMessage;
    const { rerender } = render(<MessageItem {...props} message={pending} />);
    expect(
      screen.getByRole("button", { name: /Running a command/i }),
    ).toBeInTheDocument();
    const completed = {
      ...pending,
      parts: [{ type: "tool-shell", state: "output-available" }, finalText],
    } as unknown as ChatMessage;
    rerender(<MessageItem {...props} message={completed} />);
    expect(
      screen.getByRole("button", { name: /Ran a command/i }),
    ).toBeInTheDocument();
  });
  it("does not restart historical tool indicators when another message is submitted", () => {
    const historical = {
      ...assistantMessage,
      parts: [{ type: "tool-shell", state: "input-available" }],
    } as unknown as ChatMessage;
    render(
      <MessageItem
        {...props}
        message={historical}
        status="submitted"
        isLastMessage={false}
        isLastAssistantMessage={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Command interrupted/i }),
    ).toBeInTheDocument();
  });
});

describe("MessageItem user message collapse", () => {
  it("collapses long user messages behind a full-message button", () => {
    const longMessage = Array.from({ length: 24 }, (_, index) =>
      index === 19
        ? `line 20 ${"x".repeat(1_300)} exact-line-20-tail`
        : `line ${index + 1}`,
    ).join("\n");

    renderMessageItem({
      mode: "ask",
      message: createUserMessage(longMessage),
    });

    expect(
      screen.getByRole("button", { name: /show full message/i }),
    ).toBeInTheDocument();
    const ellipsis = screen.getByText("…");
    expect(ellipsis).toBeInTheDocument();
    expect(ellipsis.tagName).toBe("DIV");
    expect(ellipsis).toHaveTextContent(/^…$/);
    expect(screen.getByText(/line 20/)).toBeInTheDocument();
    expect(screen.getByText(/exact-line-20-tail/)).toBeInTheDocument();
    expect(screen.queryByText(/line 24/)).not.toBeInTheDocument();
  });

  it("collapses very long single-line user messages by character count", () => {
    const longMessage = `start-${"x".repeat(1_194)}hidden-tail`;

    renderMessageItem({
      mode: "ask",
      message: createUserMessage(longMessage),
    });

    expect(
      screen.getByRole("button", { name: /show full message/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/hidden-tail/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show full message/i }));

    expect(screen.getByText(/hidden-tail/)).toBeInTheDocument();
  });

  it("shows the full user message and allows collapsing it again", () => {
    const longMessage = Array.from(
      { length: 24 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");

    renderMessageItem({
      mode: "ask",
      message: createUserMessage(longMessage),
    });

    fireEvent.click(screen.getByRole("button", { name: /show full message/i }));

    expect(
      screen.queryByRole("button", { name: /show full message/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/line 24/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show less/i }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /show less/i }));

    expect(screen.queryByText(/line 24/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /show full message/i }),
    ).toBeInTheDocument();
  });

  it("leaves short user messages expanded", () => {
    renderMessageItem({
      mode: "ask",
      message: createUserMessage("short message"),
    });

    expect(screen.getByText("short message")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /show full message/i }),
    ).not.toBeInTheDocument();
  });
});

describe("edited files in the transcript", () => {
  const writeMessage = (
    id: string,
    path: string,
    state: string,
    output: unknown,
  ) =>
    ({
      id,
      role: "assistant",
      metadata: { mode: "agent" },
      parts: [
        {
          type: "tool-file",
          toolCallId: `${id}-write`,
          input: { action: "write", path, text: "one\ntwo" },
          state,
          output,
        },
        { type: "text", text: "Finished." },
      ],
    }) as unknown as ChatMessage;
  it("keeps the edited file summary on each completed response", () => {
    renderMessageItem({
      mode: "agent",
      message: writeMessage("first", "/root/a.ts", "output-available", {
        success: true,
      }),
    });
    renderMessageItem({
      mode: "agent",
      message: writeMessage("second", "/root/b.ts", "output-available", {
        success: true,
      }),
    });
    expect(screen.getAllByTestId("files-changed-card")).toHaveLength(2);
    expect(screen.getByText("a.ts")).toBeVisible();
    expect(screen.getByText("b.ts")).toBeVisible();
  });
  it.each([
    ["input-available", undefined],
    ["output-error", { error: "Denied" }],
    ["output-available", { success: false, error: "Denied" }],
  ])(
    "does not report a pending or rejected write as edited (%s)",
    (state, output) => {
      renderMessageItem({
        mode: "agent",
        message: writeMessage("first", "/root/a.ts", state as string, output),
      });
      expect(
        screen.queryByTestId("files-changed-card"),
      ).not.toBeInTheDocument();
    },
  );
});

it.each(["agent", "chat"])(
  "keeps generated media between earlier and later prose in %s messages",
  (mode) => {
    const { container } = renderMessageItem({
      mode: mode as ChatMode,
      message: {
        ...assistantMessage,
        metadata: { mode },
        parts: [
          { type: "text", text: "Before generation" },
          {
            type: "tool-generate_image",
            toolCallId: "image-1",
            state: "output-available",
            output: {},
          },
          { type: "text", text: "After the image" },
          {
            type: "tool-generate_video",
            toolCallId: "video-1",
            state: "output-available",
            output: {},
          },
          { type: "text", text: "Final explanation" },
        ],
      } as unknown as ChatMessage,
    });
    expect(
      Array.from(container.querySelectorAll('[data-testid^="part-"]')).map(
        (node) => node.textContent,
      ),
    ).toEqual([
      "Before generation",
      "tool-generate_image",
      "After the image",
      "tool-generate_video",
      "Final explanation",
    ]);
  },
);
