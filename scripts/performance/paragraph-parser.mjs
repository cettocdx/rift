// Diagnostic only: exercise the installed Streamdown block pipeline, never mocks.
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { realpathSync } from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Block,
  Streamdown,
  parseMarkdownIntoBlocks,
  defaultRemarkPlugins,
} from "streamdown";
import { markdownLinkRepairOptions } from "../../lib/ui/markdown-link-repair.ts";
import { createIncrementalMarkdownParser } from "../../lib/ui/incremental-markdown-blocks.ts";
const requireFromStreamdown = createRequire(import.meta.resolve("streamdown"));
const dependency = async (name) =>
  import(pathToFileURL(requireFromStreamdown.resolve(name)));
const [
  { unified },
  { default: remarkParse },
  { default: remarkRehype },
  { default: remend },
] = await Promise.all([
  dependency("unified"),
  dependency("remark-parse"),
  dependency("remark-rehype"),
  import(
    pathToFileURL(
      path.resolve(
        realpathSync("node_modules/streamdown"),
        "../remend/dist/index.js",
      ),
    )
  ),
]);
export {
  remend,
  markdownLinkRepairOptions,
  parseMarkdownIntoBlocks,
  defaultRemarkPlugins,
  createIncrementalMarkdownParser,
};
export function captureBlocks(
  text,
  { mode = "streaming", parseBlocks = parseMarkdownIntoBlocks } = {},
) {
  const blocks = [];
  function Capture(props) {
    blocks.push(props);
    return null;
  }
  renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        mode,
        animated: false,
        BlockComponent: Capture,
        parseMarkdownIntoBlocksFn: parseBlocks,
        remend: markdownLinkRepairOptions(text),
      },
      text,
    ),
  );
  return blocks;
}
export {
  plainParagraphTree,
  remarkPlainParagraph as plainParagraphParser,
} from "../../lib/ui/plain-paragraph-parser.ts";
import {
  plainParagraphTree,
  remarkPlainParagraph,
} from "../../lib/ui/plain-paragraph-parser.ts";
export const eligiblePlainParagraph = (content) =>
  Boolean(plainParagraphTree(content));
export function renderBlock(props) {
  return renderToStaticMarkup(React.createElement(Block, props));
}
export function blockProcessor(props, shortcut = false) {
  // Streamdown 2.5.0 Ct/ks: parse -> default remark plugins -> remarkRehype
  // (allowDangerousHtml) -> default rehype plugins. Captured defaults include raw,
  // so its alternate Go HTML-to-text transform is not applied.
  return unified()
    .use(remarkParse)
    .use(props.remarkPlugins)
    .use(shortcut ? [remarkPlainParagraph] : [])
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(props.rehypePlugins)
    .freeze();
}

export function renderFullStreamdown(
  text,
  shortcut = false,
  mode = "streaming",
) {
  return renderToStaticMarkup(
    React.createElement(
      Streamdown,
      {
        mode,
        animated: false,
        remend: markdownLinkRepairOptions(text),
        remarkPlugins: [
          ...Object.values(defaultRemarkPlugins),
          ...(shortcut ? [remarkPlainParagraph] : []),
        ],
      },
      text,
    ),
  );
}
