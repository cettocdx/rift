"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Check,
  FileDiff,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useWorkbench } from "./WorkbenchProvider";
import {
  parseUnifiedDiff,
  buildHunkPatch,
  describeHunk,
  supportsHunkReview,
} from "@/lib/workbench/diff-hunks";
import { useOptionalMobileNavigation } from "./WorkbenchMobileNavigation";
import type { WorkbenchGitDiff, WorkbenchGitFileStatus } from "./types";

type DiffView = "unstaged" | "staged";
type PendingAction = "stage" | "unstage" | "commit" | null;

const statusGlyph: Record<WorkbenchGitFileStatus["status"], string> = {
  conflict: "!",
  renamed: "R",
  copied: "C",
  deleted: "D",
  added: "A",
  modified: "M",
  typechange: "T",
  untracked: "U",
  unknown: "?",
};

function statusTone(status: WorkbenchGitFileStatus["status"]) {
  if (status === "conflict" || status === "deleted") {
    return "text-workbench-error";
  }
  if (status === "added" || status === "untracked" || status === "copied") {
    return "text-workbench-success";
  }
  if (
    status === "modified" ||
    status === "renamed" ||
    status === "typechange"
  ) {
    return "text-workbench-warning";
  }
  return "text-workbench-muted";
}

function diffLineTone(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-workbench-diff-add-surface text-workbench-diff-add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-workbench-diff-remove-surface text-workbench-diff-remove";
  }
  if (line.startsWith("@@")) return "text-workbench-info";
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("---") ||
    line.startsWith("+++")
  ) {
    return "text-workbench-faint";
  }
  return "text-workbench-text/75";
}

/**
 * Renders a unified diff, with per-hunk controls when the diff has hunks.
 *
 * Reviewing an agent's edit used to be all-or-nothing per file: stage the whole
 * thing or none of it. Most reviews are not that -- "these three lines are
 * right, that one is not" is the normal case, and it had no expression here.
 */
function UnifiedDiff({
  content,
  onHunkAction,
  pendingHunk,
}: {
  content: string;
  onHunkAction?: (hunkIndex: number, mode: "accept" | "reject") => void;
  pendingHunk?: { index: number; mode: "accept" | "reject" } | null;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(content), [content]);
  const reviewable = Boolean(onHunkAction) && supportsHunkReview(parsed);

  // Which hunk each line belongs to, computed up front so the render pass has
  // no counter to mutate.
  const lines = useMemo(() => content.split("\n"), [content]);
  const hunkIndexByLine = useMemo(
    () =>
      lines.reduce<number[]>((acc, line) => {
        const previous = acc.length > 0 ? acc[acc.length - 1] : -1;
        acc.push(line.startsWith("@@") ? previous + 1 : previous);
        return acc;
      }, []),
    [lines],
  );

  return lines.map((line, index) => {
    const isHunkHeader = line.startsWith("@@");
    const currentHunk = hunkIndexByLine[index];

    if (isHunkHeader && reviewable && parsed.hunks[currentHunk]) {
      const busy = pendingHunk?.index === currentHunk;
      return (
        <span
          key={`${index}:${line}`}
          data-hunk-header={currentHunk}
          className={`flex w-fit min-w-full items-center gap-2 px-2.5 ${diffLineTone(line)}`}
        >
          <span className="min-w-0 flex-1 truncate">{line}</span>
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={() => onHunkAction?.(currentHunk, "accept")}
              aria-label={`Stage hunk ${currentHunk + 1}: ${describeHunk(parsed.hunks[currentHunk])}`}
              className="rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.06em] text-workbench-faint transition-colors hover:text-workbench-diff-add focus-visible:outline-none focus-visible:text-workbench-diff-add disabled:opacity-50"
            >
              {busy && pendingHunk?.mode === "accept" ? "…" : "Stage"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => onHunkAction?.(currentHunk, "reject")}
              aria-label={`Revert hunk ${currentHunk + 1}: ${describeHunk(parsed.hunks[currentHunk])}`}
              className="rounded px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.06em] text-workbench-faint transition-colors hover:text-workbench-diff-remove focus-visible:outline-none focus-visible:text-workbench-diff-remove disabled:opacity-50"
            >
              {busy && pendingHunk?.mode === "reject" ? "…" : "Revert"}
            </button>
          </span>
        </span>
      );
    }

    return (
      <span
        key={`${index}:${line}`}
        className={`block w-fit min-w-full px-2.5 ${diffLineTone(line)}`}
      >
        {line || "\u00a0"}
      </span>
    );
  });
}

