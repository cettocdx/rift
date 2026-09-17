const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const filename = path.resolve(__dirname, "../benchmark-agent-startup.cjs");
const localRequire = createRequire(filename);
const { buildScenario } = localRequire("./startup-scenarios.cjs");

// Execute the complete CLI with isolated SDK/HTTP/filesystem substitutes. No
// credential file, network, terminal process or model is accessed by this test.
async function execute(args, outcome = "success", runFixture = {}) {
  const requests = [],
    reports = [],
    logs = [];
  const fakeProcess = { argv: ["node", filename, ...args], exitCode: 0 };
  let nonce = 0;
  class ApiClient {
    async fetchStream(runId, _name, options) {
      const request = requests[Number(runId.slice(4)) - 1];
      const prompt = request.messages[0].parts[0].text;
      const soak = prompt.includes("RIFT_SOAK_");
      const scenario = buildScenario(
        request.sandboxPreference === "e2b"
          ? "terminal"
          : prompt === "merhaba"
            ? "greeting"
            : "explanation",
        request.chatId,
      );
      const command = soak
        ? `i=0; while [ "$i" -lt 1 ]; do printf 'RIFT_SOAK_%s\\n' "$i"; i=$((i + 1)); sleep 10; done`
        : scenario.command;
      const chunks = [];
      if (soak || scenario.name === "terminal") {
        chunks.push({
          type: "tool-input-available",
          toolCallId: "call1",
          toolName: "run_terminal_cmd",
          input: { command, timeout: soak ? 40 : 30 },
        });
        if (outcome !== "missing-output")
          chunks.push({
            type: "tool-output-available",
            toolCallId: "call1",
            output: {
              result: {
                output: soak
                  ? "RIFT_SOAK_0\n"
                  : `/workspace\n${scenario.outputSentinel}\n`,
                exitCode: outcome === "unknown" ? null : 0,
                ...(outcome === "unknown" ? { outcome: "unknown" } : {}),
                durationMs: soak ? 10000 : 12,
              },
            },
          });
      }
      if (outcome === "unexpected-tool")
        chunks.push({
          type: "tool-input-start",
          toolCallId: "other",
          toolName: "web_search",
        });
      chunks.push({
        type: "text-delta",
        delta: soak
          ? "RIFT_SOAK_DONE"
          : scenario.name === "greeting"
            ? "Merhaba!"
            : `A relative path starts at the current directory; an absolute path starts at root.\n${scenario.finalSentinel}`,
      });
      chunks.push({ type: "finish" });
      return (async function* () {
        const first = options.lastEventId ? Number(options.lastEventId) + 1 : 0;
        for (let i = first; i < chunks.length; i++) {
          options.onPart({ id: String(i) });
          yield chunks[i];
        }
      })();
    }
  }
  const context = {
    __dirname: path.dirname(filename),
    Buffer,
    AbortController,
    AbortSignal,
    setTimeout: () => 1,
    clearTimeout: () => {},
    crypto: { randomUUID: () => `sample${++nonce}` },
    process: fakeProcess,
    console: {
      log: (line) => logs.push(line),
      error: (line) => logs.push(line),
    },
    require: (name) => {
      if (name === "node:fs")
        return {
          readFileSync: () =>
            JSON.stringify({ apiKey: "offline-fixture-token" }),
          writeFileSync: (_file, json) => reports.push(JSON.parse(json)),
        };
      if (name === "dotenv") return { config: () => {} };
      if (name === "@trigger.dev/sdk")
        return {
          runs: {
            retrieve: async () => ({
              status: "COMPLETED",
              metadata: {},
              version: "offline",
              ...runFixture,
            }),
          },
        };
      if (name === "@trigger.dev/core/v3") return { ApiClient };
      return localRequire(name);
    },
    fetch: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return {
        ok: true,
        headers: { get: () => "chat;dur=5" },
        json: async () => ({
          runId: `run-${requests.length}`,
          publicAccessToken: "opaque-offline-token",
        }),
      };
    },
  };
  await vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, {
    filename,
  });
  assert.doesNotMatch(
    logs.join("\n"),
    /offline-fixture-token|opaque-offline-token/,
  );
  return { requests, report: reports.at(-1), code: fakeProcess.exitCode };
}
test("whole CLI schedules three scenarios and binds cloud tool evidence without credentials in reports", async () => {
  const result = await execute(["--scenario", "mixed", "--samples", "3"]);
  assert.equal(result.code, 0);
  assert.deepEqual(
    result.requests.map((r) => r.approvalMode),
    ["ask", "ask", "full"],
  );
  assert.equal(result.requests[2].sandboxPreference, "e2b");
  assert.deepEqual(
    result.report.samples.map((r) => r.scenario),
    ["greeting", "explanation", "terminal"],
  );
  assert.equal(result.report.summary.verified, 3);
  assert.equal(
    result.report.samples[2].scenarioEvidence.toolResult.exitCode,
    0,
  );
  assert.equal(result.report.summary.byScenario.terminal.samples, 1);
});

