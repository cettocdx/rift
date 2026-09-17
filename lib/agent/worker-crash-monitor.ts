import { writeSync } from "node:fs";

/** Observe fatal exceptions without swallowing them or changing Node's exit policy. */
export async function withWorkerCrashMonitor<T>(runId: string, run: () => Promise<T>): Promise<T> {
  const observe = (error: Error, origin: string) => {
    try {
      // Drop the message (may contain provider URLs/credentials). Retain only
      // stack locations, error class/code and correlation with the durable run.
      const frames = String(error.stack ?? "").split("\n")
        .filter(line => /^\s+at /.test(line))
        .slice(0, 20)
        .map(line => line.replace(/https?:\/\/[^\s)]+/g, "[remote]"));
      writeSync(2, JSON.stringify({
        timestamp: new Date().toISOString(), level: "error",
        event: "agent_worker_uncaught_exception", service: "rift-agent-worker",
        environment: process.env.NODE_ENV ?? "development", request_id: runId,
        origin, error_name: error.name,
        error_code: typeof (error as NodeJS.ErrnoException).code === "string"
          ? (error as NodeJS.ErrnoException).code : undefined,
        frames,
      }) + "\n");
    } catch { /* Diagnostics cannot replace the original fatal error. */ }
  };
  process.on("uncaughtExceptionMonitor", observe);
  try { return await run(); }
  finally { process.off("uncaughtExceptionMonitor", observe); }
}
