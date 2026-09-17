const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateTerminalSoak } = require("../terminal-soak-evidence.cjs");

const command = "sleep 30";
const output = { result: { exitCode: 0, durationMs: 30010, output: "RIFT_SOAK_0\nRIFT_SOAK_1\nRIFT_SOAK_2\n" } };
const evidence = { command, calls: [{ toolCallId: "command-1", toolName: "run_terminal_cmd", input: { command } }], outputs: [{ toolCallId: "command-1", output }], steps: 3 };

test("requires confirmed successful exit and ordered complete markers", () => {
  assert.equal(evaluateTerminalSoak(evidence).verified, true);
});
test("does not accept markers or a success-shaped string without an exit status", () => {
  for (const exitCode of [undefined, null, 1, 130]) {
    const changed = structuredClone(evidence);
    changed.outputs[0].output.result.exitCode = exitCode;
    assert.equal(evaluateTerminalSoak(changed).verified, false);
  }
});
test("rejects missing, repeated or reordered markers", () => {
  for (const text of ["RIFT_SOAK_0\nRIFT_SOAK_2", "RIFT_SOAK_0\nRIFT_SOAK_1\nRIFT_SOAK_1\nRIFT_SOAK_2", "RIFT_SOAK_1\nRIFT_SOAK_0\nRIFT_SOAK_2"]) {
    const changed = structuredClone(evidence);
    changed.outputs[0].output.result.output = text;
    assert.equal(evaluateTerminalSoak(changed).verified, false);
  }
});
test("rejects a second command submission or unrelated output", () => {
  assert.equal(evaluateTerminalSoak({ ...evidence, calls: [...evidence.calls, "command-2"] }).verified, false);
  assert.equal(evaluateTerminalSoak({ ...evidence, outputs: [{ toolCallId: "unrelated", output }] }).verified, false);
});
test("rejects unknown outcomes and duplicate tool results", () => {
  const changed = structuredClone(evidence);
  changed.outputs[0].output.result.outcome = "unknown";
  assert.equal(evaluateTerminalSoak(changed).verified, false);
  assert.equal(evaluateTerminalSoak({ ...evidence, outputs: [...evidence.outputs, ...evidence.outputs] }).verified, false);
});
test("invalid evidence fails without throwing or assuming success", () => {
  for (const value of [null, {}, { calls: [], outputs: [], steps: 0 }])
    assert.equal(evaluateTerminalSoak(value).verified, false);
});
test("rejects fabricated quick markers, a changed command or different tool", () => {
  for (const input of [{ command: "printf markers" }, { command, is_background: true }, { command, interactive: true }, { command, action: "read" }]) {
    const changed = structuredClone(evidence);
    changed.calls[0].input = input;
    assert.equal(evaluateTerminalSoak(changed).verified, false);
  }
  const changed = structuredClone(evidence);
  changed.calls[0].toolName = "read_terminal_output";
  assert.equal(evaluateTerminalSoak(changed).verified, false);
});
test("rejects missing or too short execution duration", () => {
  for (const durationMs of [undefined, null, 0, 29999]) {
    const changed = structuredClone(evidence);
    changed.outputs[0].output.result.durationMs = durationMs;
    assert.equal(evaluateTerminalSoak(changed).verified, false);
  }
});
