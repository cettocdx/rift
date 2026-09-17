// CPU cost of the real console renderer. This is not terminal-display latency.
// Run after: pnpm --dir packages/console build
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createRequire } from "node:module";
import { renderView } from "../packages/console/dist/renderer.js";

const require = createRequire(import.meta.url);
const { snapshot } = require("../packages/console/test/fixture.cjs");
const state = {
  ...snapshot(),
  approvals: [],
  target: "local",
  entries: [
    ...Array.from({ length: 1000 }, (_, i) => ({
      id: `history-${i}`, kind: "assistant", text: "Historical output.\n".repeat(30),
    })),
    { id: "live", kind: "assistant", text: "Current output.\n".repeat(1000) },
  ],
};
const results = [];
for (const [columns, rows] of [[80, 24], [126, 46], [180, 60]]) {
  const timings = [];
  for (let i = 0; i < 350; i++) {
    const input = "Typing while output arrives ".repeat(1 + i % 4);
    const started = performance.now();
    const view = renderView({ columns, rows, connected: true, snapshot: state,
      cwd: "/tmp/rift-performance", input, inputCursor: [...input].length });
    const duration = performance.now() - started;
    assert.ok(view.cursor.row > 0 && view.cursor.row <= rows);
    assert.ok(view.frame.includes("Typing"));
    if (i >= 50) timings.push(duration);
  }
  timings.sort((a, b) => a - b);
  results.push({ columns, rows, samples: timings.length,
    rendererP95Ms: timings[Math.floor(timings.length * .95)],
    rendererMaxMs: timings.at(-1) });
}
console.log(JSON.stringify({ measurement: "renderer CPU only; excludes PTY, display and model",
  historyEntries: 1000, liveLines: 1000, results }, null, 2));
