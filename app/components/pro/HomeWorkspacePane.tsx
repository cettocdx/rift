"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  File,
  FileCode2,
  Folder,
  PanelRightClose,
  Plus,
  RefreshCw,
  Search,
  TerminalSquare,
} from "lucide-react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { useInputApi } from "@/app/contexts/InputContext";
import { createWorkbenchRequestHeaders } from "@/lib/workbench/project-context";
import type {
  WorkbenchFileEntry,
  WorkbenchFileSnapshot,
} from "../workbench/types";

export function HomeWorkspacePane({
  onClose,
  loadOnOpen = false,
}: {
  onClose: () => void;
  loadOnOpen?: boolean;
}) {
  const { activeProject } = useGlobalState();
  return (
    <WorkspaceFiles
      key={activeProject?.id ?? "standalone"}
      onClose={onClose}
      loadOnOpen={loadOnOpen}
    />
  );
}

function WorkspaceFiles({
  onClose,
  loadOnOpen,
}: {
  onClose: () => void;
  loadOnOpen: boolean;
}) {
  const { activeProject, setTerminalDockOpen } = useGlobalState();
  const { inputRef, setInput } = useInputApi();
  const [path, setPath] = useState("");
  const [query, setQuery] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [requested, setRequested] = useState(loadOnOpen);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [result, setResult] = useState<{
    key: string;
    entries: WorkbenchFileEntry[];
    file: WorkbenchFileSnapshot | null;
    error: string | null;
  } | null>(null);
  const requestKey = JSON.stringify([path, filePath, refresh]);
  const loading = requested && result?.key !== requestKey;
  const entries = result?.entries ?? [];
  const file = result?.file;
  const error = result?.error;
  const headers = useMemo(
    () => createWorkbenchRequestHeaders({ projectId: activeProject?.id }),
    [activeProject?.id],
  );

  useEffect(() => {
    if (!requested) return;
    const controller = new AbortController();
    const endpoint = filePath === null ? "tree" : "file";
    void fetch(
      `/api/workbench/${endpoint}?path=${encodeURIComponent(filePath ?? path)}`,
      {
        headers,
        signal: controller.signal,
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok)
          throw new Error("Your workspace isn’t available right now.");
        if (controller.signal.aborted) return;
        if (filePath === null) {
          if (!Array.isArray(data.entries))
            throw new Error("Invalid file list");
          setResult({
            key: requestKey,
            entries: data.entries,
            file: null,
            error: null,
          });
        } else {
          if (typeof data.content !== "string")
            throw new Error("Invalid file preview");
          setResult({ key: requestKey, entries: [], file: data, error: null });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            key: requestKey,
            entries: [],
            file: null,
            error: "Your workspace isn’t available right now.",
          });
      });
    return () => controller.abort();
  }, [headers, path, filePath, requestKey, requested]);

  const visible = entries
    .filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
    .toSorted(
      (a, b) =>
        Number(b.type === "directory") - Number(a.type === "directory") ||
        a.name.localeCompare(b.name),
    );
  const goBack = () => {
    if (filePath !== null) setFilePath(null);
    else setPath(path.split("/").slice(0, -1).join("/"));
    setQuery("");
  };

  return (
    <aside className="rift-home-files" aria-label="Workspace files">
      <header className="rift-files-header">
        <button type="button" onClick={() => setTerminalDockOpen(true)}>
          <TerminalSquare aria-hidden /> Terminal
        </button>
        <span className="rift-files-tab">
          <Folder aria-hidden /> {activeProject?.name ?? "Workspace"}
        </span>
        <button
          type="button"
          aria-label="Close workspace files"
          onClick={onClose}
        >
          <PanelRightClose aria-hidden />
        </button>
      </header>
      <div className="rift-files-search">
        <Search aria-hidden />
        <input
          aria-label="Search workspace files"
          placeholder="Search files"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={!requested || filePath !== null}
        />
      </div>
      {(path || filePath) && (
        <div className="rift-files-breadcrumb">
          <button
            type="button"
            onClick={goBack}
            aria-label="Back to parent folder"
          >
            <ArrowLeft aria-hidden />
          </button>
          <span>{filePath ?? path}</span>
        </div>
      )}
      <div className="rift-files-content">
        {!requested ? (
          <div className="rift-files-empty">
            <Folder aria-hidden />
            <p>Your files, close at hand</p>
            <span>Browse your workspace and add files to a message.</span>
            <button type="button" onClick={() => setRequested(true)}>
              Browse workspace
            </button>
          </div>
        ) : loading ? (
          <div
            className="rift-files-loading"
            role="status"
            aria-label="Loading workspace files"
          >
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} />
            ))}
          </div>
        ) : error ? (
          <div className="rift-files-empty">
            <Folder aria-hidden />
            <p>{error}</p>
            <button
              type="button"
              onClick={() => {
                setRequested(true);
                setRefresh((value) => value + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : filePath !== null && file ? (
          <>
            <div className="rift-file-preview-heading">
              <FileCode2 aria-hidden />
              <span>{filePath.split("/").at(-1)}</span>
              <button
                type="button"
                onClick={() => {
                  setInput(
                    `${inputRef.current}${inputRef.current ? " " : ""}@files ${filePath} `,
                  );
                  document
                    .querySelector<HTMLTextAreaElement>(
                      'textarea[data-testid="chat-input"]',
                    )
                    ?.focus();
                }}
              >
                <Plus aria-hidden /> Add to message
              </button>
            </div>
            <pre className="rift-file-preview">
              <code>{file.content}</code>
            </pre>
          </>
        ) : visible.length ? (
          visible.map((entry) => (
            <button
              type="button"
              key={entry.path}
              className="rift-file-row"
              onClick={() => {
                if (entry.type === "directory") {
                  setPath(entry.path);
                  setQuery("");
                } else setFilePath(entry.path);
              }}
            >
              {entry.type === "directory" ? (
                <ChevronRight className="rift-file-chevron" aria-hidden />
              ) : /\.(tsx?|jsx?|json|css|md|toml|ya?ml)$/.test(entry.name) ? (
                <FileCode2 className="rift-file-code" aria-hidden />
              ) : (
                <File aria-hidden />
              )}
              <span>{entry.name}</span>
            </button>
          ))
        ) : (
          <div className="rift-files-empty">
            <Folder aria-hidden />
            <p>
              {query ? "No files match your search." : "This folder is empty."}
            </p>
            <span>
              {query
                ? "Try a different name."
                : "New files will appear here as you build."}
            </span>
          </div>
        )}
      </div>
      <footer>
        <Folder aria-hidden />
        <span>{activeProject?.name ?? "Workspace"}</span>
        <button
          type="button"
          onClick={() => {
            setRequested(true);
            setRefresh((value) => value + 1);
          }}
          aria-label="Refresh workspace files"
        >
          <RefreshCw aria-hidden />
        </button>
      </footer>
    </aside>
  );
}
