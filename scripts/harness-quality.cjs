#!/usr/bin/env node
// Initial product targets; development samples are evidence, not production percentiles.
const DEFAULT_TARGETS = { minSamples: 20, medianMs: 4000, p95Ms: 8000 };
const { validateReportedScenario } = require("./startup-scenarios.cjs");
function timingStats(rows, key) {
  const values = rows
    .map((r) => r[key])
    .filter((v) => Number.isFinite(v) && v >= 0)
    .sort((a, b) => a - b);
  return values.length
    ? {
        samples: values.length,
        medianMs: values[Math.ceil(values.length * 0.5) - 1],
        p95Ms: values[Math.ceil(values.length * 0.95) - 1],
        maxMs: values.at(-1),
      }
    : null;
}
function evaluateQuality(report, targets = DEFAULT_TARGETS) {
  const rows = Array.isArray(report?.samples) ? report.samples : [];
  const violations = [];
  const recovery = report?.mode === "disconnect-recovery";
  if (!recovery && report?.mode !== "startup")
    violations.push("Unknown report mode");
  if (rows.length < (recovery ? 1 : targets.minSamples))
    violations.push("Insufficient samples");
  if (rows.some((r) => r.status !== "COMPLETED" || r.finished !== true))
    violations.push("Incomplete or failed runs");
  if (rows.some((r) => r.duplicateEvents !== 0))
    violations.push("Duplicate events or missing duplicate check");
  // Legacy timing-only reports keep their original contract. Named scenario
  // reports must additionally retain successful task-specific evidence.
  if (
    report?.scenarios !== undefined ||
    rows.some(
      (r) => r.scenario !== undefined || r.scenarioVerified !== undefined,
    )
  ) {
    if (rows.some((r) => !validateReportedScenario(r)))
      violations.push("Failed or missing scenario evidence");
    if (
      report?.scenarios !== undefined &&
      (!Array.isArray(report.scenarios) ||
        report.scenarios.length === 0 ||
        report.scenarios.some(
          (name) => !["greeting", "explanation", "terminal"].includes(name),
        ) ||
        rows.some(
          (r, index) =>
            r.scenario !== report.scenarios[index % report.scenarios.length],
        ))
    )
      violations.push("Invalid scenario schedule");
  }
  const firstText = timingStats(rows, "firstTextMs");
  if (!firstText || firstText.samples !== rows.length)
    violations.push("Missing first-text measurements");
  if (recovery) {
    if (rows.some((r) => r.completedWhileDetached !== true))
      violations.push("Work did not complete while detached");
  } else if (firstText) {
    if (firstText.medianMs > targets.medianMs)
      violations.push("Median first text exceeds target");
    if (firstText.p95Ms > targets.p95Ms)
      violations.push("P95 first text exceeds target");
  }
  return {
    pass: violations.length === 0,
    violations,
    firstText,
    targets: recovery ? undefined : targets,
  };
}
module.exports = { evaluateQuality, timingStats };
if (require.main === module) {
  const fs = require("node:fs");
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error(
      "Usage: node scripts/harness-quality.cjs report.json [recovery.json]",
    );
    process.exitCode = 1;
  }
  for (const file of files) {
    try {
      const result = evaluateQuality(JSON.parse(fs.readFileSync(file, "utf8")));
      console.log(JSON.stringify({ file, ...result }));
      if (!result.pass) process.exitCode = 1;
    } catch {
      console.error(
        JSON.stringify({
          file,
          pass: false,
          violations: ["Unreadable report"],
        }),
      );
      process.exitCode = 1;
    }
  }
}
