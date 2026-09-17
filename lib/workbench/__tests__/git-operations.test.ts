import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  BOUNDED_GIT_DIFF_COMMAND,
  encodeGitCommitMessage,
  FILTER_FREE_GIT_STATUS_COMMAND,
  GIT_COMMIT_PREFLIGHT_COMMAND,
  GIT_INIT_COMMAND,
  GIT_INIT_FAILED_EXIT_CODE,
  GIT_MUTATION_COMMAND,
  MAX_GIT_DIFF_BYTES,
  normalizeRepositoryGitPath,
  parseGitDiffCommand,
  parseGitCommitPreflightCommand,
  parseGitMutationCommand,
} from "@/lib/workbench/git-operations";
import {
  GIT_REPOSITORY_OUTSIDE_EXIT_CODE,
  GIT_STATUS_FAILED_EXIT_CODE,
  parseGitStatusCommand,
} from "@/lib/workbench/git-status-command";

function runCommand(command: string, envs: Record<string, string>) {
  return spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, ...envs },
  });
}

function runGit(repo: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "Git command failed");
  }
  return result;
}

describe("bounded Workbench Git operations", () => {
  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rift-workbench-git-ops-"));
    repo = join(root, "project");
    mkdirSync(repo, { recursive: true });
    runGit(repo, ["init", "--quiet"]);
    runGit(repo, ["config", "user.name", "RIFT Test"]);
    runGit(repo, ["config", "user.email", "rift@example.test"]);
    writeFileSync(join(repo, "README.md"), "initial\n");
    runGit(repo, ["add", "README.md"]);
    runGit(repo, ["commit", "--quiet", "-m", "initial"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function baseEnvs(overrides: Record<string, string> = {}) {
    return {
      RIFT_ROOT: realpathSync(root),
      RIFT_REPOSITORY_ROOT: realpathSync(repo),
      RIFT_GIT_FILE: "",
      RIFT_GIT_RENAMED_FROM: "",
      RIFT_GIT_INCLUDE_RENAME_SOURCE: "0",
      RIFT_GIT_MAX_DIFF_BYTES: String(MAX_GIT_DIFF_BYTES),
      RIFT_GIT_ACTION: "stage",
      RIFT_GIT_COMMIT_MESSAGE_B64: "",
      RIFT_GIT_EXPECTED_TREE: "",
      RIFT_GIT_EXPECTED_PARENT: "",
      RIFT_GIT_EXPECTED_HEAD_REF: "",
      ...overrides,
    };
  }

  it.each([
    ["status", FILTER_FREE_GIT_STATUS_COMMAND],
    ["diff", BOUNDED_GIT_DIFF_COMMAND],
    ["mutation", GIT_MUTATION_COMMAND],
  ])(
    "reports a %s validation timeout without claiming the repository is outside the workspace",
    (_name, command) => {
      // Expire the real child-process reader immediately. The production timeout
      // path must reap that process and fail before any mutation is attempted.
      const expired = command.replace(
        "deadline=time.monotonic()+timeout",
        "deadline=time.monotonic()-1",
      );
      expect(expired).not.toBe(command);
      const indexBefore = readFileSync(join(repo, ".git/index"));
      const result = runCommand(expired, baseEnvs());
      expect(result.status).toBe(GIT_STATUS_FAILED_EXIT_CODE);
      expect(result.stdout).toBe("");
      expect(readFileSync(join(repo, ".git/index"))).toEqual(indexBefore);
    },
  );

  it("initializes a fresh directory with a valid mutation response and preserves its files", () => {
    const target = join(realpathSync(root), "fresh $(literal)");
    mkdirSync(target);
    writeFileSync(join(target, "keep.txt"), "keep me\n");
    const result = runCommand(
      GIT_INIT_COMMAND,
      baseEnvs({
        RIFT_REPOSITORY_ROOT: "",
        RIFT_GIT_INIT_TARGET: target,
      }),
    );
    expect(result.status).toBe(0);
    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: true,
      action: "init",
    });
    expect(existsSync(join(target, ".git"))).toBe(true);
    expect(readFileSync(join(target, "keep.txt"), "utf8")).toBe("keep me\n");
  });

  it("refuses to reinitialize an existing repository without modifying its configuration", () => {
    const before = readFileSync(join(repo, ".git/config"), "utf8");
    const result = runCommand(
      GIT_INIT_COMMAND,
      baseEnvs({
        RIFT_REPOSITORY_ROOT: "",
        RIFT_GIT_INIT_TARGET: realpathSync(repo),
      }),
    );
    expect(result.status).toBe(0);
    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "init",
      code: "already_a_repository",
    });
    expect(readFileSync(join(repo, ".git/config"), "utf8")).toBe(before);
  });

  it("refuses init through a symlink or outside the authorized root", () => {
    const outside = mkdtempSync(join(tmpdir(), "rift-git-init-outside-"));
    try {
      const linked = join(realpathSync(root), "linked");
      symlinkSync(realpathSync(outside), linked);
      for (const target of [linked, realpathSync(outside)]) {
        const result = runCommand(
          GIT_INIT_COMMAND,
          baseEnvs({
            RIFT_REPOSITORY_ROOT: "",
            RIFT_GIT_INIT_TARGET: target,
          }),
        );
        expect(result.status).toBe(GIT_INIT_FAILED_EXIT_CODE);
        expect(existsSync(join(outside, ".git"))).toBe(false);
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  function readFilterFreeStatus() {
    const result = runCommand(FILTER_FREE_GIT_STATUS_COMMAND, baseEnvs());
    expect(result.status).toBe(0);
    return parseGitStatusCommand(result.stdout);
  }

  it("reads clean, staged, unstaged, untracked, and intent-to-add state without git status", () => {
    writeFileSync(join(repo, "README.md"), "staged\n");
    runGit(repo, ["add", "README.md"]);
    writeFileSync(join(repo, "README.md"), "working\n");
    writeFileSync(join(repo, "untracked.txt"), "untracked\n");
    writeFileSync(join(repo, "intent.txt"), "intent\n");
    runGit(repo, ["add", "-N", "intent.txt"]);
    writeFileSync(join(repo, "empty-staged.txt"), "");
    runGit(repo, ["add", "empty-staged.txt"]);

    const status = readFilterFreeStatus();

    expect(status.fileStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "README.md",
          indexStatus: "M",
          workingTreeStatus: "M",
          staged: true,
        }),
        expect.objectContaining({
          name: "untracked.txt",
          status: "untracked",
          indexStatus: " ",
          workingTreeStatus: "?",
          staged: false,
        }),
        expect.objectContaining({
          name: "intent.txt",
          status: "added",
          indexStatus: " ",
          workingTreeStatus: "A",
          staged: false,
        }),
        expect.objectContaining({
          name: "empty-staged.txt",
          status: "added",
          indexStatus: "A",
          workingTreeStatus: " ",
          staged: true,
        }),
      ]),
    );
    expect(status.truncated).toBe(false);
  });

  it("reads an unborn repository with no upstream", () => {
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo);
    runGit(repo, ["init", "--quiet"]);
    runGit(repo, ["config", "user.name", "RIFT Test"]);
    runGit(repo, ["config", "user.email", "rift@example.test"]);

    const status = readFilterFreeStatus();

    expect(status.fileStatus).toEqual([]);
    expect(status.detached).toBe(false);
    expect(status.currentBranch).toBeDefined();
    expect(status.upstream).toBeUndefined();
    expect(status.truncated).toBe(false);
  });

  it("reports unmerged entries as conflicts", () => {
    const originalBranch = runGit(repo, [
      "branch",
      "--show-current",
    ]).stdout.trim();
    runGit(repo, ["checkout", "-q", "-b", "conflicting"]);
    writeFileSync(join(repo, "README.md"), "branch\n");
    runGit(repo, ["commit", "-qam", "branch"]);
    runGit(repo, ["checkout", "-q", originalBranch]);
    writeFileSync(join(repo, "README.md"), "main\n");
    runGit(repo, ["commit", "-qam", "main"]);
    const merge = spawnSync("git", ["merge", "--no-edit", "conflicting"], {
      cwd: repo,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
    expect(merge.status).not.toBe(0);

    expect(readFilterFreeStatus().fileStatus).toContainEqual(
      expect.objectContaining({
        name: "README.md",
        status: "conflict",
        indexStatus: "U",
        workingTreeStatus: "U",
      }),
    );
  });

  it("never executes repository clean filters while reading status", () => {
    const marker = join(root, "status-filter-ran");
    const filter = join(root, "status-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(
      join(repo, ".gitattributes"),
      "README.md filter=status-test\n",
    );
    runGit(repo, ["config", "filter.status-test.clean", filter]);
    runGit(repo, ["add", ".gitattributes", "README.md"]);
    runGit(repo, ["commit", "--quiet", "-m", "configure filter"]);
    rmSync(marker, { force: true });

    const status = readFilterFreeStatus();

    expect(status.fileStatus).toEqual([]);
    expect(status.truncated).toBe(false);
    expect(existsSync(marker)).toBe(false);
  });

  it("ignores sparse-checkout absences and submodule worktrees", () => {
    mkdirSync(join(repo, "docs"));
    writeFileSync(join(repo, "docs", "guide.md"), "guide\n");
    runGit(repo, ["add", "docs/guide.md"]);
    runGit(repo, ["commit", "--quiet", "-m", "add sparse path"]);

    const nestedRepo = join(root, "nested-repository");
    mkdirSync(nestedRepo);
    runGit(nestedRepo, ["init", "--quiet"]);
    runGit(nestedRepo, ["config", "user.name", "RIFT Test"]);
    runGit(nestedRepo, ["config", "user.email", "rift@example.test"]);
    writeFileSync(join(nestedRepo, "nested.txt"), "nested\n");
    runGit(nestedRepo, ["add", "nested.txt"]);
    runGit(nestedRepo, ["commit", "--quiet", "-m", "nested"]);
    runGit(repo, [
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      "--quiet",
      nestedRepo,
      "vendor/nested",
    ]);
    runGit(repo, ["commit", "--quiet", "-am", "add submodule"]);
    runGit(repo, ["sparse-checkout", "init", "--cone"]);
    runGit(repo, ["sparse-checkout", "set", "src", "vendor"]);

    const status = readFilterFreeStatus();

    expect(status.fileStatus).toEqual([]);
    expect(status.truncated).toBe(false);
  });

  it("bounds worktree hashing and marks an oversized scan incomplete", () => {
    const oversized = join(repo, "oversized.bin");
    writeFileSync(oversized, "");
    runGit(repo, ["add", "oversized.bin"]);
    runGit(repo, ["commit", "--quiet", "-m", "add oversized placeholder"]);
    truncateSync(oversized, 257 * 1024 * 1024);

    const status = readFilterFreeStatus();

    expect(status.truncated).toBe(true);
    expect(status.fileStatus).toContainEqual(
      expect.objectContaining({
        name: "oversized.bin",
        status: "modified",
      }),
    );
  });

  it("marks status truncated only when a change exists beyond the 500-file cap", () => {
    for (let index = 0; index < 500; index += 1) {
      writeFileSync(join(repo, `untracked-${index}.txt`), `${index}\n`);
    }

    const exact = readFilterFreeStatus();
    expect(exact.fileStatus).toHaveLength(500);
    expect(exact.truncated).toBe(false);

    writeFileSync(join(repo, "untracked-overflow.txt"), "overflow\n");
    const overflow = readFilterFreeStatus();
    expect(overflow.fileStatus).toHaveLength(500);
    expect(overflow.truncated).toBe(true);
  });

  it("rejects an object directory symlink before staging can write outside the workspace", () => {
    const externalRoot = mkdtempSync(join(tmpdir(), "rift-external-objects-"));
    try {
      const objectDirectory = join(repo, ".git", "objects");
      const externalObjects = join(externalRoot, "objects");
      renameSync(objectDirectory, externalObjects);
      symlinkSync(externalObjects, objectDirectory);
      writeFileSync(join(repo, "outside-write.txt"), "must stay inside\n");

      const result = runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "stage",
          RIFT_GIT_FILE: "outside-write.txt",
        }),
      );

      expect(result.status).toBe(GIT_REPOSITORY_OUTSIDE_EXIT_CODE);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("rejects object alternates that point outside the workspace", () => {
    const externalRoot = mkdtempSync(
      join(tmpdir(), "rift-external-alternate-"),
    );
    try {
      const externalObjects = join(externalRoot, "objects");
      mkdirSync(externalObjects);
      writeFileSync(
        join(repo, ".git", "objects", "info", "alternates"),
        `${externalObjects}\n`,
      );
      writeFileSync(join(repo, "alternate-write.txt"), "must stay inside\n");

      const result = runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "stage",
          RIFT_GIT_FILE: "alternate-write.txt",
        }),
      );

      expect(result.status).toBe(GIT_REPOSITORY_OUTSIDE_EXIT_CODE);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("rejects a loose-object fanout symlink before Git can follow it", () => {
    const externalRoot = mkdtempSync(join(tmpdir(), "rift-external-fanout-"));
    try {
      const objectDirectory = join(repo, ".git", "objects");
      let content = "";
      let oid = "";
      for (let attempt = 0; attempt < 1_000; attempt += 1) {
        content = `outside fanout ${attempt}\n`;
        const body = Buffer.from(content);
        oid = createHash("sha1")
          .update(Buffer.from(`blob ${body.byteLength}\0`))
          .update(body)
          .digest("hex");
        if (!existsSync(join(objectDirectory, oid.slice(0, 2)))) break;
      }
      const externalFanout = join(externalRoot, "fanout");
      mkdirSync(externalFanout);
      symlinkSync(externalFanout, join(objectDirectory, oid.slice(0, 2)));
      writeFileSync(join(repo, "fanout-write.txt"), content);

      const result = runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "stage",
          RIFT_GIT_FILE: "fanout-write.txt",
        }),
      );

      expect(result.status).toBe(GIT_REPOSITORY_OUTSIDE_EXIT_CODE);
      expect(readdirSync(externalFanout)).toEqual([]);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("rejects a refs directory symlink before Git can update an outside ref", () => {
    const externalRoot = mkdtempSync(join(tmpdir(), "rift-external-refs-"));
    try {
      const refsDirectory = join(repo, ".git", "refs");
      const externalRefs = join(externalRoot, "refs");
      renameSync(refsDirectory, externalRefs);
      symlinkSync(externalRefs, refsDirectory);
      writeFileSync(join(repo, "outside-ref.txt"), "must not update refs\n");

      const result = runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "stage",
          RIFT_GIT_FILE: "outside-ref.txt",
        }),
      );

      expect(result.status).toBe(GIT_REPOSITORY_OUTSIDE_EXIT_CODE);
      expect(result.stdout).toBe("");
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("returns separate bounded staged and unstaged unified patches", () => {
    writeFileSync(join(repo, "README.md"), "staged change\n");
    runGit(repo, ["add", "README.md"]);
    writeFileSync(join(repo, "README.md"), "working change\n");

    const result = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({ RIFT_GIT_FILE: "README.md" }),
    );

    expect(result.status).toBe(0);
    const diff = parseGitDiffCommand(result.stdout);
    expect(diff.staged.content).toContain("+staged change");
    expect(diff.unstaged.content).toContain("+working change");
    expect(diff.staged.truncated).toBe(false);
    expect(diff.unstaged.truncated).toBe(false);
  });

  it("renders an untracked file as an addition", () => {
    writeFileSync(join(repo, "new file.txt"), "untracked content\n");

    const result = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({ RIFT_GIT_FILE: "new file.txt" }),
    );

    expect(result.status).toBe(0);
    const diff = parseGitDiffCommand(result.stdout);
    expect(diff.staged.content).toBe("");
    expect(diff.unstaged.content).toContain("+untracked content");
  });

  it("truncates oversized patches at the configured byte boundary", () => {
    writeFileSync(
      join(repo, "large.txt"),
      `${"x".repeat(MAX_GIT_DIFF_BYTES + 4_096)}\n`,
    );

    const result = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({ RIFT_GIT_FILE: "large.txt" }),
    );

    expect(result.status).toBe(0);
    const diff = parseGitDiffCommand(result.stdout);
    expect(diff.unstaged.truncated).toBe(true);
    expect(Buffer.byteLength(diff.unstaged.content, "utf8")).toBe(
      MAX_GIT_DIFF_BYTES,
    );
  });

  it("reads a working-tree patch without invoking clean filters", () => {
    const marker = join(root, "diff-filter-ran");
    const filter = join(root, "diff-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(join(repo, ".gitattributes"), "README.md filter=evil\n");
    runGit(repo, ["config", "filter.evil.clean", filter]);
    writeFileSync(join(repo, "README.md"), "raw working content\n");

    const result = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({ RIFT_GIT_FILE: "README.md" }),
    );

    expect(result.status).toBe(0);
    expect(parseGitDiffCommand(result.stdout).unstaged.content).toContain(
      "+raw working content",
    );
    expect(existsSync(marker)).toBe(false);
  });

  it("renders deletions when the file's parent directory was removed", () => {
    mkdirSync(join(repo, "nested"));
    writeFileSync(join(repo, "nested", "removed.txt"), "remove me\n");
    runGit(repo, ["add", "nested/removed.txt"]);
    runGit(repo, ["commit", "--quiet", "-m", "add nested file"]);
    rmSync(join(repo, "nested"), { recursive: true });

    const result = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({ RIFT_GIT_FILE: "nested/removed.txt" }),
    );

    expect(result.status).toBe(0);
    expect(parseGitDiffCommand(result.stdout).unstaged.content).toContain(
      "-remove me",
    );
  });

  it("includes both sides of an exact rename without recursive pathspecs", () => {
    renameSync(join(repo, "README.md"), join(repo, "renamed README.md"));

    const diffResult = runCommand(
      BOUNDED_GIT_DIFF_COMMAND,
      baseEnvs({
        RIFT_GIT_FILE: "renamed README.md",
        RIFT_GIT_RENAMED_FROM: "README.md",
        RIFT_GIT_INCLUDE_RENAME_SOURCE: "1",
      }),
    );
    expect(diffResult.status).toBe(0);
    const workingPatch = parseGitDiffCommand(diffResult.stdout).unstaged
      .content;
    expect(workingPatch).toContain("deleted file mode 100644");
    expect(workingPatch).toContain("new file mode 100644");

    const stageResult = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "renamed README.md",
        RIFT_GIT_RENAMED_FROM: "README.md",
        RIFT_GIT_INCLUDE_RENAME_SOURCE: "1",
      }),
    );
    expect(parseGitMutationCommand(stageResult.stdout)).toEqual({
      ok: true,
      action: "stage",
    });
    expect(runGit(repo, ["diff", "--cached", "--name-status"]).stdout).toMatch(
      /^R\d+\s+README\.md\s+renamed README\.md/m,
    );
  });

  it("passes shell-like file names as literal argv while staging and unstaging", () => {
    const file = "odd $(touch WORKBENCH_PATH_INJECTION).txt";
    writeFileSync(join(repo, file), "literal path\n");

    const staged = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({ RIFT_GIT_ACTION: "stage", RIFT_GIT_FILE: file }),
    );
    expect(staged.status).toBe(0);
    expect(parseGitMutationCommand(staged.stdout)).toEqual({
      ok: true,
      action: "stage",
    });
    expect(existsSync(join(repo, "WORKBENCH_PATH_INJECTION"))).toBe(false);
    expect(runGit(repo, ["diff", "--cached", "--name-only"]).stdout).toContain(
      file,
    );

    const unstaged = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({ RIFT_GIT_ACTION: "unstage", RIFT_GIT_FILE: file }),
    );
    expect(unstaged.status).toBe(0);
    expect(parseGitMutationCommand(unstaged.stdout)).toEqual({
      ok: true,
      action: "unstage",
    });
    expect(
      runGit(repo, ["diff", "--cached", "--name-only"]).stdout,
    ).not.toContain(file);
  });

  it("rejects executable clean filters without invoking them", () => {
    const marker = join(root, "clean-filter-ran");
    const filter = join(root, "filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(join(repo, ".gitattributes"), "filtered.txt filter=evil\n");
    writeFileSync(join(repo, "filtered.txt"), "filtered\n");
    runGit(repo, ["config", "filter.evil.clean", filter]);

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "filtered.txt",
      }),
    );

    expect(result.status).toBe(0);
    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "unsafe_filter",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects built-in content conversion instead of staging different bytes", () => {
    writeFileSync(join(repo, "converted.txt"), "line one\r\nline two\r\n");
    runGit(repo, ["config", "core.autocrlf", "input"]);

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "converted.txt",
      }),
    );

    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "content_conversion",
    });
    expect(runGit(repo, ["diff", "--cached", "--name-only"]).stdout).toBe("");
  });

  it("rejects explicit encoding attributes, including sentinel-like values", () => {
    writeFileSync(
      join(repo, ".gitattributes"),
      "encoded.txt working-tree-encoding=unspecified\n",
    );
    writeFileSync(join(repo, "encoded.txt"), "encoded\n");

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "encoded.txt",
      }),
    );

    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "content_conversion",
    });
  });

  it("rejects directory pathspecs instead of recursively staging descendants", () => {
    mkdirSync(join(repo, "directory"));
    writeFileSync(join(repo, "directory", "child.txt"), "child\n");

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({ RIFT_GIT_ACTION: "stage", RIFT_GIT_FILE: "directory" }),
    );

    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "unsupported_path",
    });
    expect(runGit(repo, ["diff", "--cached", "--name-only"]).stdout).toBe("");
  });

  it("does not treat a configured filter.unset driver as filter-free", () => {
    const marker = join(root, "unset-filter-ran");
    const filter = join(root, "unset-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(join(repo, ".gitattributes"), "filtered.txt filter=unset\n");
    writeFileSync(join(repo, "filtered.txt"), "filtered\n");
    runGit(repo, ["config", "filter.unset.clean", filter]);

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "filtered.txt",
      }),
    );

    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "unsafe_filter",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("does not treat a configured filter.unspecified driver as absent", () => {
    const marker = join(root, "unspecified-filter-ran");
    const filter = join(root, "unspecified-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(
      join(repo, ".gitattributes"),
      "filtered.txt filter=unspecified\n",
    );
    writeFileSync(join(repo, "filtered.txt"), "filtered\n");
    runGit(repo, ["config", "filter.unspecified.clean", filter]);

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "stage",
        RIFT_GIT_FILE: "filtered.txt",
      }),
    );

    expect(parseGitMutationCommand(result.stdout)).toEqual({
      ok: false,
      action: "stage",
      code: "unsafe_filter",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("commits the exact message without hooks, signing programs, or shell evaluation", () => {
    const hookMarker = join(root, "hook-ran");
    const signerMarker = join(root, "signer-ran");
    const filterMarker = join(root, "commit-filter-ran");
    const hook = join(repo, ".git", "hooks", "pre-commit");
    const signer = join(root, "signer.sh");
    const filter = join(root, "commit-filter.sh");
    writeFileSync(hook, `#!/bin/sh\n: > "${hookMarker}"\nexit 1\n`);
    chmodSync(hook, 0o700);
    writeFileSync(signer, `#!/bin/sh\n: > "${signerMarker}"\nexit 1\n`);
    chmodSync(signer, 0o700);
    writeFileSync(filter, `#!/bin/sh\n: > "${filterMarker}"\ncat\n`);
    chmodSync(filter, 0o700);
    runGit(repo, ["config", "commit.gpgSign", "true"]);
    runGit(repo, ["config", "gpg.program", signer]);
    runGit(repo, ["config", "filter.commit-test.clean", filter]);
    writeFileSync(
      join(repo, ".gitattributes"),
      "README.md filter=commit-test\n",
    );
    writeFileSync(join(repo, "README.md"), "committed\n");
    runGit(repo, ["add", "README.md"]);
    rmSync(filterMarker, { force: true });
    expect(existsSync(filterMarker)).toBe(false);
    const message = "release $(touch WORKBENCH_COMMIT_INJECTION)";
    const preflight = runCommand(GIT_COMMIT_PREFLIGHT_COMMAND, baseEnvs());
    expect(preflight.status).toBe(0);
    expect(existsSync(filterMarker)).toBe(false);
    const { treeOid, parentOid, headRef } = parseGitCommitPreflightCommand(
      preflight.stdout,
    );

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "commit",
        RIFT_GIT_COMMIT_MESSAGE_B64: encodeGitCommitMessage(message),
        RIFT_GIT_EXPECTED_TREE: treeOid,
        RIFT_GIT_EXPECTED_PARENT: parentOid ?? "",
        RIFT_GIT_EXPECTED_HEAD_REF: headRef ?? "",
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(filterMarker)).toBe(false);
    const parsed = parseGitMutationCommand(result.stdout);
    expect(parsed).toMatchObject({ ok: true, action: "commit" });
    expect(runGit(repo, ["log", "-1", "--format=%B"]).stdout.trim()).toBe(
      message,
    );
    expect(existsSync(hookMarker)).toBe(false);
    expect(existsSync(signerMarker)).toBe(false);
    expect(existsSync(filterMarker)).toBe(false);
    expect(existsSync(join(repo, "WORKBENCH_COMMIT_INJECTION"))).toBe(false);
  });

  it("isolates the mutation write-tree from racily-clean filter execution", () => {
    const marker = join(root, "mutation-filter-ran");
    const filter = join(root, "mutation-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${marker}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(join(repo, ".gitattributes"), "README.md filter=mutation\n");
    runGit(repo, ["config", "filter.mutation.clean", filter]);
    writeFileSync(join(repo, "README.md"), "mutation commit\n");
    runGit(repo, ["add", ".gitattributes", "README.md"]);
    const treeOid = runGit(repo, ["write-tree"]).stdout.trim();
    const parentOid = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();
    const headRef = runGit(repo, ["symbolic-ref", "HEAD"]).stdout.trim();
    rmSync(marker, { force: true });
    const indexTime = statSync(join(repo, ".git", "index")).mtime;
    utimesSync(join(repo, "README.md"), indexTime, indexTime);

    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({
        RIFT_GIT_ACTION: "commit",
        RIFT_GIT_COMMIT_MESSAGE_B64: encodeGitCommitMessage("direct commit"),
        RIFT_GIT_EXPECTED_TREE: treeOid,
        RIFT_GIT_EXPECTED_PARENT: parentOid,
        RIFT_GIT_EXPECTED_HEAD_REF: headRef,
      }),
    );

    expect(result.status).toBe(0);
    expect(parseGitMutationCommand(result.stdout)).toMatchObject({
      ok: true,
      action: "commit",
    });
    expect(existsSync(marker)).toBe(false);
  });

  it("rejects a same-tip branch switch after commit preflight", () => {
    writeFileSync(join(repo, "README.md"), "staged on original branch\n");
    runGit(repo, ["add", "README.md"]);
    const preflight = parseGitCommitPreflightCommand(
      runCommand(GIT_COMMIT_PREFLIGHT_COMMAND, baseEnvs()).stdout,
    );
    runGit(repo, ["checkout", "-q", "-b", "same-tip-other"]);

    const result = parseGitMutationCommand(
      runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "commit",
          RIFT_GIT_COMMIT_MESSAGE_B64: encodeGitCommitMessage("wrong branch"),
          RIFT_GIT_EXPECTED_TREE: preflight.treeOid,
          RIFT_GIT_EXPECTED_PARENT: preflight.parentOid ?? "",
          RIFT_GIT_EXPECTED_HEAD_REF: preflight.headRef ?? "",
        }),
      ).stdout,
    );

    expect(result).toEqual({
      ok: false,
      action: "commit",
      code: "index_changed",
    });
    expect(runGit(repo, ["log", "-1", "--format=%s"]).stdout.trim()).toBe(
      "initial",
    );
  });

  it("commits detached HEAD without dereferencing a branch", () => {
    const branch = runGit(repo, ["branch", "--show-current"]).stdout.trim();
    const branchTip = runGit(repo, ["rev-parse", branch]).stdout.trim();
    runGit(repo, ["checkout", "--detach", "--quiet", "HEAD"]);
    writeFileSync(join(repo, "README.md"), "detached commit\n");
    runGit(repo, ["add", "README.md"]);
    const preflight = parseGitCommitPreflightCommand(
      runCommand(GIT_COMMIT_PREFLIGHT_COMMAND, baseEnvs()).stdout,
    );
    expect(preflight.headRef).toBeNull();

    const result = parseGitMutationCommand(
      runCommand(
        GIT_MUTATION_COMMAND,
        baseEnvs({
          RIFT_GIT_ACTION: "commit",
          RIFT_GIT_COMMIT_MESSAGE_B64: encodeGitCommitMessage("detached"),
          RIFT_GIT_EXPECTED_TREE: preflight.treeOid,
          RIFT_GIT_EXPECTED_PARENT: preflight.parentOid ?? "",
        }),
      ).stdout,
    );

    expect(result).toMatchObject({ ok: true, action: "commit" });
    expect(runGit(repo, ["rev-parse", branch]).stdout.trim()).toBe(branchTip);
    expect(runGit(repo, ["rev-parse", "HEAD"]).stdout.trim()).not.toBe(
      branchTip,
    );
  });

  it("rejects traversal and protected paths before reaching Git", () => {
    expect(() => normalizeRepositoryGitPath("project", "../secret")).toThrow(
      "workspace root",
    );
    expect(() => normalizeRepositoryGitPath("project", ".env")).toThrow(
      "protected",
    );
    expect(normalizeRepositoryGitPath("project", "src/file.ts")).toBe(
      "src/file.ts",
    );
  });

  it("keeps commit messages bounded by UTF-8 bytes", () => {
    expect(() => encodeGitCommitMessage("   ")).toThrow("1-4096");
    expect(() => encodeGitCommitMessage("🙂".repeat(1_025))).toThrow("1-4096");
    expect(() => encodeGitCommitMessage("unsafe\u001bmessage")).toThrow(
      "control characters",
    );
    expect(
      Buffer.from(encodeGitCommitMessage(" valid message "), "base64").toString(
        "utf8",
      ),
    ).toBe("valid message");
  });

  it("does not expose repository file contents through helper output", () => {
    writeFileSync(join(repo, "README.md"), "private line\n");
    const result = runCommand(
      GIT_MUTATION_COMMAND,
      baseEnvs({ RIFT_GIT_ACTION: "stage", RIFT_GIT_FILE: "README.md" }),
    );
    expect(result.stdout).not.toContain(
      readFileSync(join(repo, "README.md"), "utf8"),
    );
  });
});
