import {
  assertHunkPatchTargets,
  inspectHunkPatch,
  HunkPatchPolicyError,
  MAX_HUNK_PATCH_BYTES,
} from "../hunk-patch-policy";
import { parseUnifiedDiff, buildHunkPatch } from "../diff-hunks";

const GOOD = `--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 one
+two
 three
`;

const expectThrows = (fn: () => void, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(HunkPatchPolicyError);
    expect((error as HunkPatchPolicyError).code).toBe(code);
    return;
  }
  throw new Error(`expected a ${code} rejection, but nothing was thrown`);
};

describe("what a patch claims about itself", () => {
  it("collects the paths from every header form git emits", () => {
    const inspected = inspectHunkPatch(
      "diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -1 +1 @@\n-a\n+b\n",
    );
    expect(inspected.paths).toEqual(["x.ts"]);
    expect(inspected.hunkCount).toBe(1);
  });

  it("ignores /dev/null, which names no file", () => {
    const inspected = inspectHunkPatch(
      "--- /dev/null\n+++ b/new.ts\n@@ -0,0 +1 @@\n+hello\n",
    );
    expect(inspected.paths).toEqual(["new.ts"]);
  });

  it("drops the trailing timestamp some diffs carry", () => {
    const inspected = inspectHunkPatch(
      "--- a/x.ts\t2026-01-01 00:00:00\n+++ b/x.ts\t2026-01-02 00:00:00\n@@ -1 +1 @@\n-a\n+b\n",
    );
    expect(inspected.paths).toEqual(["x.ts"]);
  });
});

describe("the boundary a hunk operation may not cross", () => {
  it("accepts a single-hunk patch confined to the reviewed file", () => {
    expect(() => assertHunkPatchTargets(GOOD, "src/app.ts")).not.toThrow();
    // The a/ b/ prefix on the expected path is accepted too.
    expect(() => assertHunkPatchTargets(GOOD, "a/src/app.ts")).not.toThrow();
  });

  it("refuses a patch that targets a different file", () => {
    // The whole point: the patch, not the button, decides what git writes.
    expectThrows(
      () => assertHunkPatchTargets(GOOD, "src/other.ts"),
      "path_mismatch",
    );
  });

  it("refuses a patch that smuggles a second file in", () => {
    const smuggled = `${GOOD}--- a/.env\n+++ b/.env\n@@ -1 +1 @@\n-SECRET=x\n+SECRET=stolen\n`;
    expectThrows(
      () => assertHunkPatchTargets(smuggled, "src/app.ts"),
      "not_single_hunk",
    );
  });

  it("refuses a patch whose headers disagree with each other", () => {
    const mismatched =
      "--- a/src/app.ts\n+++ b/src/elsewhere.ts\n@@ -1 +1 @@\n-a\n+b\n";
    expectThrows(
      () => assertHunkPatchTargets(mismatched, "src/app.ts"),
      "path_mismatch",
    );
  });

  it("refuses a path that escapes the repository", () => {
    const escaping =
      "--- a/../../etc/passwd\n+++ b/../../etc/passwd\n@@ -1 +1 @@\n-a\n+b\n";
    expectThrows(
      () => assertHunkPatchTargets(escaping, "src/app.ts"),
      "path_traversal",
    );
  });

  it("refuses a patch carrying more than one hunk", () => {
    const two = `${GOOD}@@ -20,3 +21,3 @@\n-x\n+y\n`;
    expectThrows(
      () => assertHunkPatchTargets(two, "src/app.ts"),
      "not_single_hunk",
    );
  });

  it("refuses a patch with no hunk at all", () => {
    expectThrows(
      () => assertHunkPatchTargets("--- a/x\n+++ b/x\n", "x"),
      "not_single_hunk",
    );
  });

  it("refuses an empty patch", () => {
    expectThrows(() => assertHunkPatchTargets("   ", "x"), "empty_patch");
  });

  it("refuses a patch far larger than a hunk", () => {
    const huge = `--- a/x\n+++ b/x\n@@ -1 +1 @@\n+${"x".repeat(MAX_HUNK_PATCH_BYTES)}\n`;
    expectThrows(() => assertHunkPatchTargets(huge, "x"), "patch_too_large");
  });

  it("accepts what the builder actually produces", () => {
    // The policy and the builder must agree, or every real hunk is refused.
    const parsed = parseUnifiedDiff(GOOD);
    const patch = buildHunkPatch(parsed, parsed.hunks[0]);
    expect(() => assertHunkPatchTargets(patch, "src/app.ts")).not.toThrow();
  });
});
