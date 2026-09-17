/** @jest-environment node */
import { execFile, execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { AnySandbox } from "@/types";
import { prepareCloudProjectRepository } from "../prepare-project-repository";
import { fetchGithubRepositoryApi } from "../repositories";
import { configureSandboxGit } from "../configure-sandbox-git";

jest.mock("../repositories", () => ({
  ...jest.requireActual("../repositories"),
  fetchGithubRepositoryApi: jest.fn(),
}));
jest.mock("../configure-sandbox-git", () => ({
  configureSandboxGit: jest.fn(),
}));

const repository = {
  id: 123,
  fullName: "owner/repo",
  defaultBranch: "main",
  private: true,
};
let fixture: string;
let workspace: string;
let gitEnv: NodeJS.ProcessEnv;
let run: jest.Mock;
let sandbox: AnySandbox;
let ensureSandbox: jest.Mock;
const execAsync = promisify(execFile);

function git(...args: string[]) {
  return execFileSync("git", args, {
    env: gitEnv,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}
function prepare(
  overrides: Partial<Parameters<typeof prepareCloudProjectRepository>[0]> = {},
) {
  return prepareCloudProjectRepository({
    repository,
    sandboxNamespace: "rift-project-owner-isolated",
    executionPreference: "e2b",
    connection: { token: "secret-token", username: "owner" },
    ensureSandbox,
    signal: new AbortController().signal,
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  fixture = realpathSync(mkdtempSync(join(tmpdir(), "rift-repo-prepare-")));
  workspace = join(fixture, "workspace");
  const home = join(fixture, "home");
  const remote = join(fixture, "remote");
  mkdirSync(workspace);
  mkdirSync(home);
  mkdirSync(remote);
  gitEnv = {
    ...process.env,
    HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(home, ".gitconfig"),
    GIT_AUTHOR_NAME: "Test",
    GIT_AUTHOR_EMAIL: "test@example.com",
    GIT_COMMITTER_NAME: "Test",
    GIT_COMMITTER_EMAIL: "test@example.com",
  };
  git("init", "-b", "main", remote);
  writeFileSync(join(remote, "README.md"), "selected repository\n");
  git("-C", remote, "add", "README.md");
  git("-C", remote, "commit", "-m", "fixture");
  git(
    "config",
    "--global",
    `url.file://${remote}.insteadOf`,
    "https://github.com/owner/repo.git",
  );
  jest.mocked(fetchGithubRepositoryApi).mockResolvedValue({
    json: async () => ({
      id: 123,
      full_name: "owner/repo",
      default_branch: "main",
      private: true,
    }),
  } as Response);
  run = jest.fn(async (command, options) => {
    const { stdout } = await execAsync("/bin/bash", ["-c", command], {
      cwd: workspace,
      env: {
        ...gitEnv,
        ...options.envs,
        HOME: home,
        RIFT_REPO_WORKSPACE: workspace,
        RIFT_REPO_OWNER: userInfo().username,
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    return {
      stdout: stdout.replaceAll(workspace, "/home/user"),
      stderr: "",
      exitCode: 0,
    };
  });
  sandbox = { commands: { run } } as unknown as AnySandbox;
  ensureSandbox = jest.fn().mockResolvedValue(sandbox);
});
afterEach(() => rmSync(fixture, { recursive: true, force: true }));

it("verifies current access and clones the selected repository before returning its path", async () => {
  expect(await prepare()).toEqual({ path: "/home/user/repo", reused: false });
  expect(readFileSync(join(workspace, "repo/README.md"), "utf8")).toBe(
    "selected repository\n",
  );
  expect(
    git(
      "-C",
      join(workspace, "repo"),
      "config",
      "--get",
      "remote.origin.url",
    ).trim(),
  ).toBe("https://github.com/owner/repo.git");
  expect(fetchGithubRepositoryApi).toHaveBeenCalledWith(
    "/repos/owner/repo",
    "secret-token",
  );
  expect(configureSandboxGit).toHaveBeenCalledWith(
    sandbox,
    "secret-token",
    "owner",
  );
  expect(run.mock.calls[0][0]).not.toContain("secret-token");
  expect(run.mock.calls[0][1]).toMatchObject({
    user: "root",
    cwd: "/home/user",
    envs: { HOME: "/root", GIT_TERMINAL_PROMPT: "0", RIFT_REPO_OWNER: "user" },
  });
  expect(git("config", "--global", "--get-all", "safe.directory").trim()).toBe(
    join(workspace, "repo"),
  );
});

it("reuses a matching checkout and preserves modified and untracked files", async () => {
  await prepare();
  writeFileSync(join(workspace, "repo/README.md"), "user changes\n");
  writeFileSync(join(workspace, "repo/draft.txt"), "draft");
  expect(await prepare()).toEqual({ path: "/home/user/repo", reused: true });
  expect(readFileSync(join(workspace, "repo/README.md"), "utf8")).toBe(
    "user changes\n",
  );
  expect(readFileSync(join(workspace, "repo/draft.txt"), "utf8")).toBe("draft");
});

it("rejects a mismatched existing origin without changing the checkout", async () => {
  await prepare();
  git(
    "-C",
    join(workspace, "repo"),
    "remote",
    "set-url",
    "origin",
    "https://github.com/other/repo.git",
  );
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "checkout_conflict" },
  });
  expect(
    git(
      "-C",
      join(workspace, "repo"),
      "config",
      "--get",
      "remote.origin.url",
    ).trim(),
  ).toBe("https://github.com/other/repo.git");
});

it("never follows an existing destination symlink to reuse or modify its target", async () => {
  await prepare();
  const external = join(fixture, "outside-workspace");
  renameSync(join(workspace, "repo"), external);
  symlinkSync(external, join(workspace, "repo"));
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "checkout_conflict" },
  });
  expect(readFileSync(join(external, "README.md"), "utf8")).toBe(
    "selected repository\n",
  );
});

it("requires a project namespace before using a shared cloud sandbox", async () => {
  await expect(prepare({ sandboxNamespace: undefined })).rejects.toMatchObject({
    metadata: { github_repository_error: "project_scope_missing" },
  });
  expect(ensureSandbox).not.toHaveBeenCalled();
});

it.each(["desktop", "local-connection-123"])(
  "leaves %s execution to its existing local git environment",
  async (executionPreference) => {
    expect(await prepare({ executionPreference })).toBeUndefined();
    expect(ensureSandbox).not.toHaveBeenCalled();
    expect(fetchGithubRepositoryApi).not.toHaveBeenCalled();
  },
);

it("rejects lost GitHub access before starting a cloud sandbox", async () => {
  jest
    .mocked(fetchGithubRepositoryApi)
    .mockRejectedValue(new Error("upstream token secret-token"));
  await expect(prepare()).rejects.toMatchObject({
    cause: expect.not.stringContaining("secret-token"),
    metadata: { github_repository_error: "access_unavailable" },
  });
  expect(ensureSandbox).not.toHaveBeenCalled();
});

it("rejects an unrelated repository now occupying the saved path", async () => {
  jest.mocked(fetchGithubRepositoryApi).mockResolvedValue({
    json: async () => ({
      id: 999,
      full_name: "owner/repo",
      default_branch: "main",
      private: true,
    }),
  } as Response);
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "repository_changed" },
  });
  expect(ensureSandbox).not.toHaveBeenCalled();
});

