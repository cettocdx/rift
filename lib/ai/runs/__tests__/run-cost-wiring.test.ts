import fs from "node:fs";
import path from "node:path";

/**
 * 24.7: every completed Run has a cost breakdown.
 *
 * The Run schema carries cost_dollars, but a schema field nobody writes is a
 * blank column. Both producers must actually pass the cost when they close a
 * run, and it has to be the same figure the usage log records -- not a second
 * estimate that drifts from the bill. This is exactly the "silently dropped
 * value threaded through many hops" failure I hit on the media lineage, so it
 * gets a contract test rather than trust.
 */
describe("a finished run records its cost", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  for (const file of ["lib/api/chat-handler.ts", "trigger/agent-long.ts"]) {
    describe(file, () => {
      const src = read(file);

      it("captures the billing figure, not a fresh estimate", () => {
        // The value comes from the same usageCostRecord the usage log is built
        // from, so the run and the log cannot disagree.
        expect(src).toContain(
          "recordedRunCostDollars = usageCostRecord.costDollars",
        );
        expect(src).toContain(
          "recordedRunTotalTokens = usageCostRecord.totalTokens",
        );
      });

      it("passes the captured cost when it closes the run", () => {
        const finishCall = src.slice(src.indexOf("finishRunRecord({"));
        expect(finishCall).toContain("costDollars: recordedRunCostDollars");
        expect(finishCall).toContain("recordedRunTotalTokens");
      });
    });
  }
});
