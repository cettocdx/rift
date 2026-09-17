import React from "react";
import { Check, Circle, LoaderCircle, Pause, X } from "lucide-react";
import type { Todo } from "@/types";

export type TodoDisplayStatus = Todo["status"] | "paused";

export const STATUS_ICONS = {
  completed: (
    <Check className="size-3 text-[var(--success)]" aria-hidden="true" />
  ),
  in_progress: (
    <LoaderCircle
      className="size-3 text-muted-foreground motion-safe:animate-spin motion-reduce:animate-none"
      aria-hidden="true"
    />
  ),
  paused: <Pause className="size-3 text-muted-foreground" aria-hidden="true" />,
  cancelled: <X className="size-3 text-destructive" aria-hidden="true" />,
  pending: (
    <Circle className="size-2.5 text-muted-foreground/60" aria-hidden="true" />
  ),
} as const;

export const getStatusIcon = (status: TodoDisplayStatus) =>
  STATUS_ICONS[status] || STATUS_ICONS.pending;

export const getTextStyles = (status: TodoDisplayStatus) => {
  if (status === "completed") {
    return "text-muted-foreground";
  }
  if (status === "in_progress") {
    return "text-[var(--cursor-text-secondary)] font-medium";
  }
  return "text-muted-foreground";
};

export const SharedTodoItem = React.memo(
  ({ todo, isPaused = false }: { todo: Todo; isPaused?: boolean }) => {
    const displayStatus: TodoDisplayStatus =
      isPaused && todo.status === "in_progress" ? "paused" : todo.status;
    return (
      <div
        data-testid="todo-item"
        data-status={displayStatus}
        className="flex min-h-7 items-center gap-2 py-1.5"
      >
        <div className="flex size-4 flex-shrink-0 items-center justify-center">
          {getStatusIcon(displayStatus)}
        </div>
        {/* A finished label takes the sweep-strike from the aicss task-list:
            the line DRAWS across rather than appearing, so completion reads
            as an act. Cancelled items get the same line without ceremony --
            for them it always meant what a strike means. */}
        <span
          data-struck={
            displayStatus === "completed" || displayStatus === "cancelled"
              ? "true"
              : "false"
          }
          className={`rift-todo-label min-w-0 text-[12px] leading-4 ${getTextStyles(displayStatus)}`}
        >
          {todo.content}
        </span>
      </div>
    );
  },
);

SharedTodoItem.displayName = "SharedTodoItem";
