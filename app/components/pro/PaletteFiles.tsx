"use client";
import { useEffect, useState } from "react";
import { ArrowLeft, File, Folder, RefreshCw } from "lucide-react";
import { CommandGroup, CommandItem } from "@/components/ui/command";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { createWorkbenchRequestHeaders } from "@/lib/workbench/project-context";
import type { WorkbenchFileEntry } from "../workbench/types";

/** Mounted only after the user explicitly chooses Files in the palette. */
export function PaletteFiles({
  query,
  clearQuery,
}: {
  query: string;
  clearQuery: () => void;
}) {
  const { activeProject } = useGlobalState();
  return (
    <Directory
      key={activeProject?.id ?? "default"}
      projectId={activeProject?.id}
      query={query}
      clearQuery={clearQuery}
    />
  );
}
function Directory({
  projectId,
  query,
  clearQuery,
}: {
  projectId?: string;
  query: string;
  clearQuery: () => void;
}) {
  const [path, setPath] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    entries?: WorkbenchFileEntry[];
    content?: string;
    error?: string;
  } | null>(null);
  const key = JSON.stringify([path, file, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    fetch(
      `/api/workbench/${file === null ? "tree" : "file"}?path=${encodeURIComponent(file ?? path)}`,
      {
        headers: createWorkbenchRequestHeaders({ projectId }),
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const data = await response.json();
        if (
          !response.ok ||
          (file === null
            ? !Array.isArray(data.entries)
            : typeof data.content !== "string")
        )
          throw new Error(
            "Files could not be loaded. Check the workspace connection and try again.",
          );
        if (!controller.signal.aborted)
          setResult({ key, entries: data.entries, content: data.content });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({
            key,
            error:
              "Files could not be loaded. Check the workspace connection and try again.",
          });
      });
    return () => controller.abort();
  }, [path, file, key, projectId]);
  const back = () => {
    clearQuery();
    if (file !== null) setFile(null);
    else setPath(path.split("/").slice(0, -1).join("/"));
  };
  const entries = [...(result?.entries ?? [])]
    .filter((entry) => entry.name.toLowerCase().includes(query.toLowerCase()))
    .sort(
      (a, b) =>
        Number(b.type === "directory") - Number(a.type === "directory") ||
        a.name.localeCompare(b.name),
    );
  return (
    <CommandGroup
      heading={file ?? (path ? `Files in ${path}` : "Files in workspace root")}
    >
      {path || file ? (
        <CommandItem onSelect={back} forceMount>
          <ArrowLeft /> Back to folder
        </CommandItem>
      ) : null}
      {result?.key !== key ? (
        <p
          role="status"
          className="px-3 py-5 text-ui-label text-muted-foreground"
        >
          Loading files…
        </p>
      ) : result.error ? (
        <>
          <p
            role="alert"
            className="px-3 py-3 text-ui-label text-muted-foreground"
          >
            {result.error}
          </p>
          <CommandItem
            onSelect={() => setAttempt((value) => value + 1)}
            forceMount
          >
            <RefreshCw /> Retry
          </CommandItem>
        </>
      ) : file !== null ? (
        <pre
          tabIndex={0}
          aria-label={`Preview of ${file}`}
          className="max-h-72 overflow-auto rounded-md bg-muted/40 p-3 font-mono text-ui-label"
        >
          {result.content}
        </pre>
      ) : (
        <>
          {entries.map((entry) => (
            <CommandItem
              key={entry.path}
              value={entry.path}
              forceMount
              onSelect={() => {
                clearQuery();
                if (entry.type === "directory") setPath(entry.path);
                else setFile(entry.path);
              }}
            >
              {entry.type === "directory" ? <Folder /> : <File />}
              <span className="truncate">{entry.name}</span>
            </CommandItem>
          ))}
          {!entries.length ? (
            <p
              role="status"
              className="px-3 py-5 text-ui-label text-muted-foreground"
            >
              {query
                ? "No matching files in this folder."
                : "This folder is empty."}
            </p>
          ) : null}
        </>
      )}
    </CommandGroup>
  );
}
