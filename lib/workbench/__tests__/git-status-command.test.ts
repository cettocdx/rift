import { existsSync } from "node:fs";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  BOUNDED_GIT_STATUS_COMMAND,
  createReadOnlyGitEnvs,
  FIND_GIT_ROOT_COMMAND,
  GIT_REPOSITORY_OUTSIDE_EXIT_CODE,
  GIT_STATUS_FAILED_EXIT_CODE,
  MAX_GIT_STATUS_BYTES,
  MAX_GIT_STATUS_RECORDS,
  parseGitRootCommand,
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

function readRawGitStatus(repo: string, workspaceRoot: string) {
  const repositoryRoot = realpathSync(repo);
  const result = spawnSync(
    "/usr/bin/git",
    [
      "--no-optional-locks",
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
      "--ignore-submodules=all",
      "--renames",
    ],
    {
      cwd: repositoryRoot,
      env: createReadOnlyGitEnvs(repositoryRoot, workspaceRoot),
    },
  );
  if (result.status !== 0 || !Buffer.isBuffer(result.stdout)) {
    throw new Error(
      result.stderr?.toString("utf8") || "Git status command failed",
    );
  }
  return result.stdout;
}

describe("bounded Workbench Git commands", () => {
  let root: string;
  let repo: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rift-workbench-git-"));
    repo = join(root, "project");
    mkdirSync(join(repo, "src"), { recursive: true });
    runGit(repo, ["init", "--quiet"]);
    runGit(repo, ["config", "user.name", "RIFT Test"]);
    runGit(repo, ["config", "user.email", "rift@example.test"]);
    writeFileSync(join(repo, "README.md"), "initial\n");
    writeFileSync(join(repo, "src", "app.ts"), "export const value = 1;\n");
    runGit(repo, ["add", "."]);
    runGit(repo, ["commit", "--quiet", "-m", "initial"]);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function statusEnvs(overrides: Record<string, string> = {}) {
    const workspaceRoot = realpathSync(root);
    const repositoryRoot = realpathSync(repo);
    return {
      ...createReadOnlyGitEnvs(repositoryRoot, workspaceRoot),
      RIFT_ROOT: workspaceRoot,
      RIFT_REPOSITORY_ROOT: repositoryRoot,
      RIFT_GIT_MAX_BYTES: String(MAX_GIT_STATUS_BYTES),
      RIFT_GIT_MAX_RECORDS: String(MAX_GIT_STATUS_RECORDS),
      ...overrides,
    };
  }

  it("discovers the actual repository root from a nested directory", () => {
    const workspaceRoot = realpathSync(root);
    const result = runCommand(FIND_GIT_ROOT_COMMAND, {
      ...createReadOnlyGitEnvs(undefined, workspaceRoot),
      RIFT_ROOT: workspaceRoot,
      RIFT_GIT_CWD: realpathSync(join(repo, "src")),
    });

    expect(result.status).toBe(0);
    expect(parseGitRootCommand(result.stdout).repositoryRoot).toBe(
      realpathSync(repo),
    );
  });

  it.each([
    [false, true],
    [true, true],
    [false, false],
    [true, false],
  ])(
    "bounds read-only discovery timeout recovery (persistent=%s, discovery=%s)",
    (persistent, discovery) => {
      const workspaceRoot = realpathSync(root);
      const probe = `
_original_popen = subprocess.Popen
_probe_failures = 0
class TimeoutProbe(_original_popen):
    def communicate(self, *args, **kwargs):
        global _probe_failures
        if ${persistent ? "True" : "_probe_failures == 0"}:
            _probe_failures += 1
            print("probe-discovery-timeout", file=sys.stderr)
            raise subprocess.TimeoutExpired(self.args, 3)
        return super().communicate(*args, **kwargs)
subprocess.Popen = TimeoutProbe
`;
      const source = discovery
        ? FIND_GIT_ROOT_COMMAND
        : BOUNDED_GIT_STATUS_COMMAND;
      const signature = `def ${discovery ? "run_git" : "run_git_line"}(arguments,environment,failure_code):`;
      const command = source.replace(signature, probe + "\n" + signature);
      const result = runCommand(command, {
        ...(discovery
          ? createReadOnlyGitEnvs(undefined, workspaceRoot)
          : statusEnvs()),
        RIFT_ROOT: workspaceRoot,
        RIFT_GIT_CWD: realpathSync(join(repo, "src")),
      });
      expect(result.status).toBe(persistent ? GIT_STATUS_FAILED_EXIT_CODE : 0);
      expect(result.stderr.match(/probe-discovery-timeout/g)?.length).toBe(
        persistent ? 2 : 1,
      );
      if (persistent) expect(result.stdout).toBe("");
      else if (discovery)
        expect(parseGitRootCommand(result.stdout).repositoryRoot).toBe(
          realpathSync(repo),
        );
      else expect(() => parseGitStatusCommand(result.stdout)).not.toThrow();
    },
  );

  it("returns repository-root-relative status paths and rename sources", () => {
    writeFileSync(join(repo, "README.md"), "changed\n");
    runGit(repo, ["mv", "src/app.ts", "src/main.ts"]);
    writeFileSync(join(repo, "src", "new file.ts"), "new\n");

    const result = runCommand(BOUNDED_GIT_STATUS_COMMAND, statusEnvs());

    expect(result.status).toBe(0);
    const status = parseGitStatusCommand(result.stdout);
    expect(status.fileStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", status: "modified" }),
        expect.objectContaining({
          name: "src/main.ts",
          renamedFrom: "src/app.ts",
          status: "renamed",
        }),
        expect.objectContaining({
          name: "src/new file.ts",
          status: "untracked",
        }),
      ]),
    );
    expect(status.truncated).toBe(false);
  });

  it("returns at most maxRecords - 1 files and marks the result truncated", () => {
    for (let index = 0; index < 6; index++) {
      writeFileSync(join(repo, `untracked-${index}.txt`), `${index}\n`);
    }

    const result = runCommand(
      BOUNDED_GIT_STATUS_COMMAND,
      statusEnvs({ RIFT_GIT_MAX_RECORDS: "3" }),
    );

    expect(result.status).toBe(0);
    const status = parseGitStatusCommand(result.stdout);
    expect(status.fileStatus).toHaveLength(2);
    expect(status.truncated).toBe(true);
  });

  it("stops reading at the byte cap and returns a partial result", () => {
    writeFileSync(join(repo, "untracked.txt"), "new\n");

    const result = runCommand(
      BOUNDED_GIT_STATUS_COMMAND,
      statusEnvs({ RIFT_GIT_MAX_BYTES: "32" }),
    );

    expect(result.status).toBe(0);
    const status = parseGitStatusCommand(result.stdout);
    expect(status.fileStatus).toHaveLength(0);
    expect(status.truncated).toBe(true);
  });

  it("uses a one-byte sentinel so an exact byte cap is not truncated", () => {
    writeFileSync(join(repo, "untracked.txt"), "new\n");
    const workspaceRoot = realpathSync(root);
    const rawStatus = readRawGitStatus(repo, workspaceRoot);

    const exactResult = runCommand(
      BOUNDED_GIT_STATUS_COMMAND,
      statusEnvs({ RIFT_GIT_MAX_BYTES: String(rawStatus.length) }),
    );
    const shortResult = runCommand(
      BOUNDED_GIT_STATUS_COMMAND,
      statusEnvs({ RIFT_GIT_MAX_BYTES: String(rawStatus.length - 1) }),
    );

    expect(exactResult.status).toBe(0);
    expect(parseGitStatusCommand(exactResult.stdout).truncated).toBe(false);
    expect(shortResult.status).toBe(0);
    expect(parseGitStatusCommand(shortResult.stdout).truncated).toBe(true);
  });

  it("ignores inherited PATH, Git execution, and trace variables", () => {
    const fakeBin = join(root, "fake-bin");
    const fakeGitMarker = join(root, "fake-git-ran");
    const traceMarker = join(root, "git-trace");
    mkdirSync(fakeBin);
    const fakeGit = join(fakeBin, "git");
    writeFileSync(fakeGit, `#!/bin/sh\n: > "${fakeGitMarker}"\nexit 99\n`);
    chmodSync(fakeGit, 0o700);

    const result = runCommand(
      BOUNDED_GIT_STATUS_COMMAND,
      statusEnvs({
        PATH: `${fakeBin}:/usr/bin:/bin`,
        GIT_EXEC_PATH: fakeBin,
        GIT_TRACE: traceMarker,
      }),
    );

    expect(result.status).toBe(0);
    expect(existsSync(fakeGitMarker)).toBe(false);
    expect(existsSync(traceMarker)).toBe(false);
  });

  it("rejects repository paths that are not strict POSIX relative paths", () => {
    writeFileSync(join(repo, "bad\\name.txt"), "invalid API path\n");

    const result = runCommand(BOUNDED_GIT_STATUS_COMMAND, statusEnvs());

    expect(result.status).toBe(GIT_STATUS_FAILED_EXIT_CODE);
    expect(result.stdout).toBe("");
  });

  it("rejects a repository whose Git directory is outside the workspace", () => {
    const externalRoot = mkdtempSync(join(tmpdir(), "rift-external-git-"));
    try {
      const externalGitDirectory = join(externalRoot, "gitdir");
      renameSync(join(repo, ".git"), externalGitDirectory);
      writeFileSync(join(repo, ".git"), `gitdir: ${externalGitDirectory}\n`);
      const workspaceRoot = realpathSync(root);

      const result = runCommand(FIND_GIT_ROOT_COMMAND, {
        ...createReadOnlyGitEnvs(undefined, workspaceRoot),
        RIFT_ROOT: workspaceRoot,
        RIFT_GIT_CWD: realpathSync(repo),
      });

      expect(result.status).toBe(GIT_REPOSITORY_OUTSIDE_EXIT_CODE);
    } finally {
      rmSync(externalRoot, { recursive: true, force: true });
    }
  });

  it("overrides a repository-configured fsmonitor executable", () => {
    const sentinel = join(root, "fsmonitor-ran");
    const hook = join(root, "fsmonitor.sh");
    writeFileSync(hook, `#!/bin/sh\n: > "${sentinel}"\nexit 0\n`);
    chmodSync(hook, 0o700);
    runGit(repo, ["config", "core.fsmonitor", hook]);

    runGit(repo, ["status", "--porcelain"]);
    expect(readFileSync(sentinel, "utf8")).toBe("");
    unlinkSync(sentinel);

    const result = runCommand(BOUNDED_GIT_STATUS_COMMAND, statusEnvs());

    expect(result.status).toBe(0);
    expect(existsSync(sentinel)).toBe(false);
  });

  it("neutralizes repository clean and process filters while reading status", () => {
    const sentinel = join(root, "status-filter-ran");
    const filter = join(root, "status-filter.sh");
    writeFileSync(filter, `#!/bin/sh\n: > "${sentinel}"\ncat\n`);
    chmodSync(filter, 0o700);
    writeFileSync(join(repo, ".gitattributes"), "README.md filter=evil\n");
    runGit(repo, ["config", "filter.evil.clean", filter]);
    const oid = runGit(repo, ["rev-parse", ":README.md"]).stdout.trim();
    runGit(repo, ["update-index", "--cacheinfo", `100644,${oid},README.md`]);
    writeFileSync(join(repo, "README.md"), "changed without conversion\n");
    rmSync(sentinel, { force: true });

    const result = runCommand(BOUNDED_GIT_STATUS_COMMAND, statusEnvs());

    expect(result.status).toBe(0);
    expect(parseGitStatusCommand(result.stdout).fileStatus).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "README.md", status: "modified" }),
      ]),
    );
    expect(existsSync(sentinel)).toBe(false);
  });
});
