import {
  createVisibleMessageEntries,
  getMessagePositionFlags,
} from "../Messages";
import { findLastAssistantMessageIndex } from "@/lib/utils/message-utils";
import type { ChatMessage } from "@/types";

function message(id: string, role: "user" | "assistant"): ChatMessage {
  return {
    id,
    role,
    parts: [{ type: "text", text: id }],
  } as ChatMessage;
}

function positionFlags(messages: ChatMessage[]) {
  const lastAssistantMessageIndex = findLastAssistantMessageIndex(messages);
  return messages.map((entry, index) =>
    getMessagePositionFlags({
      message: entry,
      index,
      messagesLength: messages.length,
      lastAssistantMessageIndex,
      branchBoundaryIndex: -1,
    }),
  );
}

describe("long transcript rendering invariants", () => {
  const transcript = Array.from({ length: 200 }, (_, index) =>
    message(`message-${index}`, index % 2 === 0 ? "user" : "assistant"),
  );

  it("keeps 199 historical row keys and position props stable when a turn is appended", () => {
    const beforeKeys = createVisibleMessageEntries(transcript).map(
      (entry) => entry.renderKey,
    );
    const beforePositions = positionFlags(transcript);
    const appended = [...transcript, message("message-200", "assistant")];
    const afterKeys = createVisibleMessageEntries(appended).map(
      (entry) => entry.renderKey,
    );
    const afterPositions = positionFlags(appended);

    expect(afterKeys.slice(0, transcript.length)).toEqual(beforeKeys);
    expect(
      beforePositions.filter(
        (position, index) =>
          JSON.stringify(position) === JSON.stringify(afterPositions[index]),
      ),
    ).toHaveLength(199);
  });

  it("preserves every loaded row key and position prop when a 28-row page is prepended", () => {
    const olderPage = Array.from({ length: 28 }, (_, index) =>
      message(`older-${index}`, index % 2 === 0 ? "user" : "assistant"),
    );
    const beforeKeys = createVisibleMessageEntries(transcript).map(
      (entry) => entry.renderKey,
    );
    const beforePositions = positionFlags(transcript);
    const prepended = [...olderPage, ...transcript];
    const afterKeys = createVisibleMessageEntries(prepended)
      .slice(olderPage.length)
      .map((entry) => entry.renderKey);
    const afterPositions = positionFlags(prepended).slice(olderPage.length);

    expect(afterKeys).toEqual(beforeKeys);
    expect(afterPositions).toEqual(beforePositions);
  });
});
