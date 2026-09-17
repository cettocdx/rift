/** @jest-environment node */
import {
  summarizeWorkspaceUsage,
  workspaceIdentity,
  journalChargePoints,
} from "../workspace-usage";

test("only complete acknowledged charges form an exact total", () => {
  expect(
    summarizeWorkspaceUsage("s", [
      { operationId: "one", status: "settled", credits: 25 },
      { operationId: "two", status: "settled", credits: 10 },
    ]),
  ).toMatchObject({ status: "settled", credits: 35, usd: 0.0035 });
});
test("pending and unknown never masquerade as zero or complete partial spend", () => {
  expect(
    summarizeWorkspaceUsage("s", [
      { operationId: "one", status: "settled", credits: 25 },
      { operationId: "two", status: "pending", credits: null },
    ]),
  ).toMatchObject({
    status: "pending",
    credits: null,
    usd: null,
    settledCredits: 25,
  });
  expect(summarizeWorkspaceUsage("s", [])).toMatchObject({
    status: "unknown",
    credits: null,
  });
});
test("duplicates do not inflate totals and conflicting receipts fail closed", () => {
  const row = { operationId: "one", status: "settled" as const, credits: 25 };
  expect(summarizeWorkspaceUsage("s", [row, row]).credits).toBe(25);
  expect(() =>
    summarizeWorkspaceUsage("s", [row, { ...row, credits: 26 }]),
  ).toThrow();
});
test("identity requires both bounded clean identifiers", () => {
  expect(workspaceIdentity(new Headers())).toBeNull();
  expect(() =>
    workspaceIdentity(new Headers({ "x-rift-session-id": "s" })),
  ).toThrow();
  expect(
    workspaceIdentity(
      new Headers({
        "x-rift-session-id": "ses_abc",
        "x-rift-operation-id": "op-123",
      }),
    ),
  ).toEqual({ sessionId: "ses_abc", operationId: "op-123" });
});
test("journal computes exact retail and owner billing units, no double margin", () => {
  const evidence = {
    subscription: "pro",
    servedFrom: "account",
    usage: { costDollars: 0.001 },
    pricingMargin: 2.5,
  };
  expect(journalChargePoints(evidence)).toBe(25);
  expect(journalChargePoints({ ...evidence, pricingMargin: 1 })).toBe(10);
  expect(
    journalChargePoints({
      ...evidence,
      subscription: "free",
      servedFrom: "free",
    }),
  ).toBe(0);
  expect(journalChargePoints({ ...evidence, usage: {} })).toBeNull();
});
