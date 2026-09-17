import {
  parseUnifiedDiff,
  buildHunkPatch,
  describeHunk,
  supportsHunkReview,
} from "../diff-hunks";

const TWO_HUNK_DIFF = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 import { boot } from "./boot";
+import { log } from "./log";
 
 export function main() {
   boot();
@@ -20,7 +21,6 @@ export function main() {
 }
 
 export function shutdown() {
-  console.log("bye");
   process.exit(0);
 }
`;

describe("parseUnifiedDiff", () => {
  it("splits a file diff into its hunks", () => {
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);

    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.oldPath).toBe("a/src/app.ts");
    expect(parsed.newPath).toBe("b/src/app.ts");
    expect(parsed.fileHeader).toEqual([
      "--- a/src/app.ts",
      "+++ b/src/app.ts",
    ]);
  });

  it("reads the line ranges and counts each hunk touches", () => {
    const [first, second] = parseUnifiedDiff(TWO_HUNK_DIFF).hunks;

    expect(first).toMatchObject({
      index: 0,
      oldStart: 1,
      oldLines: 4,
      newStart: 1,
      newLines: 5,
      addedCount: 1,
      removedCount: 0,
    });
    expect(second).toMatchObject({
      index: 1,
      oldStart: 20,
      newStart: 21,
      addedCount: 0,
      removedCount: 1,
    });
  });

  it("treats an omitted count as one, per the unified-diff format", () => {
    // `@@ -5 +5 @@` means a single line, not zero. Reading it as zero would
    // build a patch that git applies to the wrong range.
    const parsed = parseUnifiedDiff(
      `--- a/x\n+++ b/x\n@@ -5 +5 @@\n-old\n+new\n`,
    );
    expect(parsed.hunks[0]).toMatchObject({ oldLines: 1, newLines: 1 });
  });

  it("keeps a hunk's context lines, not only its changes", () => {
    // Context is what git matches on. Dropping it produces a patch that
    // applies at the wrong offset or not at all.
    const [first] = parseUnifiedDiff(TWO_HUNK_DIFF).hunks;
    expect(first.lines).toContain(' import { boot } from "./boot";');
    expect(first.lines).toContain('+import { log } from "./log";');
  });

  it("reports a binary or mode-only diff as unreviewable by hunk", () => {
    const parsed = parseUnifiedDiff(
      "diff --git a/logo.png b/logo.png\nBinary files differ\n",
    );
    expect(parsed.hunks).toHaveLength(0);
    expect(parsed.isBinaryOrMetadataOnly).toBe(true);
    expect(supportsHunkReview(parsed)).toBe(false);
  });

  it("returns nothing for an empty diff", () => {
    const parsed = parseUnifiedDiff("");
    expect(parsed.hunks).toEqual([]);
    expect(parsed.isBinaryOrMetadataOnly).toBe(false);
  });
});

describe("buildHunkPatch", () => {
  it("emits a patch carrying exactly one hunk", () => {
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);
    const patch = buildHunkPatch(parsed, parsed.hunks[0]);

    expect(patch.match(/^@@/gm)).toHaveLength(1);
    expect(patch).toContain('+import { log } from "./log";');
    expect(patch).not.toContain('-  console.log("bye");');
  });

  it("keeps the original file header verbatim", () => {
    // git needs these back exactly. Rebuilding them from a path is how subtly
    // wrong patches get made.
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);
    const patch = buildHunkPatch(parsed, parsed.hunks[1]);

    expect(patch.startsWith("--- a/src/app.ts\n+++ b/src/app.ts\n")).toBe(true);
  });

  it("anchors the new side to the old start so a lone hunk lands correctly", () => {
    // The second hunk's real header is `+21`, which assumes the first hunk was
    // applied. Applied alone it must target `+20`, or git puts it a line off.
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);
    const patch = buildHunkPatch(parsed, parsed.hunks[1]);

    expect(patch).toContain("@@ -20,7 +20,6 @@");
    expect(patch).not.toContain("+21,6");
  });

  it("ends with a newline, which git requires", () => {
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);
    expect(buildHunkPatch(parsed, parsed.hunks[0]).endsWith("\n")).toBe(true);
  });
});

describe("describeHunk", () => {
  it("summarises what the hunk does", () => {
    const parsed = parseUnifiedDiff(TWO_HUNK_DIFF);
    expect(describeHunk(parsed.hunks[0])).toContain("+1");
    expect(describeHunk(parsed.hunks[1])).toContain("−1");
  });
});
