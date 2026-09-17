import "server-only";
import type { AnySandbox } from "@/types";
import type { ProjectGithubRepository } from "@/lib/projects/project-runtime";
import type { LoadedGithubToken } from "./load-user-github-token";
import { ChatSDKError } from "@/lib/errors";
import { isE2BSandbox } from "@/lib/ai/tools/utils/sandbox-types";
import { configureSandboxGit } from "./configure-sandbox-git";
import {
  fetchGithubRepositoryApi,
  githubFullName,
  repositoryDto,
} from "./repositories";

export type PreparedProjectRepository = { path: string; reused: boolean };

const preparationMessages: Record<string, string> = {
  project_scope_missing:
    "The repository needs an isolated project workspace. Open it again from GitHub in the sidebar.",
  reconnect_required:
    "Reconnect GitHub from the sidebar before working on this repository in the cloud.",
  access_unavailable:
    "GitHub access to this repository could not be verified. Check repository permissions or reconnect GitHub from the sidebar.",
  repository_changed:
    "The saved GitHub repository has moved or changed. Open it again from GitHub in the sidebar.",
  checkout_conflict:
    "The repository directory contains another checkout or existing files. Your files were preserved; inspect the workspace before continuing.",
  clone_incomplete:
    "An earlier repository clone did not complete. Its files were preserved; inspect the workspace before retrying.",
  git_missing:
    "Git is unavailable in the cloud workspace. Reconnect the workspace and try again.",
  clone_failed:
    "The selected repository could not be cloned. Check GitHub access and inspect the workspace before retrying.",
  preparation_failed:
    "The selected repository could not be prepared. Inspect the workspace and try again.",
};
function preparationError(code: string) {
  const known = code in preparationMessages ? code : "preparation_failed";
  return new ChatSDKError("bad_request:stream", preparationMessages[known], {
    github_repository_error: known,
  });
}

// Fixed code, public repository metadata only in envs. Python's argument arrays
// avoid shell interpolation; subprocess output is never returned to the model.
// A per-sandbox lock and a retained staging directory prevent destructive replay
// after concurrent runs, interrupted observations, or failed clones.
const prepareCommand = `python3 - <<'RIFT_REPOSITORY_PREPARE'
import fcntl, json, os, pathlib, pwd, shutil, subprocess, time

def fail(code):
    print(json.dumps({"error": code}))
    raise SystemExit(0)

def git(*args):
    return subprocess.run(["git", *args], capture_output=True, text=True, timeout=90)

def main():
    if not shutil.which("git"):
        fail("git_missing")
    root = pathlib.Path(os.environ["RIFT_REPO_WORKSPACE"]).resolve()
    full_name = os.environ["RIFT_REPO_FULL_NAME"]
    expected = full_name.lower()
    destination = root / full_name.split("/")[1]
    stage = root / (".rift-clone-" + os.environ["RIFT_REPO_ID"])
    lock_dir = pathlib.Path.home() / ".rift-repository-locks"
    lock_dir.mkdir(mode=0o700, exist_ok=True)
    provenance_file = lock_dir / (os.environ["RIFT_REPO_ID"] + ".clone.json")
    provenance = {"repositoryId": int(os.environ["RIFT_REPO_ID"]), "fullName": full_name, "stage": str(stage)}
    with (lock_dir / (os.environ["RIFT_REPO_ID"] + ".lock")).open("a") as lock:
        deadline = time.monotonic() + 95
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    fail("preparation_failed")
                time.sleep(0.1)

        def matching_checkout(path):
            if path.is_symlink() or not (path / ".git").exists():
                return False
            # Reject worktrees whose administrative files escape this workspace.
            directory = git("-c", "safe.directory=" + str(path), "-C", str(path), "rev-parse", "--absolute-git-dir")
            if directory.returncode != 0:
                return False
            try:
                pathlib.Path(directory.stdout.strip()).resolve().relative_to(root)
            except ValueError:
                return False
            origin = git("-c", "safe.directory=" + str(path), "-C", str(path), "config", "--local", "--get", "remote.origin.url")
            if origin.returncode != 0:
                return False
            remote = origin.stdout.strip()
            for prefix in ("https://github.com/", "git@github.com:", "ssh://git@github.com/"):
                if remote.startswith(prefix):
                    name = remote[len(prefix):].removesuffix(".git")
                    return name.lower() == expected
            return False

        def ready(path, reused):
            # File tools and browser terminals edit as the unprivileged user;
            # agent git commands run as root to access its private credentials.
            # Authorize only this verified checkout for root's Git ownership check.
            safe = git("config", "--global", "--get-all", "safe.directory")
            if str(path) not in safe.stdout.splitlines():
                configured = git("config", "--global", "--add", "safe.directory", str(path))
                if configured.returncode != 0:
                    fail("preparation_failed")
            print(json.dumps({"path": str(path), "reused": reused}))

        def publish_stage(reused):
            owner = pwd.getpwnam(os.environ["RIFT_REPO_OWNER"])
            # Only our verified new clone changes ownership. Never follow its
            # symlinks or change ownership on an existing destination checkout.
            for directory, subdirectories, files in os.walk(stage, followlinks=False):
                os.chown(directory, owner.pw_uid, owner.pw_gid, follow_symlinks=False)
                for name in subdirectories + files:
                    os.chown(os.path.join(directory, name), owner.pw_uid, owner.pw_gid, follow_symlinks=False)
            if destination.exists() or destination.is_symlink():
                fail("checkout_conflict")
            stage.rename(destination)
            provenance_file.unlink(missing_ok=True)
            ready(destination, reused)

        def completed_stage():
            try:
                if json.loads(provenance_file.read_text()) != provenance:
                    return False
            except Exception:
                return False
            if not matching_checkout(stage) or (stage / ".git" / "index.lock").exists():
                return False
            head = git("-c", "safe.directory=" + str(stage), "-C", str(stage), "rev-parse", "--verify", "HEAD")
            status = git("-c", "safe.directory=" + str(stage), "-C", str(stage), "status", "--porcelain=v1", "--untracked-files=all")
            return head.returncode == 0 and status.returncode == 0 and not status.stdout

        # Preserve checkouts created by the earlier model-driven flow, including
        # a checkout at workspace root. Never reset, pull, or change branches.
        candidates = [root, destination]
        candidates.extend(path for path in root.iterdir() if path.is_dir() and not path.name.startswith("."))
        for candidate in dict.fromkeys(candidates):
            if matching_checkout(candidate):
                ready(candidate, True)
                return
        if destination.exists() or destination.is_symlink() or (root / ".git").exists():
            fail("checkout_conflict")
        if stage.exists() or stage.is_symlink():
            # An interrupted observation may have left a complete clone. Promote
            # it only with our private provenance, exact origin, valid HEAD and
            # clean worktree. Never reclone or alter partial/user-modified work.
            if completed_stage():
                publish_stage(True)
                return
            fail("clone_incomplete")
        stage.mkdir()
        provenance_file.write_text(json.dumps(provenance))
        cloned = git("-c", "http.followRedirects=false", "clone", "--", "https://github.com/" + full_name + ".git", str(stage))
        if cloned.returncode != 0:
            fail("clone_failed")
        if not matching_checkout(stage):
            fail("clone_failed")
        publish_stage(False)

try:
    main()
except Exception:
    fail("preparation_failed")
RIFT_REPOSITORY_PREPARE`;

