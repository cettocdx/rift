const COMPLETE_LINKS = { links: false, images: false } as const;

/**
 * remend 1.3 rescans every link's preceding code fences on each text delta.
 * A linear conservative check avoids that quadratic work when no link needs
 * repair. Ambiguous input stays on the library path, including escapes and
 * HTML (which an earlier remend handler may trim before link repair).
 */
export function markdownLinkRepairOptions(content: string) {
  if (content.includes("\\") || content.includes("<")) return undefined;
  let brackets = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "[") brackets++;
    else if (content[i] === "]") {
      if (!brackets) return undefined;
      brackets--;
      if (content[i + 1] !== "(") continue;
      let parentheses = 1;
      i += 2;
      for (; i < content.length && parentheses; i++) {
        // Keep nested bracket/URL ambiguities on the existing parser path.
        if (content[i] === "[" || content[i] === "]") return undefined;
        if (content[i] === "(") parentheses++;
        else if (content[i] === ")") parentheses--;
      }
      if (parentheses) return undefined;
      i--;
    }
  }
  return brackets ? undefined : COMPLETE_LINKS;
}
