import { describe, expect, it, jest } from "@jest/globals";

const loadSaveMessageWithMocks = async () => {
  jest.resetModules();
  process.env.NEXT_PUBLIC_CONVEX_URL = "https://example.convex.cloud";

  const mockArchiveMessage = jest.fn().mockResolvedValue({type: "file", fileId: "archive-1", name: "run.json", mediaType: "application/json"});
  jest.doMock("../archive-message", () => ({archiveMessage: mockArchiveMessage}));
  const mockMutation = jest.fn().mockResolvedValue({ id: "message-1" });
  const mockCompactMessageForStorage = jest.fn((message: any) => {
    const sizeBytes = JSON.stringify(message.parts).length;
    return {
      message,
      compacted: false,
      beforeSizeBytes: sizeBytes,
      afterSizeBytes: sizeBytes,
      strippedUiOnlyFields: false,
      prunedCount: 0,
    };
  });

  jest.doMock("server-only", () => ({}), { virtual: true });
  jest.doMock("convex/browser", () => ({
    ConvexHttpClient: class {
      mutation = mockMutation;
      query = jest.fn();
      action = jest.fn();
    },
  }));
  jest.doMock("@/lib/chat/compaction/prune-tool-outputs", () => ({
    compactMessageForStorage: mockCompactMessageForStorage,
  }));

  const { saveMessage } = await import("../actions");
  return { saveMessage, mockCompactMessageForStorage, mockMutation, mockArchiveMessage };
};

describe("saveMessage", () => {
  it("forwards the optional run ownership guard to the storage mutation", async () => {
    const { saveMessage, mockMutation } = await loadSaveMessageWithMocks();
    await saveMessage({
      chatId: "chat-1",
      userId: "user-1",
      expectedTriggerRunId: "run-current",
      message: {
        id: "message-1",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
      },
    });
    expect(mockMutation.mock.calls.at(-1)?.[1]).toEqual(
      expect.objectContaining({ expectedTriggerRunId: "run-current" }),
    );
  });

  it("preserves typed run-lost failures instead of returning success", async () => {
    const { saveMessage, mockMutation } = await loadSaveMessageWithMocks();
    const lost = Object.assign(new Error("This run no longer owns the chat"), {
      data: { code: "AGENT_RUN_LOST" },
    });
    mockMutation.mockRejectedValueOnce(lost);
    await expect(
      saveMessage({
        chatId: "chat-1",
        userId: "user-1",
        expectedTriggerRunId: "run-old",
        message: {
          id: "message-1",
          role: "assistant",
          parts: [{ type: "text", text: "stale" }],
        },
      }),
    ).rejects.toBe(lost);
  });

  it("sanitizes assistant parts before storage compaction", async () => {
    const { saveMessage, mockCompactMessageForStorage } =
      await loadSaveMessageWithMocks();
    const circularOutput: Record<string, unknown> = { ok: true };
    circularOutput.self = circularOutput;

    await expect(
      saveMessage({
        chatId: "chat-1",
        userId: "user-1",
        message: {
          id: "message-1",
          role: "assistant",
          parts: [
            {
              type: "tool-run_terminal_cmd",
              state: "output-available",
              input: { command: "echo hi" },
              output: circularOutput,
            } as any,
          ],
        },
      }),
    ).resolves.toBeDefined();

    const compactedMessage = mockCompactMessageForStorage.mock
      .calls[0]?.[0] as {
      parts: Array<{ output?: unknown }>;
    };

    expect(compactedMessage.parts[0].output).toEqual({
      ok: true,
      self: "[Circular]",
    });
    expect(() => JSON.stringify(compactedMessage.parts)).not.toThrow();
  });

  it("persists one attachment id for a generated-media tool result", async () => {
    const { saveMessage, mockMutation } = await loadSaveMessageWithMocks();

    await saveMessage({
      chatId: "chat-1",
      userId: "user-1",
      message: {
        id: "message-video",
        role: "assistant",
        parts: [
          {
            type: "tool-generate_video",
            state: "output-available",
            output: {
              fileId: "file-video",
              storageId: "storage-video",
              mediaType: "video/mp4",
            },
          } as any,
        ],
      },
      extraFileIds: ["file-video" as any],
    });

    expect(mockMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fileIds: ["file-video"] }),
    );
  });
});


it("never saves compacted placeholders if the original archive cannot commit", async () => {
  const {saveMessage, mockCompactMessageForStorage, mockMutation, mockArchiveMessage} = await loadSaveMessageWithMocks();
  mockCompactMessageForStorage.mockImplementation((message: any) => ({
    message: {...message, parts: [{type: "text", text: "Archived"}]},
    compacted: true, beforeSizeBytes: 2_000_000, afterSizeBytes: 50,
    strippedUiOnlyFields: false, prunedCount: 1,
  }));
  mockArchiveMessage.mockRejectedValueOnce(new Error("Storage unavailable"));
  await expect(saveMessage({chatId: "chat-1", userId: "user-1", message: {
    id: "message-1", role: "assistant", parts: [{type: "text", text: "original"}],
  }})).rejects.toThrow();
  expect(mockMutation).not.toHaveBeenCalled();
  expect(mockArchiveMessage).toHaveBeenCalledWith(expect.objectContaining({
    message: expect.objectContaining({parts: [{type: "text", text: "original"}]}),
  }));
});
