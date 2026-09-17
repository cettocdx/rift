"use client";

import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import {
  AlertCircle,
  ChevronRight,
  FileCode2,
  Folder,
  FolderOpen,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useWorkbench } from "./WorkbenchProvider";
import { useOptionalMobileNavigation } from "./WorkbenchMobileNavigation";
import type { WorkbenchFileEntry } from "./types";

interface ExplorerNavigation {
  tabPath: string | null;
  register: (path: string, node: HTMLDivElement | null) => void;
  focused: (path: string) => void;
  move: (path: string, key: string) => void;
}
const ExplorerNavigationContext = createContext<ExplorerNavigation | null>(
  null,
);

function DirectoryChildren({ path, depth }: { path: string; depth: number }) {
  const { state } = useWorkbench();
  const directory = state.directories[path];

  if (!directory || directory.loading) {
    return (
      <div
        className="flex h-6 items-center gap-2 pr-2 text-[12px] text-muted-foreground"
        style={{ paddingLeft: 16 + depth * 12 }}
      >
        <LoaderCircle className="size-3 motion-safe:animate-spin" />
        Reading directory
      </div>
    );
  }

  if (directory.error) {
    return (
      <div
        className="flex items-start gap-2 py-1.5 pr-2 text-[12px] leading-5 text-workbench-error"
        style={{ paddingLeft: 16 + depth * 12 }}
      >
        <AlertCircle className="mt-0.5 size-3 shrink-0" />
        <span>{directory.error}</span>
      </div>
    );
  }

  if (directory.entries.length === 0) {
    return (
      <div
        className="h-6 pr-2 text-[12px] leading-6 text-workbench-faint"
        style={{ paddingLeft: 16 + depth * 12 }}
      >
        Empty directory
      </div>
    );
  }

  return (
    <div role="group">
      {directory.entries.map((entry) => (
        <ExplorerEntry key={entry.path} entry={entry} depth={depth} />
      ))}
      {directory.truncated ? (
        <div
          className="h-6 pr-2 text-[11px] leading-6 text-workbench-warning"
          style={{ paddingLeft: 16 + depth * 12 }}
        >
          Directory list truncated
        </div>
      ) : null}
    </div>
  );
}

function ExplorerEntry({
  entry,
  depth,
}: {
  entry: WorkbenchFileEntry;
  depth: number;
}) {
  const { state, actions } = useWorkbench();
  const mobileNavigation = useOptionalMobileNavigation();
  const isDirectory = entry.type === "directory";
  const isExpanded = state.expandedDirectories.has(entry.path);
  const active = !isDirectory && state.activePath === entry.path;
  const navigation = useContext(ExplorerNavigationContext)!;
  const activate = () => {
    if (isDirectory) {
      void actions.toggleDirectory(entry.path);
    } else {
      void actions.openFile(entry.path);
      mobileNavigation?.setSurface("editor");
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target !== event.currentTarget ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Home",
        "End",
      ].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      navigation.move(entry.path, event.key);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) activate();
    }
  };

  return (
    <div
      role="treeitem"
      aria-label={entry.name}
      aria-level={depth + 1}
      tabIndex={navigation.tabPath === entry.path ? 0 : -1}
      ref={(node) => navigation.register(entry.path, node)}
      onFocus={(event) => {
        if (event.target === event.currentTarget)
          navigation.focused(entry.path);
      }}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        if (
          (event.target as Element).closest('[role="treeitem"]') !==
          event.currentTarget
        )
          return;
        event.currentTarget.focus();
        activate();
      }}
      className="outline-none focus-visible:[&>.explorer-row]:outline focus-visible:[&>.explorer-row]:outline-1 focus-visible:[&>.explorer-row]:-outline-offset-1 focus-visible:[&>.explorer-row]:outline-ring"
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-selected={active}
    >
      <div
        title={entry.path}
        className={`explorer-row group flex h-6 [@media(pointer:coarse)]:min-h-11 w-full cursor-pointer items-center gap-1.5 border-l-2 pr-2 text-left text-[12px] transition-colors duration-(--duration-hover) motion-reduce:transition-none ${
          active
            ? "border-workbench-muted bg-workbench-hover text-workbench-text"
            : "border-transparent text-workbench-muted hover:bg-workbench-control hover:text-workbench-text"
        }`}
        style={{ paddingLeft: 6 + depth * 12 }}
      >
        {isDirectory ? (
          <ChevronRight
            className={`size-3 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${isExpanded ? "rotate-90" : ""}`}
          />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        {isDirectory ? (
          isExpanded ? (
            <FolderOpen className="size-3.5 shrink-0 text-workbench-muted" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-workbench-faint" />
          )
        ) : (
          <FileCode2 className="size-3.5 shrink-0 text-muted-foreground/70 group-hover:text-foreground/80" />
        )}
        <span className="min-w-0 flex-1 truncate">{entry.name}</span>
      </div>
      {isDirectory && isExpanded ? (
        <DirectoryChildren path={entry.path} depth={depth + 1} />
      ) : null}
    </div>
  );
}

