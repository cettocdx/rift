/** Isolated database acceptance: no model, tools, files or charges.
 * From the repository root, set RIFT_QA_USER_ID to the test owner and NODE_PATH
 * to node_modules/next/dist/compiled, then run:
 * npx tsx --conditions=react-server scripts/verify-http-finalization-recovery.ts
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { config } from "dotenv";
import { getFunctionName } from "convex/server";
import { api } from "../convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "../lib/db/convex-client";
import {
  admitHackHttpExecution,
  markHackHttpExecutionRunning,
  finishHackHttpExecution,
  readHackHttpExecution,
  type HackHttpExecutionBinding,
} from "../lib/hack/http-execution";

config({ path: ".env.local", quiet: true });
async function main() {
  const userId = process.env.RIFT_QA_USER_ID;
  if (!userId) throw new Error("An explicit QA owner is required");
  const client = getConvexClient();
  const original = client.mutation.bind(client);
  const results = [];
  for (const scenario of [
    "lost-response",
    "pre-write-network-error",
    "newer-generation",
  ] as const) {
    const binding: HackHttpExecutionBinding = {
      userId,
      chatId: randomUUID(),
      executionId: randomUUID(),
    };
    const next = { ...binding, executionId: randomUUID() };
    const admitted: HackHttpExecutionBinding[] = [];
    let acknowledgments = 0;
    try {
      await original(api.chats.saveChat, {
        serviceKey: getConvexServiceKey()!,
        userId,
        id: binding.chatId,
        title: `RIFT QA finalization: ${scenario}`,
        purpose: "security",
      });
      assert.equal((await admitHackHttpExecution(binding)).admitted, true);
      admitted.push(binding);
      assert.equal(await markHackHttpExecutionRunning(binding), true);
      client.mutation = (async (
        ...args: Parameters<typeof client.mutation>
      ) => {
        const [reference, values] = args;
        if (getFunctionName(reference) !== "hackHttpExecutions:finish")
          return original(reference, values ?? {}, args[2]);
        assert.equal(values.executionId, binding.executionId);
        acknowledgments++;
        if (acknowledgments !== 1)
          return original(reference, values ?? {}, args[2]);
        if (scenario !== "pre-write-network-error")
          await original(reference, values ?? {}, args[2]);
        if (scenario === "newer-generation") {
          assert.equal((await admitHackHttpExecution(next)).admitted, true);
          admitted.push(next);
          assert.equal(await markHackHttpExecutionRunning(next), true);
        }
        // Inject only the transport failure; preceding writes use the real backend.
        throw new TypeError("fetch failed");
      }) as typeof client.mutation;
      assert.equal(await finishHackHttpExecution(binding), true);
      assert.equal(
        acknowledgments,
        scenario === "pre-write-network-error" ? 2 : 1,
      );
      assert.equal((await readHackHttpExecution(binding))?.phase, "terminal");
      if (scenario === "newer-generation")
        assert.equal((await readHackHttpExecution(next))?.phase, "running");
      results.push({
        scenario,
        chatId: binding.chatId,
        acknowledgments,
        passed: true,
      });
    } finally {
      client.mutation = original;
      // These synthetic producers have no tool, terminal or model to drain.
      for (const owned of admitted)
        assert.equal(await finishHackHttpExecution(owned), true);
    }
  }
  console.log(
    JSON.stringify(
      { scenarios: results, toolsExecuted: 0, modelCalls: 0 },
      null,
      2,
    ),
  );
}
main().catch(() => {
  console.error(
    "HTTP finalization acceptance failed; inspect the isolated QA records.",
  );
  process.exitCode = 1;
});
