import fs from "node:fs";
import path from "node:path";

const routeSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/hack-chat/route.ts"),
  "utf8",
);
const handlerSource = fs.readFileSync(
  path.resolve(__dirname, "../chat-handler.ts"),
  "utf8",
);

describe("Hack agent request lifecycle contract", () => {
  it("keeps the platform ceiling at 420s and aborts the app between 360–375s", () => {
    expect(routeSource).toMatch(/maxDuration\s*=\s*420/);
    const budgetMatch = routeSource.match(
      /HACK_AGENT_PREEMPTIVE_TIMEOUT_MS\s*=\s*([\d_]+)/,
    );
    expect(budgetMatch).not.toBeNull();
    const budget = Number(budgetMatch![1].replaceAll("_", ""));
    expect(budget).toBeGreaterThanOrEqual(360_000);
    expect(budget).toBeLessThanOrEqual(375_000);
    expect(routeSource).toContain(
      "agentPreemptiveTimeoutMs: HACK_AGENT_PREEMPTIVE_TIMEOUT_MS",
    );
    expect(routeSource).toContain(
      'preemptiveTimeoutEndpoint: "/api/hack-chat"',
    );
  });

  it("uses an absolute request-start budget for agents and the stream runner", () => {
    expect(handlerSource).toMatch(/const requestStartedAt = Date\.now\(\)/);
    expect(handlerSource).toMatch(
      /isAgentMode\(mode\) && agentPreemptiveTimeoutMs !== undefined[\s\S]*?maxStreamTimeMs: agentPreemptiveTimeoutMs,[\s\S]*?startTime: requestStartedAt/,
    );
    expect(handlerSource).toMatch(
      /maxDurationMs:\s*agentPreemptiveTimeoutMs \?\? AGENT_MAX_STREAM_DURATION_MS/,
    );
    expect(handlerSource).toMatch(
      /requestDeadlineMs:\s*agentPreemptiveTimeoutMs !== undefined\s*\? requestStartedAt \+ agentPreemptiveTimeoutMs/,
    );
  });

  it("opts only Hack into a reporting reserve inside its hard deadline", () => {
    expect(routeSource).toContain("HACK_AGENT_REPORTING_RESERVE_MS = 45_000");
    expect(routeSource).toContain(
      "agentReportingReserveMs: HACK_AGENT_REPORTING_RESERVE_MS",
    );
    expect(handlerSource).toMatch(
      /reportingReserveMs:\s*hackWorkbenchOnly && purpose === "security"\s*\? agentReportingReserveMs/,
    );
  });

  it("never retries an empty reporting generation or records it as completed", () => {
    expect(handlerSource).toMatch(
      /isProviderApiError\(error\) &&\s*!state.stoppedDueToElapsedTimeout/,
    );
    expect(handlerSource).toMatch(
      /!isRetryWithFallback &&\s*!isAborted &&\s*!state.stoppedDueToElapsedTimeout &&\s*isAutoModel/,
    );
    expect(handlerSource.includes("resolveChatRunFinalization({")).toBe(true);
    expect(
      handlerSource.includes(
        "stoppedDueToElapsedTimeout: state.stoppedDueToElapsedTimeout",
      ),
    ).toBe(true);
  });

  it("finalizes the normal and fallback legs with the same cutoff-aware run receipt", () => {
    expect(handlerSource.includes("await finishRecordedRun(isAborted)")).toBe(
      true,
    );
    expect(
      handlerSource.includes("await finishRecordedRun(retryAborted)"),
    ).toBe(true);
    expect(handlerSource.includes("getRunFinalization(retryAborted)")).toBe(
      true,
    );
    expect(
      /state.streamFinishReason =\s*finalization.finishReason/.test(
        handlerSource,
      ),
    ).toBe(true);
    expect(
      /wasAborted: retryAborted,\s*wasPreemptiveTimeout: isPreemptiveAbort/.test(
        handlerSource,
      ),
    ).toBe(true);
  });

  it("only forwards request disconnects for non-resumable temporary chats", () => {
    const temporaryGuard = handlerSource.indexOf("if (temporary) {");
    const requestAbort = handlerSource.indexOf(
      'req.signal.addEventListener("abort", abortFromRequest',
      temporaryGuard,
    );

    expect(temporaryGuard).toBeGreaterThan(-1);
    expect(requestAbort).toBeGreaterThan(temporaryGuard);
    expect(handlerSource).toContain("clearLifecycleGuards()");
  });
});
