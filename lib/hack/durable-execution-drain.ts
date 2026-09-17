import type { ToolSet } from "ai";
import {
  ptySessionManager,
  type PtySessionManager,
} from "@/lib/ai/tools/utils/pty-session-manager";
import { createHttpToolExecutionDrain } from "./http-tool-execution-drain";

/** Local settlement only. The worker must separately persist its cleanup acknowledgment. */
export function createDurableHackExecutionDrain({
  runId,
  chatId,
  manager = ptySessionManager,
}: {
  runId: string;
  chatId: string;
  manager?: PtySessionManager;
}): {
  wrap<T extends ToolSet>(tools: T): T;
  runInScope<T>(callback: () => T): T;
  drainTools(): Promise<void>;
  settle(): Promise<void>;
} {
  let closing = false;
  let settlement: Promise<void> | undefined;
  let toolSettlement: Promise<void> | undefined;
  const scoped = <T>(callback: () => T): T =>
    manager.withConfirmedScope(runId, callback);
  // Internal scope entry remains available to iterator cleanup after sealing.
  const tools = createHttpToolExecutionDrain({ runInScope: scoped });
  const kickoff = () => {
    if (settlement) return;
    closing = true;
    let resolve!: () => void;
    let reject!: (error: unknown) => void;
    // Cache before invoking callbacks, including synchronous kill handlers.
    settlement = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Early callers may await only tools to persist known usage. Keep the full
    // result observed while retaining its rejection for a later settle().
    void settlement.catch(() => {});
    toolSettlement = tools.closeAndWait();
    void (async () => {
      const results = await Promise.allSettled([
        toolSettlement,
        scoped(() => manager.closeAllConfirmed(chatId)),
      ]);
      const failure = results.find((result) => result.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
      manager.releaseConfirmedScope(runId);
    })().then(resolve, reject);
  };
  return {
    wrap: tools.wrap,
    runInScope<T>(callback: () => T): T {
      if (closing) throw new Error("Durable Hack execution is closed.");
      return scoped(callback);
    },
    drainTools() {
      kickoff();
      return toolSettlement!;
    },
    settle() {
      kickoff();
      return settlement!;
    },
  };
}
