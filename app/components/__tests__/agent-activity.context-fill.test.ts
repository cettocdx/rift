import { getContextFillTokens } from "../agent-activity";

const turn = (inputTokens?: number, totalTokens = 1000) => ({
  role: "assistant",
  metadata:
    inputTokens === undefined ? { totalTokens } : { inputTokens, totalTokens },
  parts: [{ type: "text", text: "ok" }],
});

describe("getContextFillTokens", () => {
  it("uses the latest provider input instead of cumulative multistep usage", () => {
    const message = turn(68400);
    expect(
      getContextFillTokens([
        {
          ...message,
          metadata: { ...message.metadata, contextInputTokens: 14000 },
        },
      ]),
    ).toBe(14000);
  });
  it("does not replace a reported zero context with the run total", () => {
    const message = turn(68400);
    expect(
      getContextFillTokens([
        {
          ...message,
          metadata: { ...message.metadata, contextInputTokens: 0 },
        },
      ]),
    ).toBe(0);
  });
  it("reports the newest turn's input, not the conversation's total", () => {
    // Three turns costing 1000 tokens each did not fill the window with 3000:
    // each request sent what the last one reports.
    expect(getContextFillTokens([turn(9000), turn(18000), turn(26100)])).toBe(
      26100,
    );
  });

  it("falls back to the last turn that reported an input count", () => {
    expect(getContextFillTokens([turn(9000), turn(undefined)])).toBe(9000);
  });

  it("ignores user turns", () => {
    expect(
      getContextFillTokens([
        turn(9000),
        { role: "user", parts: [{ type: "text", text: "next" }] },
      ]),
    ).toBe(9000);
  });

  it("reports nothing before any turn has run", () => {
    expect(getContextFillTokens([])).toBe(0);
    expect(getContextFillTokens([turn(undefined)])).toBe(0);
  });
});
