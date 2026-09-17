import { formatModelPrice } from "../model-price";
import { RETAIL_MARGIN } from "@/lib/rate-limit/token-bucket";

describe("formatModelPrice", () => {
  it("quotes the price the user is charged, not the raw provider rate", () => {
    // Grok 4.5 costs $2/$6 per million at the provider; the user pays the
    // retail multiple. Quoting the raw rate would understate every bill.
    expect(RETAIL_MARGIN).toBe(2.5);
    expect(formatModelPrice("model-grok-4.5")).toEqual({
      input: "$5",
      output: "$15",
    });
  });

  it("keeps whole dollars whole and fractions to cents", () => {
    expect(formatModelPrice("model-grok-4.3")).toEqual({
      input: "$3.13",
      output: "$6.25",
    });
    expect(formatModelPrice("model-opus-4.8")).toEqual({
      input: "$12.50",
      output: "$62.50",
    });
  });

  it("falls back to the default rate for an unknown model", () => {
    expect(formatModelPrice("model-does-not-exist")).toEqual(
      formatModelPrice(undefined),
    );
  });
});

it("shows provider prices for the owner at-cost account", () => {
  expect(formatModelPrice("model-grok-4.5", 1)).toEqual({
    input: "$2",
    output: "$6",
  });
});
