/** @jest-environment node */
import fs from "node:fs";
import path from "node:path";

afterEach(() => jest.restoreAllMocks());

it("records one immutable module evaluation window across warm invocations", () => {
  jest.spyOn(Date, "now").mockReturnValueOnce(100000).mockReturnValue(100500);
  jest.spyOn(process, "uptime").mockReturnValueOnce(2).mockReturnValue(2.5);
  jest.isolateModules(() => {
    const probe = require("../worker-module-timing");
    expect(probe.readWorkerModuleTiming()).toBeUndefined();
    probe.markWorkerModuleReady();
    const first = probe.readWorkerModuleTiming();
    expect(first).toEqual({
      probeStartedAt: 100000,
      moduleReadyAt: 100500,
      evaluationWindowMs: 500,
    });
    expect(Object.isFrozen(first)).toBe(true);
    probe.markWorkerModuleReady();
    expect(probe.readWorkerModuleTiming()).toBe(first);
  });
});

it("starts the leaf probe before the task dependencies and closes after registration", () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), "trigger/agent-long.ts"),
    "utf8",
  );
  expect(source.slice(0, source.indexOf(";"))).toContain(
    "@/lib/agent/worker-module-timing",
  );
  expect(source.lastIndexOf("markWorkerModuleReady();")).toBeGreaterThan(
    source.indexOf('createAgentLongTask("agent-long")'),
  );
  expect(source).toContain("moduleEvaluation: readWorkerModuleTiming()");
});
