import { describe, expect, it } from "@jest/globals";
import { usesAccountCreditLedger } from "../included-credits";

describe("add-on credit plan eligibility", () => {
  it("allows the active consumer plans used by the top-up action", () => {
    expect(usesAccountCreditLedger("pro")).toBe(true);
    expect(usesAccountCreditLedger("ultra")).toBe(true);
  });

  it("keeps free and non-consumer plans outside the add-on checkout", () => {
    for (const tier of ["", "free", "team", "pro-plus", "unknown"]) {
      expect(usesAccountCreditLedger(tier)).toBe(false);
    }
  });
});