export function WorkbenchExplorer() {
  const { state, actions, meta } = useWorkbench();
  const root = state.directories[""];
  const loadDirectory = actions.loadDirectory;
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const focusWithin = useRef(false);
  const visible: Array<{ entry: WorkbenchFileEntry; parent: string | null }> =
    [];
  const visit = (path: string, parent: string | null) => {
    const directory = state.directories[path];
    if (!directory || directory.loading || directory.error) return;
    for (const entry of directory.entries) {
      visible.push({ entry, parent });
      if (
        entry.type === "directory" &&
        state.expandedDirectories.has(entry.path)
      )
        visit(entry.path, entry.path);
    }
  };
  visit("", null);
  let tabPath =
    visible.find(({ entry }) => entry.path === focusedPath)?.entry.path ?? null;
  if (!tabPath && focusedPath) {
    tabPath =
      visible
        .filter(
          ({ entry }) =>
            entry.type === "directory" &&
            focusedPath.startsWith(`${entry.path}/`),
        )
        .at(-1)?.entry.path ?? null;
  }
  tabPath ??=
    visible.find(({ entry }) => entry.path === state.activePath)?.entry.path ??
    visible[0]?.entry.path ??
    null;
  const focusPath = (path: string | undefined) => {
    if (path) nodes.current.get(path)?.focus();
  };
  useLayoutEffect(() => {
    if (
      focusWithin.current &&
      tabPath &&
      document.activeElement === document.body
    ) {
      nodes.current.get(tabPath)?.focus();
    }
  });
  const navigation: ExplorerNavigation = {
    tabPath,
    register: (path, node) => {
      if (node) nodes.current.set(path, node);
      else nodes.current.delete(path);
    },
    focused: setFocusedPath,
    move: (path, key) => {
      const index = visible.findIndex(({ entry }) => entry.path === path);
      const current = visible[index];
      if (!current) return;
      if (key === "ArrowDown") focusPath(visible[index + 1]?.entry.path);
      else if (key === "ArrowUp") focusPath(visible[index - 1]?.entry.path);
      else if (key === "Home") focusPath(visible[0]?.entry.path);
      else if (key === "End") focusPath(visible.at(-1)?.entry.path);
      else if (key === "ArrowRight" && current.entry.type === "directory") {
        if (!state.expandedDirectories.has(path))
          void actions.toggleDirectory(path);
        else if (visible[index + 1]?.parent === path)
          focusPath(visible[index + 1]?.entry.path);
      } else if (key === "ArrowLeft") {
        if (
          current.entry.type === "directory" &&
          state.expandedDirectories.has(path)
        )
          void actions.toggleDirectory(path);
        else focusPath(current.parent ?? undefined);
      }
    },
  };

  useEffect(() => {
    void loadDirectory("");
  }, [loadDirectory]);

  return (
    <ExplorerNavigationContext.Provider value={navigation}>
      <section
        className="flex h-full min-h-0 flex-col bg-workbench-panel"
        aria-label="Explorer"
      >
        <header className="flex h-[35px] [@media(pointer:coarse)]:min-h-12 shrink-0 items-center gap-2 border-b border-workbench-border px-2.5">
          <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Explorer
          </span>
          <button
            type="button"
            onClick={() => void actions.loadDirectory("", true)}
            aria-label="Refresh Explorer"
            title="Refresh Explorer"
            className="ml-auto flex size-6 [@media(pointer:coarse)]:size-11 items-center justify-center rounded text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:-outline-offset-1"
          >
            <RefreshCw
              className={`size-3.5 ${root?.loading ? "motion-safe:animate-spin" : ""}`}
            />
          </button>
        </header>
        <div className="flex h-[26px] shrink-0 items-center border-b border-workbench-border px-2.5 font-mono text-[11px] text-workbench-muted">
          {meta.workspaceLabel}
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto py-1"
          role="tree"
          aria-label="Workspace files"
          onFocusCapture={() => {
            focusWithin.current = true;
          }}
          onBlurCapture={(event) => {
            if (
              !event.currentTarget.contains(event.relatedTarget as Node | null)
            )
              focusWithin.current = false;
          }}
        >
          {!root || root.loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted-foreground">
              <LoaderCircle className="size-3.5 motion-safe:animate-spin" />
              Connecting to sandbox
            </div>
          ) : root.error ? (
            <div className="px-3 py-3">
              <div className="flex items-start gap-2 text-[12px] leading-5 text-workbench-error">
                <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
                <span>{root.error}</span>
              </div>
              <button
                type="button"
                onClick={() => void actions.loadDirectory("", true)}
                className="mt-3 h-7 [@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[12px] text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-ring focus-visible:-outline-offset-1"
              >
                Retry
              </button>
            </div>
          ) : root.entries.length === 0 ? (
            <div className="px-3 py-4 text-[12px] leading-5 text-muted-foreground">
              The sandbox workspace is empty. Files created by the agent will
              appear here after refresh.
            </div>
          ) : (
            root.entries.map((entry) => (
              <ExplorerEntry key={entry.path} entry={entry} depth={0} />
            ))
          )}
        </div>
      </section>
    </ExplorerNavigationContext.Provider>
  );
}
