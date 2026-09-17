import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(
  path.resolve(__dirname, "../../../trigger/agent-long.ts"),
  "utf8",
);

describe("durable worker cleanup admission wiring", () => {
  it("registers cancellation cleanup only after successful worker admission", () => {
    const runStart = source.indexOf("run: withRunPtyScope(");
    const admission = source.search(
      /const workerStart\s*=\s*await\s+measureSetup\("claim",\s*\(\)\s*=>\s*startClaimedAgentRunForWorker\(/,
    );
    const registration = source.indexOf(
      "runCleanupMap.set(ctx.run.id",
      runStart,
    );
    expect(runStart).toBeGreaterThan(-1);
    expect(admission).toBeGreaterThan(runStart);
    expect(registration).toBeGreaterThan(admission);
  });
  it("runs every model through the shared Rift harness with real cancellation", () => {
    expect(source).not.toContain("@/lib/opencode/");
    expect(source).not.toContain("resolveBuildEngine");
    expect(source).toContain(
      "return createAgentStream(modelName, streamCtx, state)",
    );
    expect(
      source.match(
        /signal: userStopSignal.signal,\s*drainOnAbort: true,\s*heartbeat:/g,
      )?.length,
    ).toBe(2);
  });
  it("puts out-of-band cancellation refund and PTY cleanup in the originating DB/run scopes", () => {
    expect(source).toContain("await cleanup.cancel()");
    expect(source).toMatch(
      /withConvexClientScope\(\s*hackWorkbenchOnly\s*\?\s*resolveHackWorkerConvexUrl\(payload.convexUrl\)\s*:\s*payload.convexUrl/,
    );
    expect(source).toMatch(
      /cancel: bindConvexClientScope\(async \(\) => \{[\s\S]*?ptySessionManager\.withScope\(ctx\.run\.id,[\s\S]*?ptySessionManager\.closeAll\(chatId\)/,
    );
  });
});

it("starts lazy reads only after admission and keeps all execution gates ahead of consumption", () => {
  const checkpoint = source.indexOf(
    'if (checkpointStart?.status === "blocked")',
  );
  const entitlement = source.indexOf(
    "extraUsageConfig = await usagePreparation",
  );
  const freeLock = source.indexOf(
    "await acquireFreeRunConcurrencyLock(",
    entitlement,
  );
  const prepare = source.indexOf(
    "const integrationPreparation = prepareWorkerIntegrations(",
  );
  const cleanup = source.indexOf(
    "closeMcpToolsOnce = integrationPreparation.close",
    prepare,
  );
  const preflight = source.indexOf("await runTrackedPreflight(", prepare);
  const moderation = source.indexOf("await moderationPromise", preflight);
  const consume = source.indexOf(
    "await integrationPreparation.ready",
    moderation,
  );
  const tools = source.indexOf('} = phaseTimer.measureSync("tools",', consume);
  expect(checkpoint).toBeGreaterThan(-1);
  expect(entitlement).toBeGreaterThan(checkpoint);
  expect(freeLock).toBeGreaterThan(entitlement);
  expect(prepare).toBeGreaterThan(freeLock);
  expect(cleanup).toBeGreaterThan(prepare);
  expect(preflight).toBeGreaterThan(cleanup);
  expect(moderation).toBeGreaterThan(preflight);
  expect(consume).toBeGreaterThan(moderation);
  expect(tools).toBeGreaterThan(consume);
  expect(source.slice(freeLock, prepare)).toContain(
    "userStopSignal.signal.throwIfAborted()",
  );
  expect(source.slice(moderation, consume)).toContain(
    "userStopSignal.signal.throwIfAborted()",
  );
  const preparation = source.slice(prepare, preflight);
  expect(preparation).toContain("{ lazy: true }");
  expect(preparation).toContain(
    "agentRuntimePolicy?.activeProfile?.mcpServerIds",
  );
  expect(preparation).toContain("toolFreeTurn");
  expect(source).toContain(
    "const toolFreeTurn = standaloneGreeting || standaloneText;",
  );
});

it("requires confirmed Hack settlement before persistence and releasing ownership", () => {
  expect(source).toContain("createDurableHackExecutionDrain");
  expect(source).toContain("hackExecutionDrain?.wrap");
  expect(source).toContain("if (isAborted) await drainHackTools()");
  expect(source).toMatch(/if \(retryAborted\)\s+await drainHackTools\(\)/);
  expect(source).toMatch(
    /finally \{\s+await drainHackTools\(\);\s+if \(claimCancellation\.stopped\)/,
  );
  const proof = source.indexOf("await recordHackRunCleanup(");
  const release = source.indexOf("await releaseAgentRunClaim(", proof);
  expect(proof).toBeGreaterThan(0);
  expect(release).toBeGreaterThan(proof);
  expect(source.slice(proof, release)).toContain("hackCleanupConfirmed");
});
