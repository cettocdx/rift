// Run: node --experimental-strip-types scripts/verify-markdown-repair.mjs
// Compare with the installed parser itself, not a mocked implementation.
import assert from "node:assert/strict";
import { markdownLinkRepairOptions } from "../lib/ui/markdown-link-repair.ts";
const { default: remend } = await import(new URL("../../remend/dist/index.js", import.meta.resolve("streamdown")));
const chunks = ["plain text ", "[link](https://example.com/a(b))", "![image](url)", "[nested [label]](url)", "[reference]", "[unfinished", "[x](unfinished", "\\[escaped]", "<tag", "```js\nconst a = [1, 2];\n```", "**bold", "~~strike", "[x](url[part])", "](", "[label <tag]"];
let seed = 7919, fast = 0;
for (let i = 0; i < 20000; i++) {
  let text = "";
  for (let j = 0; j < 4; j++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    text += chunks[seed % chunks.length] + "\n\n";
  }
  const options = markdownLinkRepairOptions(text);
  if (options) fast++;
  assert.equal(remend(text, options), remend(text), JSON.stringify(text));
}
console.log(JSON.stringify({ cases: 20000, fastPathCases: fast, equivalent: true }));
