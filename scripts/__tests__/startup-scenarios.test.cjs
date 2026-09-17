const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const helperPath = "../startup-scenarios.cjs";
let helper = {};
try {
  helper = require(helperPath);
} catch (error) {
  if (error.code !== "MODULE_NOT_FOUND") throw error;
}
const api = () => {
  assert.equal(
    typeof helper.parseBenchmarkOptions,
    "function",
    "scenario parser must exist",
  );
  return helper;
};
const plan = (name) => api().buildScenario(name, "sample123");
function completed(name) {
  const scenario = plan(name);
  const observation = api().createObservation();
  if (name === "terminal") {
    api().collectBenchmarkChunk(observation, {
      type: "tool-input-start",
      toolCallId: "call1",
      toolName: "run_terminal_cmd",
    });
    api().collectBenchmarkChunk(observation, {
      type: "tool-input-available",
      toolCallId: "call1",
      toolName: "run_terminal_cmd",
      input: { command: scenario.command, timeout: 30 },
    });
    api().collectBenchmarkChunk(observation, {
      type: "tool-output-available",
      toolCallId: "call1",
      output: {
        result: {
          output: `/workspace\n${scenario.outputSentinel}\n`,
          exitCode: 0,
          durationMs: 12,
        },
      },
    });
  }
  api().collectBenchmarkChunk(observation, {
    type: "text-delta",
    delta: `An absolute path starts at the filesystem root. A relative path starts at the current directory.\n${scenario.finalSentinel}`,
  });
  api().collectBenchmarkChunk(observation, { type: "finish" });
  return { scenario, observation, status: "COMPLETED" };
}
test("defaults preserve greeting and existing bounded soak options", () => {
  assert.deepEqual(api().parseBenchmarkOptions([]).scenarioNames, ["greeting"]);
  const soak = api().parseBenchmarkOptions([
    "--terminal-soak",
    "--samples",
    "1",
    "--soak-steps",
    "60",
  ]);
  assert.equal(soak.terminalSoak, true);
  assert.equal(soak.soakSteps, 60);
  assert.equal(soak.disconnect, true);
});
test("mixed scheduling is deterministic and total samples never exceed20", () => {
  const options = api().parseBenchmarkOptions([
    "--scenario",
    "mixed",
    "--samples",
    "20",
  ]);
  assert.deepEqual(options.scenarioNames, [
    "greeting",
    "explanation",
    "terminal",
  ]);
  assert.equal(options.count, 20);
  assert.deepEqual(
    Array.from({ length: 5 }, (_, i) => options.scenarioNames[i % 3]),
    ["greeting", "explanation", "terminal", "greeting", "explanation"],
  );
});
test("malformed and conflicting CLI arguments reject before auth/dependency loading", () => {
  for (const args of [
    ["--scenario", "unknown"],
    ["--samples", "21"],
    ["--samples"],
    ["--scenario", "terminal", "--terminal-soak", "--samples", "1"],
    ["--soak-steps", "2"],
    ["--samples", "1", "--samples", "2"],
    ["--origin", "file:///tmp/a"],
    ["--what"],
    ["--scenario", "--persisted"],
  ]) {
    assert.throws(() => api().parseBenchmarkOptions(args));
    const run = spawnSync(
      process.execPath,
      [path.resolve(__dirname, "../benchmark-agent-startup.cjs"), ...args],
      {
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          HOME: "/definitely-no-rift-benchmark-auth",
        },
      },
    );
    assert.equal(run.status, 1);
    assert.match(run.stderr, /Invalid benchmark options/);
    assert.doesNotMatch(
      run.stderr,
      /console\.json|Cannot find module|apiKey|Bearer/,
    );
  }
});
test("only terminal scenario grants full approval and explicitly selects cloud", () => {
  for (const name of ["greeting", "explanation"])
    assert.equal(plan(name).approvalMode, "ask");
  const terminal = plan("terminal");
  assert.equal(terminal.approvalMode, "full");
  assert.equal(terminal.sandboxPreference, "e2b");
  assert.equal(
    terminal.command,
    "pwd; printf '%s\\n' 'RIFT_TERMINAL_sample123'",
  );
  assert.throws(() => api().buildScenario("terminal", "bad'; rm -rf /"));
  assert.throws(() => api().buildScenario("terminal", undefined));
});
test("explanation needs finished nonempty text, sentinel and no tool attempts", () => {
  const evidence = completed("explanation");
  assert.equal(api().evaluateScenario(evidence).verified, true);
  for (const type of [
    "tool-input-start",
    "tool-input-available",
    "tool-input-error",
  ]) {
    const changed = completed("explanation");
    api().collectBenchmarkChunk(changed.observation, {
      type,
      toolCallId: "unexpected",
      toolName: "browser",
    });
    assert.equal(api().evaluateScenario(changed).verified, false);
  }
  for (const patch of [
    { text: "" },
    { text: evidence.scenario.finalSentinel },
    { finished: false },
  ]) {
    assert.equal(
      api().evaluateScenario({
        ...evidence,
        observation: { ...evidence.observation, ...patch },
      }).verified,
      false,
    );
  }
  assert.equal(
    api().evaluateScenario({ ...evidence, status: "FAILED" }).verified,
    false,
  );
});
test("terminal success comes from exactly one matching real output and confirmed exit", () => {
  const evidence = completed("terminal");
  const result = api().evaluateScenario(evidence);
  assert.equal(result.verified, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.commandCount, 1);
  assert.equal(
    result.toolResult.output,
    `/workspace\n${evidence.scenario.outputSentinel}\n`,
  );
  assert.equal(result.toolCall.toolCallId, "call1");
});
test("model success text never compensates for missing, wrong or unknown tool results", () => {
  for (const patch of [
    { outputs: [] },
    { outputs: [{ toolCallId: "other", output: { result: { exitCode: 0 } } }] },
  ]) {
    const evidence = completed("terminal");
    Object.assign(evidence.observation, patch);
    assert.equal(api().evaluateScenario(evidence).verified, false);
  }
  for (const patch of [
    { exitCode: null },
    { exitCode: 1 },
    { outcome: "unknown" },
    { success: false },
    { error: "failed despite stale exit code" },
    { output: "fake success" },
    { output: "/workspace\nRIFT_TERMINAL_wrong\n" },
  ]) {
    const evidence = completed("terminal");
    Object.assign(evidence.observation.outputs[0].output.result, patch);
    assert.equal(api().evaluateScenario(evidence).verified, false);
  }
  const failedEnvelope = completed("terminal");
  failedEnvelope.observation.outputs[0].output.success = false;
  assert.equal(api().evaluateScenario(failedEnvelope).verified, false);
});
test("duplicate, changed, extra or background commands fail exact-once evidence", () => {
  for (const patch of [
    { command: "echo fake" },
    { is_background: true },
    { interactive: true },
    { action: "write" },
    { timeout: 9999 },
  ]) {
    const evidence = completed("terminal");
    Object.assign(evidence.observation.calls[0].input, patch);
    assert.equal(api().evaluateScenario(evidence).verified, false);
  }
  for (const what of ["call", "output", "other-tool"]) {
    const evidence = completed("terminal");
    if (what === "call")
      evidence.observation.calls.push(evidence.observation.calls[0]);
    if (what === "output")
      evidence.observation.outputs.push(evidence.observation.outputs[0]);
    if (what === "other-tool")
      api().collectBenchmarkChunk(evidence.observation, {
        type: "tool-input-start",
        toolCallId: "other",
        toolName: "web_search",
      });
    assert.equal(api().evaluateScenario(evidence).verified, false);
  }
});
test("terminal result must contain pwd plus one unique sentinel and final response acknowledgement", () => {
  for (const output of [
    "RIFT_TERMINAL_sample123\n",
    "/workspace\nRIFT_TERMINAL_sample123\nRIFT_TERMINAL_sample123\n",
    "relative/path\nRIFT_TERMINAL_sample123\n",
  ]) {
    const evidence = completed("terminal");
    evidence.observation.outputs[0].output.result.output = output;
    assert.equal(api().evaluateScenario(evidence).verified, false);
  }
  const evidence = completed("terminal");
  evidence.observation.text = "Done";
  assert.equal(api().evaluateScenario(evidence).verified, false);
});

