/**
 * The safety boundary for applying a single hunk.
 *
 * A unified diff carries its own target paths. Accepting a client-supplied
 * patch and handing it to `git apply` would let a caller rewrite any file in
 * the repository from a control labelled "accept this hunk in file.ts" -- the
 * patch, not the UI, decides what gets written. Everything here exists to make
 * the patch's claim about itself checkable before git ever sees it.
 *
 * Pure and dependency-free so it can run on the server before the sandbox is
 * touched, and be tested exhaustively without one.
 */

export class HunkPatchPolicyError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "HunkPatchPolicyError";
    this.code = code;
  }
}

/** Patches are small by construction. A large one is not a hunk. */
export const MAX_HUNK_PATCH_BYTES = 256 * 1024;

/** Strips one leading `a/` or `b/` segment, which git adds to diff headers. */
function stripDiffPrefix(path: string): string {
  if (path === "/dev/null") return path;
  const match = /^[ab]\/(.*)$/.exec(path);
  return match ? match[1] : path;
}

/**
 * A diff header path may carry a trailing tab and timestamp. Everything from
 * the first tab is metadata, not part of the path.
 */
function headerPath(rawValue: string): string {
  const value = rawValue.split("\t")[0].trim();
  return stripDiffPrefix(value);
}

export type HunkPatchInspection = {
  /** Every distinct repository path the patch claims to touch. */
  paths: string[];
  hunkCount: number;
};

/**
 * Reads what a patch says it will do, without trusting it.
 *
 * Collects paths from every header form git emits -- `--- `, `+++ `, and the
 * `diff --git` line -- because a patch that declares one path in one form and
 * a different path in another is exactly the case this must catch.
 */
export function inspectHunkPatch(patch: string): HunkPatchInspection {
  const paths = new Set<string>();
  let hunkCount = 0;

  for (const line of patch.split("\n")) {
    if (line.startsWith("@@")) {
      hunkCount += 1;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ")) {
      const path = headerPath(line.slice(4));
      // /dev/null is a real header for an added or deleted file and names no
      // path, so it is not a target.
      if (path && path !== "/dev/null") paths.add(path);
      continue;
    }
    if (line.startsWith("diff --git ")) {
      for (const token of line.slice("diff --git ".length).split(" ")) {
        const path = stripDiffPrefix(token.trim());
        if (path && path !== "/dev/null") paths.add(path);
      }
    }
  }

  return { paths: [...paths], hunkCount };
}

/**
 * Refuses any patch that is not exactly one hunk confined to `expectedPath`.
 *
 * Throws rather than returning a boolean: a caller that forgets to check a
 * boolean gets a security hole, while one that forgets to catch gets a 500.
 */
export function assertHunkPatchTargets(
  patch: string,
  expectedPath: string,
): void {
  if (!patch.trim()) {
    throw new HunkPatchPolicyError("empty_patch", "The patch is empty.");
  }

  if (new TextEncoder().encode(patch).byteLength > MAX_HUNK_PATCH_BYTES) {
    throw new HunkPatchPolicyError(
      "patch_too_large",
      "This change is too large to apply one hunk at a time.",
    );
  }

  // A path escaping the repository is the same attack as a mismatched path,
  // and is worth naming separately so the log says which one happened.
  if (patch.includes("../") || patch.includes("..\\")) {
    throw new HunkPatchPolicyError(
      "path_traversal",
      "The patch references a path outside the repository.",
    );
  }

  const { paths, hunkCount } = inspectHunkPatch(patch);

  if (hunkCount !== 1) {
    throw new HunkPatchPolicyError(
      "not_single_hunk",
      `A hunk operation must carry exactly one hunk; this patch has ${hunkCount}.`,
    );
  }

  const normalizedExpected = stripDiffPrefix(expectedPath.trim());
  const foreign = paths.filter((path) => path !== normalizedExpected);

  if (paths.length === 0) {
    throw new HunkPatchPolicyError(
      "no_target_path",
      "The patch does not name the file it applies to.",
    );
  }

  if (foreign.length > 0) {
    throw new HunkPatchPolicyError(
      "path_mismatch",
      "The patch targets a different file from the one under review.",
    );
  }
}
