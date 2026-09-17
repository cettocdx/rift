import assert from 'node:assert/strict';
import { parseMarkdownIntoBlocks } from 'streamdown';
import { createIncrementalMarkdownParser } from '../lib/ui/incremental-markdown-blocks.ts';
const { default: remend } = await import(new URL('../../remend/dist/index.js', import.meta.resolve('streamdown')));

const history = Array.from({ length: 180 }, (_, i) => `### Section ${i}\n\nA [reference](https://example.com/${i}) and text.\n\n`).join('');
const sizes = [];
const parse = createIncrementalMarkdownParser(text => {
  sizes.push(text.length);
  return parseMarkdownIntoBlocks(text);
});
assert.deepEqual(parse(history + 'Latest'), parseMarkdownIntoBlocks(history + 'Latest'));
assert.deepEqual(parse(history + 'Latest result'), parseMarkdownIntoBlocks(history + 'Latest result'));
assert(sizes.length === 1 || sizes.at(-1) < 300, `Reparsed ${sizes.at(-1)} characters of unchanged history`);
const beforePlainAppend = sizes.length;
assert.deepEqual(parse(history + 'Latest result continues.'), parseMarkdownIntoBlocks(history + 'Latest result continues.'));
assert.equal(sizes.length, beforePlainAppend, 'Plain inline extension should reuse established raw block boundaries');

const cases = [
  '# Heading\n\nparagraph\n\ncontinued\n---\n',
  '- first\n\n- second\n  continuation\n\n  paragraph\n\nend',
  '> quote\n> next\n\n> more\n\nplain',
  '```js\nconst a = 1;\n\n## not a heading\n```\n\nend',
  '~~~\ncode\n\n~~~\n\ntext',
  '| A | B |\n| - | - |\n| 1 | 2 |\n\nend',
  'Text [ref].\n\n[ref]: https://example.com\n\ntext',
  'Footnote[^a]\n\n[^a]: Footnote content\n\nnext',
  '<div>\n\nhello\n\n</div>\n\nend',
  '$$\n\nformula\n\n$$\n\nend',
  'indented\n\n    code\n\n    more\n\nend',
  'a\r\n\r\nb\r\n',
  '[streaming link](https://example.com/path) and **unfinished bold**\n\nnext',
  '![image](https://example.com/image.png)\n\ninline `code`\n\nnext',
];
let checks = 0;
for (const example of cases) {
  const parser = createIncrementalMarkdownParser(parseMarkdownIntoBlocks);
  const repairedParser = createIncrementalMarkdownParser(parseMarkdownIntoBlocks);
  for (let i = 0; i <= example.length; i++) {
    const text = history + example.slice(0, i);
    assert.deepEqual(parser(text), parseMarkdownIntoBlocks(text), JSON.stringify(example.slice(0, i)));
    const repaired = remend(text);
    assert.deepEqual(repairedParser(repaired), parseMarkdownIntoBlocks(repaired));
    checks += 2;
  }
  for (const replacement of ['new message', history, '', example]) {
    assert.deepEqual(parser(replacement), parseMarkdownIntoBlocks(replacement));
    checks++;
  }
}
let seed = 53;
const random = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
for (let sample = 0; sample < 300; sample++) {
  const parser = createIncrementalMarkdownParser(parseMarkdownIntoBlocks);
  const text = Array.from({ length: 8 }, () => cases[random(cases.length)]).join('\n\n');
  for (let i = 0; i < text.length; i += 1 + random(17)) {
    assert.deepEqual(parser(text.slice(0, i)), parseMarkdownIntoBlocks(text.slice(0, i)));
    checks++;
  }
  assert.deepEqual(parser(text), parseMarkdownIntoBlocks(text));
  checks++;
}
console.log(JSON.stringify({ checks, parserCallsForPlainAppends: sizes.length, lastParsedCharacters: sizes.at(-1), originalCharacters: history.length, passed: true }));
