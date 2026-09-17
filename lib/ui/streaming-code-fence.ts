/** Compatibility helper for callers interested only in unfinished fences. */
export function streamingCodeFence(
  content: string,
): { language: string; code: string } | null {
  const fence = standaloneCodeFence(content);
  return fence && !fence.closed
    ? { language: fence.language, code: fence.code }
    : null;
}

/** A single unindented fence, including its completed form. Mixed Markdown and
 * indented fences keep the normal parser's whitespace and block semantics. */
export function standaloneCodeFence(content: string): {
  language: string;
  code: string;
  closed: boolean;
} | null {
  const opening = /^(`{3,}|~{3,})([^\n]*)\n/.exec(content);
  if (
    !opening ||
    content.includes("\r") ||
    (opening[1][0] === "`" && opening[2].includes("`"))
  )
    return null;
  const body = content.slice(opening[0].length);
  const marker = opening[1][0];
  const closing = new RegExp(
    `^ {0,3}${marker}{${opening[1].length},}[ \\t]*(?:\\n|$)`,
    "m",
  ).exec(body);
  if (closing && body.slice(closing.index + closing[0].length).trim())
    return null;
  return {
    language: opening[2].trim().split(/\s+/)[0] || "",
    code: closing ? body.slice(0, closing.index) : body,
    closed: closing !== null,
  };
}
