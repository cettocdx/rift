// Usage: node scripts/performance/measure-paragraph-parser.mjs [/tmp/result.json]
// Node/SSR microbenchmark; not a browser frame or native acceptance benchmark.
import assert from "node:assert/strict";
import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { buildStreamHistory } from "./stream-history.cjs";
import {
  captureBlocks,
  eligiblePlainParagraph,
  renderBlock,
  blockProcessor,
  plainParagraphParser,
  remend,
  markdownLinkRepairOptions,
  createIncrementalMarkdownParser,
  parseMarkdownIntoBlocks,
} from "./paragraph-parser.mjs";
const repeats = 15;
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    medianMs: median(values),
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    minMs: sorted[0],
    maxMs: sorted.at(-1),
    samples: values.length,
  };
}
function measure(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}
function compare(normal, candidate) {
  const a = [],
    b = [];
  for (let i = 0; i < repeats; i++) {
    if (i % 2) {
      b.push(measure(candidate));
      a.push(measure(normal));
    } else {
      a.push(measure(normal));
      b.push(measure(candidate));
    }
  }
  return { normal: stats(a), shortcut: stats(b) };
}
const base = buildStreamHistory(true);
const initial = captureBlocks("Latest result: Streaming output.")[0];
const normal = blockProcessor(initial),
  shortcut = blockProcessor(initial, true);
const candidateProps = {
  ...initial,
  remarkPlugins: [...initial.remarkPlugins, plainParagraphParser],
};
for (let i = 0; i < 30; i++) {
  const text = "Latest result: " + "Streaming output. ".repeat(32 + i);
  normal.runSync(normal.parse(text), text);
  shortcut.runSync(shortcut.parse(text), text);
  renderBlock({ ...initial, content: text });
  renderBlock({ ...candidateProps, content: text });
}
const rows = [];
for (const updates of [1, 64, 256, 512, 1024, 1567, 2400]) {
  const fullText =
    base + "\n\nLatest result: " + "Streaming output. ".repeat(updates);
  const props = captureBlocks(fullText, {
    parseBlocks: createIncrementalMarkdownParser(parseMarkdownIntoBlocks),
  }).at(-1);
  const text = props.content,
    fast = { ...props, remarkPlugins: candidateProps.remarkPlugins };
  const eligible = eligiblePlainParagraph(text);
  assert.deepEqual(shortcut.parse(text), normal.parse(text));
  assert.equal(renderBlock(fast), renderBlock(props));
  const remendTimes = [];
  for (let i = 0; i < repeats; i++)
    remendTimes.push(
      measure(() => remend(fullText, markdownLinkRepairOptions(fullText))),
    );
  rows.push({
    updates,
    eligible,
    fullTextLength: fullText.length,
    activeBlockLength: text.length,
    blockCount: captureBlocks(fullText).length,
    parse: compare(
      () => normal.parse(text),
      () => shortcut.parse(text),
    ),
    pipeline: compare(
      () => normal.runSync(normal.parse(text), text),
      () => shortcut.runSync(shortcut.parse(text), text),
    ),
    blockSsr: compare(
      () => renderBlock(props),
      () => renderBlock(fast),
    ),
    wholeMessageRemend: stats(remendTimes),
  });
}
// Every delta in a bounded growing window, not repeated rendering of one string.
const appendWindow = [];
for (let n = 1500; n < 1568; n++) {
  const text = ("Latest result: " + "Streaming output. ".repeat(n)).trimEnd();
  const a = () => renderBlock({ ...initial, content: text });
  const b = () => renderBlock({ ...candidateProps, content: text });
  let normalMs, shortcutMs;
  if (n % 2) {
    shortcutMs = measure(b);
    normalMs = measure(a);
  } else {
    normalMs = measure(a);
    shortcutMs = measure(b);
  }
  appendWindow.push({
    updates: n,
    activeBlockLength: text.length,
    normalMs,
    shortcutMs,
  });
}
const result = {
  diagnostic: true,
  node: process.version,
  nodeEnv: process.env.NODE_ENV ?? "unset (React development)",
  streamdown: "2.5.0",
  remarkParse: "11.0.0",
  remend: "1.3.0",
  repeats,
  rows,
  appendWindow: {
    from: 1500,
    to: 1567,
    normal: stats(appendWindow.map((x) => x.normalMs)),
    shortcut: stats(appendWindow.map((x) => x.shortcutMs)),
    samples: appendWindow,
  },
  note: "Installed real Streamdown Block SSR and its captured default remark/rehype plugins. Shortcut preserves the Block and downstream pipeline. Node/SSR, sequential on one host; not browser render latency, native, GC causality, or outlier elimination. Whole-message remend remains unchanged. Production helper: >=1024 UTF-16 units, Unicode L/M/N plus limited ASCII punctuation, no www.; same fallback and downstream pipeline.",
};
const json = JSON.stringify(result, null, 2);
if (process.argv[2]) fs.writeFileSync(process.argv[2], json);
else console.log(json);
