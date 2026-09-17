"use client";

import { useId, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronRight,
  Copy,
  ExternalLink,
  FileCode2,
  FileDiff,
  FileJson2,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import type { FileDiffStat } from "../agent-activity";
import { isSidebarFile, type SidebarContent } from "@/types/chat";
import styles from "./WorkbenchConversationChanges.module.css";

const InlineDiff = dynamic(
  () => import("../DiffView").then((module) => module.DiffView),
  {
    ssr: false,
    loading: () => <p role="status">Loading diff…</p>,
  },
);

function fileIcon(path: string) {
  if (/\.(json|jsonc)$/i.test(path)) return FileJson2;
  if (/\.(tsx?|jsx?|py|rs|go|css|html|sh|swift|vue|svelte)$/i.test(path))
    return FileCode2;
  return FileText;
}

/** Conversation edits are not a Git snapshot: do not infer branch or file status. */
export function WorkbenchConversationChanges({
  changes,
  onOpen,
  scopeLabel = "This conversation",
}: {
  changes: readonly FileDiffStat[];
  onOpen: (content: SidebarContent) => void;
  scopeLabel?: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const instanceId = useId();
  const copyPath = async (path: string) => {
    try {
      await navigator.clipboard.writeText(path);
      toast.success("Path copied");
    } catch {
      toast.error("Could not copy the path. Try again.");
    }
  };
  const known = changes.filter((file) => !file.diffUnavailable);
  const added = known.reduce((total, file) => total + file.added, 0);
  const removed = known.reduce((total, file) => total + file.removed, 0);
  const unavailable = changes.length - known.length;

  return (
    <section className={styles.panel} aria-label="Review changes">
      <header className={styles.summary}>
        <FileDiff aria-hidden="true" />
        <span>
          {changes.length} {changes.length === 1 ? "file" : "files"}
        </span>
        {known.length > 0 && (
          <span
            className={styles.counts}
            aria-label={`${added} additions, ${removed} deletions${unavailable ? ", known diffs only" : ""}`}
          >
            <span className={styles.added}>+{added}</span>
            <span className={styles.removed}>−{removed}</span>
          </span>
        )}
        <span className={styles.scope}>{scopeLabel}</span>
      </header>
      {unavailable > 0 && (
        <p className={styles.notice}>
          {unavailable} {unavailable === 1 ? "file has" : "files have"} no
          available diff. Totals include known diffs only.
        </p>
      )}
      {changes.length ? (
        <ul className={styles.list} aria-label="Changed files">
          {changes.map((file, index) => {
            const split = Math.max(
              file.path.lastIndexOf("/"),
              file.path.lastIndexOf("\\"),
            );
            const directory = file.path.slice(0, split + 1);
            const name = file.path.slice(split + 1);
            const Icon = fileIcon(file.path);
            const open = expanded === file.path;
            const panelId = `${instanceId}-diff-${index}`;
            const execution = isSidebarFile(file.execution)
              ? file.execution
              : null;
            return (
              <li key={file.path}>
                <div className={styles.fileRow}>
                  <button
                    type="button"
                    className={styles.row}
                    onClick={() => setExpanded(open ? null : file.path)}
                    aria-expanded={open}
                    aria-controls={panelId}
                    aria-label={`Review ${file.path}`}
                    title={file.path}
                  >
                    <ChevronRight
                      aria-hidden="true"
                      className={open ? styles.expanded : undefined}
                    />
                    <Icon aria-hidden="true" />
                    <span className={styles.path} aria-hidden="true">
                      {directory && (
                        <span className={styles.directory}>{directory}</span>
                      )}
                      <span className={styles.filename}>{name}</span>
                    </span>
                    {file.diffUnavailable ? (
                      <span className={styles.unavailable}>
                        Diff unavailable
                      </span>
                    ) : (
                      <span className={styles.counts} aria-hidden="true">
                        <span className={styles.added}>+{file.added}</span>
                        <span className={styles.removed}>−{file.removed}</span>
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    className={styles.copyPath}
                    aria-label={`Copy path ${file.path}`}
                    title="Copy path"
                    onClick={() => void copyPath(file.path)}
                  >
                    <Copy size={14} aria-hidden="true" />
                  </button>
                </div>
                {open && (
                  <div
                    id={panelId}
                    className={styles.detail}
                    role="region"
                    aria-label={`Diff ${file.path}`}
                  >
                    <div className={styles.detailToolbar}>
                      <span>Latest edit</span>
                      <button
                        type="button"
                        onClick={() => onOpen(file.execution)}
                        aria-label={`Open ${file.path} in editor`}
                      >
                        <ExternalLink size={13} aria-hidden="true" /> Open file
                      </button>
                    </div>
                    {file.diffUnavailable || !execution ? (
                      <p className={styles.notice}>
                        The before/after content is unavailable for this edit.
                      </p>
                    ) : (
                      <div className={styles.diff}>
                        <InlineDiff
                          originalContent={execution.originalContent ?? ""}
                          modifiedContent={
                            execution.modifiedContent ?? execution.content ?? ""
                          }
                          language={
                            execution.language ??
                            file.path.split(".").pop() ??
                            "text"
                          }
                        />
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={styles.empty}>
          <FileDiff aria-hidden="true" />
          <h3>No changes yet</h3>
          <p>Files edited in this conversation will appear here.</p>
        </div>
      )}
    </section>
  );
}
