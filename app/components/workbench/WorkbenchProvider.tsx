"use client";

import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname } from "next/navigation";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { chatIdFromPathname } from "@/app/hooks/useChatNavigation";
import {
  createWorkbenchRequestHeaders,
  STANDALONE_WORKBENCH_REQUEST_HEADERS,
} from "@/lib/workbench/project-context";
import type {
  WorkbenchActions,
  WorkbenchAdapter,
  WorkbenchConflictResolution,
  WorkbenchContextValue,
  WorkbenchDirectory,
  WorkbenchDocument,
  WorkbenchFileSnapshot,
  WorkbenchGitState,
  WorkbenchGitSnapshot,
  WorkbenchSidebarView,
} from "./types";
import { WorkbenchClientError } from "./types";
import { readWorkbenchDraft, writeWorkbenchDraft } from "./workbench-drafts";

type WorkbenchGitApiSnapshot = Omit<WorkbenchGitSnapshot, "truncated"> & {
  truncated?: boolean;
};

const WorkbenchRequestHeadersContext = createContext<
  Readonly<Record<string, string>>
>(STANDALONE_WORKBENCH_REQUEST_HEADERS);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function responseJson<T>(response: Response): Promise<T> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const body = asRecord(payload) ?? {};
    const metadata = asRecord(body.metadata);
    const details = asRecord(body.details);
    const normalizedDetails =
      metadata || details ? { ...metadata, ...details } : undefined;
    const message =
      typeof body.error === "string"
        ? body.error
        : typeof body.message === "string"
          ? body.message
          : "The Workbench request failed.";
    throw new WorkbenchClientError(
      message,
      response.status,
      typeof body.code === "string" ? body.code : undefined,
      normalizedDetails,
    );
  }

  return payload as T;
}

export function createWorkbenchHttpAdapter(
  requestHeaders: Readonly<
    Record<string, string>
  > = STANDALONE_WORKBENCH_REQUEST_HEADERS,
): WorkbenchAdapter {
  return {
    async listDirectory(path) {
      const response = await fetch(
        `/api/workbench/tree?path=${encodeURIComponent(path)}`,
        { cache: "no-store", headers: requestHeaders },
      );
      return responseJson(response);
    },
    async readFile(path) {
      const response = await fetch(
        `/api/workbench/file?path=${encodeURIComponent(path)}`,
        { cache: "no-store", headers: requestHeaders },
      );
      return responseJson(response);
    },
    async writeFile(args) {
      const response = await fetch("/api/workbench/file", {
        method: "PUT",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      });
      return responseJson(response);
    },
    async readGit(path) {
      const response = await fetch(
        `/api/workbench/git?path=${encodeURIComponent(path)}`,
        { cache: "no-store", headers: requestHeaders },
      );
      const snapshot = await responseJson<WorkbenchGitApiSnapshot>(response);
      return { ...snapshot, truncated: snapshot.truncated === true };
    },
    async readGitDiff(args) {
      const searchParams = new URLSearchParams({
        path: args.path,
        file: args.file,
      });
      if (args.renamedFrom) {
        searchParams.set("renamedFrom", args.renamedFrom);
      }
      const response = await fetch(`/api/workbench/git?${searchParams}`, {
        cache: "no-store",
        headers: requestHeaders,
      });
      return responseJson(response);
    },
    async mutateGit(mutation) {
      const response = await fetch("/api/workbench/git", {
        method: "POST",
        headers: {
          ...requestHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(mutation),
      });
      return responseJson(response);
    },
  };
}

export const workbenchHttpAdapter = createWorkbenchHttpAdapter();

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The sandbox workspace could not be reached.";
}

function loadingDocument(path: string): WorkbenchDocument {
  return {
    path,
    content: "",
    savedContent: "",
    revision: "",
    size: 0,
    modifiedAt: null,
    status: "loading",
    error: null,
    conflict: null,
  };
}

function snapshotDocument(snapshot: WorkbenchFileSnapshot): WorkbenchDocument {
  return {
    ...snapshot,
    savedContent: snapshot.content,
    status: "ready",
    error: null,
    conflict: null,
  };
}

const initialGitState: WorkbenchGitState = {
  repositoryPath: null,
  status: null,
  truncated: false,
  loading: false,
  error: null,
  loaded: false,
};