test("twenty mixed samples retain the quality minimum and valid serialized evidence", async () => {
  const { evaluateQuality } = localRequire("./harness-quality.cjs");
  const result = await execute(["--scenario", "mixed", "--samples", "20"]);
  assert.equal(result.code, 0);
  assert.equal(result.requests.length, 20);
  assert.deepEqual(
    Object.values(result.report.summary.byScenario).map(
      (group) => group.samples,
    ),
    [7, 7, 6],
  );
  assert.equal(result.report.summary.byScenario.terminal.smallSample, true);
  assert.match(result.report.note, /not comparable.*greeting-only/);
  assert.equal(evaluateQuality(result.report).pass, true);
  result.report.samples[2].scenarioEvidence.toolResult.exitCode = null;
  assert.equal(evaluateQuality(result.report).pass, false);
});
test("whole CLI rejects success text without tool evidence and never submits a retry", async () => {
  for (const outcome of ["missing-output", "unknown", "unexpected-tool"]) {
    const result = await execute(
      ["--scenario", "terminal", "--samples", "1"],
      outcome,
    );
    assert.equal(result.code, 1);
    assert.equal(result.requests.length, 1);
    assert.equal(result.report.samples[0].scenarioVerified, false);
  }
});
test("whole CLI rejects tools in explanation and preserves greeting and legacy soak behavior", async () => {
  assert.equal(
    (
      await execute(
        ["--scenario", "explanation", "--samples", "1"],
        "unexpected-tool",
      )
    ).code,
    1,
  );
  const greeting = await execute(["--samples", "1"]);
  assert.equal(greeting.requests[0].messages[0].parts[0].text, "merhaba");
  assert.equal(greeting.requests[0].approvalMode, "ask");
  const soak = await execute([
    "--terminal-soak",
    "--samples",
    "1",
    "--soak-steps",
    "1",
  ], "success", { metadata: { cleanupConfirmed: true } });
  assert.equal(soak.code, 0);
  assert.equal(soak.requests[0].approvalMode, "full");
  assert.equal(soak.report.samples[0].soakVerified, true);
  assert.equal(soak.report.samples[0].completedWhileDetached, true);
});

test("startup evidence retains provider and worker timing without unrelated metadata", async () => {
  const base = 1700000000000;
  const result = await execute(["--samples", "1"], "success", {
    createdAt: new Date(base),
    startedAt: new Date(base + 500),
    attemptCount: 1,
    region: "eu-west-1",
    payload: { secret: "private-payload" },
    metadata: {
      startupTiming: {
        handlerEnteredAt: base + 3100,
        attemptStartedAt: base + 2800,
        environmentType: "DEVELOPMENT",
        processUptimeMs: 2500,
        secret: "private-metadata",
      },
    },
  });
  const timing = result.report.samples[0].startupTiming;
  assert.equal(timing.providerCreatedAt, base);
  assert.equal(timing.providerStartedAt, base + 500);
  assert.equal(timing.providerAttemptCount, 1);
  assert.equal(timing.providerRegion, "eu-west-1");
  assert.equal(timing.providerPreStartMs, 500);
  assert.equal(timing.providerStartToAttemptMs, 2300);
  assert.equal(timing.attemptToHandlerWallClockDeltaMs, 300);
  assert.equal(timing.environmentType, "DEVELOPMENT");
  assert.equal(timing.processUptimeMs, 2500);
  assert.match(timing.interpretation, /cross-runtime.*clock skew/);
  assert.match(timing.interpretation, /not queue or cold-start/);
  assert.doesNotMatch(
    JSON.stringify(result.report),
    /private-payload|private-metadata/,
  );
});

test("startup evidence tolerates missing and invalid diagnostics", async () => {
  const empty = await execute(["--samples", "1"]);
  assert.equal(empty.report.samples[0].startupTiming, undefined);
  const invalid = await execute(["--samples", "1"], "success", {
    createdAt: "invalid",
    startedAt: new Date(NaN),
    attemptCount: -1,
    region: "https://secret.invalid/token",
    metadata: {
      startupTiming: {
        handlerEnteredAt: Infinity,
        attemptStartedAt: -1,
        environmentType: "PRIVATE",
        processUptimeMs: -5,
      },
    },
  });
  assert.equal(invalid.report.samples[0].startupTiming, undefined);
});

test("startup evidence preserves clock skew as a signed labeled delta", async () => {
  const base = 1700000000000;
  const result = await execute(["--samples", "1"], "success", {
    createdAt: new Date(base + 600),
    startedAt: new Date(base + 500),
    metadata: {
      startupTiming: {
        handlerEnteredAt: base,
        attemptStartedAt: base + 800,
      },
    },
  });
  const timing = result.report.samples[0].startupTiming;
  assert.equal(timing.providerPreStartMs, undefined);
  assert.equal(timing.providerStartToAttemptMs, 300);
  assert.equal(timing.attemptToHandlerWallClockDeltaMs, -800);
  assert.match(timing.interpretation, /clock skew/);
});

test("complete benchmark retains allowlisted phase spans in its persisted report", async () => {
  const result = await execute(["--samples", "1"], "success", {
    metadata: {
      setupSpansMs: {
        tools: {
          startedMs: 40,
          endedMs: 45,
          durationMs: 5,
          outcome: "completed",
          input: "private-input",
        },
        "private-phase": {
          startedMs: 1,
          endedMs: 2,
          durationMs: 1,
          outcome: "completed",
        },
      },
    },
  });
  assert.deepEqual(result.report.samples[0].setupPhases.spans, {
    tools: { startedMs: 40, endedMs: 45, durationMs: 5, outcome: "completed" },
  });
  assert.ok(!JSON.stringify(result.report).includes("private"));
});

test("terminal soak fails acceptance without confirmed cleanup even after successful output", async () => {
  const result = await execute(["--terminal-soak", "--samples", "1", "--soak-steps", "1"]);
  assert.equal(result.report.samples[0].soakVerified, true);
  assert.equal(result.code, 1);
});
