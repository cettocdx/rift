/** Each renderer owns its parser, so conversations never share cached text. */
export function createIncrementalMarkdownParser(
  parse: (text: string) => string[],
) {
  let prefix = "";
  let blocks: string[] = [];
  let previousText = "";
  let previousResult: string[] | undefined;
  return (text: string) => {
    // Definitions, footnotes, HTML and math can affect distant blocks. Preserve
    // the upstream whole-document behavior for those, and normalized newlines.
    if (
      text.includes("<") ||
      text.includes("$") ||
      text.includes("\r") ||
      text.includes("[^") ||
      /\][ \t]*:/.test(text)
    ) {
      prefix = "";
      blocks = [];
      previousResult = undefined;
      return parse(text);
    }
    if (previousResult && text.startsWith(previousText)) {
      const extension = text.slice(previousText.length);
      const last = previousResult.at(-1);
      // A plain inline suffix cannot introduce a new block boundary. Keep
      // parsing markup, newlines, edits and incomplete constructs normally.
      if (
        last &&
        /^[A-Za-z][A-Za-z0-9 .,!?;:]*$/.test(last) &&
        /^[A-Za-z0-9 .,!?]+$/.test(extension)
      ) {
        const result = [...previousResult.slice(0, -1), last + extension];
        previousText = text;
        previousResult = result;
        return result;
      }
    }
    if (!text.startsWith(prefix)) {
      prefix = "";
      blocks = [];
    }
    const tail = text.slice(prefix.length);
    const parsed = parse(tail);
    const result = [...blocks, ...parsed];
    // Raw blocks must reproduce the source exactly before offsets can be used.
    // Keep two non-space blocks mutable: a trailing list/paragraph/table/fence
    // may still absorb blank lines or change shape as the next line arrives.
    if (parsed.join("") === tail) {
      let remaining = 2;
      let cut = parsed.length;
      while (cut > 0 && remaining > 0) {
        cut--;
        if (parsed[cut].trim()) remaining--;
      }
      if (cut > 0) {
        const completed = parsed.slice(0, cut);
        prefix += completed.join("");
        blocks = [...blocks, ...completed];
      }
    }
    previousText = text;
    previousResult = result.join("") === text ? result : undefined;
    return result;
  };
}