function workspaceFilePath(repositoryPath: string, name: string) {
  return [repositoryPath, name].filter(Boolean).join("/");
}

function hasWorkingTreeChange(file: WorkbenchGitFileStatus) {
  return file.workingTreeStatus !== " ";
}

function ChangeRow({
  file,
  selected,
  disabled,
  onSelect,
}: {
  file: WorkbenchGitFileStatus;
  selected: boolean;
  disabled: boolean;
  onSelect: (file: WorkbenchGitFileStatus) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelect(file)}
      title={`Review ${file.name}`}
      className={`group flex min-h-7 w-full items-center gap-2 border-l-2 px-2.5 text-left text-[12px] transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:bg-muted disabled:cursor-wait disabled:opacity-55 ${
        selected
          ? "border-workbench-muted bg-workbench-hover text-workbench-text"
          : "border-transparent text-workbench-muted hover:bg-workbench-control hover:text-workbench-text"
      }`}
    >
      <FileDiff aria-hidden className="size-3.5 shrink-0 opacity-65" />
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      {file.staged ? (
        <span className="rounded border border-workbench-border-strong bg-workbench-control px-1 font-mono text-[10.5px] uppercase tracking-[0.06em] text-workbench-muted">
          staged
        </span>
      ) : null}
      <span
        className={`w-3 shrink-0 text-right font-mono text-[12px] ${statusTone(file.status)}`}
        aria-label={file.status}
      >
        {statusGlyph[file.status]}
      </span>
    </button>
  );
}

function DiffState({
  selectedPath,
  view,
  diff,
  loading,
  error,
  onRetry,
  onHunkAction,
  pendingHunk,
}: {
  selectedPath: string | null;
  view: DiffView;
  diff: WorkbenchGitDiff | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onHunkAction?: (hunkIndex: number, mode: "accept" | "reject") => void;
  pendingHunk?: { index: number; mode: "accept" | "reject" } | null;
}) {
  if (!selectedPath) {
    return (
      <div className="px-3 py-4 text-[11.5px] leading-5 text-muted-foreground">
        Select a file to inspect its staged and working-tree patch.
      </div>
    );
  }

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 px-3 py-4 text-[11.5px] text-muted-foreground"
        role="status"
      >
        <LoaderCircle
          aria-hidden
          className="size-3.5 motion-safe:animate-spin"
        />
        Reading unified diff…
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-3">
        <div
          className="flex items-start gap-2 text-[11.5px] leading-[18px] text-workbench-error"
          role="alert"
        >
          <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="break-words">{error}</span>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 h-7 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[11px] text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
        >
          Retry Diff
        </button>
      </div>
    );
  }

  const section = diff?.[view];
  if (!section?.content) {
    return (
      <div className="px-3 py-4 text-[11.5px] leading-5 text-muted-foreground">
        No {view === "staged" ? "staged" : "working-tree"} patch for this file.
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {section.truncated ? (
        <div
          className="border-b border-workbench-warning-border bg-workbench-warning-surface px-2.5 py-1.5 text-[10.5px] leading-4 text-workbench-warning"
          role="status"
        >
          Patch truncated at the safe display limit.
        </div>
      ) : null}
      <pre
        tabIndex={0}
        aria-label={`${view === "staged" ? "Staged" : "Working tree"} unified diff for ${selectedPath}`}
        className="min-h-0 flex-1 overflow-auto whitespace-pre bg-workbench-canvas py-2 font-mono text-[10px] leading-[16px] focus-visible:outline-none focus-visible:bg-muted"
      >
        <UnifiedDiff
          content={section.content}
          // A truncated patch is not the whole hunk, so a patch built from it
          // would apply something other than what it shows. No controls there.
          onHunkAction={section.truncated ? undefined : onHunkAction}
          pendingHunk={pendingHunk}
        />
      </pre>
    </div>
  );
}

