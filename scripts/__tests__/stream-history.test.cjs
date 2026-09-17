const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  buildStreamHistory,
  historyMessage,
  toolOutput,
} = require("../performance/stream-history.cjs");
test("representative history contains real paragraphs, tables and fenced blocks", async () => {
  const { parseMarkdownIntoBlocks } = await import("streamdown");
  const base = buildStreamHistory(true);
  assert.equal(base.split("\n").length - 1, 888);
  assert(base.includes("### Step 0\n\nVerified"));
  assert.equal((base.match(/^```typescript$/gm) || []).length, 18);
  assert.equal((base.match(/^\| Check \| Result \|$/gm) || []).length, 15);
  assert(parseMarkdownIntoBlocks(base).length > 500);
  assert(historyMessage(0).includes("\n\nA [reference]"));
  assert.equal(toolOutput(0).split("\n").length - 1, 30);
});
test("old escaped history is an explicitly named pathological alternative", async () => {
  const { parseMarkdownIntoBlocks } = await import("streamdown");
  const base = buildStreamHistory(true, true);
  assert.equal(base.includes("\n"), false);
  assert(base.includes("\\n"));
  assert.equal(parseMarkdownIntoBlocks(base).length, 1);
});
