const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const dots = [
  [0, 0],
  [0, 1],
  [0, 2],
  [1, 0],
  [1, 1],
  [1, 2],
  [0, 3],
  [1, 3],
];
function pixels(lines) {
  const result = Array.from({ length: lines.length * 4 }, () =>
    Array(lines[0].length * 2).fill(false),
  );
  lines.forEach((line, row) =>
    Array.from(line).forEach((char, column) => {
      const cell = char === " " ? 0 : char.codePointAt(0) - 0x2800;
      dots.forEach(([x, y], bit) => {
        result[row * 4 + y][column * 2 + x] = !!(cell & (1 << bit));
      });
    }),
  );
  return result;
}

test("terminal logo retains approved source paths and the symbol's opposed sweeps", async () => {
  const { terminalLogo, RIFT_SYMBOL_PATH } =
    await import("../dist/terminal-logo.js");
  const canonical = readFileSync(
    resolve(__dirname, "../../../lib/brand/logo.ts"),
    "utf8",
  );
  const terminal = readFileSync(
    resolve(__dirname, "../src/terminal-logo.ts"),
    "utf8",
  );
  assert.ok(canonical.includes(RIFT_SYMBOL_PATH));
  for (const path of canonical.matchAll(/"(M[^"\n]+)"/g))
    assert.ok(
      terminal.includes(path[1]),
      "terminal must retain each approved vector path",
    );
  const mask = pixels(terminalLogo("symbol", 24, 12));
  let filled = 0;
  mask.forEach((row, y) =>
    row.forEach((pixel, x) => {
      assert.equal(pixel, mask[47 - y][47 - x], "180-degree sweep symmetry");
      if (pixel) filled++;
    }),
  );
  assert.ok(
    filled > 300 && filled < 700,
    "filled sweeps remain sparse within clear space",
  );
  assert.ok(
    mask[23].every((pixel) => !pixel) && mask[24].every((pixel) => !pixel),
    "the central gap remains open",
  );
  assert.ok(
    mask[0].every((pixel) => !pixel) && mask[47].every((pixel) => !pixel),
    "package clear space remains empty",
  );
});

test("terminal logo fits cells without stretching and keeps the wordmark counter open", async () => {
  const { terminalLogo } = await import("../dist/terminal-logo.js");
  const square = terminalLogo("symbol", 12, 6);
  assert.deepEqual(
    terminalLogo("symbol", 20, 6),
    square.map((row) => "    " + row + "    "),
  );
  const wordmark = terminalLogo("horizontal", 107, 19);
  const mask = pixels(wordmark);
  assert.equal(mask[30][98], false, "R counter is transparent");
  assert.equal(mask[30][85], true, "R stem is filled");
  for (const [columns, rows] of [
    [4, 2],
    [6, 3],
    [34, 6],
  ]) {
    const lines = terminalLogo("symbol", columns, rows);
    assert.equal(lines.length, rows);
    assert.ok(
      lines.every(
        (line) => line.length === columns && /^[\u2800-\u28ff ]+$/.test(line),
      ),
    );
  }
  assert.throws(() => terminalLogo("symbol", NaN, 6), RangeError);
});

test("shared web and CLI artwork stays aligned with the approved vector rasterizer", async () => {
  const { terminalLogo } = await import("../dist/terminal-logo.js");
  const { RIFT_WORDMARK, RIFT_COMPACT_LOGO } =
    await import("../dist/terminal-art.js");
  assert.deepEqual(RIFT_WORDMARK, terminalLogo("horizontal", 34, 6));
  assert.deepEqual(
    RIFT_COMPACT_LOGO,
    terminalLogo("symbol", 6, 3).map(
      (row, index) => row + (index === 1 ? "  Rift" : ""),
    ),
  );
});

test("activity pulses brightness while the approved symbol remains fixed", async () => {
  const { RIFT_ACTIVITY_MARK, riftActivityIntensity } =
    await import("../dist/activity-orb.js");
  const { terminalLogo } = await import("../dist/terminal-logo.js");
  assert.deepEqual(RIFT_ACTIVITY_MARK, terminalLogo("symbol", 6, 3));
  assert.notEqual(riftActivityIntensity(0), riftActivityIntensity(800));
  assert.equal(
    riftActivityIntensity(0, true),
    riftActivityIntensity(800, true),
  );
  assert.equal(riftActivityIntensity(NaN), riftActivityIntensity(0));
});
