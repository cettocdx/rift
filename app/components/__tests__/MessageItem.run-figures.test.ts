import { formatRunFigures } from "../MessageItem";

describe("formatRunFigures", () => {
  it("reports tokens and cost the way the run row shows them", () => {
    // Above a cent, money reads as money: two decimals.
    expect(formatRunFigures(26188, 0.0525144)).toBe("26.2k · $0.05");
    expect(formatRunFigures(940, 0.42)).toBe("940 · $0.42");
  });

  it("keeps sub-cent runs honest instead of rounding them to $0.00", () => {
    // Most runs land here. Two decimals would report every one of them as free.
    expect(formatRunFigures(1200, 0.0003)).toBe("1.2k · $0.0003");
  });

  it("omits whatever the run did not report", () => {
    expect(formatRunFigures(26188, undefined)).toBe("26.2k");
    expect(formatRunFigures(undefined, 0.05)).toBe("$0.05");
    expect(formatRunFigures(undefined, undefined)).toBeNull();
  });

  it("treats zero and non-finite figures as nothing to report", () => {
    expect(formatRunFigures(0, 0)).toBeNull();
    expect(formatRunFigures(Number.NaN, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
