import fs from "node:fs";
import path from "node:path";
const read = (name: string) =>
  fs.readFileSync(path.join(process.cwd(), name), "utf8");
const worker = read("trigger/agent-long.ts");
it("selects the dedicated task only from server-owned construction, preserving generic security rejection", () => {
  expect(worker).toContain(
    'export const agentLongTask = createAgentLongTask("agent-long")',
  );
  expect(read("trigger/hack-long.ts")).toContain(
    'export const hackLongTask = createAgentLongTask("hack-long")',
  );
  expect(worker).toContain('const hackWorkbenchOnly = taskId === "hack-long"');
  expect(worker).toContain("assertHackWorkbenchPurposeRoute(purpose, false)");
  expect(read("app/api/agent-long/route.ts")).toContain(
    "createAgentLongHandler(false)",
  );
  expect(read("app/api/hack-long/route.ts")).toContain(
    "createAgentLongHandler(true)",
  );
  expect(worker).toMatch(/retry:\s*\{ maxAttempts: 1 \}/);
});
it("pins deployment before scoped lookup and verifies receipt before atomic claim activation, persisted request before tools", () => {
  expect(worker).toMatch(
    /withConvexClientScope\(\s*hackWorkbenchOnly\s*\?\s*resolveHackWorkerConvexUrl\(payload.convexUrl\)/,
  );
  const receipt = worker.indexOf(
    "await authorizeHackWorkerRun(payload, ctx.run.id)",
  );
  const claim = worker.indexOf("startClaimedAgentRunForWorker({", receipt);
  const context = worker.indexOf(
    "assertHackRunContext(payload, hackBinding",
    claim,
  );
  const tools = worker.indexOf("createTools(", context);
  expect(receipt).toBeGreaterThan(0);
  expect(claim).toBeGreaterThan(receipt);
  expect(context).toBeGreaterThan(claim);
  expect(tools).toBeGreaterThan(context);
  expect(worker).toMatch(
    /const subscription =\s*hackWorkbenchOnly\s*\? "ultra"\s*:\s*payloadSubscription/,
  );
});
it("uses checkpoint ownership for Hack, checks live access before steps/effects, and binds scope to model context", () => {
  expect(worker).toContain('(purpose === "app" || hackBinding)');
  expect(worker).toMatch(
    /requestHash:\s*hackBinding\s*\?\s*hashHackRunPayload\(payload\)/,
  );
  expect(worker).toContain("createHackCheckpointBarrier");
  expect(worker).toMatch(
    /onStepStarted:[\s\S]*?assertHackExecutionAccess\(\s*userId,\s*userStopSignal.signal/,
  );
  expect(worker).toContain("appendHackRunSystemContext(");
  expect(worker).toMatch(/const isAutoModel =\s*!hackBinding &&/);
  expect(worker).toMatch(
    /const autoContinueReason =\s*hackBinding\s*\?\s*null/,
  );
  expect(worker).toMatch(
    /const retryAutoContinueReason =\s*hackBinding\s*\?\s*null/,
  );
});

it("normalizes internal failure before saving and uses the same outcome for the run receipt", () => {
  const normalize = worker.indexOf("const hackFinalization = hackBinding");
  const persistence = worker.indexOf("await updateChat({", normalize);
  expect(normalize).toBeGreaterThan(0);
  expect(worker.slice(normalize, persistence)).toContain(
    "manualStop: hackStopObserved",
  );
  expect(worker).toMatch(
    /claimCancellation.stopped \|\|\s*\(await readHackCancellationEvidence|claimCancellation.stopped \|\| await readHackCancellationEvidence/,
  );
  expect(worker.slice(normalize, persistence)).toMatch(
    /state.streamFinishReason =\s*hackFinalization.finishReason/,
  );
  expect(worker).toMatch(
    /const outcome =\s*hackFinalization\?\.outcome \?\?\s*resolveRunOutcome/,
  );
});

it("carries verified cancellation through terminal stream error handling", () => {
  expect(worker).toMatch(
    /if \(hackStopObserved && !claimCancellation.stopped\)[\s\S]*?claimCancellation.handle\(\s*new AgentRunCanceledError/,
  );
  expect(worker).toMatch(
    /const terminalStreamError =\s*hackBinding && claimCancellation.stopped\s*\? undefined\s*:\s*\(?streamError/,
  );
});