it("requires a connection for private repository preparation", async () => {
  await expect(prepare({ connection: null })).rejects.toMatchObject({
    metadata: { github_repository_error: "reconnect_required" },
  });
  expect(ensureSandbox).not.toHaveBeenCalled();
});

it("reports missing git before attempting a clone", async () => {
  const tools = join(fixture, "tools");
  mkdirSync(tools);
  const python = execFileSync("/usr/bin/which", ["python3"], {
    encoding: "utf8",
  }).trim();
  symlinkSync(python, join(tools, "python3"));
  gitEnv.PATH = tools;
  await expect(prepare()).rejects.toMatchObject({
    cause:
      "Git is unavailable in the cloud workspace. Reconnect the workspace and try again.",
    metadata: { github_repository_error: "git_missing" },
  });
});

it("serializes concurrent preparation into one clone and one reused checkout", async () => {
  const results = await Promise.all([prepare(), prepare()]);
  expect(results.map((result) => result?.reused).sort()).toEqual([false, true]);
  expect(readFileSync(join(workspace, "repo/README.md"), "utf8")).toBe(
    "selected repository\n",
  );
});

it("finds and reuses an existing matching checkout in another workspace directory", async () => {
  await prepare();
  renameSync(join(workspace, "repo"), join(workspace, "existing-checkout"));
  expect(await prepare()).toEqual({
    path: "/home/user/existing-checkout",
    reused: true,
  });
});

it("retains a failed clone and refuses to replay it on a retry", async () => {
  // The fixed GitHub URL is rewritten to this local fixture. Moving it makes
  // git fail locally, without making any GitHub/network request.
  renameSync(join(fixture, "remote"), join(fixture, "remote-moved"));
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "clone_failed" },
  });
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "clone_incomplete" },
  });
});

it("does not automatically replay a partial clone", async () => {
  mkdirSync(join(workspace, ".rift-clone-123"));
  writeFileSync(join(workspace, ".rift-clone-123/partial.txt"), "keep");
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "clone_incomplete" },
  });
  expect(
    readFileSync(join(workspace, ".rift-clone-123/partial.txt"), "utf8"),
  ).toBe("keep");
});

it("promotes a completed RIFT staging checkout after an interruption without recloning", async () => {
  await prepare();
  const stage = join(workspace, ".rift-clone-123");
  renameSync(join(workspace, "repo"), stage);
  writeFileSync(
    join(fixture, "home/.rift-repository-locks/123.clone.json"),
    JSON.stringify({ repositoryId: 123, fullName: repository.fullName, stage }),
  );
  // A recovery must not need to clone again or fetch any file from the remote.
  renameSync(join(fixture, "remote"), join(fixture, "remote-moved"));
  expect(await prepare()).toEqual({ path: "/home/user/repo", reused: true });
  expect(readFileSync(join(workspace, "repo/README.md"), "utf8")).toBe(
    "selected repository\n",
  );
});

it("preserves a dirty staging checkout even when its RIFT provenance is valid", async () => {
  await prepare();
  const stage = join(workspace, ".rift-clone-123");
  renameSync(join(workspace, "repo"), stage);
  writeFileSync(
    join(fixture, "home/.rift-repository-locks/123.clone.json"),
    JSON.stringify({ repositoryId: 123, fullName: repository.fullName, stage }),
  );
  writeFileSync(join(stage, "README.md"), "preserve interrupted work");
  await expect(prepare()).rejects.toMatchObject({
    metadata: { github_repository_error: "clone_incomplete" },
  });
  expect(readFileSync(join(stage, "README.md"), "utf8")).toBe(
    "preserve interrupted work",
  );
});
