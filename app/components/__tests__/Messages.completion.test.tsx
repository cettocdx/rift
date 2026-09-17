import { fireEvent, render, screen, within } from "@testing-library/react";
import { Messages } from "../Messages";
import { extractWebSourcesFromMessage } from "@/lib/utils/message-utils";
import type { ChatMessage, ChatStatus } from "@/types";

jest.mock("@/lib/utils/message-utils", () => {
  const actual = jest.requireActual("@/lib/utils/message-utils");
  return {
    ...actual,
    extractWebSourcesFromMessage: jest.fn(actual.extractWebSourcesFromMessage),
  };
});
jest.mock("@/app/contexts/GlobalState", () => ({
  useGlobalState: () => ({ openSidebar: jest.fn() }),
}));
jest.mock("../MessagePartHandler", () => ({
  MessagePartHandler: ({ part }: { part: any }) => (
    <div>{part.text ?? part.type}</div>
  ),
}));
jest.mock("../FilePartRenderer", () => ({
  FilePartRenderer: ({ part }: { part: { name?: string; url?: string } }) => (
    <a href={part.url}>{part.name}</a>
  ),
}));
jest.mock("../ConversationOutline", () => ({
  ConversationOutline: () => null,
}));
jest.mock("../MessageEditor", () => ({
  MessageEditor: () => <div>Editing message</div>,
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

function transcript() {
  return [
    {
      id: "old-user",
      role: "user",
      parts: [{ type: "text", text: "Earlier question" }],
    },
    {
      id: "old-answer",
      role: "assistant",
      metadata: { mode: "agent", generationTimeMs: 2000 },
      parts: [
        {
          type: "tool-web",
          toolCallId: "web-old",
          state: "output-available",
          output: [{ url: "https://example.com", title: "Earlier source" }],
        },
        { type: "text", text: "Earlier answer" },
      ],
    },
    {
      id: "new-user",
      role: "user",
      parts: [{ type: "text", text: "Current question" }],
    },
    {
      id: "new-answer",
      role: "assistant",
      metadata: { mode: "agent", generationTimeMs: 3000 },
      parts: [{ type: "text", text: "Current answer" }],
    },
  ] as unknown as ChatMessage[];
}
const callbacks = () => ({
  setMessages: jest.fn(),
  onRegenerate: jest.fn(),
  onRetry: jest.fn(),
  onEditMessage: jest.fn(),
  onBranchMessage: jest.fn(),
  error: null,
  scrollRef: { current: null },
  contentRef: { current: null },
});
const countFor = (id: string) =>
  jest
    .mocked(extractWebSourcesFromMessage)
    .mock.calls.filter(([m]) => (m as ChatMessage).id === id).length;

beforeEach(() => jest.mocked(extractWebSourcesFromMessage).mockClear());

it("keeps historical source extraction stable across completion while current actions update", () => {
  const messages = transcript();
  const props = callbacks();
  const view = (status: ChatStatus) => (
    <Messages {...props} messages={messages} status={status} />
  );
  const { container, rerender } = render(view("streaming"));
  expect(
    screen.queryByRole("button", { name: "Regenerate response" }),
  ).toBeNull();
  const before = countFor("old-answer");
  expect(before).toBeGreaterThan(0);
  for (const status of ["submitted", "streaming", "error", "ready"] as const) {
    rerender(view(status));
    expect(countFor("old-answer")).toBe(before);
    if (status === "ready" || status === "error")
      expect(
        screen.getByRole("button", { name: "Regenerate response" }),
      ).toBeEnabled();
    else
      expect(
        screen.queryByRole("button", { name: "Regenerate response" }),
      ).toBeNull();
  }
  fireEvent.click(screen.getByRole("button", { name: "Regenerate response" }));
  expect(props.onRegenerate).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Earlier answer")).toBeInTheDocument();
  const oldRow = container.querySelector(
    '[data-message-id="old-answer"]',
  ) as HTMLElement;
  fireEvent.click(within(oldRow).getByRole("button", { name: /Branch/i }));
  expect(props.onBranchMessage).toHaveBeenCalledWith("old-answer");
  const oldUser = container.querySelector(
    '[data-message-id="old-user"]',
  ) as HTMLElement;
  fireEvent.click(
    within(oldUser).getByRole("button", { name: "Edit message" }),
  );
  expect(screen.getByText("Editing message")).toBeInTheDocument();
});

it.each(["ready", "error"] as const)(
  "shows late exact usage metadata without requiring a text or status change (%s)",
  (status) => {
    const messages = transcript();
    const props = callbacks();
    const { rerender } = render(
      <Messages {...props} messages={messages} status={status} />,
    );
    expect(screen.queryByText(/2\.4k/)).toBeNull();
    const updated = messages.map((message) =>
      message.id === "new-answer"
        ? {
            ...message,
            metadata: {
              ...message.metadata,
              totalTokens: 2400,
              costDollars: 0.125,
            },
          }
        : message,
    );
    expect(updated[3].parts).toBe(messages[3].parts);
    rerender(<Messages {...props} messages={updated} status={status} />);
    expect(screen.getByText("Worked for 3s · 2.4k · $0.13")).toBeVisible();
    // An independent correction to cost must also update, including a zero charge.
    const corrected = updated.map((message) =>
      message.id === "new-answer"
        ? {
            ...message,
            metadata: { ...message.metadata, costDollars: 0 },
          }
        : message,
    );
    rerender(<Messages {...props} messages={corrected} status={status} />);
    expect(screen.getByText("Worked for 3s · 2.4k")).toBeVisible();
    const correctedTokens = corrected.map((message) =>
      message.id === "new-answer"
        ? { ...message, metadata: { ...message.metadata, totalTokens: 3000 } }
        : message,
    );
    rerender(
      <Messages {...props} messages={correctedTokens} status={status} />,
    );
    expect(screen.getByText("Worked for 3s · 3.0k")).toBeVisible();
  },
);

it("shows late saved-file receipts and corrections without text or status changes", () => {
  const messages = transcript();
  const props = callbacks();
  const { rerender } = render(
    <Messages {...props} messages={messages} status="ready" />,
  );
  expect(screen.queryByRole("link", { name: "report.pdf" })).toBeNull();
  const receipt = {
    fileId: "file-report",
    name: "report.pdf",
    mediaType: "application/pdf",
    url: "https://example.com/report-v1.pdf",
  };
  const withReceipt = messages.map((message) =>
    message.id === "new-answer"
      ? { ...message, fileDetails: [receipt] }
      : message,
  ) as ChatMessage[];
  expect(withReceipt[3].parts).toBe(messages[3].parts);
  rerender(<Messages {...props} messages={withReceipt} status="ready" />);
  expect(screen.getByRole("link", { name: "report.pdf" })).toHaveAttribute(
    "href",
    receipt.url,
  );
  const corrected = withReceipt.map((message) =>
    message.id === "new-answer"
      ? {
          ...message,
          fileDetails: [
            {
              ...receipt,
              name: "final-report.pdf",
              url: "https://example.com/report-v2.pdf",
            },
          ],
        }
      : message,
  ) as ChatMessage[];
  rerender(<Messages {...props} messages={corrected} status="ready" />);
  expect(screen.queryByRole("link", { name: "report.pdf" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "final-report.pdf" }),
  ).toHaveAttribute("href", "https://example.com/report-v2.pdf");
  const removed = corrected.map((message) =>
    message.id === "new-answer" ? { ...message, fileDetails: [] } : message,
  );
  rerender(<Messages {...props} messages={removed} status="ready" />);
  expect(screen.queryByRole("link", { name: "final-report.pdf" })).toBeNull();
});
