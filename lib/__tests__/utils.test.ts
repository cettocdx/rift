import { describe, it, expect } from "@jest/globals";
import { cn, convertToUIMessages } from "../utils";
import type { MessageRecord } from "../utils";
import type { Id } from "@/convex/_generated/dataModel";

describe("utils", () => {
  describe("cn", () => {
    it("should merge class names correctly", () => {
      const result = cn("px-4", "py-2", "bg-blue-500");
      expect(result).toBe("px-4 py-2 bg-blue-500");
    });

    it("should handle conditional classes", () => {
      const isActive = true;
      const result = cn("base-class", isActive && "active-class");
      expect(result).toBe("base-class active-class");
    });

    it("should handle tailwind conflicts", () => {
      const result = cn("px-4", "px-8");
      expect(result).toBe("px-8");
    });
  });

  describe("convertToUIMessages", () => {
    it("should convert MessageRecord array to ChatMessage array", () => {
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "user",
          created_at: 1_700_000_000_000,
          parts: [{ type: "text", text: "Hello" }],
        },
        {
          id: "msg2",
          role: "assistant",
          parts: [{ type: "text", text: "Hi there!" }],
          source_message_id: "msg1",
          feedback: { feedbackType: "positive" },
        },
      ];

      const result = convertToUIMessages(messages);

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("msg1");
      expect(result[0].role).toBe("user");
      expect(result[0].createdAt).toBe(1_700_000_000_000);
      expect(result[0].parts[0]).toEqual({ type: "text", text: "Hello" });
      expect(result[1].sourceMessageId).toBe("msg1");
      expect(result[1].metadata?.feedbackType).toBe("positive");
    });

    it("should handle messages without feedback", () => {
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
        },
      ];

      const result = convertToUIMessages(messages);

      expect(result[0].metadata).toBeUndefined();
    });

    it("should convert generation timing metadata", () => {
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "assistant",
          parts: [{ type: "text", text: "Done" }],
          mode: "agent",
          generation_started_at: 1_000,
          generation_time_ms: 2_500,
        },
      ];

      const result = convertToUIMessages(messages);

      expect(result[0].metadata).toEqual({
        mode: "agent",
        generationStartedAt: 1_000,
        generationTimeMs: 2_500,
      });
    });

    it("carries a durable stopReason so a stopped turn stays recognizable", () => {
      // The chat row's canceled_at is cleared by the next run; the message-level
      // stop_reason is what survives. It must reach the UI metadata intact.
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "assistant",
          parts: [{ type: "text", text: "Partial" }],
          mode: "agent",
          stop_reason: "user",
        },
      ];

      const result = convertToUIMessages(messages);

      expect(result[0].metadata?.stopReason).toBe("user");
    });

    it("ignores an unrecognized stop_reason", () => {
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "assistant",
          parts: [{ type: "text", text: "Done" }],
          stop_reason: "something-else",
        },
      ];

      expect(convertToUIMessages(messages)[0].metadata).toBeUndefined();
    });

    it.each([
      "budget-exhausted",
      "context-limit",
      "doom-loop",
      "preemptive-timeout",
      "timeout",
      "stop",
    ])(
      "preserves the per-message finish_reason %s across history hydration",
      (finishReason) => {
        const messages: MessageRecord[] = [
          {
            id: "answer",
            role: "assistant",
            parts: [{ type: "text", text: "Saved output" }],
            finish_reason: finishReason,
          },
        ];
        expect(convertToUIMessages(messages)[0].metadata?.finishReason).toBe(
          finishReason,
        );
      },
    );

    it("should handle messages with file details", () => {
      const messages: MessageRecord[] = [
        {
          id: "msg1",
          role: "user",
          parts: [{ type: "text", text: "Check this file" }],
          fileDetails: [
            {
              fileId: "file1" as Id<"files">,
              name: "document.pdf",
              url: "https://example.com/document.pdf",
            },
          ],
        },
      ];

      const result = convertToUIMessages(messages);

      expect(result[0].fileDetails).toHaveLength(1);
      expect(result[0].fileDetails?.[0].name).toBe("document.pdf");
    });
  });
});
