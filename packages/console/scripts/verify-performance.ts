// Actual OpenTUI component + native test renderer. Excludes OS terminal display,
// PTY transport and model latency. Run with Bun from packages/console.
import { createTestRenderer } from "@opentui/core/testing";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { mountRiftTui } from "../src/opentui";
import type { ConsoleSnapshot } from "../src/protocol";
import { snapshot } from "../test/fixture.cjs";

const results = [];
for (const [width, height] of [
  [80, 24],
  [126, 46],
  [180, 60],
]) {
  const ui = await createTestRenderer({ width, height, targetFps: 60 });
  const events = new EventEmitter();
  const state = snapshot() as ConsoleSnapshot;
  state.approvals = [];
  state.status = "streaming";
  state.entries = Array.from({ length: 1000 }, (_, i) => ({
    id: `history-${i}`,
    kind: "assistant",
    text: "Historical output.\n".repeat(30),
  }));
  state.entries.push({
    id: "live",
    kind: "assistant",
    text: "Current output.\n".repeat(1000),
  });
  const app = mountRiftTui(ui.renderer, {
    cwd: "/tmp/rift-performance",
    connect: async () => ({
      events,
      snapshot: state,
      close: async () => {},
      send: async () => {
        throw new Error("No task dispatch permitted");
      },
    }),
    login: async () => {},
    openApp: async () => {},
  });
  const update: number[] = [];
  const frames: number[] = [];
  const inputFrames: number[] = [];
  let expectedDraft = "Keep this unsent draft";
  try {
    await ui.flush();
    await ui.mockInput.typeText(expectedDraft);
    for (let i = 0; i < 100; i++) {
      state.entries.at(-1)!.text += `Chunk ${i}\n`;
      const start = performance.now();
      events.emit("snapshot");
      const updated = performance.now();
      await ui.flush();
      const end = performance.now();
      assert.equal(app.input.plainText, expectedDraft);
      if (i % 10 === 0) {
        const inputStart = performance.now();
        await ui.mockInput.typeText(".");
        expectedDraft += ".";
        await ui.flush();
        inputFrames.push(performance.now() - inputStart);
        assert.equal(app.input.plainText, expectedDraft);
      }
      if (i >= 10) {
        update.push(updated - start);
        frames.push(end - start);
      }
    }
    assert.ok(ui.captureCharFrame().includes(expectedDraft));
    const summarize = (v: number[]) => {
      v.sort((a, b) => a - b);
      return {
        p50: v[Math.floor(v.length * 0.5)],
        p95: v[Math.floor(v.length * 0.95)],
        max: v.at(-1),
      };
    };
    results.push({
      width,
      height,
      samples: update.length,
      inputSamples: inputFrames.length,
      inputAndVisualIdleMs: summarize(inputFrames),
      draftPreserved: app.input.plainText === expectedDraft,
      updateMs: summarize(update),
      updateAndVisualIdleMs: summarize(frames),
    });
  } finally {
    await app.close();
  }
}
console.log(
  JSON.stringify(
    {
      measurement:
        "OpenTUI native test renderer at production targetFps=60; visual-idle includes scheduler wait, excludes PTY/display/model",
      historyEntries: 1000,
      historyLinesPerEntry: 30,
      liveLines: 1000,
      results,
    },
    null,
    2,
  ),
);
