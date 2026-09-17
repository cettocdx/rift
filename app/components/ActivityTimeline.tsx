import React, { useMemo, useRef, useEffect } from "react";
import { Loader2, Check, X, CircleDot } from "lucide-react";
import type { SidebarContent, ChatStatus } from "@/types/chat";
import {
  getActionText,
  getSidebarIcon,
  getDisplayTarget,
} from "./computer-sidebar-utils";
import {
  classifyPhase,
  getActivityStatus,
  PHASE_META,
  PHASE_ORDER,
  type ActivityPhase,
} from "./activity-utils";

interface ActivityTimelineProps {
  /** All tool executions in chronological order */
  toolExecutions: SidebarContent[];
  /** Index of the currently-viewed execution (-1 if none) */
  currentIndex: number;
  /** Jump to a specific execution's detail view */
  onSelect: (content: SidebarContent) => void;
  /** Chat streaming status — used to mark the final step as running */
  status?: ChatStatus;
}

const getToolCallId = (content: SidebarContent): string | undefined =>
  "toolCallId" in content ? content.toolCallId : undefined;

export const ActivityTimeline: React.FC<ActivityTimelineProps> = ({
  toolExecutions,
  currentIndex,
  onSelect,
  status,
}) => {
  const activeRef = useRef<HTMLButtonElement>(null);
  const isStreaming = status === "streaming";

  // Per-phase counts for the summary header
  const phaseCounts = useMemo(() => {
    const counts: Record<ActivityPhase, number> = {
      recon: 0,
      scanning: 0,
      exploitation: 0,
      reporting: 0,
      general: 0,
    };
    toolExecutions.forEach((item) => {
      counts[classifyPhase(item)] += 1;
    });
    return counts;
  }, [toolExecutions]);

  // Auto-scroll the active row into view as the agent works
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex, toolExecutions.length]);

  if (toolExecutions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <div className="text-muted-foreground text-sm">
          No activity yet. Steps will appear here as the agent works.
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Summary header */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/40 px-3 py-2">
        <span className="text-[11px] font-medium text-muted-foreground">
          {toolExecutions.length} step{toolExecutions.length !== 1 ? "s" : ""}
        </span>
        {PHASE_ORDER.filter((p) => phaseCounts[p] > 0).map((phase) => (
          <span
            key={phase}
            className="inline-flex items-center gap-1 rounded-full border border-border/50 bg-muted/30 px-1.5 py-0.5 text-[10px]"
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${PHASE_META[phase].dot}`}
            />
            <span className={PHASE_META[phase].color}>
              {PHASE_META[phase].label}
            </span>
            <span className="text-muted-foreground">{phaseCounts[phase]}</span>
          </span>
        ))}
      </div>

      {/* Timeline list */}
      <div className="flex-1 min-h-0 overflow-y-auto py-1">
        {toolExecutions.map((item, index) => {
          const phase = classifyPhase(item);
          const isLastWhileStreaming =
            isStreaming && index === toolExecutions.length - 1;
          const itemStatus = getActivityStatus(item, isLastWhileStreaming);
          const isActive = index === currentIndex;
          const action = getActionText(item);
          const target = getDisplayTarget(item);
          const meta = PHASE_META[phase];
          const key = getToolCallId(item) || `step-${index}`;

          return (
            <button
              key={key}
              ref={isActive ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(item)}
              className={`group flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors ${
                isActive ? "bg-muted/60" : "hover:bg-muted/30"
              }`}
              aria-current={isActive ? "step" : undefined}
            >
              {/* Phase accent + step number */}
              <div className="flex flex-col items-center pt-0.5">
                <span
                  className={`h-2 w-2 rounded-full ${meta.dot}`}
                  title={meta.label}
                />
                {index < toolExecutions.length - 1 && (
                  <span className="mt-1 w-px flex-1 bg-border/50" />
                )}
              </div>

              {/* Tool icon */}
              <div className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center [&_svg]:h-4 [&_svg]:w-4">
                {getSidebarIcon(item)}
              </div>

              {/* Action + target */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] text-foreground">
                    {action}
                  </span>
                  <span
                    className={`text-[9px] uppercase tracking-wide ${meta.color}`}
                  >
                    {meta.label}
                  </span>
                </div>
                {target && (
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {target}
                  </div>
                )}
              </div>

              {/* Status indicator */}
              <div className="mt-0.5 flex-shrink-0">
                {itemStatus === "running" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                ) : itemStatus === "error" ? (
                  <X className="h-3.5 w-3.5 text-red-400" />
                ) : (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                )}
              </div>
            </button>
          );
        })}

        {/* Live tail indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
            <CircleDot className="h-3 w-3 animate-pulse text-green-500" />
            Agent run in progress
          </div>
        )}
      </div>
    </div>
  );
};
