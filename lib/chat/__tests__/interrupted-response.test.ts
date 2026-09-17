import type { ChatMessage } from "@/types/chat";
import { isNetworkStreamError } from "@/lib/errors";
import {
  AGENT_START_TIMEOUT_MESSAGE,
  hasInterruptedPersistedResponse,
  LOST_AGENT_CONNECTION_MESSAGE,
} from "../interrupted-response";

const userMessage = {
  id: "user_1",
  role: "user",
  parts: [{ type: "text", text: "Build it" }],
} as ChatMessage;

const baseState = {
  isExistingChat: true,
  chatLoaded: true,
  hasActiveStream: false,
  status: "ready" as const,
  hasClientError: false,
  messages: [userMessage],
};

describe("hasInterruptedPersistedResponse", () => {
  it("detects a saved trailing user turn after its producer disappeared", () => {
    expect(hasInterruptedPersistedResponse(baseState)).toBe(true);
  });

  it.each([
    ["chat is still loading", { chatLoaded: false }],
    ["producer is still active", { hasActiveStream: true }],
    ["request is submitted", { status: "submitted" as const }],
    ["request is streaming", { status: "streaming" as const }],
    ["useChat already has an error", { hasClientError: true }],
    ["chat is temporary/new", { isExistingChat: false }],
  ])("does not duplicate recovery UI when %s", (_label, patch) => {
    expect(hasInterruptedPersistedResponse({ ...baseState, ...patch })).toBe(
      false,
    );
  });

  it("does not mark a completed assistant turn as interrupted", () => {
    const assistantMessage = {
      id: "assistant_1",
      role: "assistant",
      parts: [{ type: "text", text: "Done" }],
    } as ChatMessage;

    expect(
      hasInterruptedPersistedResponse({
        ...baseState,
        messages: [userMessage, assistantMessage],
      }),
    ).toBe(false);
  });

  const failedPartialResponse = {
    ...baseState,
    lastRunError: "The agent run failed. Your message and saved work are kept.",
    messages: [
      userMessage,
      {
        id: "assistant_partial",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "I created the files and am running the build.",
          },
        ],
      } as ChatMessage,
    ],
  };

  it("surfaces a persisted run failure after partial assistant output on reload", () => {
    expect(hasInterruptedPersistedResponse(failedPartialResponse)).toBe(true);
  });

  it.each([
    ["chat is loading", { chatLoaded: false }],
    ["replacement run is active", { hasActiveStream: true }],
    ["replacement request is submitted", { status: "submitted" as const }],
    ["request is streaming", { status: "streaming" as const }],
    ["client already reports the error", { hasClientError: true }],
    ["chat is new", { isExistingChat: false }],
    ["user stopped the run", { canceledAt: 123 }],
    ["new run cleared the failure", { lastRunError: undefined }],
    ["failure is empty", { lastRunError: "" }],
  ])("does not surface a persisted failure when %s", (_label, patch) => {
    expect(
      hasInterruptedPersistedResponse({ ...failedPartialResponse, ...patch }),
    ).toBe(false);
  });

  it("ignores a hidden auto-continue prompt when the visible assistant turn completed", () => {
    const assistantMessage = {
      id: "assistant_1",
      role: "assistant",
      parts: [{ type: "text", text: "Working" }],
    } as ChatMessage;
    const hiddenContinue = {
      id: "user_hidden",
      role: "user",
      metadata: { isAutoContinue: true },
      parts: [{ type: "text", text: "continue" }],
    } as ChatMessage;

    expect(
      hasInterruptedPersistedResponse({
        ...baseState,
        messages: [userMessage, assistantMessage, hiddenContinue],
      }),
    ).toBe(false);
  });
});

describe("agent connection error classification", () => {
  it("offers reconnect for the durable agent transport error", () => {
    expect(isNetworkStreamError(new Error(LOST_AGENT_CONNECTION_MESSAGE))).toBe(
      true,
    );
  });

  it("offers reconnect when Agent startup times out", () => {
    expect(isNetworkStreamError(new Error(AGENT_START_TIMEOUT_MESSAGE))).toBe(
      true,
    );
  });

  it("stays silent when the user is the one who stopped the run", () => {
    // Stopping before the assistant has said anything leaves the exact state
    // this guard looks for: a saved user message, no assistant turn, no active
    // stream. The banner would blame RIFT for doing what it was told.
    const stopped = {
      isExistingChat: true,
      chatLoaded: true,
      hasActiveStream: false,
      status: "ready" as const,
      hasClientError: false,
      messages: [{ id: "u1", role: "user" as const, parts: [] }],
    };

    expect(hasInterruptedPersistedResponse(stopped)).toBe(true);
    expect(
      hasInterruptedPersistedResponse({ ...stopped, canceledAt: Date.now() }),
    ).toBe(false);
  });
});
