import fs from "node:fs";
import path from "node:path";
import { captureWorkerStartupTiming } from "../worker-startup-timing";

describe("worker startup timing", () => {
  it("copies only numeric module-window evidence", () => {
    expect(
      captureWorkerStartupTiming({
        moduleEvaluation: {
          probeStartedAt: 100000,
          moduleReadyAt: 100500,
          evaluationWindowMs: 500,
          secret: "not timing",
        },
      }),
    ).toEqual({
      moduleEvaluation: {
        probeStartedAt: 100000,
        moduleReadyAt: 100500,
        evaluationWindowMs: 500,
      },
    });
    expect(
      captureWorkerStartupTiming({
        moduleEvaluation: {
          probeStartedAt: 100000,
          moduleReadyAt: 100500,
          evaluationWindowMs: Infinity,
        },
      }),
    ).toEqual({});
  });
  it("retains only bounded timing and environment evidence", () => {
    expect(
      captureWorkerStartupTiming({
        handlerEnteredAt: 1700000000500,
        attemptStartedAt: new Date(1700000000100),
        environmentType: "DEVELOPMENT",
        processUptimeSeconds: 1.234,
      }),
    ).toEqual({
      handlerEnteredAt: 1700000000500,
      attemptStartedAt: 1700000000100,
      environmentType: "DEVELOPMENT",
      processUptimeMs: 1234,
    });
  });

  it.each([
    undefined,
    null,
    "",
    "not-a-date",
    -1,
    Infinity,
    NaN,
    new Date(NaN),
  ])("omits invalid timestamps and uptime (%p)", (invalid) => {
    expect(
      captureWorkerStartupTiming({
        handlerEnteredAt: invalid,
        attemptStartedAt: invalid,
        environmentType: "unknown-secret-value",
        processUptimeSeconds: invalid,
      }),
    ).toEqual({});
  });

  it("retains all four known environments and zero process uptime", () => {
    for (const environmentType of [
      "PRODUCTION",
      "STAGING",
      "DEVELOPMENT",
      "PREVIEW",
    ]) {
      expect(
        captureWorkerStartupTiming({
          environmentType,
          processUptimeSeconds: 0,
        }),
      ).toEqual({ environmentType, processUptimeMs: 0 });
    }
  });

  it("preserves raw timestamp ordering without claiming cold startup or queue time", () => {
    expect(
      captureWorkerStartupTiming({
        handlerEnteredAt: 1700000000000,
        attemptStartedAt: new Date(1700000000500),
      }),
    ).toEqual({
      handlerEnteredAt: 1700000000000,
      attemptStartedAt: 1700000000500,
    });
  });
});

it("captures entry diagnostics before setup and publishes through existing metadata", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "trigger/agent-long.ts"),
    "utf8",
  );
  const runBody = source.slice(source.indexOf("run: withRunPtyScope("));
  const capture = runBody.indexOf(
    "const startupTiming = captureWorkerStartupTiming(",
  );
  expect(capture).toBeGreaterThan(0);
  expect(source).not.toContain("setConvexUrl(");
  expect(source).toMatch(
    /withConvexClientScope\(\s*hackWorkbenchOnly\s*\?\s*resolveHackWorkerConvexUrl\(payload.convexUrl\)\s*:\s*payload.convexUrl/,
  );
  expect(capture).toBeLessThan(runBody.indexOf("await measureSetup"));
  expect(runBody).toContain("attemptStartedAt: ctx.attempt.startedAt");
  expect(runBody).toContain("environmentType: ctx.environment.type");
  expect(runBody).toContain("processUptimeSeconds: process.uptime()");
  expect(runBody).toContain('.set("startupTiming", startupTiming)');
  // Preserve the existing elapsed-time stop and aggregate latency origin.
  expect(runBody).toContain("const taskStartTime = Date.now()");
  expect(runBody).toContain(
    "taskStartTime - payload.requestTiming.triggerRequestedAt",
  );
});
