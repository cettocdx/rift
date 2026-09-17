// Plain source shared by the browser replay and its shape regression. The old
// fixture accidentally used literal backslash-n throughout history, collapsing
// mixed Markdown into one pathological block. Keep that case explicit only.
const format = (text, escaped) =>
  escaped ? text.replaceAll("\n", "\\n") : text;
function buildStreamHistory(mixed, escaped = false) {
  return format(
    Array.from(
      { length: 180 },
      (_, i) =>
        `### Step ${i}\n\nVerified [file ${i}](https://example.com/${i}) with several checks. The working state remains available during streaming.\n\n` +
        (i % 12 === 0
          ? "| Check | Result |\n| --- | --- |\n| Navigation | Passed |\n\n"
          : "") +
        (mixed && i % 10 === 0
          ? "```typescript\nexport function reconcile(value: number) {\n  return Math.max(0, value);\n}\n```\n\n"
          : ""),
    ).join(""),
    escaped,
  );
}
function historyMessage(index, escaped = false) {
  return format(
    `### Completed message ${index}\n\nA [reference](https://example.com) and a useful explanation.\n\n${index % 5 === 0 ? "```js\nconst completed = true;\n```" : ""}`,
    escaped,
  );
}
function toolOutput(index, escaped = false) {
  return format(`Check ${index}: passed\n`.repeat(30), escaped);
}
module.exports = { buildStreamHistory, historyMessage, toolOutput };
