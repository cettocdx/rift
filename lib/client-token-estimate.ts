/**
 * Lightweight, conservative token estimate for client-side input feedback.
 *
 * Exact accounting still happens on the server with the model tokenizer. A
 * UTF-8 byte estimate is intentionally used here so opening the app does not
 * ship the multi-megabyte tokenizer vocabulary to every browser. Dividing by
 * three slightly overestimates typical Latin text while remaining sensible
 * for Turkish, CJK, emoji, and pasted source code.
 */
export const estimateTextTokens = (content: string): number => {
  if (content.length === 0) return 0;
  return Math.max(
    1,
    Math.ceil(new TextEncoder().encode(content).byteLength / 3),
  );
};

export const countInputTokens = (
  input: string,
  uploadedFiles: Array<{ tokens?: number }> = [],
): number => {
  const fileTokens = uploadedFiles.reduce(
    (total, file) => total + Math.max(0, file.tokens || 0),
    0,
  );
  return estimateTextTokens(input) + fileTokens;
};
