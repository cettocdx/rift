import { getRunUsageTotals } from "../agent-activity";

const finished = (totalTokens: number, costDollars: number) => ({
  role: "assistant",
  metadata: { totalTokens, costDollars },
  parts: [{ type: "text", text: "done" }],
});

const streaming = (text: string) => ({
  role: "assistant",
  parts: [{ type: "text", text }],
});

describe("getRunUsageTotals", () => {
  it("uses the exact server figures once a turn reports them", () => {
    expect(
      getRunUsageTotals([
        { role: "user", parts: [{ type: "text", text: "hi" }] },
        finished(26188, 0.0525),
        finished(1000, 0.002),
      ]),
    ).toEqual({
      tokens: 27188,
      costDollars: 0.0545,
      isEstimated: false,
    });
  });

  it("prices the streaming turn at the rate this chat was actually charged", () => {
    // 1000 tokens cost $0.10 -> $0.0001/token. The streaming text is estimated
    // and priced at that observed rate, not at a guessed tariff.
    const totals = getRunUsageTotals([
      finished(1000, 0.1),
      streaming("abcdef"),
    ]);

    expect(totals.isEstimated).toBe(true);
    expect(totals.tokens).toBeGreaterThan(1000);
    expect(totals.costDollars).toBeCloseTo(totals.tokens * 0.0001, 6);
  });

  it("counts tokens but claims no cost before anything has been billed", () => {
    const totals = getRunUsageTotals([streaming("hello there")]);

    expect(totals.tokens).toBeGreaterThan(0);
    expect(totals.costDollars).toBe(0);
    expect(totals.isEstimated).toBe(true);
  });

  it("ignores user turns and reports nothing for an empty chat", () => {
    expect(
      getRunUsageTotals([
        { role: "user", parts: [{ type: "text", text: "x" }] },
      ]),
    ).toEqual({ tokens: 0, costDollars: 0, isEstimated: false });
    expect(getRunUsageTotals([])).toEqual({
      tokens: 0,
      costDollars: 0,
      isEstimated: false,
    });
  });
});
