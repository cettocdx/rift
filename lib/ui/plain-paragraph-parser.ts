import type { BlockProps } from "streamdown";

type RemarkPlugin = Extract<
  NonNullable<BlockProps["remarkPlugins"]>[number],
  (...parameters: never[]) => unknown
>;

// `$` also matches before a final newline, which is not part of this subset.
const PLAIN_LINE = /^\p{L}[\p{L}\p{M}\p{N} .,!?:;]*(?![\s\S])/u;
const WWW = /www\./i;

/** A deliberately narrow subset of Markdown with exactly one plain text node.
 * Keep short text on the normal parser: the useful saving is a growing, long
 * paragraph. Re-evaluate every input so appends, edits and finalization that
 * introduce syntax immediately return to the installed Markdown parser.
 */
export function plainParagraphTree(text: string) {
  if (text.length < 1024 || !PLAIN_LINE.test(text) || WWW.test(text))
    return undefined;
  const value = text.trimEnd();
  const position = (length: number) => ({
    start: { line: 1, column: 1, offset: 0 },
    end: { line: 1, column: length + 1, offset: length },
  });
  return {
    type: "root" as const,
    children: [
      {
        type: "paragraph" as const,
        children: [
          { type: "text" as const, value, position: position(value.length) },
        ],
        position: position(text.length),
      },
    ],
    position: position(text.length),
  };
}

/** Install after the default remark plugins. Only tokenization is bypassed;
 * the existing remark/rehype transforms, sanitization, renderers and React
 * component ancestry remain intact (including links, direction and anchors).
 * Scoped to RIFT's Streamdown default pipeline: new syntax/fromMarkdown
 * extensions require differential revalidation before using this shortcut.
 */
export const remarkPlainParagraph: RemarkPlugin = function () {
  const parse = this.parser;
  if (!parse) return;
  this.parser = (text, file) =>
    plainParagraphTree(text) ?? parse.call(this, text, file);
};
