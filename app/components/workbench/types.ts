import type { OnMount } from "@monaco-editor/react";
import type { RefObject } from "react";

export type WorkbenchSidebarView = "explorer" | "changes";

export type WorkbenchFileEntry = {
  name: string;
  path: string;
  type: "file" | "directory";
  size: number;
  modifiedAt: string | null;
};

export type WorkbenchDirectory = {
  entries: WorkbenchFileEntry[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
};

export type WorkbenchFileSnapshot = {
  path: string;
  content: string;
  revision: string;
  size: number;
  modifiedAt: string | null;
};

export type WorkbenchConflict = {
  remoteContent: string;
  remoteRevision: string;
  remoteModifiedAt: string | null;
};

export type WorkbenchDocumentStatus =
  | "loading"
  | "ready"
  | "saving"
  | "conflict"
  | "error";

export type WorkbenchDocument = WorkbenchFileSnapshot & {
  savedContent: string;
  status: WorkbenchDocumentStatus;
  error: string | null;
  conflict: WorkbenchConflict | null;
};

export type WorkbenchGitFileStatus = {
  name: string;
  status:
    | "conflict"
    | "renamed"
    | "copied"
    | "deleted"
    | "added"
    | "modified"
    | "typechange"
    | "untracked"
    | "unknown";
  indexStatus: string;
  workingTreeStatus: string;
  staged: boolean;
  renamedFrom?: string;
};

export type WorkbenchGitStatus = {
  currentBranch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  detached: boolean;
  fileStatus: WorkbenchGitFileStatus[];
  isClean: boolean;
  hasChanges: boolean;
  hasStaged: boolean;
  hasUntracked: boolean;
  hasConflicts: boolean;
  totalCount: number;
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  conflictCount: number;
};

export type WorkbenchGitSnapshot = {
  repositoryPath: string | null;
  status: WorkbenchGitStatus | null;
  truncated: boolean;
};

export type WorkbenchGitDiffSection = {
  content: string;
  truncated: boolean;
};

export type WorkbenchGitDiff = {
  path: string;
  staged: WorkbenchGitDiffSection;
  unstaged: WorkbenchGitDiffSection;
};

export type WorkbenchGitDiffSnapshot = {
  repositoryPath: string;
  diff: WorkbenchGitDiff;
};

export type WorkbenchGitFileMutation = {
  action: "stage" | "unstage";
  path: string;
  file: string;
  renamedFrom?: string;
};

export type WorkbenchGitCommitMutation = {
  action: "commit";
  path: string;
  message: string;
};

/** Accept or reject exactly one hunk of one file's diff. */
export type WorkbenchGitHunkMutation = {
  action: "apply_hunk";
  path: string;
  file: string;
  /** "accept" stages just this hunk; "reject" reverses it in the worktree. */
  mode: "accept" | "reject";
  patch: string;
};

export type WorkbenchGitInitMutation = {
  action: "init";
  path: string;
};

export type WorkbenchGitMutation =
  | WorkbenchGitFileMutation
  | WorkbenchGitCommitMutation
  | WorkbenchGitHunkMutation
  | WorkbenchGitInitMutation;

export type WorkbenchGitMutationResult = {
  ok: true;
  action: WorkbenchGitMutation["action"];
  commit?: { oid: string };
};

export type WorkbenchGitState = WorkbenchGitSnapshot & {
  loading: boolean;
  error: string | null;
  loaded: boolean;
};

export type WorkbenchState = {
  sidebarOpen: boolean;
  sidebarView: WorkbenchSidebarView;
  agentPaneOpen: boolean;
  bottomPanelOpen: boolean;
  terminalFullscreen: boolean;
  directories: Record<string, WorkbenchDirectory>;
  expandedDirectories: ReadonlySet<string>;
  openTabs: string[];
  activePath: string | null;
  documents: Record<string, WorkbenchDocument>;
  git: WorkbenchGitState;
};

export type WorkbenchConflictResolution = "reload-remote" | "keep-local";

export type WorkbenchEditor = Parameters<OnMount>[0];

export type WorkbenchActions = {
  selectSidebarView: (view: WorkbenchSidebarView) => void;
  toggleSidebar: () => void;
  toggleAgentPane: () => void;
  toggleBottomPanel: () => void;
  openBottomPanel: () => void;
  closeBottomPanel: () => void;
  enterTerminalFullscreen: () => void;
  exitTerminalFullscreen: () => void;
  toggleTerminalFullscreen: () => void;
  loadDirectory: (path: string, force?: boolean) => Promise<void>;
  toggleDirectory: (path: string) => Promise<void>;
  openFile: (path: string) => Promise<void>;
  setActivePath: (path: string) => void;
  updateDocument: (path: string, content: string) => void;
  saveDocument: (path: string) => Promise<void>;
  saveActiveDocument: () => Promise<void>;
  reloadDocument: (path: string) => Promise<void>;
  resolveConflict: (
    path: string,
    resolution: WorkbenchConflictResolution,
  ) => void;
  closeDocument: (path: string) => void;
  confirmNavigation: () => boolean;
  refreshGit: (preferredWorkingDirectory?: string) => Promise<void>;
  loadGitDiff: (
    file: string,
    renamedFrom?: string,
  ) => Promise<WorkbenchGitDiffSnapshot>;
  stageGitFile: (file: string, renamedFrom?: string) => Promise<void>;
  /** Accept (stage) or reject (revert) exactly one hunk of one file's diff. */
  applyGitHunk: (
    file: string,
    patch: string,
    mode: "accept" | "reject",
  ) => Promise<void>;
  /** Creates a repository where none exists. */
  initGitRepository: () => Promise<void>;
  unstageGitFile: (file: string, renamedFrom?: string) => Promise<void>;
  commitGit: (message: string) => Promise<WorkbenchGitMutationResult>;
  registerEditor: (editor: WorkbenchEditor | null) => void;
};

export type WorkbenchMeta = {
  adapter: WorkbenchAdapter;
  editorRef: RefObject<WorkbenchEditor | null>;
  workspaceLabel: string;
  capabilities: {
    editableFiles: true;
    manualTerminal: true;
    readOnlyAgentActivity: true;
    gitDiffs: true;
    gitStaging: true;
    gitCommits: true;
  };
};

export type WorkbenchContextValue = {
  state: WorkbenchState;
  actions: WorkbenchActions;
  meta: WorkbenchMeta;
};

export type WorkbenchAdapter = {
  listDirectory: (path: string) => Promise<{
    path: string;
    entries: WorkbenchFileEntry[];
    truncated: boolean;
  }>;
  readFile: (path: string) => Promise<WorkbenchFileSnapshot>;
  writeFile: (args: {
    path: string;
    content: string;
    expectedRevision: string;
  }) => Promise<{
    path: string;
    revision: string;
    size: number;
    modifiedAt: string | null;
  }>;
  readGit: (path: string) => Promise<WorkbenchGitSnapshot>;
  readGitDiff: (args: {
    path: string;
    file: string;
    renamedFrom?: string;
  }) => Promise<WorkbenchGitDiffSnapshot>;
  mutateGit: (
    mutation: WorkbenchGitMutation,
  ) => Promise<WorkbenchGitMutationResult>;
};

export class WorkbenchClientError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "WorkbenchClientError";
  }
}
