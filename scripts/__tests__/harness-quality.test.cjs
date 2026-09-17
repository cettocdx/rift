const { test } = require("node:test");
const assert = require("node:assert/strict");
const { evaluateQuality } = require("../harness-quality.cjs");
const row = {
  status: "COMPLETED",
  finished: true,
  firstTextMs: 2500,
  duplicateEvents: 0,
};
const report = {
  mode: "startup",
  samples: Array.from({ length: 20 }, () => ({ ...row })),
};
test("rejects a fast report that hides failed or textless runs", () => {
  const bad = structuredClone(report);
  bad.samples[19] = { status: "FAILED" };
  assert.equal(evaluateQuality(bad).pass, false);
  const textless = structuredClone(report);
  delete textless.samples[0].firstTextMs;
  assert.equal(evaluateQuality(textless).pass, false);
});
test("does not label a tiny exploratory sample as release evidence", () => {
  assert.equal(evaluateQuality({ ...report, samples: [row] }).pass, false);
});
test("detects a slow tail even when the median is good", () => {
  const slow = structuredClone(report);
  slow.samples[18].firstTextMs = 15000;
  slow.samples[19].firstTextMs = 16000;
  const result = evaluateQuality(slow);
  assert.equal(result.pass, false);
  assert.equal(result.firstText.p95Ms, 15000);
});
test("requires proof of progress while detached, final delivery and no duplicates", () => {
  const recovery = {
    mode: "disconnect-recovery",
    samples: [{ ...row, completedWhileDetached: true }],
  };
  assert.equal(evaluateQuality(recovery).pass, true);
  for (const field of ["completedWhileDetached", "finished"])
    assert.equal(
      evaluateQuality({
        mode: recovery.mode,
        samples: [{ ...recovery.samples[0], [field]: false }],
      }).pass,
      false,
    );
  assert.equal(
    evaluateQuality({
      mode: recovery.mode,
      samples: [{ ...recovery.samples[0], duplicateEvents: 1 }],
    }).pass,
    false,
  );
});
test("passes complete evidence within the configured targets", () => {
  assert.equal(evaluateQuality(report).pass, true);
  assert.equal(
    evaluateQuality(report, { minSamples: 20, medianMs: 2000, p95Ms: 8000 })
      .pass,
    false,
  );
});

test("scenario reports cannot hide a failed or absent evidence check behind fast timings", () => {
  const scoped = {
    ...report,
    scenarios: ["explanation"],
    samples: report.samples.map((r) => ({
      ...r,
      scenario: "explanation",
      scenarioVerified: false,
    })),
  };
  assert.equal(evaluateQuality(scoped).pass, false);
  scoped.samples.forEach((r) => {
    r.scenarioVerified = true;
  });
  assert.equal(
    evaluateQuality(scoped).pass,
    false,
    "missing evidence must fail",
  );
});

test("terminal report requires actual matching output even if verified flags claim success", () => {
  const {
    buildScenario,
    createObservation,
    collectBenchmarkChunk,
    evaluateScenario,
  } = require("../startup-scenarios.cjs");
  const scenario = buildScenario("terminal", "sample123");
  const observation = createObservation();
  collectBenchmarkChunk(observation, {
    type: "tool-input-available",
    toolCallId: "call",
    toolName: "run_terminal_cmd",
    input: { command: scenario.command },
  });
  collectBenchmarkChunk(observation, {
    type: "tool-output-available",
    toolCallId: "call",
    output: {
      result: {
        output: `/workspace\n${scenario.outputSentinel}\n`,
        exitCode: 0,
      },
    },
  });
  collectBenchmarkChunk(observation, {
    type: "text-delta",
    delta: scenario.finalSentinel,
  });
  collectBenchmarkChunk(observation, { type: "finish" });
  const scenarioEvidence = evaluateScenario({
    scenario,
    observation,
    status: "COMPLETED",
  });
  const scoped = {
    ...report,
    scenarios: ["terminal"],
    samples: report.samples.map((r) => ({
      ...r,
      chatId: "sample123",
      scenario: "terminal",
      scenarioVerified: true,
      scenarioEvidence: structuredClone(scenarioEvidence),
    })),
  };
  assert.equal(evaluateQuality(scoped).pass, true);
  delete scoped.samples[0].scenarioEvidence.toolResult;
  assert.equal(evaluateQuality(scoped).pass, false);
  assert.equal(
    evaluateQuality({ ...scoped, samples: scoped.samples.slice(1, 4) }).pass,
    false,
    "mixed or named scenarios do not waive sample minimum",
  );
});
