import {
  hasVisibleLiveReasoning,
  isReasoningRunStreaming,
  type ReasoningStatePart,
} from "../reasoning-state";

const reasoning: ReasoningStatePart = {
  type: "reasoning",
  text: "Checking the files.",
  state: "streaming",
};

describe("visible live reasoning", () => {
  it("keeps metadata after live reasoning from creating a duplicate generic status row", () => {
    const parts = [
      reasoning,
      { type: "data-agent-heartbeat" },
      { type: "data-context-usage" },
    ];
    expect(hasVisibleLiveReasoning(parts, "streaming", true)).toBe(true);
    expect(hasVisibleLiveReasoning(parts, "submitted", true)).toBe(true);
  });

  it.each(["", " \n\t", "[REDACTED]", "[REDACTED]\n [REDACTED] "])(
    "leaves generic status visible when reasoning has no readable content (%j)",
    (text) => {
      expect(
        hasVisibleLiveReasoning([{ ...reasoning, text }], "streaming", true),
      ).toBe(false);
    },
  );

  it("checks all adjacent reasoning text and the final part's state", () => {
    const parts = [{ ...reasoning, text: "", state: "done" }, reasoning];
    expect(hasVisibleLiveReasoning(parts, "streaming", true)).toBe(true);
    expect(
      hasVisibleLiveReasoning(
        [
          { ...reasoning, state: "done" },
          { ...reasoning, state: "done" },
        ],
        "streaming",
        true,
      ),
    ).toBe(false);
    expect(
      hasVisibleLiveReasoning(
        [
          { ...reasoning, text: "[REDACTED]" },
          { ...reasoning, text: "\n[REDACTED]" },
        ],
        "streaming",
        true,
      ),
    ).toBe(false);
  });

  it.each(["text", "tool-file", "data-summarization"])(
    "allows the generic status once %s starts after reasoning",
    (type) => {
      expect(
        hasVisibleLiveReasoning([reasoning, { type }], "streaming", true),
      ).toBe(false);
    },
  );

  it("never calls old, stopped or finished reasoning live", () => {
    expect(hasVisibleLiveReasoning([reasoning], "streaming", false)).toBe(
      false,
    );
    expect(hasVisibleLiveReasoning([reasoning], "ready", true)).toBe(false);
    expect(hasVisibleLiveReasoning([reasoning], "error", true)).toBe(false);
    expect(
      hasVisibleLiveReasoning(
        [{ ...reasoning, state: "done" }],
        "streaming",
        true,
      ),
    ).toBe(false);
  });

  it("keeps legacy reasoning without a per-part state compatible", () => {
    expect(
      isReasoningRunStreaming({
        parts: [{ type: "reasoning", text: "Working" }],
        partIndex: 0,
        status: "streaming",
        isLastMessage: true,
      }),
    ).toBe(true);
  });
});