test("progress timing excludes setup envelopes and preserves first reasoning/tool/text arrival", () => {
  const observation = api().createObservation();
  const feed = (type, at, extra = {}) => api().collectBenchmarkChunk(observation, { type, ...extra }, at);
  feed("start", 10);
  feed("data-status", 20);
  feed("reasoning-start", 30);
  feed("reasoning-delta", 40, { delta: "  " });
  assert.deepEqual(observation.progressTiming, {});
  feed("reasoning-delta", 50, { delta: "Checking" });
  feed("tool-input-start", 70, { toolCallId: "one" });
  feed("tool-input-available", 90, { toolCallId: "one", toolName: "run_terminal_cmd" });
  feed("text-delta", 100, { delta: "Done" });
  feed("reasoning-delta", 120, { delta: "Later" });
  assert.deepEqual(observation.progressTiming, { firstReasoningMs: 50, firstToolInputMs: 70, firstToolReadyMs: 90, firstTextMs: 100 });
});
test("untimed or invalid observations do not manufacture timing evidence", () => {
  const observation = api().createObservation();
  for (const at of [undefined, NaN, Infinity, -1]) api().collectBenchmarkChunk(observation, { type: "text-delta", delta: "text" }, at);
  assert.deepEqual(observation.progressTiming, {});
});
