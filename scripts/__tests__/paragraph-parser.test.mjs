import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureBlocks,
  renderFullStreamdown,
  eligiblePlainParagraph,
  renderBlock,
  remend,
  markdownLinkRepairOptions,
  blockProcessor,
  plainParagraphParser,
} from "../performance/paragraph-parser.mjs";

test("strict plain eligibility agrees with actual Streamdown for all streamed prefixes", () => {
  const examples = [
    "Latest result: Streaming output. Verified 24 files, all passed!",
    "Hello www.example.com now",
    "Hello WWW.EXAMPLE.COM now",
    "Email a@example.com",
    "Visit https://example.com",
    "A &amp; B",
    "A **bold** word",
    "A _word_",
    "A `code` span",
    "A [file](https://example.com)",
    "A <em>word</em>",
    "A\\*literal",
    "Hello\nworld",
    "1. item",
    "A | B\n--- | ---\nx | y",
    "Hello café 世界",
    "A... Really? Yes; 42!",
  ];
  let accepted = 0,
    rejected = 0;
  for (const example of examples)
    for (let end = 1; end <= example.length; end++) {
      const input = example.slice(0, end);
      for (const mode of ["streaming", "static"])
        for (const props of captureBlocks(input, { mode })) {
          if (eligiblePlainParagraph(props.content)) {
            accepted++;
            assert.equal(
              renderBlock({
                ...props,
                remarkPlugins: [...props.remarkPlugins, plainParagraphParser],
              }),
              renderBlock(props),
              JSON.stringify({ input, mode, content: props.content }),
            );
          } else rejected++;
          assert.equal(
            renderBlock({
              ...props,
              remarkPlugins: [...props.remarkPlugins, plainParagraphParser],
            }),
            renderBlock(props),
          );
        }
    }
  assert.equal(accepted, 0); // Production threshold keeps short input on the real parser.
  assert(rejected > 100);
});

test("www autolinks and remend prevent raw-input bypass", () => {
  const www = captureBlocks("Hello www.example.com")[0];
  assert.match(renderBlock(www), /data-streamdown="link"/);
  assert.equal(eligiblePlainParagraph(www.content), false);
  for (const input of [
    "Hello world. ",
    "Hello **world",
    "Hello [file](https://example.com",
    "Hello <span",
  ]) {
    const repaired = remend(input, markdownLinkRepairOptions(input));
    assert.notEqual(repaired, input);
    for (const props of captureBlocks(input))
      assert.equal(
        renderBlock({
          ...props,
          remarkPlugins: [...props.remarkPlugins, plainParagraphParser],
        }),
        renderBlock(props),
      );
  }
  for (const input of [
    "1. item",
    "A &amp; B",
    "A@example.com",
    "A\nB",
    "A\\B",
    "A\tB",
    "A\rB",
  ])
    assert.equal(eligiblePlainParagraph(input), false);
});

test("parser shortcut preserves exact mdast, transformed tree, direction and custom p node", () => {
  const props = captureBlocks("Hello world.")[0];
  const normal = blockProcessor(props),
    shortcut = blockProcessor(props, true);
  const examples = [
    "Hello world.",
    "Leading spaces",
    " Leading spaces",
    "  Leading spaces",
    "    Indented code",
    "Trailing ",
    "Trailing  ",
    "Trailing   ",
    "A: B; C!",
    'A "quote"',
    "A 'quote'",
    "A www",
    "A www.",
    "A www.example.com",
    "A WWW.example.com",
    "A wWw.example.com",
    "A\u00a0B",
    "A café 世界",
    "A\nB",
    "A  \nB",
    "A &amp; B",
  ];
  for (const text of examples) {
    assert.deepEqual(shortcut.parse(text), normal.parse(text), text);
    assert.deepEqual(
      shortcut.runSync(shortcut.parse(text), text),
      normal.runSync(normal.parse(text), text),
      text,
    );
    for (const dir of [undefined, "ltr", "rtl"]) {
      const configured = {
        ...props,
        content: text,
        dir,
        components: {
          ...props.components,
          p: ({ node, children }) =>
            React.createElement(
              "p",
              { "data-node": JSON.stringify(node) },
              children,
            ),
        },
      };
      assert.equal(
        renderBlock({
          ...configured,
          remarkPlugins: [...configured.remarkPlugins, plainParagraphParser],
        }),
        renderBlock(configured),
        JSON.stringify({ text, dir }),
      );
    }
  }
});

