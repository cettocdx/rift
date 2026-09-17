import { CommandExitError, type Sandbox } from "@e2b/code-interpreter";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  assertHunkPatchTargets,
  HunkPatchPolicyError,
  MAX_HUNK_PATCH_BYTES,
} from "@/lib/workbench/hunk-patch-policy";
import {
  assertSameOriginMutation,
  assertWorkspaceDirectoryAccess,
  authorizePremiumWorkbench,
  readWorkbenchRequestTextWithLimit,
  withPremiumWorkspaceSandbox,
  workbenchErrorResponse,
  WorkbenchRequestError,
} from "@/lib/workbench/workspace-server";
import {
  MAX_WORKSPACE_PATH_LENGTH,
  WORKBENCH_ROOT,
  absoluteWorkspacePath,
  isWorkspaceEntryVisible,
  normalizeWorkspacePath,
  relativeWorkspacePath,
} from "@/lib/workbench/path-policy";
import {
  createReadOnlyGitEnvs,
  FIND_GIT_ROOT_COMMAND,
  GIT_NOT_REPOSITORY_EXIT_CODE,
  GIT_REPOSITORY_OUTSIDE_EXIT_CODE,
  GIT_STATUS_FAILED_EXIT_CODE,
  MAX_GIT_STATUS_BYTES,
  MAX_GIT_STATUS_RECORDS,
  parseGitRootCommand,
  parseGitStatusCommand,
  WorkbenchGitPayloadError,
} from "@/lib/workbench/git-status-command";
import {
  BOUNDED_GIT_DIFF_COMMAND,
  encodeGitCommitMessage,
  FILTER_FREE_GIT_STATUS_COMMAND,
  GIT_COMMIT_PREFLIGHT_COMMAND,
  GIT_COMMIT_PREFLIGHT_FAILED_EXIT_CODE,
  GIT_DIFF_FAILED_EXIT_CODE,
  GIT_INIT_COMMAND,
  GIT_INIT_FAILED_EXIT_CODE,
  GIT_MUTATION_COMMAND,
  GIT_MUTATION_FAILED_EXIT_CODE,
  MAX_GIT_COMMIT_MESSAGE_BYTES,
  MAX_GIT_DIFF_BYTES,
  normalizeRepositoryGitPath,
  parseGitDiffCommand,
  parseGitCommitPreflightCommand,
  parseGitMutationCommand,
  WorkbenchGitOperationPayloadError,
} from "@/lib/workbench/git-operations";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_GIT_MUTATION_REQUEST_BYTES = 32 * 1024;

const gitFileMutationSchema = z
  .object({
    action: z.enum(["stage", "unstage"]),
    path: z.string().max(MAX_WORKSPACE_PATH_LENGTH),
    file: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH),
    renamedFrom: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH).optional(),
  })
  .strict();

const gitCommitMutationSchema = z
  .object({
    action: z.literal("commit"),
    path: z.string().max(MAX_WORKSPACE_PATH_LENGTH),
    message: z.string().min(1).max(MAX_GIT_COMMIT_MESSAGE_BYTES),
  })
  .strict();

const gitHunkMutationSchema = z
  .object({
    action: z.literal("apply_hunk"),
    path: z.string().max(MAX_WORKSPACE_PATH_LENGTH),
    file: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH),
    /** "accept" stages just this hunk; "reject" reverses it in the worktree. */
    mode: z.enum(["accept", "reject"]),
    patch: z.string().min(1).max(MAX_HUNK_PATCH_BYTES),
  })
  .strict();

const gitInitMutationSchema = z
  .object({
    action: z.literal("init"),
    path: z.string().max(MAX_WORKSPACE_PATH_LENGTH),
  })
  .strict();

const gitMutationSchema = z.discriminatedUnion("action", [
  gitFileMutationSchema,
  gitCommitMutationSchema,
  gitHunkMutationSchema,
  gitInitMutationSchema,
]);

type RepositoryContext = {
  repositoryPath: string;
  repositoryRoot: string;
};

type SelectedGitStatus = ReturnType<
  typeof parseGitStatusCommand
>["fileStatus"][number];

