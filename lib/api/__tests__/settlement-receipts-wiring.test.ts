/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";
import { UsageTracker } from "../../usage-tracker";
import {
  computeActualCostPoints,
  POINTS_PER_DOLLAR,
  RETAIL_MARGIN,
} from "../../rate-limit/token-bucket";
jest.mock("../../db/actions", () => ({ logUsageRecord: jest.fn() }));

// Execute each entry point's actual settlement closure without importing its
// authenticated transport/Trigger runtime. This is a boundary test, not HTTP QA.
function settlementSource(file: string) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: ts.Expression[] = [];
  function visit(node: ts.Node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "deductAccumulatedUsage" &&
      node.initializer
    )
      found.push(node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect(found).toHaveLength(1);
  return ts.transpileModule(
    `globalThis.settle = ${found[0].getText(source)};`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
  ).outputText;
}

for (const [entry, hackWorkbenchOnly] of [
  ["lib/api/chat-handler.ts", false],
  ["trigger/agent-long.ts", false],
  ["trigger/agent-long.ts", true],
] as const) {
  describe(`${entry} (${hackWorkbenchOnly ? "Hack" : "standard"})`, () => {
    const code = settlementSource(path.resolve(process.cwd(), entry));
    it.each(
      ["account", "balance", "free"].flatMap((channel) => [
        { channel, rejectDebit: false },
        { channel, rejectDebit: true },
      ]),
    )(
      "shares terminal settlement for $channel (rejection: $rejectDebit)",
      async ({ channel, rejectDebit }) => {
        const usageTracker = new UsageTracker();
        usageTracker.accumulateStep({
          inputTokens: 500_000,
          outputTokens: 0,
          raw: { cost: 0.2 },
        });
        usageTracker.accumulateStep({ inputTokens: 500_000, outputTokens: 0 });
        const log = jest.spyOn(usageTracker, "log");
        const captureUsageCost = jest.fn();
        let finishDebit!: () => void;
        const pendingDebit = new Promise<void>((resolve) => {
          finishDebit = resolve;
        });
        const debitError = new Error("Receipt lost after debit attempt");
        const debit = async () => {
          await pendingDebit;
          if (rejectDebit) throw debitError;
        };
        const deductUsage = jest.fn(debit);
        const deductBalanceUsage = jest.fn(debit);
        const recordFreeMonthlyCost = jest.fn(debit);
        const settleWithJournal = jest.fn(async (_input, operation) =>
          operation(),
        );
        const context = vm.createContext({
          hackWorkbenchOnly,
          rawExecutionId: "workspace-op",
          payload: { dispatchId: "workspace-op" },
          settleWithJournal,
          usageJournalRunId: "journal-run",
          ctx: { run: { id: "journal-run" } },
          usageSettlementPromise: undefined,
          recordedRunCostDollars: undefined,
          recordedRunTotalTokens: undefined,
          usageTracker,
          getSandboxSessionCost: () => 0.25,
          chatLogger: undefined,
          selectedModel: "model-grok-4.3",
          selectedModelOverride: "model-grok-4.3",
          configuredModelId: "model-grok-4.3",
          state: {},
          rateLimitInfo: {
            servedFrom: channel,
            pointsDeducted: 0,
            remaining: 0,
            limit: 0,
            resetTime: new Date(),
          },
          subscription: channel === "account" ? "pro" : "free",
          userId: "synthetic",
          pricingMargin: undefined,
          organizationId: undefined,
          chatId: "synthetic-chat",
          estimatedInputTokens: 0,
          extraUsageConfig: undefined,
          mode: "agent",
          endpoint: "/api/chat",
          posthog: undefined,
          deductUsage,
          deductBalanceUsage,
          recordFreeMonthlyCost,
          captureUsageCost,
          releaseFreeRunLockOnce: jest.fn(async () => {}),
        });
        new vm.Script(code).runInContext(context);
        const first = context.settle();
        const second = context.settle();
        const observed = Promise.allSettled([first, second]);
        await Promise.resolve();
        // A second finalizer must wait for the same debit, not release the
        // user's run lock while the first finalizer is still settling.
        expect(context.releaseFreeRunLockOnce).not.toHaveBeenCalled();
        finishDebit();
        const results = await observed;
        expect(settleWithJournal).toHaveBeenCalledTimes(1);
        expect(settleWithJournal.mock.calls[0][0]).toMatchObject({
          userId: "synthetic",
          runId: "journal-run",
          evidence: {
            operationId: "workspace-op",
            usage: expect.objectContaining({ costDollars: expect.any(Number) }),
          },
        });
        expect(context.releaseFreeRunLockOnce).toHaveBeenCalledTimes(1);
        if (rejectDebit) {
          expect(results).toEqual([
            { status: "rejected", reason: debitError },
            { status: "rejected", reason: debitError },
          ]);
          await expect(context.settle()).rejects.toBe(debitError);
          expect(
            deductUsage.mock.calls.length +
              deductBalanceUsage.mock.calls.length +
              recordFreeMonthlyCost.mock.calls.length,
          ).toBe(1);
          expect(captureUsageCost).not.toHaveBeenCalled();
          expect(log).not.toHaveBeenCalled();
          return;
        }
        expect(results.map((result) => result.status)).toEqual([
          "fulfilled",
          "fulfilled",
        ]);
        await context.settle();
        expect(context.recordedRunCostDollars).toBeCloseTo(1.075);
        expect(usageTracker.nonModelCost).toBe(0.25);
        expect(captureUsageCost).toHaveBeenCalledTimes(1);
        expect(captureUsageCost.mock.calls[0][0].usage).toMatchObject({
          costDollars: 1.075,
          costSource: "token_estimate",
        });
        if (channel === "free") {
          expect(recordFreeMonthlyCost).toHaveBeenCalledWith(
            "synthetic",
            1.075,
          );
          expect(deductUsage).not.toHaveBeenCalled();
          expect(deductBalanceUsage).not.toHaveBeenCalled();
          expect(log).not.toHaveBeenCalled();
        } else {
          const called =
            channel === "account" ? deductUsage : deductBalanceUsage;
          expect(called).toHaveBeenCalledTimes(1);
          const args = called.mock.calls[0] as unknown as unknown[];
          const resolved = args[channel === "account" ? 6 : 4] as number;
          expect(resolved).toBe(1.075);
          expect(
            computeActualCostPoints({
              actualInputTokens: usageTracker.inputTokens,
              actualOutputTokens: usageTracker.outputTokens,
              providerCostDollars: resolved,
              modelName: "model-grok-4.3",
              nonModelCostDollars: usageTracker.nonModelCost,
            }),
          ).toBe(Math.ceil(1.075 * POINTS_PER_DOLLAR * RETAIL_MARGIN));
          expect(log).toHaveBeenCalledTimes(1);
          expect(log).toHaveBeenCalledWith(
            expect.objectContaining({
              endpoint:
                entry === "lib/api/chat-handler.ts"
                  ? "/api/chat"
                  : hackWorkbenchOnly
                    ? "/api/hack-long"
                    : "/api/agent-long",
            }),
          );
        }
      },
    );
  });
}
