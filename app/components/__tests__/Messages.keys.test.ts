import {
  createVisibleMessageEntries,
  getMessagePositionFlags,
  shouldShowStandaloneAgentStatus,
} from "../Messages";
import type { ChatMessage } from "@/types";

const message = (id: string): ChatMessage =>
  ({
    id,
    role: "assistant",
    parts: [{ type: "text", text: id }],
  }) as ChatMessage;

describe("createVisibleMessageEntries", () => {
  it("creates collision-free keys when a Trigger run is present twice", () => {
    const runId = "run_cmrjndhz8b1b70oont3c22x7i";
    const entries = createVisibleMessageEntries([
      message(runId),
      message("user-message"),
      message(runId),
    ]);

    expect(entries.map((entry) => entry.renderKey)).toEqual([
      JSON.stringify([runId, 0]),
      JSON.stringify(["user-message", 0]),
      JSON.stringify([runId, 1]),
    ]);
    expect(new Set(entries.map((entry) => entry.renderKey)).size).toBe(3);
  });

  it("keeps existing keys stable when reconnect appends another copy", () => {
    const initial = [message("user-message"), message("run-123")];
    const before = createVisibleMessageEntries(initial);
    const after = createVisibleMessageEntries([...initial, message("run-123")]);

    expect(
      after.slice(0, before.length).map((entry) => entry.renderKey),
    ).toEqual(before.map((entry) => entry.renderKey));
    expect(after[2].renderKey).toBe(JSON.stringify(["run-123", 1]));
  });

  it("cannot collide when ids contain tuple-like delimiters", () => {
    const entries = createVisibleMessageEntries([
      message("alpha"),
      message("alpha"),
      message('["alpha",1]'),
    ]);

    expect(new Set(entries.map((entry) => entry.renderKey)).size).toBe(3);
  });
});

describe("getMessagePositionFlags", () => {
  it("keeps historical row positions stable when older pages are prepended", () => {
    const assistant = {
      ...message("assistant-1"),
      role: "assistant",
    } as ChatMessage;

    const before = getMessagePositionFlags({
      message: assistant,
      index: 2,
      messagesLength: 4,
      lastAssistantMessageIndex: 2,
      branchBoundaryIndex: -1,
    });
    const afterPrepend = getMessagePositionFlags({
      message: assistant,
      index: 30,
      messagesLength: 32,
      lastAssistantMessageIndex: 30,
      branchBoundaryIndex: -1,
    });

    expect(afterPrepend).toEqual(before);
  });

  it("invalidates only the positional roles that actually move", () => {
    const assistant = {
      ...message("assistant-1"),
      role: "assistant",
    } as ChatMessage;

    expect(
      getMessagePositionFlags({
        message: assistant,
        index: 0,
        messagesLength: 1,
        lastAssistantMessageIndex: 0,
        branchBoundaryIndex: -1,
      }),
    ).toEqual({
      isLastMessage: true,
      isLastAssistantMessage: true,
      isBranchBoundary: false,
    });
    expect(
      getMessagePositionFlags({
        message: assistant,
        index: 0,
        messagesLength: 2,
        lastAssistantMessageIndex: 0,
        branchBoundaryIndex: -1,
      }),
    ).toEqual({
      isLastMessage: false,
      isLastAssistantMessage: true,
      isBranchBoundary: false,
    });
  });
});

describe("shouldShowStandaloneAgentStatus", () => {
  const userMessage = {
    id: "user-latest",
    role: "user",
    parts: [{ type: "text", text: "Keep building" }],
  } as ChatMessage;

  it("keeps the submitted state visible after an earlier assistant turn", () => {
    expect(
      shouldShowStandaloneAgentStatus({
        messages: [message("assistant-old"), userMessage],
        status: "submitted",
        isAutoResuming: false,
        hasBlockingProcessStatus: false,
      }),
    ).toBe(true);
  });

  it("covers an empty assistant shell before its first stream part", () => {
    expect(
      shouldShowStandaloneAgentStatus({
        messages: [
          userMessage,
          {
            id: "assistant-empty",
            role: "assistant",
            parts: [],
          } as ChatMessage,
        ],
        status: "streaming",
        isAutoResuming: false,
        hasBlockingProcessStatus: false,
      }),
    ).toBe(true);
  });

  it("hands activity off to the inline row after the first assistant part", () => {
    expect(
      shouldShowStandaloneAgentStatus({
        messages: [userMessage, message("assistant-live")],
        status: "streaming",
        isAutoResuming: false,
        hasBlockingProcessStatus: false,
      }),
    ).toBe(false);
  });

  it("shows durable recovery before useChat changes out of ready", () => {
    expect(
      shouldShowStandaloneAgentStatus({
        messages: [userMessage],
        status: "ready",
        isAutoResuming: true,
        hasBlockingProcessStatus: false,
      }),
    ).toBe(true);
  });

  it("lets upload and summarization status take precedence", () => {
    expect(
      shouldShowStandaloneAgentStatus({
        messages: [userMessage],
        status: "submitted",
        isAutoResuming: true,
        hasBlockingProcessStatus: true,
      }),
    ).toBe(false);
  });
});
