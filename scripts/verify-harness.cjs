#!/usr/bin/env node
// Repeatable local verification. Live reports are supplied explicitly; never launches paid probes.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const logs = fs.mkdtempSync(path.join(os.tmpdir(), "rift-harness-gate-"));
const pattern =
  "lib/__tests__/moderation.test|convex/__tests__/(agentCheckpoints|agentRunClaims)|lib/ai/tools/__tests__/|lib/agent/__tests__/|lib/api/__tests__/(agent|standalone)|lib/auth/__tests__/(api-key|get-user-id)|lib/ai/mcp/__tests__/(lazy|tool-discovery|load-user)|lib/ai/__tests__/(harness|console-model)|lib/chat/__tests__/(doom|agent-long-transport|retained)|app/api/agent-long/__tests__/|app/api/console/model/__tests__|app/hooks/__tests__/useRetainedChat|app/contexts/__tests__/ChatViewStateContext";
const steps = [
  ["types", ["node_modules/typescript/bin/tsc", "--noEmit"], root],
  [
    "harness",
    [
      "node_modules/jest/bin/jest.js",
      `--testPathPatterns=${pattern}`,
      "--runInBand",
      "--no-coverage",
      "--modulePathIgnorePatterns",
      "/.trigger/",
      "/.next",
      "/dist/",
      "/.worktrees/",
    ],
    root,
  ],
  [
    "cli-build",
    ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"],
    path.join(root, "packages/console"),
  ],
  [
    "cli-tests",
    [
      "--test",
      ...fs
        .readdirSync(path.join(root, "packages/console/test"))
        .filter((f) => f.endsWith(".test.cjs"))
        .map((f) => `test/${f}`),
    ],
    path.join(root, "packages/console"),
  ],
  [
    "quality-checker",
    ["--test", "scripts/__tests__/harness-quality.test.cjs"],
    root,
  ],
];
const results = [];
for (const [name, args, cwd] of steps) {
  const log = path.join(logs, `${name}.log`),
    fd = fs.openSync(log, "w", 0o600),
    start = Date.now();
  let result;
  try {
    result = spawnSync(process.execPath, args, {
      cwd,
      stdio: ["ignore", fd, fd],
      timeout: 300000,
    });
  } finally {
    fs.closeSync(fd);
  }
  const row = {
    name,
    passed: result.status === 0,
    durationMs: Date.now() - start,
    log,
  };
  results.push(row);
  console.log(JSON.stringify(row));
}
const { evaluateQuality } = require("./harness-quality.cjs");
const reports = process.argv.slice(2).map((file) => {
  try {
    return {
      file,
      ...evaluateQuality(JSON.parse(fs.readFileSync(file, "utf8"))),
    };
  } catch {
    return { file, pass: false, violations: ["Unreadable report"] };
  }
});
const summary = {
  regressionsPassed: results.every((r) => r.passed),
  liveReportChecks: reports.length ? reports : "not supplied",
  logs,
};
console.log(JSON.stringify(summary));
fs.writeFileSync(
  path.join(logs, "summary.json"),
  JSON.stringify(summary, null, 2),
);
if (!summary.regressionsPassed || reports.some((r) => !r.pass))
  process.exitCode = 1;
