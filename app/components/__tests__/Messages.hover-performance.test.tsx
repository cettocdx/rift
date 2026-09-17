import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { Messages } from "../Messages";
import type { ChatMessage } from "@/types";

let mockRowRenders = 0;
jest.mock("../MessageItem", () => ({
  MessageItem: (props: any) => {
    mockRowRenders++;
    return (
      <div
        data-testid={props.message.id}
        onMouseEnter={() => props.onMouseEnter?.(props.message.id)}
        onMouseLeave={props.onMouseLeave}
      >
        Message
      </div>
    );
  },
}));
jest.mock("../ConversationOutline", () => ({
  ConversationOutline: () => null,
}));
jest.mock("../AssistantCompletionAnnouncer", () => ({
  AssistantCompletionAnnouncer: () => null,
}));
jest.mock("../DataStreamProvider", () => ({
  useDataStreamState: () => ({ isAutoResuming: false }),
}));
jest.mock("../../hooks/useFileUrlCache", () => ({
  useFileUrlCache: () => ({ getCachedUrl: () => null, setCachedUrl: () => {} }),
}));
jest.mock("../../hooks/useFeedback", () => ({
  useFeedback: () => ({
    feedbackInputMessageId: null,
    handleFeedback: jest.fn(),
    handleFeedbackSubmit: jest.fn(),
    handleFeedbackCancel: jest.fn(),
  }),
}));

it("does no conversation-list React work when moving across historical messages", () => {
  const messages = Array.from({ length: 200 }, (_, i) => ({
    id: `row-${i}`,
    role: i % 2 ? "assistant" : "user",
    parts: [{ type: "text", text: "Completed message" }],
  })) as ChatMessage[];
  render(
    <Messages
      messages={messages}
      setMessages={jest.fn()}
      onRegenerate={jest.fn()}
      onRetry={jest.fn()}
      onEditMessage={jest.fn()}
      status="ready"
      error={null}
      scrollRef={{ current: null }}
      contentRef={{ current: null }}
    />,
  );
  mockRowRenders = 0;
  for (let i = 0; i < 20; i++) {
    fireEvent.mouseEnter(screen.getByTestId(`row-${i}`));
    fireEvent.mouseLeave(screen.getByTestId(`row-${i}`));
  }
  expect(mockRowRenders).toBe(0);
});
