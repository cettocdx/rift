import fs from "fs";
import path from "path";

// The behavioral cases live in budget-monitor.test.ts. This small wiring
// contract catches the route silently bypassing that tested funding policy.
test("chat handler gives every request a funding-aware budget monitor", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../chat-handler.ts"),
    "utf8",
  );
  expect(
    /const budgetMonitor = createRequestBudgetMonitor\(\{\s*rateLimitInfo,\s*extraUsageConfig,\s*subscription,\s*freeMonthlyBudgetSnapshot,\s*writer,\s*\}\)/.test(
      source,
    ),
  ).toBe(true);
});
