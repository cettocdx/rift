import fs from "node:fs";
import path from "node:path";

/**
 * The hunk route's safety contract.
 *
 * A unified diff names its own targets, so "apply this patch" is a request to
 * write wherever the patch says -- not wherever the button said. These lock the
 * two independent checks that stop a control labelled "accept this hunk in
 * file.ts" from rewriting anything else.
 */
describe("applying one hunk cannot escape the file under review", () => {
  const read = (rel: string) =>
    fs.readFileSync(path.join(process.cwd(), rel), "utf8");

  it("checks the patch server-side before the sandbox is touched", () => {
    const route = read("app/api/workbench/git/route.ts");
    expect(route).toContain("assertHunkPatchTargets(parsed.data.patch, hunkFile)");
    // The check must precede the mutation, not follow it.
    const checkAt = route.indexOf("assertHunkPatchTargets(parsed.data.patch");
    const runAt = route.indexOf('action: "apply_hunk",\n            file: hunkFile');
    expect(checkAt).toBeGreaterThan(-1);
    expect(runAt).toBeGreaterThan(checkAt);
  });

  it("re-derives the same check inside the sandbox", () => {
    // Defence in depth: a bypass of the server check still must not write to
    // another path.
    const ops = read("lib/workbench/git-operations.ts");
    expect(ops).toContain('result(False,action,"path_mismatch")');
    expect(ops).toContain('result(False,action,"not_single_hunk")');
    expect(ops).toContain("declared != {paths[0]}");
  });

  it("refuses a patch that would not apply cleanly, rather than half-writing", () => {
    const ops = read("lib/workbench/git-operations.ts");
    expect(ops).toContain('result(False,action,"patch_does_not_apply")');
    // --check runs before the real apply.
    const checkAt = ops.indexOf('apply_args+["--check"]');
    const applyAt = ops.indexOf("apply_code=run_quiet(apply_args,environment");
    expect(checkAt).toBeGreaterThan(-1);
    expect(applyAt).toBeGreaterThan(checkAt);
  });

  it("passes the patch as base64, so its bytes cannot reshape the command", () => {
    const route = read("app/api/workbench/git/route.ts");
    expect(route).toContain('Buffer.from(args.patch, "utf8").toString("base64")');
    expect(read("lib/workbench/git-operations.ts")).toContain(
      'base64.b64decode(os.environ.get("RIFT_GIT_PATCH_B64",""),validate=True)',
    );
  });

  it("stages without touching the worktree on accept, and reverses on reject", () => {
    const ops = read("lib/workbench/git-operations.ts");
    // --cached is what makes "accept" a staging decision rather than an edit.
    expect(ops).toContain('["apply","--cached","--unidiff-zero"] if hunk_mode == "accept"');
    expect(ops).toContain('["apply","-R","--unidiff-zero"]');
  });

  it("bounds the patch size on both sides of the boundary", () => {
    expect(read("app/api/workbench/git/route.ts")).toContain(
      "max(MAX_HUNK_PATCH_BYTES)",
    );
    expect(read("lib/workbench/git-operations.ts")).toContain(
      "len(patch_bytes) > ",
    );
  });
});
