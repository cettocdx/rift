"use client";
import { useMemo, useRef, useState } from "react";
import { ChevronDown, FileDiff } from "lucide-react";
import { useGlobalState } from "@/app/contexts/GlobalState";
import { getPerFileDiffStats } from "./agent-activity";
import type { SidebarContent } from "@/types/chat";
import { useIsMobile } from "@/hooks/use-mobile";
import { openWorkbench } from "@/lib/workbench/events";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import { WorkbenchConversationChanges } from "./workbench/WorkbenchConversationChanges";

export function FilesChangedCard({
  toolExecutions,
}: {
  toolExecutions: readonly SidebarContent[];
}) {
  const { openSidebar } = useGlobalState();
  const [expanded, setExpanded] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const isMobile = useIsMobile();
  const reviewButton = useRef<HTMLButtonElement>(null);
  const openingFile = useRef(false);
  const stats = useMemo(
    () =>
      getPerFileDiffStats(
        toolExecutions.filter(
          (item) => !("isExecuting" in item && item.isExecuting),
        ),
      ),
    [toolExecutions],
  );
  if (!stats.length) return null;
  const hasUnknownDiff = stats.some((file) => file.diffUnavailable);
  const total = stats.reduce(
    (acc, file) => ({
      added: acc.added + file.added,
      removed: acc.removed + file.removed,
    }),
    { added: 0, removed: 0 },
  );
  return (
    <section
      data-testid="files-changed-card"
      aria-label="Edited files"
      className="not-prose my-4 overflow-hidden rounded-xl border border-border text-[13px]"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="flex size-9 items-center justify-center rounded-lg bg-muted/60">
          <FileDiff
            aria-hidden
            className="size-[18px] text-muted-foreground"
            strokeWidth={1.6}
          />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">
            Edited {stats.length} {stats.length === 1 ? "file" : "files"}
          </div>
          {!hasUnknownDiff && (
            <div
              aria-label="Total changed lines"
              className="mt-0.5 flex gap-1.5 text-xs tabular-nums"
            >
              <span className="text-[var(--success)]">+{total.added}</span>
              <span className="text-destructive">−{total.removed}</span>
            </div>
          )}
        </div>
        <button
          ref={reviewButton}
          type="button"
          onClick={() => {
            openingFile.current = false;
            if (isMobile === false) openWorkbench({ kind: "review" });
            else setReviewOpen(true);
          }}
          className="rounded-md border px-3 py-1.5 transition-colors hover:bg-muted"
        >
          Review
        </button>
      </div>
      <ul className="border-t py-1">
        {(expanded ? stats : stats.slice(0, 3)).map((stat) => (
          <li key={stat.path}>
            <button
              type="button"
              title={stat.path}
              onClick={() => openSidebar(stat.execution)}
              className="flex w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted/60"
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {stat.path.replace(/^\/root\/(?:project\/)?/, "")}
              </span>
              {stat.diffUnavailable ? (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Diff unavailable
                </span>
              ) : (
                <span className="flex shrink-0 gap-1.5 text-xs tabular-nums">
                  <span className="text-[var(--success)]">+{stat.added}</span>
                  <span className="text-destructive">−{stat.removed}</span>
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {stats.length > 3 && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-4 pb-3 pt-1 text-left hover:text-muted-foreground"
        >
          {expanded
            ? "Show fewer files"
            : `Show ${stats.length - 3} more ${stats.length === 4 ? "file" : "files"}`}
          <ChevronDown
            aria-hidden
            className={`size-3.5 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
      )}
      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (!openingFile.current) reviewButton.current?.focus();
          }}
          showCloseButton={false}
          aria-describedby={undefined}
          className="flex h-[min(80dvh,640px)] min-h-0 flex-col overflow-hidden p-0"
        >
          <div className="flex shrink-0 items-center justify-between border-b px-3">
            <DialogTitle className="text-sm">Changes</DialogTitle>
            <DialogClose className="min-h-11 min-w-11 rounded-md px-2 text-sm hover:bg-muted">
              Done
            </DialogClose>
          </div>
          <div className="min-h-0 flex-1">
            <WorkbenchConversationChanges
              changes={stats}
              scopeLabel="This response"
              onOpen={(content) => {
                openingFile.current = true;
                setReviewOpen(false);
                openSidebar(content);
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