test("production shortcut matches real parser for long Unicode, whitespace and syntax prefixes", () => {
  const props = captureBlocks("Hello world.")[0];
  const normal = blockProcessor(props),
    shortcut = blockProcessor(props, true);
  const stems = [
    "Streaming output. ",
    "Türkçe açıklama. ",
    "中文说明。",
    "中文说明. ",
    "مرحبا بالعالم. ",
    "שלום עולם. ",
    "e\u0301cole. ",
    "𐐀𐐁𐐂 words. ",
    "A\ufe0f. ",
    "A١٢٣Ⅳ. ",
  ];
  const suffixes = [
    "",
    " ",
    "  ",
    "   ",
    "\n",
    "\r",
    "\r\n",
    "\n\n",
    "\t",
    "\u00a0",
    "\u2028",
    "\u2029",
    "\u200d",
    "www",
    "www.",
    "WWW.example.com",
    "wWw.example.com",
    "http://example.com",
    "a@example.com",
    "**bold",
    "&amp;",
    "<span>",
    "\\*",
    "é",
    "世界",
    ": ; ! ?",
    '"quote"',
    "'quote'",
  ];
  let admitted = 0;
  for (const stem of stems)
    for (const suffix of suffixes) {
      const text =
        stem.repeat(Math.ceil(1100 / stem.length)).trimEnd() + suffix;
      const actual = normal.parse(text),
        candidate = shortcut.parse(text);
      if (eligiblePlainParagraph(text)) admitted++;
      assert.deepEqual(candidate, actual, JSON.stringify({ stem, suffix }));
      assert.deepEqual(
        shortcut.runSync(candidate, text),
        normal.runSync(actual, text),
        JSON.stringify({ stem, suffix }),
      );
      const configured = { ...props, content: text };
      assert.equal(
        renderBlock({
          ...configured,
          remarkPlugins: [...configured.remarkPlugins, plainParagraphParser],
        }),
        renderBlock(configured),
      );
    }
  assert(admitted > 30);
  for (const text of [
    "A".repeat(1023),
    "A".repeat(1024),
    "A".repeat(1024) + "\n",
    " " + "A".repeat(1024),
  ])
    assert.deepEqual(shortcut.parse(text), normal.parse(text));
});

test("full Streamdown keeps remend output and long custom p / direction semantics", () => {
  const long = "Latest result: " + "Streaming output. ".repeat(100);
  for (const suffix of [
    "",
    "  ",
    "\n",
    "**bold",
    "[file](https://example.com",
    "www.example.com",
    "&amp;",
  ]) {
    const text = "### Heading\n\n" + long + suffix;
    for (const mode of ["streaming", "static"])
      assert.equal(
        renderFullStreamdown(text, true, mode),
        renderFullStreamdown(text, false, mode),
      );
  }
  const props = captureBlocks(long)[0];
  assert(eligiblePlainParagraph(props.content));
  for (const dir of [undefined, "ltr", "rtl"]) {
    const configured = {
      ...props,
      dir,
      components: {
        ...props.components,
        p: ({ node, children }) =>
          React.createElement(
            "p",
            { "data-node": JSON.stringify(node) },
            children,
          ),
      },
    };
    assert.equal(
      renderBlock({
        ...configured,
        remarkPlugins: [...props.remarkPlugins, plainParagraphParser],
      }),
      renderBlock(configured),
    );
  }
});