function invalidGitResponse(error: unknown): never {
  if (
    error instanceof WorkbenchGitPayloadError ||
    error instanceof WorkbenchGitOperationPayloadError
  ) {
    throw new WorkbenchRequestError(
      error.message,
      502,
      "invalid_sandbox_response",
    );
  }
  throw error;
}

function repositoryOutsideError() {
  return new WorkbenchRequestError(
    "The repository is outside the Workbench root.",
    400,
    "repository_outside_workspace",
  );
}

async function discoverRepository(
  sandbox: Sandbox,
  cwd: string,
): Promise<RepositoryContext | null> {
  await assertWorkspaceDirectoryAccess(sandbox, cwd);
  const absoluteCwd = absoluteWorkspacePath(cwd);

  let rootStdout: string;
  try {
    ({ stdout: rootStdout } = await sandbox.commands.run(
      FIND_GIT_ROOT_COMMAND,
      {
        cwd: WORKBENCH_ROOT,
        user: "user",
        timeoutMs: 5_000,
        envs: {
          ...createReadOnlyGitEnvs(undefined, WORKBENCH_ROOT),
          RIFT_GIT_CWD: absoluteCwd,
          RIFT_ROOT: WORKBENCH_ROOT,
        },
      },
    ));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_NOT_REPOSITORY_EXIT_CODE
    ) {
      return null;
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_REPOSITORY_OUTSIDE_EXIT_CODE
    ) {
      throw repositoryOutsideError();
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_STATUS_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "The repository root could not be verified.",
        502,
        "git_root_failed",
      );
    }
    throw error;
  }

  let discoveredRoot: string;
  try {
    discoveredRoot = parseGitRootCommand(rootStdout).repositoryRoot;
  } catch (error) {
    invalidGitResponse(error);
  }

  let repositoryPath: string;
  try {
    repositoryPath = relativeWorkspacePath(discoveredRoot);
  } catch {
    throw repositoryOutsideError();
  }
  await assertWorkspaceDirectoryAccess(sandbox, repositoryPath);
  return {
    repositoryPath,
    repositoryRoot: absoluteWorkspacePath(repositoryPath),
  };
}

async function readRawRepositoryStatus(
  sandbox: Sandbox,
  context: RepositoryContext,
) {
  let statusStdout: string;
  try {
    ({ stdout: statusStdout } = await sandbox.commands.run(
      FILTER_FREE_GIT_STATUS_COMMAND,
      {
        cwd: WORKBENCH_ROOT,
        user: "user",
        timeoutMs: 10_000,
        envs: {
          ...createReadOnlyGitEnvs(context.repositoryRoot, WORKBENCH_ROOT),
          RIFT_ROOT: WORKBENCH_ROOT,
          RIFT_REPOSITORY_ROOT: context.repositoryRoot,
          RIFT_GIT_MAX_BYTES: String(MAX_GIT_STATUS_BYTES),
          RIFT_GIT_MAX_RECORDS: String(MAX_GIT_STATUS_RECORDS),
        },
      },
    ));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_REPOSITORY_OUTSIDE_EXIT_CODE
    ) {
      throw repositoryOutsideError();
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_STATUS_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "The repository status could not be read.",
        502,
        "git_status_failed",
      );
    }
    throw error;
  }

  try {
    return parseGitStatusCommand(statusStdout);
  } catch (error) {
    invalidGitResponse(error);
  }
}