export function WorkbenchProvider({
  children,
  adapter,
  requestHeaders = STANDALONE_WORKBENCH_REQUEST_HEADERS,
  storageScope,
}: {
  children: React.ReactNode;
  adapter: WorkbenchAdapter;
  requestHeaders?: Readonly<Record<string, string>>;
  storageScope?: string;
}) {
  const [restoredDraft] = useState(() =>
    storageScope ? readWorkbenchDraft(storageScope) : null,
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarView, setSidebarView] =
    useState<WorkbenchSidebarView>("explorer");
  const [agentPaneOpen, setAgentPaneOpen] = useState(true);
  const [bottomPanelOpen, setBottomPanelOpen] = useState(true);
  const [terminalFullscreen, setTerminalFullscreen] = useState(false);
  const [directories, setDirectories] = useState<
    Record<string, WorkbenchDirectory>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    new Set(),
  );
  const [openTabs, setOpenTabs] = useState<string[]>(
    () => restoredDraft?.openTabs ?? [],
  );
  const [activePath, setActivePathState] = useState<string | null>(
    () => restoredDraft?.activePath ?? null,
  );
  const [documents, setDocuments] = useState<Record<string, WorkbenchDocument>>(
    () => restoredDraft?.documents ?? {},
  );
  const [git, setGit] = useState<WorkbenchGitState>(initialGitState);

  const editorRef =
    useRef<WorkbenchContextValue["meta"]["editorRef"]["current"]>(null);
  const directoriesRef = useRef(directories);
  const directoryLoadsRef = useRef(new Map<string, Promise<void>>());
  const documentLoadsRef = useRef(new Map<string, Promise<void>>());
  const documentsRef = useRef(documents);
  const activePathRef = useRef(activePath);
  const gitRef = useRef(git);
  const gitRefreshRequestRef = useRef(0);
  const gitContextVersionRef = useRef(0);
  const gitReadyContextVersionRef = useRef<number | null>(null);
  const bottomPanelOpenRef = useRef(bottomPanelOpen);
  const terminalFullscreenRef = useRef(terminalFullscreen);
  const terminalFullscreenReturnPanelOpenRef = useRef(bottomPanelOpen);
  directoriesRef.current = directories;
  documentsRef.current = documents;
  activePathRef.current = activePath;
  bottomPanelOpenRef.current = bottomPanelOpen;
  terminalFullscreenRef.current = terminalFullscreen;

  const hasUnsavedDocuments = useMemo(
    () =>
      Object.values(documents).some(
        (document) => document.content !== document.savedContent,
      ),
    [documents],
  );

  useEffect(() => {
    if (!storageScope) return;
    const timeoutId = window.setTimeout(() => {
      writeWorkbenchDraft(storageScope, {
        openTabs,
        activePath,
        documents,
      });
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [activePath, documents, openTabs, storageScope]);

  useEffect(() => {
    if (!hasUnsavedDocuments) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasUnsavedDocuments]);

  const loadDirectory = useCallback(
    async (path: string, force = false): Promise<void> => {
      const pending = directoryLoadsRef.current.get(path);
      if (pending) return pending;

      // Refresh cached branches as well as the root; reopening a branch must
      // not reuse a listing from before an agent changed the workspace.
      const refreshBranches =
        force && path === ""
          ? Object.keys(directoriesRef.current).filter(
              (directory) => directory !== "",
            )
          : [];
      const current = directoriesRef.current[path];
      if (!force && current && !current.error) return;
      if (current?.loading) return;

      const operation = (async () => {
        setDirectories((value) => ({
          ...value,
          [path]: {
            entries: current?.entries ?? [],
            truncated: current?.truncated ?? false,
            loading: true,
            error: null,
          },
        }));

        try {
          const result = await adapter.listDirectory(path);
          setDirectories((value) => ({
            ...value,
            [path]: {
              entries: result.entries,
              truncated: result.truncated,
              loading: false,
              error: null,
            },
          }));
        } catch (error) {
          setDirectories((value) => ({
            ...value,
            [path]: {
              entries: value[path]?.entries ?? [],
              truncated: value[path]?.truncated ?? false,
              loading: false,
              error: errorMessage(error),
            },
          }));
        }
      })();

      directoryLoadsRef.current.set(path, operation);
      try {
        await operation;
      } finally {
        if (directoryLoadsRef.current.get(path) === operation) {
          directoryLoadsRef.current.delete(path);
        }
      }
      await Promise.all(
        refreshBranches.map((directory) => loadDirectory(directory, true)),
      );
    },
    [adapter],
  );

  const toggleDirectory = useCallback(
    async (path: string) => {
      if (expandedDirectories.has(path)) {
        setExpandedDirectories((value) => {
          const next = new Set(value);
          next.delete(path);
          return next;
        });
        return;
      }

      setExpandedDirectories((value) => new Set(value).add(path));
      await loadDirectory(path);
    },
    [expandedDirectories, loadDirectory],
  );

  const reloadDocument = useCallback(
    async (path: string) => {
      const pending = documentLoadsRef.current.get(path);
      if (pending) return pending;

      const operation = (async () => {
        setDocuments((value) => ({
          ...value,
          [path]: {
            ...(value[path] ?? loadingDocument(path)),
            status: "loading",
            error: null,
            conflict: null,
          },
        }));

        try {
          const snapshot = await adapter.readFile(path);
          setDocuments((value) => ({
            ...value,
            [path]: snapshotDocument(snapshot),
          }));
        } catch (error) {
          setDocuments((value) => ({
            ...value,
            [path]: {
              ...(value[path] ?? loadingDocument(path)),
              status: "error",
              error: errorMessage(error),
              conflict: null,
            },
          }));
        }
      })();

      documentLoadsRef.current.set(path, operation);
      try {
        await operation;
      } finally {
        if (documentLoadsRef.current.get(path) === operation) {
          documentLoadsRef.current.delete(path);
        }
      }
    },
    [adapter],
  );

  const openFile = useCallback(
    async (path: string) => {
      setOpenTabs((value) => (value.includes(path) ? value : [...value, path]));
      setActivePathState(path);

      const current = documentsRef.current[path];
      if (current && current.status !== "error") return;
      setDocuments((value) => ({
        ...value,
        [path]: loadingDocument(path),
      }));
      await reloadDocument(path);
    },
    [reloadDocument],
  );

  const refreshGitAt = useCallback(
    async (
      preferredWorkingDirectory: string | undefined,
      contextVersion: number,
      contextSwitch: boolean,
    ) => {
      const requestId = ++gitRefreshRequestRef.current;
      gitReadyContextVersionRef.current = null;
      const loadingGit: WorkbenchGitState = {
        ...initialGitState,
        loading: true,
      };
      gitRef.current = loadingGit;
      if (contextSwitch) {
        setGit(loadingGit);
      } else {
        setGit((value) => ({ ...value, loading: true, error: null }));
      }
      try {
        const activeFilePath = activePathRef.current;
        const lastSeparator = activeFilePath?.lastIndexOf("/") ?? -1;
        const workingDirectory =
          preferredWorkingDirectory ??
          (activeFilePath && lastSeparator > 0
            ? activeFilePath.slice(0, lastSeparator)
            : "");
        const result = await adapter.readGit(workingDirectory);
        if (
          gitRefreshRequestRef.current !== requestId ||
          gitContextVersionRef.current !== contextVersion
        ) {
          return;
        }
        const nextGit = {
          ...result,
          loading: false,
          error: null,
          loaded: true,
        };
        gitReadyContextVersionRef.current = contextVersion;
        gitRef.current = nextGit;
        setGit(nextGit);
      } catch (error) {
        if (
          gitRefreshRequestRef.current !== requestId ||
          gitContextVersionRef.current !== contextVersion
        ) {
          return;
        }
        if (contextSwitch) {
          const failedGit: WorkbenchGitState = {
            ...initialGitState,
            error: errorMessage(error),
            loaded: true,
          };
          gitRef.current = failedGit;
          setGit(failedGit);
        } else {
          setGit((value) => ({
            ...value,
            loading: false,
            error: errorMessage(error),
            loaded: true,
          }));
        }
      }
    },
    [adapter],
  );

  const refreshGit = useCallback(
    async (preferredWorkingDirectory?: string) => {
      const contextVersion = ++gitContextVersionRef.current;
      await refreshGitAt(preferredWorkingDirectory, contextVersion, true);
    },
    [refreshGitAt],
  );

  const requireGitRepositoryPath = useCallback(() => {
    const repositoryPath = gitRef.current.repositoryPath;
    if (
      repositoryPath === null ||
      gitReadyContextVersionRef.current !== gitContextVersionRef.current
    ) {
      throw new WorkbenchClientError(
        "Open a file inside a Git repository and refresh Changes first.",
        409,
        "git_repository_required",
      );
    }
    return repositoryPath;
  }, []);

  const loadGitDiff = useCallback(
    async (file: string, renamedFrom?: string) => {
      const path = requireGitRepositoryPath();
      return adapter.readGitDiff({ path, file, renamedFrom });
    },
    [adapter, requireGitRepositoryPath],
  );

  const stageGitFile = useCallback(
    async (file: string, renamedFrom?: string) => {
      const path = requireGitRepositoryPath();
      const contextVersion = gitContextVersionRef.current;
      try {
        await adapter.mutateGit({ action: "stage", path, file, renamedFrom });
      } finally {
        if (gitContextVersionRef.current === contextVersion) {
          await refreshGitAt(path, contextVersion, false);
        }
      }
    },
    [adapter, refreshGitAt, requireGitRepositoryPath],
  );

  /**
   * Accepts or rejects one hunk. The patch is built from the diff the panel is
   * showing, so what the button does is exactly what the reader was looking at.
   */
  /**
   * Creates a repository at the current workspace location. Unlike every other
   * Git action this does not require one to already exist -- that absence is
   * its precondition -- so it reads the workspace path rather than the
   * repository path.
   */
  const initGitRepository = useCallback(async () => {
    const active = activePathRef.current;
    const path = active ? active.split("/").slice(0, -1).join("/") : "";
    const contextVersion = gitContextVersionRef.current;
    await adapter.mutateGit({ action: "init", path });
    if (gitContextVersionRef.current === contextVersion) {
      await refreshGitAt(path, contextVersion, false);
    }
  }, [adapter, refreshGitAt]);

  const applyGitHunk = useCallback(
    async (file: string, patch: string, mode: "accept" | "reject") => {
      const path = requireGitRepositoryPath();
      const contextVersion = gitContextVersionRef.current;
      try {
        await adapter.mutateGit({
          action: "apply_hunk",
          path,
          file,
          patch,
          mode,
        });
      } finally {
        if (gitContextVersionRef.current === contextVersion) {
          await refreshGitAt(path, contextVersion, false);
        }
      }
    },
    [adapter, refreshGitAt, requireGitRepositoryPath],
  );

  const unstageGitFile = useCallback(
    async (file: string, renamedFrom?: string) => {
      const path = requireGitRepositoryPath();
      const contextVersion = gitContextVersionRef.current;
      try {
        await adapter.mutateGit({
          action: "unstage",
          path,
          file,
          renamedFrom,
        });
      } finally {
        if (gitContextVersionRef.current === contextVersion) {
          await refreshGitAt(path, contextVersion, false);
        }
      }
    },
    [adapter, refreshGitAt, requireGitRepositoryPath],
  );

  const commitGit = useCallback(
    async (message: string) => {
      const path = requireGitRepositoryPath();
      const contextVersion = gitContextVersionRef.current;
      try {
        return await adapter.mutateGit({
          action: "commit",
          path,
          message,
        });
      } finally {
        if (gitContextVersionRef.current === contextVersion) {
          await refreshGitAt(path, contextVersion, false);
        }
      }
    },
    [adapter, refreshGitAt, requireGitRepositoryPath],
  );

  const saveDocument = useCallback(
    async (path: string) => {
      const document = documentsRef.current[path];
      if (!document || document.status !== "ready") return;
      if (document.content === document.savedContent) return;

      const contentToSave = document.content;
      const expectedRevision = document.revision;
      setDocuments((value) => ({
        ...value,
        [path]: {
          ...value[path],
          status: "saving",
          error: null,
          conflict: null,
        },
      }));

      try {
        const saved = await adapter.writeFile({
          path,
          content: contentToSave,
          expectedRevision,
        });
        setDocuments((value) => {
          const current = value[path];
          if (!current) return value;
          return {
            ...value,
            [path]: {
              ...current,
              savedContent: contentToSave,
              revision: saved.revision,
              size: saved.size,
              modifiedAt: saved.modifiedAt,
              status: "ready",
              error: null,
              conflict: null,
            },
          };
        });
        void refreshGit();
      } catch (error) {
        if (error instanceof WorkbenchClientError && error.status === 409) {
          try {
            const remote = await adapter.readFile(path);
            setDocuments((value) => {
              const current = value[path];
              if (!current) return value;
              return {
                ...value,
                [path]: {
                  ...current,
                  status: "conflict",
                  error: error.message,
                  conflict: {
                    remoteContent: remote.content,
                    remoteRevision: remote.revision,
                    remoteModifiedAt: remote.modifiedAt,
                  },
                },
              };
            });
          } catch (reloadError) {
            setDocuments((value) => ({
              ...value,
              [path]: {
                ...value[path],
                status: "ready",
                error: `${error.message} ${errorMessage(reloadError)}`,
                conflict: null,
              },
            }));
          }
          return;
        }

        setDocuments((value) => ({
          ...value,
          [path]: {
            ...value[path],
            status: "ready",
            error: errorMessage(error),
          },
        }));
      }
    },
    [adapter, refreshGit],
  );

  const saveActiveDocument = useCallback(async () => {
    const path = activePathRef.current;
    if (path) await saveDocument(path);
  }, [saveDocument]);

  const resolveConflict = useCallback(
    (path: string, resolution: WorkbenchConflictResolution) => {
      setDocuments((value) => {
        const document = value[path];
        const conflict = document?.conflict;
        if (!document || !conflict) return value;

        if (resolution === "reload-remote") {
          return {
            ...value,
            [path]: {
              ...document,
              content: conflict.remoteContent,
              savedContent: conflict.remoteContent,
              revision: conflict.remoteRevision,
              modifiedAt: conflict.remoteModifiedAt,
              status: "ready",
              error: null,
              conflict: null,
            },
          };
        }

        return {
          ...value,
          [path]: {
            ...document,
            savedContent: conflict.remoteContent,
            revision: conflict.remoteRevision,
            modifiedAt: conflict.remoteModifiedAt,
            status: "ready",
            error: null,
            conflict: null,
          },
        };
      });
    },
    [],
  );

  const closeDocument = useCallback((path: string) => {
    const document = documentsRef.current[path];
    if (
      document &&
      document.content !== document.savedContent &&
      !window.confirm("Close this tab without saving its changes?")
    ) {
      return;
    }

    setOpenTabs((value) => {
      const index = value.indexOf(path);
      const next = value.filter((item) => item !== path);
      setActivePathState((current) => {
        if (current !== path) return current;
        return next[Math.min(Math.max(index, 0), next.length - 1)] ?? null;
      });
      return next;
    });
  }, []);

  const confirmNavigation = useCallback(() => {
    const hasDirtyDocument = Object.values(documentsRef.current).some(
      (document) => document.content !== document.savedContent,
    );
    if (!hasDirtyDocument) return true;
    return window.confirm(
      "Leave the workspace with unsaved changes? Your draft will remain available in this browser tab.",
    );
  }, []);

  const enterTerminalFullscreen = useCallback(() => {
    if (terminalFullscreenRef.current) return;
    terminalFullscreenReturnPanelOpenRef.current = bottomPanelOpenRef.current;
    terminalFullscreenRef.current = true;
    bottomPanelOpenRef.current = true;
    setTerminalFullscreen(true);
    setBottomPanelOpen(true);
  }, []);

  const exitTerminalFullscreen = useCallback(() => {
    if (!terminalFullscreenRef.current) return;
    const restorePanelOpen = terminalFullscreenReturnPanelOpenRef.current;
    terminalFullscreenRef.current = false;
    bottomPanelOpenRef.current = restorePanelOpen;
    setTerminalFullscreen(false);
    setBottomPanelOpen(restorePanelOpen);
  }, []);

  const toggleTerminalFullscreen = useCallback(() => {
    if (terminalFullscreenRef.current) {
      exitTerminalFullscreen();
    } else {
      enterTerminalFullscreen();
    }
  }, [enterTerminalFullscreen, exitTerminalFullscreen]);

  const actions = useMemo<WorkbenchActions>(
    () => ({
      selectSidebarView(view) {
        setSidebarView(view);
        setSidebarOpen(true);
      },
      toggleSidebar() {
        setSidebarOpen((value) => !value);
      },
      toggleAgentPane() {
        setAgentPaneOpen((value) => !value);
      },
      toggleBottomPanel() {
        terminalFullscreenRef.current = false;
        setTerminalFullscreen(false);
        setBottomPanelOpen((value) => {
          const next = !value;
          bottomPanelOpenRef.current = next;
          return next;
        });
      },
      openBottomPanel() {
        bottomPanelOpenRef.current = true;
        setBottomPanelOpen(true);
      },
      closeBottomPanel() {
        terminalFullscreenRef.current = false;
        bottomPanelOpenRef.current = false;
        setTerminalFullscreen(false);
        setBottomPanelOpen(false);
      },
      enterTerminalFullscreen,
      exitTerminalFullscreen,
      toggleTerminalFullscreen,
      loadDirectory,
      toggleDirectory,
      openFile,
      setActivePath: setActivePathState,
      updateDocument(path, content) {
        setDocuments((value) => {
          const document = value[path];
          if (!document) return value;
          return {
            ...value,
            [path]: { ...document, content, error: null },
          };
        });
      },
      saveDocument,
      saveActiveDocument,
      reloadDocument,
      resolveConflict,
      closeDocument,
      confirmNavigation,
      refreshGit,
      loadGitDiff,
      stageGitFile,
      applyGitHunk,
      initGitRepository,
      unstageGitFile,
      commitGit,
      registerEditor(editor) {
        editorRef.current = editor;
      },
    }),
    [
      loadDirectory,
      toggleDirectory,
      openFile,
      saveDocument,
      saveActiveDocument,
      reloadDocument,
      resolveConflict,
      closeDocument,
      confirmNavigation,
      refreshGit,
      loadGitDiff,
      stageGitFile,
      applyGitHunk,
      initGitRepository,
      unstageGitFile,
      commitGit,
      enterTerminalFullscreen,
      exitTerminalFullscreen,
      toggleTerminalFullscreen,
    ],
  );

  const state = useMemo(
    () => ({
      sidebarOpen,
      sidebarView,
      agentPaneOpen,
      bottomPanelOpen,
      terminalFullscreen,
      directories,
      expandedDirectories,
      openTabs,
      activePath,
      documents,
      git,
    }),
    [
      sidebarOpen,
      sidebarView,
      agentPaneOpen,
      bottomPanelOpen,
      terminalFullscreen,
      directories,
      expandedDirectories,
      openTabs,
      activePath,
      documents,
      git,
    ],
  );

  const meta = useMemo(
    () => ({
      adapter,
      editorRef,
      workspaceLabel: "Workspace",
      capabilities: {
        editableFiles: true as const,
        manualTerminal: true as const,
        readOnlyAgentActivity: true as const,
        gitDiffs: true as const,
        gitStaging: true as const,
        gitCommits: true as const,
      },
    }),
    [adapter],
  );

  const value = useMemo(
    () => ({ state, actions, meta }),
    [state, actions, meta],
  );

  return (
    <WorkbenchRequestHeadersContext value={requestHeaders}>
      <WorkbenchContext value={value}>{children}</WorkbenchContext>
    </WorkbenchRequestHeadersContext>
  );
}

export function SandboxWorkbenchProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { activeProject } = useGlobalState();
  const chatId = chatIdFromPathname(pathname);
  // A persisted chat is the authority for its own project binding. Only a
  // fresh, route-less chat sends the optimistic project id selected by the
  // user; the server validates ownership in both cases.
  const projectId = chatId ? undefined : activeProject?.id;
  const requestHeaders = useMemo(
    () =>
      createWorkbenchRequestHeaders({
        chatId: chatId ?? undefined,
        projectId,
      }),
    [chatId, projectId],
  );
  const adapter = useMemo(
    () => createWorkbenchHttpAdapter(requestHeaders),
    [requestHeaders],
  );
  const workspaceScope = chatId
    ? `chat:${chatId}`
    : projectId
      ? `project:${projectId}`
      : "standalone";

  return (
    <WorkbenchProvider
      key={workspaceScope}
      adapter={adapter}
      requestHeaders={requestHeaders}
      storageScope={workspaceScope}
    >
      {children}
    </WorkbenchProvider>
  );
}

export function useWorkbenchRequestHeaders() {
  return use(WorkbenchRequestHeadersContext);
}

export function useWorkbench() {
  const value = use(WorkbenchContext);
  if (!value) {
    throw new Error("useWorkbench must be used within a WorkbenchProvider");
  }
  return value;
}
