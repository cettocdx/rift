"use client";

import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { useCallback, useEffect, useRef } from "react";
import type {
  BeforeMount,
  EditorProps,
  Monaco,
  OnMount,
} from "@monaco-editor/react";
import {
  AlertTriangle,
  FileCode2,
  LoaderCircle,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { getLanguageFromPath } from "@/app/components/computer-sidebar-utils";
import { MONACO_ASSET_PATH } from "@/lib/ui/monaco-assets";
import { useWorkbench } from "./WorkbenchProvider";
import {
  getWorkbenchTabNavigationTarget,
  workbenchEditorTabId,
} from "./workbench-editor-tabs";
import {
  WORKBENCH_EDITOR_THEMES,
  WORKBENCH_EDITOR_THEME_NAMES,
  workbenchEditorThemeName,
} from "./workbench-theme";

const MonacoEditor = dynamic<EditorProps>(
  () =>
    import("@monaco-editor/react").then((module) => {
      // Configure before Editor mounts: its mount effect initializes the loader.
      // The complete AMD distribution (including workers and fonts) is local.
      module.loader.config({ paths: { vs: MONACO_ASSET_PATH } });
      return module.default;
    }),
  {
    ssr: false,
    loading: () => (
      <div
        role="status"
        className="flex h-full min-h-0 items-center justify-center bg-workbench-canvas font-mono text-[12px] text-workbench-muted"
      >
        <LoaderCircle className="mr-2 size-3.5 motion-safe:animate-spin motion-reduce:animate-none" />
        Loading editor
      </div>
    ),
  },
);

const WORKBENCH_MODEL_PREFIX = "file:///workspace/";
const WORKBENCH_EDITOR_OPTIONS = {
  automaticLayout: true,
  minimap: { enabled: false },
  fontFamily:
    '"SFMono-Regular", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
  fontSize: 13,
  lineHeight: 20,
  fontLigatures: true,
  cursorBlinking: "smooth",
  cursorSmoothCaretAnimation: "on",
  smoothScrolling: true,
  padding: { top: 10, bottom: 12 },
  renderLineHighlight: "line",
  renderWhitespace: "selection",
  scrollBeyondLastLine: false,
  stickyScroll: { enabled: true },
  tabSize: 2,
  insertSpaces: true,
  wordWrap: "off",
  bracketPairColorization: { enabled: true },
  guides: { bracketPairs: true, indentation: true },
  overviewRulerBorder: false,
  hideCursorInOverviewRuler: true,
  fixedOverflowWidgets: true,
  largeFileOptimizations: true,
} satisfies EditorProps["options"];

const configureThemes: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(
    WORKBENCH_EDITOR_THEME_NAMES.light,
    WORKBENCH_EDITOR_THEMES.light,
  );
  monaco.editor.defineTheme(
    WORKBENCH_EDITOR_THEME_NAMES.dark,
    WORKBENCH_EDITOR_THEMES.dark,
  );
};

function fileName(path: string) {
  return path.split("/").pop() || path;
}

function editorModelPath(path: string) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file:///workspace/${encodedPath}`;
}

export function disposeClosedWorkbenchModels(
  monaco: Pick<Monaco, "editor">,
  openPaths: readonly string[],
) {
  const retainedModels = new Set(openPaths.map(editorModelPath));

  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString();
    if (uri.startsWith(WORKBENCH_MODEL_PREFIX) && !retainedModels.has(uri)) {
      model.dispose();
    }
  }
}