async function readRepositoryStatus(
  sandbox: Sandbox,
  context: RepositoryContext,
) {
  const status = await readRawRepositoryStatus(sandbox, context);

  const visibleFileStatus = status.fileStatus.flatMap((file) => {
    if (!isWorkspaceEntryVisible(context.repositoryPath, file.name)) return [];
    const { renamedFrom, ...visibleFile } = file;
    if (renamedFrom) {
      if (!isWorkspaceEntryVisible(context.repositoryPath, renamedFrom)) {
        return [];
      }
      return [{ ...visibleFile, renamedFrom }];
    }
    return [visibleFile];
  });
  const stagedCount = visibleFileStatus.filter((file) => file.staged).length;
  const untrackedCount = visibleFileStatus.filter(
    (file) => file.status === "untracked",
  ).length;
  const conflictCount = visibleFileStatus.filter(
    (file) => file.status === "conflict",
  ).length;
  const unstagedCount = visibleFileStatus.filter(
    (file) => file.workingTreeStatus !== " ",
  ).length;

  return {
    repositoryPath: context.repositoryPath,
    status: {
      currentBranch: status.currentBranch,
      upstream: status.upstream,
      ahead: status.ahead,
      behind: status.behind,
      detached: status.detached,
      fileStatus: visibleFileStatus,
      isClean: visibleFileStatus.length === 0 && !status.truncated,
      hasChanges: visibleFileStatus.length > 0 || status.truncated,
      hasStaged: stagedCount > 0,
      hasUntracked: untrackedCount > 0,
      hasConflicts: conflictCount > 0,
      totalCount: visibleFileStatus.length,
      stagedCount,
      unstagedCount,
      untrackedCount,
      conflictCount,
    },
    truncated: status.truncated,
  };
}

async function assertCommitStaysWithinVisibleWorkspace(
  sandbox: Sandbox,
  context: RepositoryContext,
) {
  let preflightStdout: string;
  try {
    ({ stdout: preflightStdout } = await sandbox.commands.run(
      GIT_COMMIT_PREFLIGHT_COMMAND,
      {
        cwd: WORKBENCH_ROOT,
        user: "user",
        timeoutMs: 10_000,
        envs: {
          RIFT_ROOT: WORKBENCH_ROOT,
          RIFT_REPOSITORY_ROOT: context.repositoryRoot,
        },
      },
    ));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_REPOSITORY_OUTSIDE_EXIT_CODE
    ) {
      throw repositoryOutsideError();
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_COMMIT_PREFLIGHT_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "The staged index cannot be committed yet. Resolve conflicts and retry.",
        409,
        "git_index_unavailable",
      );
    }
    throw error;
  }

  let preflight: ReturnType<typeof parseGitCommitPreflightCommand>;
  try {
    preflight = parseGitCommitPreflightCommand(preflightStdout);
  } catch (error) {
    invalidGitResponse(error);
  }
  const hasProtectedStagedPath = preflight.changedPaths.some(
    (path) => !isWorkspaceEntryVisible(context.repositoryPath, path),
  );

  if (preflight.truncated || hasProtectedStagedPath) {
    throw new WorkbenchRequestError(
      "Workbench cannot commit while protected or undisclosed paths are staged. Review the index in the terminal first.",
      409,
      "protected_staged_changes",
    );
  }
  if (preflight.changedPaths.length === 0) {
    throw mutationFailure("nothing_staged");
  }
  return {
    treeOid: preflight.treeOid,
    parentOid: preflight.parentOid,
    headRef: preflight.headRef,
  };
}

async function resolveSelectedGitStatus(
  sandbox: Sandbox,
  context: RepositoryContext,
  file: string,
  renamedFrom?: string,
): Promise<SelectedGitStatus> {
  const status = await readRawRepositoryStatus(sandbox, context);
  const selected = status.fileStatus.find((entry) => entry.name === file);
  const renameMatches = selected?.renamedFrom === renamedFrom;
  const selectionIsVisible = Boolean(
    selected &&
    isWorkspaceEntryVisible(context.repositoryPath, selected.name) &&
    (selected.renamedFrom === undefined ||
      isWorkspaceEntryVisible(context.repositoryPath, selected.renamedFrom)),
  );

  if (!selected || !renameMatches || !selectionIsVisible) {
    throw new WorkbenchRequestError(
      "The selected Git change is stale. Refresh Changes and try again.",
      409,
      "git_selection_stale",
    );
  }
  return selected;
}