/** Run only after project ownership and execution admission checks. Local
 * targets keep their own checkout/authentication and never allocate cloud here. */
export async function prepareCloudProjectRepository(args: {
  repository?: ProjectGithubRepository;
  sandboxNamespace?: string;
  executionPreference?: string;
  connection: LoadedGithubToken | null | undefined;
  ensureSandbox: () => Promise<AnySandbox>;
  signal: AbortSignal;
}): Promise<PreparedProjectRepository | undefined> {
  const { repository, signal } = args;
  if (
    !repository ||
    (args.executionPreference && args.executionPreference !== "e2b")
  )
    return undefined;
  signal.throwIfAborted();
  if (!args.sandboxNamespace?.startsWith("rift-project-"))
    throw preparationError("project_scope_missing");
  if (!args.connection?.token) throw preparationError("reconnect_required");
  if (
    !githubFullName.safeParse(repository.fullName).success ||
    !Number.isSafeInteger(repository.id) ||
    repository.id <= 0
  )
    throw preparationError("repository_changed");
  let current: ProjectGithubRepository;
  try {
    const response = await fetchGithubRepositoryApi(
      `/repos/${repository.fullName}`,
      args.connection.token,
    );
    current = repositoryDto(await response.json());
  } catch {
    signal.throwIfAborted();
    throw preparationError("access_unavailable");
  }
  if (
    current.id !== repository.id ||
    current.fullName.toLowerCase() !== repository.fullName.toLowerCase()
  )
    throw preparationError("repository_changed");
  signal.throwIfAborted();
  const sandbox = await args.ensureSandbox();
  signal.throwIfAborted();
  if (!isE2BSandbox(sandbox)) return undefined;
  let result: { stdout: string; exitCode: number };
  try {
    await configureSandboxGit(
      sandbox,
      args.connection.token,
      args.connection.username,
    );
    signal.throwIfAborted();
    result = await sandbox.commands.run(prepareCommand, {
      user: "root",
      cwd: "/home/user",
      timeoutMs: 120_000,
      envs: {
        HOME: "/root",
        GIT_TERMINAL_PROMPT: "0",
        RIFT_REPO_WORKSPACE: "/home/user",
        RIFT_REPO_FULL_NAME: current.fullName,
        RIFT_REPO_ID: String(current.id),
        RIFT_REPO_OWNER: "user",
      },
    });
  } catch {
    signal.throwIfAborted();
    throw preparationError("preparation_failed");
  }
  signal.throwIfAborted();
  let prepared: unknown;
  try {
    prepared = JSON.parse(result.stdout);
  } catch {
    throw preparationError("preparation_failed");
  }
  if (prepared && typeof prepared === "object" && "error" in prepared)
    throw preparationError(String(prepared.error));
  if (
    result.exitCode !== 0 ||
    !prepared ||
    typeof prepared !== "object" ||
    !("path" in prepared) ||
    typeof prepared.path !== "string" ||
    !/^\/home\/user(?:\/[A-Za-z0-9_.-]+)?$/.test(prepared.path) ||
    !("reused" in prepared) ||
    typeof prepared.reused !== "boolean"
  )
    throw preparationError("preparation_failed");
  return { path: prepared.path, reused: prepared.reused };
}
