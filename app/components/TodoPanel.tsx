"use client";

import { useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ChatStatus } from "@/types";
import { useGlobalState } from "@/app/contexts/GlobalState";
import {
  SharedTodoItem,
  getStatusIcon,
} from "@/components/ui/shared-todo-item";
import { getTodoStats } from "@/lib/utils/todo-utils";

interface TodoPanelProps {
  status?: ChatStatus;
  placement?: "chat" | "sidebar";
}

export const TodoPanel = ({ status, placement = "chat" }: TodoPanelProps) => {
  const {
    todos,
    isTodoPanelExpanded: isExpanded,
    setIsTodoPanelExpanded,
    sidebarOpen,
  } = useGlobalState();

  // Deduplicate todos by id (keep last occurrence, consistent with backend)
  const uniqueTodos = Array.from(
    new Map(todos.map((todo) => [todo.id, todo])).values(),
  );

  const stats = getTodoStats(uniqueTodos);

  // Don't show panel if no todos exist
  const hasTodos = uniqueTodos.length > 0;

  // Show panel only when there are active todos (hide when all are finished)
  const hasActiveTodos = stats.inProgress > 0 || stats.pending > 0;

  // If panel is not visible, ensure global state is reset
  useEffect(() => {
    if (!hasTodos || !hasActiveTodos) {
      setIsTodoPanelExpanded(false);
    }
  }, [hasTodos, hasActiveTodos, setIsTodoPanelExpanded]);

  if (!hasTodos) {
    return null;
  }

  if (!hasActiveTodos) {
    return null;
  }

  if (placement === "chat" && sidebarOpen) {
    return null;
  }

  if (placement === "sidebar" && !sidebarOpen) {
    return null;
  }

  const handleToggleExpand = () => {
    setIsTodoPanelExpanded(!isExpanded);
  };

  // Find the "current" todo: prefer in-progress, otherwise the most recent
  // completed/cancelled action. Pending-only is handled with a count fallback.
  const currentTodoIndex = (() => {
    const inProgressIdx = uniqueTodos.findIndex(
      (t) => t.status === "in_progress",
    );
    if (inProgressIdx !== -1) return inProgressIdx;
    for (let i = uniqueTodos.length - 1; i >= 0; i--) {
      const s = uniqueTodos[i].status;
      if (s === "completed" || s === "cancelled") return i;
    }
    return -1;
  })();

  const currentTodo =
    currentTodoIndex !== -1 ? uniqueTodos[currentTodoIndex] : undefined;

  // When the chat is idle but a todo is still in_progress, the user manually
  // stopped the agent — surface the in_progress todo as paused.
  const isPaused = status === "ready" && stats.inProgress > 0;
  const currentTodoDisplayStatus =
    currentTodo && isPaused && currentTodo.status === "in_progress"
      ? "paused"
      : currentTodo?.status;

  const headerText = isExpanded
    ? "Task progress"
    : currentTodo
      ? currentTodo.content
      : stats.done === 0
        ? `${stats.total} To-dos`
        : `${stats.done} of ${stats.total} To-dos`;

  // Both the transcript and composer show resolved tasks, not the position
  // of the active task (which could read 6/6 before anything was finished).
  const headerCounter = `${stats.done} / ${stats.total}`;

  const panelClassName =
    placement === "sidebar"
      ? "overflow-hidden rounded-lg border border-border bg-input-chat"
      : "mb-1.5 overflow-hidden rounded-lg border border-border bg-input-chat";

  const listMaxHeightClass =
    placement === "sidebar"
      ? "max-h-[min(calc(100vh-360px),400px)]"
      : "max-h-[200px]";

  const panel = (
    <div className={panelClassName}>
      {/* Header */}
      <button
        onClick={handleToggleExpand}
        className="flex min-h-8 w-full cursor-pointer items-center gap-1.5 px-2.5 py-1 text-left transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:bg-muted"
        aria-label={isExpanded ? "Collapse todos" : "Expand todos"}
      >
        {!isExpanded && currentTodo && currentTodoDisplayStatus ? (
          <span className="flex-shrink-0">
            {getStatusIcon(currentTodoDisplayStatus)}
          </span>
        ) : null}
        <h3
          className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-muted-foreground"
          title={headerText}
        >
          {headerText}
        </h3>
        {headerCounter && (
          <span title="Resolved tasks (completed or cancelled)" className="flex-shrink-0 text-[11px] text-muted-foreground">
            {headerCounter}
          </span>
        )}
        {isExpanded ? (
          <ChevronDown className="size-3 flex-shrink-0 text-muted-foreground" />
        ) : (
          <ChevronUp className="size-3 flex-shrink-0 text-muted-foreground" />
        )}
      </button>

      {/* Todo List - Collapsible */}
      {isExpanded && (
        <div
          className={`space-y-1.5 overflow-y-auto border-t border-border px-2.5 py-2 ${listMaxHeightClass}`}
        >
          {uniqueTodos.map((todo) => (
            <SharedTodoItem key={todo.id} todo={todo} isPaused={isPaused} />
          ))}
        </div>
      )}
    </div>
  );

  // In the computer sidebar, anchor the panel to the bottom of a fixed-height
  // placeholder so the expanded list overlays the timeline above it instead of
  // pushing the timeline up.
  if (placement === "sidebar") {
    return (
      <div className="relative z-50 mt-3 min-h-[40px]">
        <div className="absolute bottom-0 left-0 right-0">{panel}</div>
      </div>
    );
  }

  return panel;
};