async function readRepositoryDiff(
  sandbox: Sandbox,
  context: RepositoryContext,
  selected: SelectedGitStatus,
) {
  const includeRenameSource =
    selected.status === "renamed" && selected.renamedFrom !== undefined;
  let stdout: string;
  try {
    ({ stdout } = await sandbox.commands.run(BOUNDED_GIT_DIFF_COMMAND, {
      cwd: WORKBENCH_ROOT,
      user: "user",
      timeoutMs: 20_000,
      envs: {
        RIFT_ROOT: WORKBENCH_ROOT,
        RIFT_REPOSITORY_ROOT: context.repositoryRoot,
        RIFT_GIT_FILE: selected.name,
        RIFT_GIT_RENAMED_FROM: selected.renamedFrom ?? "",
        RIFT_GIT_INCLUDE_RENAME_SOURCE: includeRenameSource ? "1" : "0",
        RIFT_GIT_MAX_DIFF_BYTES: String(MAX_GIT_DIFF_BYTES),
      },
    }));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_REPOSITORY_OUTSIDE_EXIT_CODE
    ) {
      throw repositoryOutsideError();
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_DIFF_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "The selected Git diff could not be read.",
        502,
        "git_diff_failed",
      );
    }
    throw error;
  }

  try {
    const diff = parseGitDiffCommand(stdout);
    if (diff.path !== selected.name) {
      throw new WorkbenchGitOperationPayloadError();
    }
    return { repositoryPath: context.repositoryPath, diff };
  } catch (error) {
    invalidGitResponse(error);
  }
}

function mutationFailure(code: string): WorkbenchRequestError {
  switch (code) {
    case "nothing_staged":
      return new WorkbenchRequestError(
        "Stage at least one change before committing.",
        409,
        code,
      );
    case "identity_required":
      return new WorkbenchRequestError(
        "Configure Git user.name and user.email in this repository before committing.",
        409,
        code,
      );
    case "repository_busy":
      return new WorkbenchRequestError(
        "Git is busy in this repository. Wait for the current operation and retry.",
        409,
        code,
      );
    case "unsafe_filter":
      return new WorkbenchRequestError(
        "This file uses an executable Git clean filter and cannot be staged from Workbench.",
        409,
        code,
      );
    case "content_conversion":
      return new WorkbenchRequestError(
        "This file requires Git content conversion and cannot be staged safely in Workbench.",
        409,
        code,
      );
    case "index_changed":
      return new WorkbenchRequestError(
        "The staged index changed during the operation. Refresh Changes and retry.",
        409,
        code,
      );
    case "operation_in_progress":
      return new WorkbenchRequestError(
        "Finish the current merge, cherry-pick, or revert in the terminal before committing.",
        409,
        code,
      );
    case "unsupported_path":
      return new WorkbenchRequestError(
        "Only regular files, symbolic links, and deletions can be staged here.",
        409,
        code,
      );
    case "file_too_large":
      return new WorkbenchRequestError(
        "This file is too large to stage safely in Workbench. Use the terminal instead.",
        413,
        code,
      );
    default:
      return new WorkbenchRequestError(
        "Git could not complete this local repository operation.",
        409,
        "git_command_failed",
      );
  }
}

/**
 * Creates a repository at a workspace directory that does not have one.
 *
 * Kept separate from runRepositoryMutation because every other mutation begins
 * by discovering an existing repository, which is exactly what this cannot do.
 */
async function runRepositoryInit(sandbox: Sandbox, cwd: string) {
  await assertWorkspaceDirectoryAccess(sandbox, cwd);
  const target = absoluteWorkspacePath(cwd);

  let stdout: string;
  try {
    ({ stdout } = await sandbox.commands.run(GIT_INIT_COMMAND, {
      cwd: WORKBENCH_ROOT,
      user: "user",
      timeoutMs: 20_000,
      envs: {
        RIFT_ROOT: WORKBENCH_ROOT,
        RIFT_REPOSITORY_ROOT: "",
        RIFT_GIT_INIT_TARGET: target,
      },
    }));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_INIT_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "This location cannot be initialized as a Git repository.",
        400,
        "git_init_failed",
      );
    }
    throw error;
  }

  let result: ReturnType<typeof parseGitMutationCommand>;
  try {
    result = parseGitMutationCommand(stdout);
  } catch (error) {
    invalidGitResponse(error);
  }

  if (!result.ok) {
    if (result.code === "already_a_repository") {
      throw new WorkbenchRequestError(
        "This location is already a Git repository.",
        409,
        "already_a_repository",
      );
    }
    throw new WorkbenchRequestError(
      "Git could not initialize a repository here.",
      502,
      "git_command_failed",
    );
  }

  return result;
}

