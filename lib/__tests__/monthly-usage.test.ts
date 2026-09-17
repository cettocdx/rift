import {
  aggregateMonthlyUsage,
  getUtcMonthRange,
} from "../monthly-usage";

describe("monthly usage aggregation", () => {
  it("uses canonical usage logs for token and model totals", () => {
    const summary = aggregateMonthlyUsage(
      [
        {
          model: "model-gpt-5.6-sol",
          input_tokens: 1_000,
          output_tokens: 400,
          cache_read_tokens: 250,
          cache_write_tokens: 50,
          total_tokens: 1_400,
        },
        {
          model: "openai/gpt-5.6-sol-20260708",
          input_tokens: 600,
          output_tokens: 200,
          cache_read_tokens: 100,
          cache_write_tokens: 0,
          total_tokens: 800,
        },
        {
          model: "model-grok-4.5",
          input_tokens: 300,
          output_tokens: 100,
          total_tokens: 400,
        },
      ],
      [],
    );

    expect(summary).toMatchObject({
      hasUsage: true,
      requestCount: 3,
      tokenSource: "usage_logs",
      inputTokens: 1_900,
      outputTokens: 700,
      totalTokens: 2_600,
      cacheReadTokens: 350,
      cacheWriteTokens: 50,
      reasoningTokens: null,
      toolOperations: null,
    });
    expect(summary.models).toEqual([
      { model: "gpt-5.6-sol", requests: 2, tokens: 2_200 },
      { model: "grok-4.5", requests: 1, tokens: 400 },
    ]);
  });

  it("uses persisted message usage only when the usage ledger is empty", () => {
    const summary = aggregateMonthlyUsage([], [
      {
        id: "assistant-1",
        model: "x-ai/grok-4.5",
        usage: {
          inputTokens: 900,
          outputTokens: 300,
          totalTokens: 1_200,
          inputTokenDetails: {
            cacheReadTokens: 500,
            cacheWriteTokens: 40,
          },
          outputTokenDetails: { reasoningTokens: 180 },
        },
        parts: [{ type: "text", text: "Done" }],
      },
    ]);

    expect(summary).toMatchObject({
      requestCount: 1,
      tokenSource: "messages",
      inputTokens: 900,
      outputTokens: 300,
      totalTokens: 1_200,
      cacheReadTokens: 500,
      cacheWriteTokens: 40,
      reasoningTokens: 180,
      toolOperations: 0,
    });
    expect(summary.models).toEqual([
      { model: "grok-4.5", requests: 1, tokens: 1_200 },
    ]);
  });

  it("counts only real unique tool, media, and subagent parts", () => {
    const delegatePart = {
      type: "tool-delegate_task",
      toolCallId: "delegate-1",
      input: { name: "Ada", role: "reviewer" },
      output: { agent: { name: "Ada", role: "reviewer" } },
    };
    const summary = aggregateMonthlyUsage([], [
      {
        id: "assistant-1",
        parts: [
          delegatePart,
          { type: "tool-generate_image", toolCallId: "image-1" },
          { type: "tool-generate_video", toolCallId: "video-1" },
          { type: "tool-run_terminal_cmd", toolCallId: "terminal-1" },
        ],
      },
      {
        id: "assistant-2",
        parts: [
          delegatePart,
          {
            type: "tool-delegate_task",
            toolCallId: "delegate-2",
            input: { name: "Ada", role: "reviewer" },
          },
        ],
      },
    ]);

    expect(summary).toMatchObject({
      hasUsage: true,
      requestCount: 0,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      toolOperations: 5,
      imageOperations: 1,
      videoOperations: 1,
    });
    expect(summary.subagents).toEqual([
      { name: "Ada", role: "reviewer", runs: 2 },
    ]);
  });

  it("keeps unavailable provider fields null instead of inventing zeroes", () => {
    const summary = aggregateMonthlyUsage(
      [
        {
          model: "model-gpt-5.5",
          input_tokens: 10,
          output_tokens: 5,
          total_tokens: 15,
        },
      ],
      [],
    );

    expect(summary.cacheReadTokens).toBeNull();
    expect(summary.cacheWriteTokens).toBeNull();
    expect(summary.reasoningTokens).toBeNull();
    expect(summary.imageOperations).toBeNull();
    expect(summary.videoOperations).toBeNull();
    expect(summary.subagents).toBeNull();
  });

  it("returns an explicit empty state when no source recorded usage", () => {
    expect(aggregateMonthlyUsage([], [])).toEqual({
      hasUsage: false,
      requestCount: 0,
      tokenSource: null,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      reasoningTokens: null,
      toolOperations: null,
      imageOperations: null,
      videoOperations: null,
      models: [],
      subagents: null,
    });
  });

  it("builds a UTC calendar-month range", () => {
    const { start, end } = getUtcMonthRange(
      Date.parse("2026-07-16T02:30:00+03:00"),
    );

    expect(new Date(start).toISOString()).toBe("2026-07-01T00:00:00.000Z");
    expect(new Date(end).toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });
});
