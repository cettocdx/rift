import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff, buildHunkPatch } from "../diff-hunks";

/**
 * The unit tests check the shape of the patch. These check the only thing that
 * actually matters: that `git apply` accepts it and stages exactly the hunk it
 * was given. A patch that looks right but lands one line off would pass a
 * string comparison and corrupt a file in practice.
 */

const ORIGINAL = [
  "line one",
  "line two",
  "line three",
  "line four",
  "line five",
  "line six",
  "line seven",
  "line eight",
  "line nine",
  "line ten",
  "line eleven",
  "line twelve",
  "",
].join("\n");

// Two edits far enough apart that git emits them as separate hunks.
const MODIFIED = ORIGINAL.replace("line two", "line two CHANGED").replace(
  "line eleven",
  "line eleven CHANGED",
);

let repo: string;

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: repo, encoding: "utf8" });

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rift-hunks-"));
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(repo, "file.txt"), ORIGINAL);
  git("add", "file.txt");
  git("commit", "-q", "-m", "base");
  writeFileSync(join(repo, "file.txt"), MODIFIED);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("a single-hunk patch against real git", () => {
  it("produces two hunks for two distant edits", () => {
    const parsed = parseUnifiedDiff(git("diff", "--", "file.txt"));
    expect(parsed.hunks).toHaveLength(2);
  });

  it("stages only the first hunk when only the first is applied", () => {
    const parsed = parseUnifiedDiff(git("diff", "--", "file.txt"));
    const patch = buildHunkPatch(parsed, parsed.hunks[0]);
    writeFileSync(join(repo, "hunk.patch"), patch);

    // --cached stages without touching the working tree, which is what
    // "accept this hunk" means in the review.
    git("apply", "--cached", "hunk.patch");

    const staged = git("diff", "--cached", "--", "file.txt");
    expect(staged).toContain("+line two CHANGED");
    expect(staged).not.toContain("+line eleven CHANGED");
  });

  it("stages only the second hunk when only the second is applied", () => {
    // This is the case a naive builder gets wrong: the second hunk's own
    // header assumes the first was already applied.
    const parsed = parseUnifiedDiff(git("diff", "--", "file.txt"));
    const patch = buildHunkPatch(parsed, parsed.hunks[1]);
    writeFileSync(join(repo, "hunk.patch"), patch);

    git("apply", "--cached", "hunk.patch");

    const staged = git("diff", "--cached", "--", "file.txt");
    expect(staged).toContain("+line eleven CHANGED");
    expect(staged).not.toContain("+line two CHANGED");
  });

  it("reverts exactly one hunk from the working tree", () => {
    // "Reject this hunk" reverses it in place and leaves the rest alone.
    const parsed = parseUnifiedDiff(git("diff", "--", "file.txt"));
    const patch = buildHunkPatch(parsed, parsed.hunks[0]);
    writeFileSync(join(repo, "hunk.patch"), patch);

    git("apply", "-R", "hunk.patch");

    const content = readFileSync(join(repo, "file.txt"), "utf8");
    expect(content).toContain("line two\n");
    expect(content).not.toContain("line two CHANGED");
    // The other edit survives: rejecting one hunk is not rejecting the file.
    expect(content).toContain("line eleven CHANGED");
  });

  it("applies cleanly with --check, so a bad patch is refused up front", () => {
    const parsed = parseUnifiedDiff(git("diff", "--", "file.txt"));
    for (const hunk of parsed.hunks) {
      writeFileSync(join(repo, "hunk.patch"), buildHunkPatch(parsed, hunk));
      expect(() => git("apply", "--check", "--cached", "hunk.patch")).not.toThrow();
    }
  });
});