async function runRepositoryMutation(
  sandbox: Sandbox,
  context: RepositoryContext,
  args: {
    action: "stage" | "unstage" | "commit" | "apply_hunk";
    file?: string;
    hunkMode?: "accept" | "reject";
    patch?: string;
    renamedFrom?: string;
    includeRenameSource?: boolean;
    encodedMessage?: string;
    expectedTree?: string;
    expectedParent?: string;
    expectedHeadRef?: string;
  },
) {
  let stdout: string;
  try {
    ({ stdout } = await sandbox.commands.run(GIT_MUTATION_COMMAND, {
      cwd: WORKBENCH_ROOT,
      user: "user",
      timeoutMs: 20_000,
      envs: {
        RIFT_ROOT: WORKBENCH_ROOT,
        RIFT_REPOSITORY_ROOT: context.repositoryRoot,
        RIFT_GIT_ACTION: args.action,
        RIFT_GIT_FILE: args.file ?? "",
        RIFT_GIT_RENAMED_FROM: args.renamedFrom ?? "",
        RIFT_GIT_INCLUDE_RENAME_SOURCE: args.includeRenameSource ? "1" : "0",
        RIFT_GIT_COMMIT_MESSAGE_B64: args.encodedMessage ?? "",
        RIFT_GIT_EXPECTED_TREE: args.expectedTree ?? "",
        RIFT_GIT_EXPECTED_PARENT: args.expectedParent ?? "",
        RIFT_GIT_EXPECTED_HEAD_REF: args.expectedHeadRef ?? "",
        // Base64 so a patch's newlines and quoting cannot reshape the command.
        RIFT_GIT_PATCH_B64: args.patch
          ? Buffer.from(args.patch, "utf8").toString("base64")
          : "",
        RIFT_GIT_HUNK_MODE: args.hunkMode ?? "",
      },
    }));
  } catch (error) {
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_REPOSITORY_OUTSIDE_EXIT_CODE
    ) {
      throw repositoryOutsideError();
    }
    if (
      error instanceof CommandExitError &&
      error.exitCode === GIT_MUTATION_FAILED_EXIT_CODE
    ) {
      throw new WorkbenchRequestError(
        "The Git operation failed its sandbox validation.",
        502,
        "git_mutation_failed",
      );
    }
    throw error;
  }

  let result: ReturnType<typeof parseGitMutationCommand>;
  try {
    result = parseGitMutationCommand(stdout);
  } catch (error) {
    invalidGitResponse(error);
  }
  if (result.action !== args.action) {
    invalidGitResponse(new WorkbenchGitOperationPayloadError());
  }
  if (!result.ok) throw mutationFailure(result.code);
  if (args.action === "commit" && !result.oid) {
    invalidGitResponse(new WorkbenchGitOperationPayloadError());
  }
  if (args.action !== "commit" && result.oid) {
    invalidGitResponse(new WorkbenchGitOperationPayloadError());
  }

  return {
    ok: true as const,
    action: args.action,
    ...(result.oid ? { commit: { oid: result.oid } } : {}),
  };
}

