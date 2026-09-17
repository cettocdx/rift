import { THINKING_WORDS, pickThinkingWord } from "../thinking-words";

describe("thinking words", () => {
  it("offers a deep, unique set of gerunds", () => {
    expect(THINKING_WORDS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(THINKING_WORDS).size).toBe(THINKING_WORDS.length);
    THINKING_WORDS.forEach((word) => {
      expect(word).toMatch(/^[A-Z][a-z]+ing$/);
    });
  });

  it("keeps one run on one word", () => {
    // The row re-renders on every stream delta. A random pick would reshuffle
    // the word several times a second.
    expect(pickThinkingWord(1_786_500_000_000)).toBe(
      pickThinkingWord(1_786_500_000_000),
    );
    expect(pickThinkingWord("working")).toBe(pickThinkingWord("working"));
  });

  it("spreads different runs across the list", () => {
    const picked = new Set(
      Array.from({ length: 200 }, (_, index) =>
        pickThinkingWord(1_786_500_000_000 + index * 997),
      ),
    );
    expect(picked.size).toBeGreaterThan(20);
  });

  it("always returns a word from the list", () => {
    [0, -1, "", "x", Number.MAX_SAFE_INTEGER].forEach((seed) => {
      expect(THINKING_WORDS).toContain(pickThinkingWord(seed));
    });
  });
});
