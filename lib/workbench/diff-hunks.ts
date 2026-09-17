/**
 * Unified-diff parsing, so a change can be accepted or rejected one hunk at a
 * time instead of all-or-nothing per file.
 *
 * The workbench held a diff only as raw text. A user reviewing an agent's edit
 * could stage the whole file or none of it, which turns "most of this is right"
 * into an all-or-nothing decision -- exactly the review the spec asks to be
 * possible at hunk level.
 *
 * Pure and dependency-free: the patch this produces is fed to `git apply`, so
 * getting the format exactly right matters more than convenience. A malformed
 * patch is rejected by git rather than silently applying the wrong thing, which
 * is the failure mode we want.
 */

export type DiffHunk = {
  /** Position within the file's diff, 0-based. Stable for one parse. */
  index: number;
  /** The literal `@@ -a,b +c,d @@ …` line. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Body lines, each still carrying its leading ` `, `+`, `-` or `\`. */
  lines: string[];
  addedCount: number;
  removedCount: number;
};

export type ParsedDiff = {
  /** The `---`/`+++` preamble, verbatim. Required for a valid patch. */
  fileHeader: string[];
  oldPath?: string;
  newPath?: string;
  hunks: DiffHunk[];
  /** True when the diff carried no `@@` hunk (binary files, mode-only changes). */
  isBinaryOrMetadataOnly: boolean;
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Splits a unified diff for ONE file into its hunks.
 *
 * Anything before the first `@@` is kept verbatim as the file header: git needs
 * those lines back exactly as they were to apply a patch, and reconstructing
 * them from a path is how subtly wrong patches get built.
 */
export function parseUnifiedDiff(diffText: string): ParsedDiff {
  const fileHeader: string[] = [];
  const hunks: DiffHunk[] = [];
  let oldPath: string | undefined;
  let newPath: string | undefined;

  if (!diffText.trim()) {
    return { fileHeader, hunks, isBinaryOrMetadataOnly: false };
  }

  const lines = diffText.split("\n");
  let current: DiffHunk | null = null;

  for (const line of lines) {
    const match = HUNK_HEADER.exec(line);

    if (match) {
      if (current) hunks.push(current);
      current = {
        index: hunks.length,
        header: line,
        oldStart: Number(match[1]),
        // An omitted count means 1 in unified-diff format, not 0.
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
        addedCount: 0,
        removedCount: 0,
      };
      continue;
    }

    if (!current) {
      if (line.startsWith("--- ")) oldPath = line.slice(4).trim();
      if (line.startsWith("+++ ")) newPath = line.slice(4).trim();
      fileHeader.push(line);
      continue;
    }

    // A trailing empty string from the final newline is not a diff line.
    if (line === "" ) {
      continue;
    }

    current.lines.push(line);
    if (line.startsWith("+")) current.addedCount += 1;
    else if (line.startsWith("-")) current.removedCount += 1;
  }

  if (current) hunks.push(current);

  return {
    fileHeader,
    oldPath,
    newPath,
    hunks,
    isBinaryOrMetadataOnly: hunks.length === 0 && fileHeader.length > 0,
  };
}

/**
 * Rebuilds a patch containing exactly one hunk.
 *
 * The hunk header is rewritten so the new-side start matches the old side. When
 * a patch carries a single hunk, the line numbers the other hunks would have
 * shifted are not applied, so the original `+c` offset is wrong -- git would
 * either refuse the patch or apply it at the wrong place. Anchoring the new
 * side to the old start is what makes a single-hunk patch land correctly.
 */
export function buildHunkPatch(parsed: ParsedDiff, hunk: DiffHunk): string {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.oldStart},${hunk.newLines} @@`;

  const body = [...hunk.lines];
  // git requires a trailing newline; a patch without one is rejected.
  return [...parsed.fileHeader, header, ...body, ""].join("\n");
}

/** A one-line description of what a hunk does, for the review row. */
export function describeHunk(hunk: DiffHunk): string {
  const parts: string[] = [];
  if (hunk.addedCount > 0) parts.push(`+${hunk.addedCount}`);
  if (hunk.removedCount > 0) parts.push(`−${hunk.removedCount}`);
  const counts = parts.length > 0 ? parts.join(" ") : "no line changes";
  return `Lines ${hunk.newStart}–${hunk.newStart + Math.max(0, hunk.newLines - 1)} · ${counts}`;
}

/**
 * Whether a diff can be reviewed hunk by hunk at all.
 *
 * A binary file or a mode-only change has no hunks. Offering per-hunk controls
 * there would present buttons that cannot do anything.
 */
export function supportsHunkReview(parsed: ParsedDiff): boolean {
  return parsed.hunks.length > 0;
}