export function WorkbenchEditorTabs() {
  const { state, actions } = useWorkbench();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  const selectAndFocusTab = (index: number) => {
    const path = state.openTabs[index];
    if (!path) return;
    actions.setActivePath(path);
    tabRefs.current.get(path)?.focus();
  };

  if (state.openTabs.length === 0) {
    return (
      <div className="flex h-[35px] pointer-coarse:h-[46px] shrink-0 items-center border-b border-workbench-border bg-workbench-panel px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-workbench-muted">
        Editor
      </div>
    );
  }

  return (
    <div
      className="flex h-[35px] pointer-coarse:h-[46px] shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden border-b border-workbench-border bg-workbench-panel"
      style={{ scrollbarWidth: "none" }}
      role="tablist"
      aria-label="Open files"
    >
      {state.openTabs.map((path, index) => {
        const document = state.documents[path];
        const active = state.activePath === path;
        const dirty = Boolean(
          document && document.content !== document.savedContent,
        );

        return (
          <div
            key={path}
            className={`group flex h-full min-w-[126px] max-w-[220px] shrink-0 items-center border-r border-workbench-border border-t px-2.5 text-[12px] transition-colors duration-(--duration-hover) motion-reduce:transition-none ${
              active
                ? "border-t-workbench-muted bg-workbench-canvas text-workbench-text"
                : "border-t-transparent bg-workbench-panel text-workbench-muted hover:bg-workbench-control hover:text-workbench-text"
            }`}
          >
            <button
              type="button"
              role="tab"
              id={workbenchEditorTabId(path)}
              aria-selected={active}
              aria-controls="workbench-active-editor"
              aria-label={`${fileName(path)}${dirty ? ", unsaved changes" : ""}`}
              tabIndex={active ? 0 : -1}
              ref={(element) => {
                if (element) tabRefs.current.set(path, element);
                else tabRefs.current.delete(path);
              }}
              onClick={() => actions.setActivePath(path)}
              onKeyDown={(event) => {
                const targetIndex = getWorkbenchTabNavigationTarget(
                  event.key,
                  index,
                  state.openTabs.length,
                );
                if (targetIndex === null) return;
                event.preventDefault();
                selectAndFocusTab(targetIndex);
              }}
              title={path}
              className="flex min-w-0 flex-1 items-center gap-1.5 text-left pointer-coarse:min-h-11 pointer-coarse:min-w-11 focus-visible:outline-none"
            >
              <FileCode2 className="size-3.5 shrink-0 opacity-65" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{fileName(path)}</span>
              {document?.status === "saving" ? (
                <LoaderCircle
                  className="size-3 shrink-0 motion-safe:animate-spin text-foreground/65"
                  aria-label="Saving"
                />
              ) : dirty ? (
                <span
                  className="size-1.5 shrink-0 rounded-full bg-workbench-muted"
                  aria-label="Unsaved changes"
                />
              ) : null}
            </button>
            <button
              type="button"
              onClick={() => actions.closeDocument(path)}
              aria-label={`Close ${fileName(path)}`}
              className="ml-1 flex size-5 shrink-0 items-center justify-center rounded opacity-100 pointer-fine:opacity-0 pointer-coarse:size-11 [@media(hover:none)]:opacity-100 transition-opacity duration-100 motion-reduce:transition-none hover:bg-workbench-hover group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none"
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EditorEmptyState() {
  return (
    <div
      id="workbench-active-editor"
      className="flex h-full min-h-0 items-center justify-center bg-workbench-canvas px-8 text-center"
    >
      <div className="max-w-sm">
        <FileCode2 className="mx-auto size-7 text-muted-foreground/30" />
        <p className="mt-3 text-[13px] text-foreground">
          Open a file from Explorer
        </p>
        <p className="mt-1 text-[12px] leading-5 text-[var(--pro-text-muted)]">
          Files open in a real editor model. Changes stay local until you save
          with ⌘S or Ctrl+S.
        </p>
      </div>
    </div>
  );
}

export function WorkbenchActiveEditor() {
  const { state, actions } = useWorkbench();
  const { resolvedTheme } = useTheme();
  const editorTheme = workbenchEditorThemeName(resolvedTheme);
  const path = state.activePath;
  const document = path ? state.documents[path] : null;
  const monacoRef = useRef<Monaco | null>(null);

  const handleMount = useCallback<OnMount>(
    (editor, monaco) => {
      monacoRef.current = monaco;
      actions.registerEditor(editor);
      editor.addAction({
        id: "rift-workbench-save",
        label: "Save active file",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
        run: () => actions.saveActiveDocument(),
      });
      editor.focus();
    },
    [actions],
  );

  const handleChange = useCallback(
    (value: string | undefined) => {
      if (path) actions.updateDocument(path, value ?? "");
    },
    [actions, path],
  );

  useEffect(() => {
    if (monacoRef.current) {
      disposeClosedWorkbenchModels(monacoRef.current, state.openTabs);
    }
  }, [state.openTabs]);

  useEffect(
    () => () => {
      actions.registerEditor(null);
      if (monacoRef.current) {
        disposeClosedWorkbenchModels(monacoRef.current, []);
        monacoRef.current = null;
      }
    },
    [actions],
  );

  if (!path || !document) return <EditorEmptyState />;

  if (document.status === "loading") {
    return (
      <div
        id="workbench-active-editor"
        role="tabpanel"
        aria-labelledby={workbenchEditorTabId(path)}
        className="flex min-h-0 flex-1 items-center justify-center bg-workbench-canvas text-[12px] text-workbench-muted"
      >
        <LoaderCircle className="mr-2 size-3.5 motion-safe:animate-spin" />
        Reading {fileName(path)}
      </div>
    );
  }

  if (document.status === "error" && !document.revision) {
    return (
      <div
        id="workbench-active-editor"
        role="tabpanel"
        aria-labelledby={workbenchEditorTabId(path)}
        className="flex min-h-0 flex-1 items-center justify-center bg-workbench-canvas px-6"
      >
        <div className="max-w-md text-center">
          <AlertTriangle className="mx-auto size-5 text-workbench-warning" />
          <p className="mt-3 text-[13px] leading-5 text-muted-foreground">
            {document.error || "The file could not be opened."}
          </p>
          <button
            type="button"
            onClick={() => void actions.reloadDocument(path)}
            className="mt-3 inline-flex h-7 pointer-coarse:min-h-11 items-center gap-1.5 rounded border border-workbench-border-strong bg-workbench-control px-2.5 text-[12px] text-workbench-text transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover focus-visible:outline-none"
          >
            <RefreshCw className="size-3" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  const dirty = document.content !== document.savedContent;

  return (
    <div
      id="workbench-active-editor"
      role="tabpanel"
      aria-labelledby={workbenchEditorTabId(path)}
      className="relative flex min-h-0 flex-1 flex-col bg-workbench-canvas"
    >
      {document.status === "conflict" ? (
        <div
          role="alert"
          className="flex shrink-0 flex-wrap items-center gap-2 border-b border-workbench-warning-border bg-workbench-warning-surface px-3 py-2 text-[12px]"
        >
          <AlertTriangle className="size-3.5 shrink-0 text-workbench-warning" />
          <span className="min-w-[180px] flex-1 text-[var(--pro-text-secondary)]">
            This file changed remotely after it was opened. Choose which copy to
            continue with.
          </span>
          <button
            type="button"
            onClick={() => actions.resolveConflict(path, "reload-remote")}
            className="h-7 pointer-coarse:min-h-11 rounded border border-workbench-border-strong bg-workbench-control px-2 text-[12px] text-workbench-muted transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover hover:text-workbench-text focus-visible:outline-none"
          >
            Reload remote
          </button>
          <button
            type="button"
            onClick={() => actions.resolveConflict(path, "keep-local")}
            className="h-7 pointer-coarse:min-h-11 rounded border border-workbench-border-strong bg-workbench-hover px-2 text-[12px] text-workbench-text transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-active focus-visible:outline-none"
          >
            Keep mine
          </button>
        </div>
      ) : document.error ? (
        <div
          role="alert"
          className="flex shrink-0 items-center gap-2 border-b border-workbench-error-border bg-workbench-error-surface px-3 py-1.5 text-[12px] text-workbench-error"
        >
          <AlertTriangle className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{document.error}</span>
          <button
            type="button"
            disabled={!dirty || document.status === "saving"}
            onClick={() => void actions.saveDocument(path)}
            className="inline-flex h-7 pointer-coarse:min-h-11 items-center gap-1 rounded border border-workbench-border-strong bg-workbench-control px-2 text-[12px] text-workbench-text transition-colors duration-(--duration-hover) motion-reduce:transition-none hover:bg-workbench-hover focus-visible:outline-none disabled:opacity-40"
          >
            <Save className="size-3" />
            Retry save
          </button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <MonacoEditor
          beforeMount={configureThemes}
          onMount={handleMount}
          path={editorModelPath(path)}
          language={getLanguageFromPath(path)}
          value={document.content}
          onChange={handleChange}
          theme={editorTheme}
          keepCurrentModel
          saveViewState
          loading={
            <span className="font-mono text-[13px] text-muted-foreground">
              Starting editor…
            </span>
          }
          options={WORKBENCH_EDITOR_OPTIONS}
        />
      </div>
    </div>
  );
}
