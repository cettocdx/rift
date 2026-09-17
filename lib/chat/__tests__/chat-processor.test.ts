import { describe, it, expect } from "@jest/globals";
import { UIMessage } from "ai";
import {
  BUILD_MODELS,
  DEFAULT_BUILD_MODEL,
  formatBuildModelContext,
} from "@/types/chat";
import {
  processChatMessages,
  limitImageParts,
  selectModel,
  getMaxStepsForUser,
  fixIncompleteMessageParts,
} from "../chat-processor";

function makeFilePart(id: string, mediaType = "image/png") {
  return { type: "file", fileId: id, mediaType, name: `${id}.png`, size: 100 };
}

function makeMessage(
  id: string,
  role: "user" | "assistant",
  parts: any[],
): UIMessage {
  return { id, role, parts } as UIMessage;
}

describe("limitImageParts", () => {
  it("should return messages unchanged when under the limit", () => {
    const messages = [
      makeMessage("m1", "user", [
        { type: "text", text: "hello" },
        makeFilePart("f1"),
      ]),
    ];
    const result = limitImageParts(messages);
    expect(result).toBe(messages); // same reference, no changes
  });

  it("should return messages unchanged when exactly at the ask limit (10 images)", () => {
    const parts = Array.from({ length: 10 }, (_, i) => makeFilePart(`f${i}`));
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "ask");
    expect(result).toBe(messages);
  });

  it("should remove oldest images when over the ask limit", () => {
    const parts = Array.from({ length: 15 }, (_, i) => makeFilePart(`f${i}`));
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "ask");

    const remainingFiles = result[0].parts.filter(
      (p: any) => p.type === "file",
    );
    expect(remainingFiles).toHaveLength(10);
    // Should keep f5..f14 (the 10 most recent), removing f0..f4
    expect((remainingFiles[0] as any).fileId).toBe("f5");
    expect((remainingFiles[9] as any).fileId).toBe("f14");
  });

  it("should remove oldest images across multiple messages in ask mode", () => {
    // 3 messages with 5 images each = 15 total, should keep last 10
    const messages = Array.from({ length: 3 }, (_, msgIdx) => {
      const parts = Array.from({ length: 5 }, (_, fileIdx) =>
        makeFilePart(`f${msgIdx * 5 + fileIdx}`),
      );
      return makeMessage(`m${msgIdx}`, "user", parts);
    });

    const result = limitImageParts(messages, "ask");

    const allFiles = result.flatMap((msg) =>
      msg.parts.filter((p: any) => p.type === "file"),
    );
    expect(allFiles).toHaveLength(10);
    // Oldest 5 images (f0..f4) from first message should be removed
    expect((allFiles[0] as any).fileId).toBe("f5");
    expect((allFiles[9] as any).fileId).toBe("f14");
  });

  it("should preserve non-file parts when removing images", () => {
    const parts: any[] = [
      { type: "text", text: "check these images" },
      ...Array.from({ length: 12 }, (_, i) => makeFilePart(`f${i}`)),
    ];
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "ask");

    const textParts = result[0].parts.filter((p: any) => p.type === "text");
    const fileParts = result[0].parts.filter((p: any) => p.type === "file");

    expect(textParts).toHaveLength(1);
    expect((textParts[0] as any).text).toBe("check these images");
    expect(fileParts).toHaveLength(10);
  });

  it("should handle messages with no parts", () => {
    const messages = [
      { id: "m1", role: "user" } as UIMessage,
      makeMessage("m2", "user", [makeFilePart("f1")]),
    ];
    const result = limitImageParts(messages);
    expect(result).toBe(messages); // under limit, no changes
  });

  it("should only limit images, leaving PDFs and other file types untouched", () => {
    const parts = Array.from({ length: 25 }, (_, i) =>
      makeFilePart(`f${i}`, i % 2 === 0 ? "image/png" : "application/pdf"),
    );
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "ask");

    const remainingFiles = result[0].parts.filter(
      (p: any) => p.type === "file",
    );
    const images = remainingFiles.filter(
      (p: any) => p.mediaType === "image/png",
    );
    const pdfs = remainingFiles.filter(
      (p: any) => p.mediaType === "application/pdf",
    );

    // All 12 PDFs should remain (odd indices: 1,3,5,...,23 = 12 PDFs)
    expect(pdfs).toHaveLength(12);
    // Only 10 most recent images should remain (even indices: 0,2,4,...,24 = 13 images, keep last 10)
    expect(images).toHaveLength(10);
  });

  it("should not remove any files when all are non-image types", () => {
    const parts = Array.from({ length: 20 }, (_, i) =>
      makeFilePart(`f${i}`, "application/pdf"),
    );
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages);
    expect(result).toBe(messages); // no images, nothing to limit
  });

  it("should allow 20 images in agent mode", () => {
    const parts = Array.from({ length: 20 }, (_, i) => makeFilePart(`f${i}`));
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "agent");
    expect(result).toBe(messages);
  });

  it("should remove oldest images only after the agent limit", () => {
    const parts = Array.from({ length: 25 }, (_, i) => makeFilePart(`f${i}`));
    const messages = [makeMessage("m1", "user", parts)];
    const result = limitImageParts(messages, "agent");

    const remainingFiles = result[0].parts.filter(
      (p: any) => p.type === "file",
    );
    expect(remainingFiles).toHaveLength(20);
    expect((remainingFiles[0] as any).fileId).toBe("f5");
    expect((remainingFiles[19] as any).fileId).toBe("f24");
  });
});

