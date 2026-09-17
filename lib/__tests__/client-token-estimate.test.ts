import {
  countInputTokens,
  estimateTextTokens,
} from "@/lib/client-token-estimate";

describe("client token estimate", () => {
  it("uses a small UTF-8 estimate without model tokenizer data", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("abcdef")).toBe(2);
    expect(estimateTextTokens("🐼")).toBe(2);
  });

  it("includes uploaded-file tokens and ignores invalid negative counts", () => {
    expect(
      countInputTokens("abc", [{ tokens: 120 }, { tokens: -20 }, {}]),
    ).toBe(121);
  });
});