export async function GET(req: NextRequest) {
  try {
    const access = await authorizePremiumWorkbench(req);
    const cwd = normalizeWorkspacePath(
      req.nextUrl.searchParams.get("path") ?? "",
    );
    const requestedFile = req.nextUrl.searchParams.get("file");
    const requestedRenameSource = req.nextUrl.searchParams.get("renamedFrom");

    const result = await withPremiumWorkspaceSandbox(
      req,
      async (sandbox) => {
        const context = await discoverRepository(sandbox, cwd);
        if (!context) {
          if (requestedFile !== null) {
            throw new WorkbenchRequestError(
              "No Git repository was found at this workspace location.",
              409,
              "git_repository_required",
            );
          }
          return null;
        }

        if (requestedFile === null) {
          if (requestedRenameSource !== null) {
            throw new WorkbenchRequestError(
              "A selected Git file is required for rename context.",
              400,
              "git_file_required",
            );
          }
          return readRepositoryStatus(sandbox, context);
        }

        const file = normalizeRepositoryGitPath(
          context.repositoryPath,
          requestedFile,
        );
        const renamedFrom =
          requestedRenameSource === null
            ? undefined
            : normalizeRepositoryGitPath(
                context.repositoryPath,
                requestedRenameSource,
              );
        const selected = await resolveSelectedGitStatus(
          sandbox,
          context,
          file,
          renamedFrom,
        );
        return readRepositoryDiff(sandbox, context, selected);
      },
      access,
    );

    return NextResponse.json(
      result ?? { repositoryPath: null, status: null, truncated: false },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const access = await authorizePremiumWorkbench(req);
    const rawBody = await readWorkbenchRequestTextWithLimit(
      req,
      MAX_GIT_MUTATION_REQUEST_BYTES,
    );

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WorkbenchRequestError(
        "Choose a Git action and provide its required fields.",
        400,
        "invalid_git_mutation",
      );
    }
    const parsed = gitMutationSchema.safeParse(json);
    if (!parsed.success) {
      throw new WorkbenchRequestError(
        "Choose a Git action and provide its required fields.",
        400,
        "invalid_git_mutation",
      );
    }

    const cwd = normalizeWorkspacePath(parsed.data.path);
    const result = await withPremiumWorkspaceSandbox(
      req,
      async (sandbox) => {
        if (parsed.data.action === "init") {
          // Initialization requires an authorized directory, not an existing
          // repository. The init command refuses to overwrite existing Git data.
          return runRepositoryInit(sandbox, cwd);
        }

        const context = await discoverRepository(sandbox, cwd);
        if (!context) {
          throw new WorkbenchRequestError(
            "No Git repository was found at this workspace location.",
            409,
            "git_repository_required",
          );
        }

        if (parsed.data.action === "commit") {
          let encodedMessage: string;
          try {
            encodedMessage = encodeGitCommitMessage(parsed.data.message);
          } catch (error) {
            throw new WorkbenchRequestError(
              error instanceof Error
                ? error.message
                : "Enter a valid commit message.",
              400,
              "invalid_commit_message",
            );
          }
          const commitSnapshot = await assertCommitStaysWithinVisibleWorkspace(
            sandbox,
            context,
          );
          return runRepositoryMutation(sandbox, context, {
            action: "commit",
            encodedMessage,
            expectedTree: commitSnapshot.treeOid,
            expectedParent: commitSnapshot.parentOid ?? undefined,
            expectedHeadRef: commitSnapshot.headRef ?? undefined,
          });
        }

        if (parsed.data.action === "apply_hunk") {
          const hunkFile = normalizeRepositoryGitPath(
            context.repositoryPath,
            parsed.data.file,
          );
          // The patch names its own targets. Refuse anything that is not one
          // hunk confined to the file under review BEFORE the sandbox sees it,
          // so a control labelled "accept this hunk" cannot rewrite some other
          // file. The sandbox re-derives the same check independently.
          try {
            assertHunkPatchTargets(parsed.data.patch, hunkFile);
          } catch (error) {
            throw new WorkbenchRequestError(
              error instanceof HunkPatchPolicyError
                ? error.message
                : "This patch cannot be applied.",
              400,
              error instanceof HunkPatchPolicyError
                ? error.code
                : "invalid_hunk_patch",
            );
          }

          return runRepositoryMutation(sandbox, context, {
            action: "apply_hunk",
            file: hunkFile,
            hunkMode: parsed.data.mode,
            patch: parsed.data.patch,
          });
        }

        const file = normalizeRepositoryGitPath(
          context.repositoryPath,
          parsed.data.file,
        );
        const renamedFrom = parsed.data.renamedFrom
          ? normalizeRepositoryGitPath(
              context.repositoryPath,
              parsed.data.renamedFrom,
            )
          : undefined;
        const selected = await resolveSelectedGitStatus(
          sandbox,
          context,
          file,
          renamedFrom,
        );
        return runRepositoryMutation(sandbox, context, {
          action: parsed.data.action,
          file: selected.name,
          renamedFrom: selected.renamedFrom,
          includeRenameSource:
            selected.status === "renamed" && selected.renamedFrom !== undefined,
        });
      },
      access,
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