// ==========================================================================
// selectModel - Model selection logic
// ==========================================================================
describe("Build model catalog", () => {
  it("shows only the verified current frontier models", () => {
    expect(BUILD_MODELS.map((entry) => entry.model)).toEqual([
      "GPT-5.6 Sol",
      "GPT-6 Astra",
      "Gemini 3.8 Flash",
      "Claude Opus 5",
      "Claude Fable 5.1",
      "Grok 4.6",
      "Kimi K3",
      "Qwen3.8 Max",
      "GLM 5.3",
      "Hy4 preview",
    ]);
    expect(
      Object.fromEntries(
        BUILD_MODELS.map((entry) => [
          entry.id,
          formatBuildModelContext(entry.contextTokens),
        ]),
      ),
    ).toEqual({
      "build-codex": "1.05M context",
      "build-astra": "1.05M context",
      "build-gemini": "1.05M context",
      "build-max": "1M context",
      "build-fable": "1M context",
      "build-grok": "500K context",
      "build-kimi": "1.05M context",
      "build-qwen": "1M context",
      "build-glm": "1.05M context",
      "build-hunyuan": "1.05M context",
    });
    expect(DEFAULT_BUILD_MODEL).toBe("build-codex");
  });
});

describe("selectModel (single-model product)", () => {
  // Every mode, subscription, tier override, and attachment state resolves to
  // the one model (Grok 4.3). No tier selection is offered in the UI.
  it("returns the single model regardless of mode", () => {
    expect(selectModel("agent", "pro")).toBe("model-grok-4.3");
    expect(selectModel("ask", "pro")).toBe("model-grok-4.3");
  });

  it("returns the single model regardless of subscription", () => {
    expect(selectModel("agent", "free")).toBe("model-grok-4.3");
    expect(selectModel("ask", "free")).toBe("model-grok-4.3");
    expect(selectModel("agent", "ultra")).toBe("model-grok-4.3");
    expect(selectModel("ask", "team")).toBe("model-grok-4.3");
  });

  it("ignores any tier override", () => {
    expect(selectModel("agent", "pro", "rift-standard")).toBe("model-grok-4.3");
    expect(selectModel("agent", "pro", "rift-pro")).toBe("model-grok-4.3");
    expect(selectModel("agent", "pro", "rift-max")).toBe("model-grok-4.3");
    expect(selectModel("ask", "pro", "rift-max")).toBe("model-grok-4.3");
    expect(selectModel("agent", "pro", "auto")).toBe("model-grok-4.3");
  });

  it("ignores image/PDF attachment state", () => {
    expect(selectModel("ask", "pro", undefined, true)).toBe("model-grok-4.3");
    expect(selectModel("ask", "pro", "rift-standard", true)).toBe(
      "model-grok-4.3",
    );
  });

  it("uses Grok 4.6 for the Hacker Mode security-agent canary", () => {
    expect(
      selectModel("agent", "pro", undefined, false, "security", true),
    ).toBe("model-grok-4.6");
    expect(selectModel("ask", "pro", undefined, false, "security", true)).toBe(
      "model-grok-4.3",
    );
    expect(selectModel("agent", "pro", undefined, false, "app", true)).toBe(
      "model-gpt-5.6-sol",
    );
  });

  it("routes Build selections only to the verified frontier catalog", () => {
    expect(selectModel("agent", "pro", undefined, false, "app")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(selectModel("agent", "pro", "build-balanced", false, "app")).toBe(
      "model-fable-5.1",
    );
    expect(selectModel("agent", "pro", "build-fast", false, "app")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(selectModel("agent", "pro", "build-grok", false, "app")).toBe(
      "model-grok-4.6",
    );
    expect(selectModel("agent", "pro", "build-kimi", false, "app")).toBe(
      "model-kimi-k3",
    );
    expect(selectModel("agent", "pro", "build-qwen", false, "app")).toBe(
      "model-qwen3.8-max",
    );
    expect(selectModel("agent", "pro", "build-glm", false, "app")).toBe(
      "model-glm-5.3",
    );
    expect(selectModel("agent", "pro", "build-max", false, "app")).toBe(
      "model-opus-5",
    );
  });

  it("upgrades hidden legacy Build selections instead of routing retired models", () => {
    expect(selectModel("agent", "pro", "build-glm", false, "app")).toBe(
      "model-glm-5.3",
    );
    expect(selectModel("agent", "pro", "build-deepseek", false, "app")).toBe(
      "model-gpt-5.6-sol",
    );
    expect(selectModel("agent", "pro", "build-opus46", false, "app")).toBe(
      "model-opus-5",
    );
  });

  it("uses Fable 5.1 for image-tool orchestration", () => {
    expect(selectModel("agent", "pro", undefined, false, "image")).toBe(
      "model-fable-5.1",
    );
  });
});

// ==========================================================================
// getMaxStepsForUser - Step limits by mode and subscription
// ==========================================================================
describe("getMaxStepsForUser", () => {
  it("should return 100 steps for agent mode (all tiers)", () => {
    expect(getMaxStepsForUser("agent", "free")).toBe(100);
    expect(getMaxStepsForUser("agent", "pro")).toBe(100);
    expect(getMaxStepsForUser("agent", "ultra")).toBe(100);
    expect(getMaxStepsForUser("agent", "team")).toBe(100);
  });

  it("should return 15 steps for free ask mode", () => {
    expect(getMaxStepsForUser("ask", "free")).toBe(15);
  });

  it("should return 100 steps for paid ask mode", () => {
    expect(getMaxStepsForUser("ask", "pro")).toBe(100);
    expect(getMaxStepsForUser("ask", "ultra")).toBe(100);
    expect(getMaxStepsForUser("ask", "team")).toBe(100);
  });
});

// ==========================================================================
// fixIncompleteMessageParts - Fixing incomplete tool invocations on abort
// ==========================================================================
describe("fixIncompleteMessageParts", () => {
  it("should not modify already-complete tool parts", () => {
    const parts = [
      { type: "step-start" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "output-available",
        input: { title: "Test" },
        output: { message: "Created" },
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toEqual(parts);
  });

  it("should mark incomplete renderable tool with input as aborted", () => {
    const parts = [
      { type: "step-start" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "input-available",
        input: { title: "Test", content: "Content" },
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("step-start");
    expect(result[1]).toMatchObject({
      type: "tool-create_note",
      toolCallId: "call_1",
      state: "output-error",
      input: { title: "Test", content: "Content" },
      errorText: "Stopped by user before the tool completed.",
    });
  });

  it("should remove tool parts with input-streaming and no input", () => {
    const parts = [
      { type: "step-start" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "input-streaming",
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(0);
  });

  it("should remove tool parts with undefined input", () => {
    const parts = [
      { type: "text", text: "Let me help" },
      { type: "step-start" },
      {
        type: "tool-file",
        toolCallId: "call_2",
        state: "input-streaming",
        input: undefined,
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    // Text should remain, step-start and tool should be removed
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("text");
  });

  it("should mark incomplete tool with partial meaningful input as aborted", () => {
    const parts = [
      { type: "step-start" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "input-streaming",
        input: { title: "Partial" },
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      type: "tool-create_note",
      state: "output-error",
      input: { title: "Partial" },
      errorText: "Stopped by user before the tool completed.",
    });
  });

  it("should mark incomplete file writes with streamed path metadata as aborted", () => {
    const parts = [
      { type: "step-start" },
      {
        input: {
          action: "write",
          brief: "Test with cloudscraper to handle Cloudflare challenge",
          path: "/home/user/telenet_cloudscraper.py",
        },
        state: "input-streaming",
        toolCallId: "toolu_vrtx_01CY5UvLdoBKwymCRD5TB8r3",
        type: "tool-file",
      },
    ];

    const result = fixIncompleteMessageParts(parts);

    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({
      type: "tool-file",
      state: "output-error",
      toolCallId: "toolu_vrtx_01CY5UvLdoBKwymCRD5TB8r3",
      input: {
        action: "write",
        brief: "Test with cloudscraper to handle Cloudflare challenge",
        path: "/home/user/telenet_cloudscraper.py",
      },
      errorText: "Stopped by user before the tool completed.",
    });
  });

  it("should handle mixed complete and incomplete parts", () => {
    const parts = [
      { type: "step-start" },
      { type: "text", text: "I'll create a note" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "output-available",
        input: { title: "Done" },
        output: { message: "Created" },
      },
      { type: "step-start" },
      {
        type: "tool-file",
        toolCallId: "call_2",
        state: "input-streaming",
        // No input - interrupted
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    // Should keep first step-start, text, and completed tool; remove second step-start and incomplete tool
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("step-start");
    expect(result[1].type).toBe("text");
    expect(result[2].type).toBe("tool-create_note");
    expect(result[2].state).toBe("output-available");
  });

  it("should preserve existing output on incomplete tool with input", () => {
    const parts = [
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "input-available",
        input: { title: "Test" },
        output: { message: "Partial result" },
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result[0].state).toBe("output-available");
    expect(result[0].output).toEqual({ message: "Partial result" });
  });

  it("should preserve error tool parts", () => {
    const parts = [
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "output-error",
        errorText: "Something went wrong",
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(1);
    expect(result[0].errorText).toBe("Something went wrong");
  });

  // Trailing incomplete step trimming (Gemini "must include at least one parts field" fix)
  it("should trim trailing step with only reasoning (no text/tool content)", () => {
    const parts = [
      { type: "step-start" },
      { type: "reasoning", state: "done", text: "Thinking about step 1..." },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "output-available",
        input: { title: "Note" },
        output: { message: "Created" },
      },
      { type: "step-start" },
      {
        type: "reasoning",
        state: "done",
        text: "Thinking about step 2 but interrupted...",
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    // Should keep first step with content, remove trailing step-start + reasoning
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("step-start");
    expect(result[1].type).toBe("reasoning");
    expect(result[2].type).toBe("tool-create_note");
  });

  it("should not trim trailing step that has text content", () => {
    const parts = [
      { type: "step-start" },
      {
        type: "tool-create_note",
        toolCallId: "call_1",
        state: "output-available",
        input: { title: "Note" },
        output: { message: "Created" },
      },
      { type: "step-start" },
      { type: "reasoning", state: "done", text: "Let me explain..." },
      { type: "text", text: "Here is the result." },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(5);
  });

  it("should not trim trailing step that has tool content", () => {
    const parts = [
      { type: "step-start" },
      { type: "reasoning", state: "done", text: "Thinking..." },
      {
        type: "tool-file",
        toolCallId: "call_1",
        state: "output-available",
        input: { action: "read" },
        output: { content: "file data" },
      },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(3);
  });

  it("should trim single step with only reasoning to empty array", () => {
    const parts = [
      { type: "step-start" },
      { type: "reasoning", state: "done", text: "Just thinking..." },
    ];
    const result = fixIncompleteMessageParts(parts);
    expect(result).toHaveLength(0);
  });

  it("should trim trailing step with multiple reasoning parts but no content", () => {
    const parts = [
      { type: "step-start" },
      { type: "text", text: "I found the issue." },
      { type: "step-start" },
      { type: "reasoning", state: "done", text: "First thought..." },
      { type: "reasoning", state: "done", text: "Second thought..." },
    ];
    const result = fixIncompleteMessageParts(parts);
    // Should keep first step, remove trailing step-start + both reasoning parts
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("step-start");
    expect(result[1].type).toBe("text");
  });
});

describe("run archive model boundary", () => {
  it("keeps the downloadable archive out of automatic model context", async () => {
    const { filterUIOnlyParts } = await import("../chat-processor");
    const parts = [
      { type: "text", text: "Done" },
      { type: "file", fileId: "archive", isRunArchive: true },
      { type: "file", fileId: "normal" },
    ];
    expect(filterUIOnlyParts({ parts }).parts).toEqual([parts[0], parts[2]]);
    expect(parts).toHaveLength(3);
  });
});

describe("historical PTY model projection", () => {
  it("retains full historical evidence when a sandbox-local artifact may have expired", async () => {
    const snapshot = "old log evidence\n".repeat(1000);
    const part = {
      type: "tool-interact_terminal_session",
      state: "output-available",
      toolCallId: "poll",
      input: { action: "wait", session: "fixture" },
      output: {
        result: {
          output: "",
          sessionSnapshot: snapshot,
          rawSnapshot: snapshot,
          modelContext: {
            screen: "current prompt>",
            scrollback: {
              path: "/tmp/terminal_full_output/fixture.txt",
              characters: snapshot.length,
              scope: "retained PTY snapshot",
            },
          },
        },
      },
    };
    const messages = [
      makeMessage("user", "user", [{ type: "text", text: "Continue" }]),
      makeMessage("assistant", "assistant", [part]),
    ];
    const result = await processChatMessages({
      messages,
      mode: "agent",
      userId: "fixture",
      subscription: "pro",
      purpose: "app",
      deferModeration: true,
    });
    const serialized = JSON.stringify(result.processedMessages);
    expect(serialized).not.toContain("current prompt>");
    expect(serialized).not.toContain("/tmp/terminal_full_output/fixture.txt");
    expect(serialized).toContain("old log evidence");
    expect(part.output.result.sessionSnapshot).toBe(snapshot);
    expect(part.output.result.rawSnapshot).toBe(snapshot);
  });
});

describe("persisted archive recovery", () => {
  it("keeps an agent recovery hint without eagerly downloading or trusting archive metadata", async () => {
    const messages = [
      makeMessage("old", "assistant", [
        { type: "text", text: "Operation details were compacted." },
        {
          type: "file",
          fileId: "untrusted-id",
          mediaType: "application/json",
          isRunArchive: true,
          url: "https://expired.example/archive",
          text: "ARCHIVE_ONLY_SENTINEL",
        },
      ]),
      makeMessage("new", "user", [
        { type: "text", text: "Recover the omitted detail" },
      ]),
    ];
    const result = await processChatMessages({
      messages,
      mode: "agent",
      userId: "owner-fixture",
      subscription: "pro",
      purpose: "app",
      uploadBasePath: "/tmp/fresh-sandbox",
      deferModeration: true,
    });
    expect(result.sandboxFiles).toEqual([]);
    const context = JSON.stringify(result.processedMessages);
    expect(context).toContain("read_run_archive");
    expect(context).not.toContain("ARCHIVE_ONLY_SENTINEL");
    expect(context).not.toContain("untrusted-id");
    expect(context).not.toContain("https://expired.example/archive");
    expect(result.processedMessages.map((message) => message.id)).toEqual([
      "old",
      "new",
    ]);
    expect(messages[0].parts).toHaveLength(2);
    const { filterUIOnlyParts } = await import("../chat-processor");
    expect(JSON.stringify(filterUIOnlyParts(messages[0]))).not.toContain(
      "read_run_archive",
    );
    expect(
      JSON.stringify(filterUIOnlyParts({ ...messages[0], role: "user" }, true)),
    ).not.toContain("read_run_archive");
  });
});