export function WorkbenchChanges() {
  const mobileNavigation = useOptionalMobileNavigation();
  const { state, actions } = useWorkbench();
  const { git } = state;
  const {
    applyGitHunk,
    initGitRepository,
    commitGit,
    loadGitDiff,
    openFile,
    refreshGit,
    stageGitFile,
    unstageGitFile,
  } = actions;
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [dismissedNoRepository, setDismissedNoRepository] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [initError, setInitError] = useState<string | null>(null);
  const [pendingHunk, setPendingHunk] = useState<{
    index: number;
    mode: "accept" | "reject";
  } | null>(null);
  const [diffView, setDiffView] = useState<DiffView>("unstaged");
  const [diff, setDiff] = useState<WorkbenchGitDiff | null>(null);
  const [diffRepositoryPath, setDiffRepositoryPath] = useState<string | null>(
    null,
  );
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffError, setDiffError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  const diffRequestRef = useRef(0);
  const unstagedTabRef = useRef<HTMLButtonElement>(null);
  const stagedTabRef = useRef<HTMLButtonElement>(null);
  const commitInputRef = useRef<HTMLInputElement>(null);
  const selectedRepositoryRef = useRef(git.repositoryPath);
  const operationRequestRef = useRef(0);
  const tabId = useId();

  const selectedFile =
    git.status?.fileStatus.find((file) => file.name === selectedPath) ?? null;
  const selectedFileName = selectedFile?.name ?? null;
  const selectedRenameSource = selectedFile?.renamedFrom;
  const selectedSignature = selectedFile
    ? `${selectedFile.name}:${selectedFile.indexStatus}:${selectedFile.workingTreeStatus}:${selectedFile.renamedFrom ?? ""}`
    : "";

  const requestDiff = useCallback(
    async (repositoryPath: string, file: string, renamedFrom?: string) => {
      const requestId = ++diffRequestRef.current;
      setDiffLoading(true);
      setDiffError(null);
      setDiff(null);
      setDiffRepositoryPath(repositoryPath);
      try {
        const snapshot = await loadGitDiff(file, renamedFrom);
        if (diffRequestRef.current !== requestId) return;
        if (snapshot.repositoryPath !== repositoryPath) {
          throw new Error(
            "The repository changed while reading this diff. Select the file again.",
          );
        }
        setDiff(snapshot.diff);
      } catch (error) {
        if (diffRequestRef.current !== requestId) return;
        setDiff(null);
        setDiffError(
          error instanceof Error
            ? error.message
            : "The selected Git diff could not be read.",
        );
      } finally {
        if (diffRequestRef.current === requestId) setDiffLoading(false);
      }
    },
    [loadGitDiff],
  );

  useEffect(() => {
    void refreshGit();
  }, [refreshGit]);

  useEffect(() => {
    if (selectedRepositoryRef.current === git.repositoryPath) return;
    selectedRepositoryRef.current = git.repositoryPath;
    operationRequestRef.current += 1;
    diffRequestRef.current += 1;
    setSelectedPath(null);
    setDiff(null);
    setDiffRepositoryPath(null);
    setDiffError(null);
    setDiffLoading(false);
    setMutationError(null);
    setSuccessMessage("");
    setCommitMessage("");
    setPendingAction(null);
  }, [git.repositoryPath]);

  useEffect(() => {
    if (!selectedPath) {
      diffRequestRef.current += 1;
      setDiff(null);
      setDiffError(null);
      setDiffLoading(false);
      setDiffRepositoryPath(null);
      return;
    }
    if (!selectedFileName || git.repositoryPath === null) {
      setSelectedPath(null);
      return;
    }
    void requestDiff(
      git.repositoryPath,
      selectedFileName,
      selectedRenameSource,
    );
  }, [
    git.repositoryPath,
    requestDiff,
    selectedFileName,
    selectedPath,
    selectedRenameSource,
    selectedSignature,
  ]);

  useEffect(
    () => () => {
      diffRequestRef.current += 1;
    },
    [],
  );

  const selectFile = (file: WorkbenchGitFileStatus) => {
    if (pendingAction) return;
    operationRequestRef.current += 1;
    setSelectedPath(file.name);
    setMutationError(null);
    setSuccessMessage("");
    setDiffView(
      file.staged && !hasWorkingTreeChange(file) ? "staged" : "unstaged",
    );
  };

  const runFileAction = async (action: "stage" | "unstage") => {
    if (!selectedFile || pendingAction) return;
    const operationId = ++operationRequestRef.current;
    setPendingAction(action);
    setMutationError(null);
    setSuccessMessage("");
    try {
      if (action === "stage") {
        await stageGitFile(selectedFile.name, selectedFile.renamedFrom);
        if (operationRequestRef.current !== operationId) return;
        setSuccessMessage(`Staged ${selectedFile.name}`);
        setDiffView("staged");
      } else {
        await unstageGitFile(selectedFile.name, selectedFile.renamedFrom);
        if (operationRequestRef.current !== operationId) return;
        setSuccessMessage(`Unstaged ${selectedFile.name}`);
        setDiffView("unstaged");
      }
    } catch (error) {
      if (operationRequestRef.current !== operationId) return;
      setMutationError(
        error instanceof Error
          ? error.message
          : `The file could not be ${action === "stage" ? "staged" : "unstaged"}.`,
      );
    } finally {
      if (operationRequestRef.current === operationId) {
        setPendingAction(null);
      }
    }
  };

  const submitCommit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const message = commitMessage.trim();
    if (
      !message ||
      pendingAction ||
      !git.status?.hasStaged ||
      git.status.hasConflicts ||
      git.truncated
    ) {
      return;
    }
    const operationId = ++operationRequestRef.current;

    setPendingAction("commit");
    setMutationError(null);
    setSuccessMessage("");
    try {
      const result = await commitGit(message);
      if (operationRequestRef.current !== operationId) return;
      setCommitMessage("");
      setSuccessMessage(
        result.commit
          ? `Committed ${result.commit.oid.slice(0, 8)}`
          : "Committed staged changes",
      );
      window.requestAnimationFrame(() => commitInputRef.current?.focus());
    } catch (error) {
      if (operationRequestRef.current !== operationId) return;
      setMutationError(
        error instanceof Error
          ? error.message
          : "The staged changes could not be committed.",
      );
    } finally {
      if (operationRequestRef.current === operationId) {
        setPendingAction(null);
      }
    }
  };

  const selectDiffTab = (
    view: DiffView,
    focusTarget?: HTMLButtonElement | null,
  ) => {
    setDiffView(view);
    if (focusTarget) {
      window.requestAnimationFrame(() => focusTarget.focus());
    }
  };

  const handleDiffTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    current: DiffView,
  ) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      if (current === "unstaged") {
        selectDiffTab("staged", stagedTabRef.current);
      } else {
        selectDiffTab("unstaged", unstagedTabRef.current);
      }
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      selectDiffTab("unstaged", unstagedTabRef.current);
    } else if (event.key === "End") {
      event.preventDefault();
      selectDiffTab("staged", stagedTabRef.current);
    }
  };

  const canStage = Boolean(selectedFile && hasWorkingTreeChange(selectedFile));
  const canUnstage = Boolean(selectedFile?.staged);
  const visibleDiff = diffRepositoryPath === git.repositoryPath ? diff : null;
  const activePatch = visibleDiff?.[diffView];

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-workbench-panel"
      aria-label="Changes"
    >
      <header className="flex h-[35px] shrink-0 items-center gap-2 border-b border-workbench-border px-2.5">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Changes
        </span>
        {git.status ? (
          <span className="rounded bg-workbench-hover px-1.5 font-mono text-[10.5px] text-workbench-muted">
            {git.status.fileStatus.length}
            {git.truncated ? "+" : ""}
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => void refreshGit()}
          disabled={git.loading || pendingAction !== null}
          aria-label="Refresh changes"
          title="Refresh Changes"
          className="ml-auto flex size-6 items-center justify-center rounded text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none disabled:cursor-wait disabled:opacity-55"
        >
          <RefreshCw
            aria-hidden
            className={`size-3.5 ${git.loading ? "motion-safe:animate-spin" : ""}`}
          />
        </button>
      </header>

      {git.repositoryPath !== null &&
      git.status &&
      !git.loading &&
      !git.error ? (
        <div className="flex h-[26px] shrink-0 items-center gap-1.5 border-b border-workbench-border px-2.5 font-mono text-[11px] text-workbench-muted">
          <GitBranch aria-hidden className="size-3" />
          <span className="min-w-0 flex-1 truncate">
            {git.status.currentBranch || "detached HEAD"}
          </span>
          {git.status.ahead || git.status.behind ? (
            <span className="tabular-nums">
              ↑{git.status.ahead} ↓{git.status.behind}
            </span>
          ) : null}
        </div>
      ) : null}

      {git.loading && !git.loaded ? (
        <div
          className="flex min-h-0 flex-1 items-start gap-2 px-3 py-4 text-[12px] text-muted-foreground"
          role="status"
        >
          <LoaderCircle
            aria-hidden
            className="mt-0.5 size-3.5 motion-safe:animate-spin"
          />
          Reading repository state…
        </div>
      ) : git.error ? (
        <div className="min-h-0 flex-1 px-3 py-3">
          <div
            className="flex items-start gap-2 text-[12px] leading-[18px] text-workbench-error"
            role="alert"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-3.5 shrink-0" />
            <span className="break-words">{git.error}</span>
          </div>
          <button
            type="button"
            onClick={() => void refreshGit()}
            className="mt-3 h-7 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[11px] text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
          >
            Retry Status
          </button>
        </div>
      ) : dismissedNoRepository ? (
        <div className="min-h-0 flex-1 px-3 py-4 text-[12px] leading-5 text-muted-foreground">
          Working without Git. Changes are not tracked here.
          <button
            type="button"
            onClick={() => setDismissedNoRepository(false)}
            className="ml-1 underline underline-offset-2 transition-colors hover:text-workbench-text focus-visible:outline-none focus-visible:text-workbench-text"
          >
            Set up Git
          </button>
        </div>
      ) : git.repositoryPath === null || !git.status ? (
        // The spec asks the empty state to offer a way forward rather than only
        // reporting the absence. Cloning is deliberately absent: it needs a
        // remote and credentials, and offering a control that cannot finish is
        // the class of dead button this redesign exists to remove.
        <div className="min-h-0 flex-1 px-3 py-4">
          <p className="text-[12px] leading-5 text-muted-foreground">
            No Git repository was found here.
            {state.activePath
              ? ""
              : " Open a file inside a project first, so RIFT knows where to create one."}
          </p>
          {initError ? (
            <p
              role="alert"
              className="mt-2 text-[11.5px] leading-4 text-workbench-danger"
            >
              {initError}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              disabled={initBusy || !state.activePath}
              onClick={() => {
                setInitError(null);
                setInitBusy(true);
                void initGitRepository()
                  .catch((error: unknown) =>
                    setInitError(
                      error instanceof Error
                        ? error.message
                        : "Git could not initialize a repository here.",
                    ),
                  )
                  .finally(() => setInitBusy(false));
              }}
              className="h-7 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[11px] text-workbench-text transition-colors duration-(--duration-hover) hover:bg-workbench-hover focus-visible:outline-none disabled:opacity-50"
            >
              {initBusy ? "Initializing…" : "Initialize Git"}
            </button>
            <button
              type="button"
              onClick={() => void refreshGit()}
              className="h-7 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[11px] text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
            >
              Open another folder
            </button>
            <button
              type="button"
              onClick={() => setDismissedNoRepository(true)}
              className="h-7 rounded px-2.5 text-[11px] text-workbench-faint transition-colors duration-(--duration-hover) hover:text-workbench-text focus-visible:outline-none"
            >
              Continue without Git
            </button>
          </div>
        </div>
      ) : git.status.isClean ? (
        <div className="flex min-h-0 flex-1 items-start gap-2 px-3 py-4 text-[12px] leading-5 text-muted-foreground">
          <Check
            aria-hidden
            className="mt-1 size-3.5 shrink-0 text-workbench-success"
          />
          Working tree is clean.
        </div>
      ) : git.status.fileStatus.length === 0 ? (
        <div
          className="min-h-0 flex-1 px-3 py-4 text-[12px] leading-5 text-muted-foreground"
          role="status"
        >
          Repository state is incomplete. Refresh Changes before staging or
          committing.
        </div>
      ) : (
        <>
          <div
            className="max-h-[34%] min-h-24 shrink-0 overflow-y-auto border-b border-workbench-border py-1"
            aria-label="Changed files"
            role="list"
          >
            {git.status.fileStatus.map((file) => (
              <div
                key={`${file.name}:${file.indexStatus}:${file.workingTreeStatus}`}
                role="listitem"
                className="[contain-intrinsic-size:32px] [content-visibility:auto]"
              >
                <ChangeRow
                  file={file}
                  selected={file.name === selectedPath}
                  disabled={pendingAction !== null}
                  onSelect={selectFile}
                />
              </div>
            ))}
          </div>

          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-8 shrink-0 items-center border-b border-workbench-border bg-workbench-panel px-1.5">
              <div
                role="tablist"
                aria-label="Diff views"
                className="flex h-8 min-w-0 flex-1"
              >
                <button
                  ref={unstagedTabRef}
                  id={`${tabId}-unstaged-tab`}
                  type="button"
                  role="tab"
                  aria-selected={diffView === "unstaged"}
                  aria-controls={`${tabId}-diff-panel`}
                  tabIndex={diffView === "unstaged" ? 0 : -1}
                  onClick={() => selectDiffTab("unstaged")}
                  onKeyDown={(event) => handleDiffTabKeyDown(event, "unstaged")}
                  className={`h-8 border-b px-2 text-[11px] transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:bg-muted ${
                    diffView === "unstaged"
                      ? "border-workbench-muted text-workbench-text"
                      : "border-transparent text-muted-foreground hover:text-foreground/80"
                  }`}
                >
                  Working
                </button>
                <button
                  ref={stagedTabRef}
                  id={`${tabId}-staged-tab`}
                  type="button"
                  role="tab"
                  aria-selected={diffView === "staged"}
                  aria-controls={`${tabId}-diff-panel`}
                  tabIndex={diffView === "staged" ? 0 : -1}
                  onClick={() => selectDiffTab("staged")}
                  onKeyDown={(event) => handleDiffTabKeyDown(event, "staged")}
                  className={`h-8 border-b px-2 text-[11px] transition-colors duration-(--duration-hover) focus-visible:outline-none focus-visible:bg-muted ${
                    diffView === "staged"
                      ? "border-workbench-muted text-workbench-text"
                      : "border-transparent text-muted-foreground hover:text-foreground/80"
                  }`}
                >
                  Staged
                </button>
              </div>
              {selectedFile && selectedFile.status !== "deleted" ? (
                <button
                  type="button"
                  onClick={() => {
                    mobileNavigation?.setSurface("editor");
                    void openFile(
                      workspaceFilePath(
                        git.repositoryPath ?? "",
                        selectedFile.name,
                      ),
                    );
                  }}
                  className="h-6 shrink-0 rounded px-1.5 text-[11px] text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
                >
                  Open File
                </button>
              ) : null}
            </div>

            <div
              id={`${tabId}-diff-panel`}
              role="tabpanel"
              aria-labelledby={`${tabId}-${diffView}-tab`}
              tabIndex={diffError || activePatch?.content ? undefined : 0}
              className="flex min-h-0 flex-1 flex-col bg-workbench-canvas focus-visible:outline-none focus-visible:bg-muted"
            >
              <DiffState
                selectedPath={selectedPath}
                view={diffView}
                diff={visibleDiff}
                loading={diffLoading}
                error={diffError}
                pendingHunk={pendingHunk}
                onHunkAction={
                  // Only the working-tree view can be staged or reverted a hunk
                  // at a time; an already-staged hunk is a different operation.
                  diffView === "unstaged" && selectedFile && visibleDiff
                    ? async (hunkIndex, mode) => {
                        const section = visibleDiff.unstaged;
                        if (!section?.content) return;
                        const parsed = parseUnifiedDiff(section.content);
                        const hunk = parsed.hunks[hunkIndex];
                        if (!hunk) return;
                        setPendingHunk({ index: hunkIndex, mode });
                        try {
                          await applyGitHunk(
                            selectedFile.name,
                            buildHunkPatch(parsed, hunk),
                            mode,
                          );
                        } finally {
                          setPendingHunk(null);
                        }
                      }
                    : undefined
                }
                onRetry={() => {
                  if (selectedFile) {
                    if (git.repositoryPath === null) return;
                    void requestDiff(
                      git.repositoryPath,
                      selectedFile.name,
                      selectedFile.renamedFrom,
                    );
                  }
                }}
              />
            </div>

            {selectedFile ? (
              <div className="flex min-h-9 shrink-0 items-center gap-1.5 border-t border-workbench-border bg-workbench-panel px-2">
                <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-workbench-faint">
                  {activePatch?.truncated
                    ? "partial patch"
                    : selectedFile.status}
                </span>
                {canUnstage ? (
                  <button
                    type="button"
                    onClick={() => void runFileAction("unstage")}
                    disabled={pendingAction !== null}
                    className="h-6 rounded border border-workbench-border-strong bg-workbench-control px-1.5 text-[10.5px] text-workbench-muted transition-colors duration-(--duration-hover) hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none disabled:cursor-wait disabled:opacity-45"
                  >
                    {pendingAction === "unstage" ? "Unstaging…" : "Unstage"}
                  </button>
                ) : null}
                {canStage ? (
                  <button
                    type="button"
                    onClick={() => void runFileAction("stage")}
                    disabled={pendingAction !== null}
                    className="h-6 rounded border border-workbench-border-strong bg-workbench-hover px-1.5 text-[10.5px] text-workbench-text transition-colors duration-(--duration-hover) hover:bg-workbench-active focus-visible:outline-none disabled:cursor-wait disabled:opacity-45"
                  >
                    {pendingAction === "stage" ? "Staging…" : "Stage"}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      )}

      {git.repositoryPath !== null &&
      git.status &&
      !git.loading &&
      !git.error ? (
        <form
          onSubmit={submitCommit}
          className="shrink-0 border-t border-workbench-border bg-workbench-panel p-2"
        >
          <label
            htmlFor={`${tabId}-commit-message`}
            className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80"
          >
            <GitCommitHorizontal aria-hidden className="size-3" />
            Commit Staged Changes
          </label>
          <div className="flex items-center gap-1.5">
            <input
              ref={commitInputRef}
              id={`${tabId}-commit-message`}
              name="commit-message"
              type="text"
              required
              maxLength={4096}
              autoComplete="off"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              placeholder="Commit message…"
              aria-describedby={`${tabId}-commit-help`}
              className="h-7 min-w-0 flex-1 rounded border border-workbench-border-strong bg-workbench-control px-2 text-[11px] text-workbench-text placeholder:text-workbench-faint focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={
                pendingAction !== null ||
                !git.status.hasStaged ||
                !commitMessage.trim() ||
                git.status.hasConflicts ||
                git.truncated
              }
              className="h-7 shrink-0 rounded border border-workbench-border-strong bg-workbench-hover px-2 text-[11px] text-workbench-text transition-colors duration-(--duration-hover) hover:bg-workbench-active focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40"
            >
              {pendingAction === "commit" ? "Committing…" : "Commit"}
            </button>
          </div>
          <p
            id={`${tabId}-commit-help`}
            className="mt-1.5 text-[10px] leading-4 text-workbench-faint"
          >
            Local commit only. Push, pull request, and revert are not available
            here.
          </p>
          {git.truncated ? (
            <p className="mt-1 text-[10px] leading-4 text-workbench-warning">
              Refresh after reducing the change set; commits are disabled while
              the list is incomplete.
            </p>
          ) : null}
          {git.status.hasConflicts ? (
            <p className="mt-1 text-[10px] leading-4 text-workbench-warning">
              Resolve and stage all conflicts before committing.
            </p>
          ) : null}
          {mutationError ? (
            <p
              className="mt-1 break-words text-[10.5px] leading-4 text-workbench-error"
              role="alert"
            >
              {mutationError}
            </p>
          ) : null}
          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {pendingAction ? `${pendingAction} in progress` : successMessage}
          </p>
          {successMessage ? (
            <p className="mt-1 truncate text-[10.5px] leading-4 text-workbench-success">
              {successMessage}
            </p>
          ) : null}
        </form>
      ) : null}

      {git.truncated ? (
        <footer className="shrink-0 border-t border-workbench-border bg-workbench-panel px-2.5 py-1.5 text-[10px] leading-4 text-workbench-faint">
          Change list truncated at the safe display limit.
        </footer>
      ) : null}
    </section>
  );
}
