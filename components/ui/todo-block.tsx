import React, { useState, useMemo, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight, CircleArrowRight, CircleCheck, ListTodo } from "lucide-react";
import { RollingCount } from "@/components/ui/rolling-count";
import type { TodoBlockProps } from "@/types";
import { useTodoBlockContext } from "@/app/contexts/TodoBlockContext";
import { SharedTodoItem } from "@/components/ui/shared-todo-item";
import { getLiveTodoBlockTodos, getTodoStats } from "@/lib/utils/todo-utils";
import { useGlobalState } from "@/app/contexts/GlobalState";

export const TodoBlock = ({
  todos: snapshotTodos,
  inputTodos,
  blockId,
  messageId,
}: TodoBlockProps) => {
  const { todos: liveTodos } = useGlobalState();
  const todos = useMemo(
    () => getLiveTodoBlockTodos(snapshotTodos, liveTodos, messageId),
    [snapshotTodos, liveTodos, messageId],
  );
  const { autoOpenTodoBlock, toggleTodoBlock, isBlockExpanded } =
    useTodoBlockContext();
  const [showAllTodos, setShowAllTodos] = useState(false);

  // Determine if this block should be expanded based on todo block state
  const isExpanded = isBlockExpanded(messageId, blockId);

  // Auto-open this todo block when it's created (closes previous ones in same message)
  useEffect(() => {
    autoOpenTodoBlock(messageId, blockId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageId, blockId]); // Only depend on messageId and blockId to prevent infinite loops

  const todoData = useMemo(() => {
    const byStatus = {
      completed: todos.filter((t) => t.status === "completed"),
      inProgress: todos.filter((t) => t.status === "in_progress"),
      pending: todos.filter((t) => t.status === "pending"),
      cancelled: todos.filter((t) => t.status === "cancelled"),
    };

    const stats = getTodoStats(todos);

    const currentInProgress = byStatus.inProgress[0];
    const lastCompleted = byStatus.completed[byStatus.completed.length - 1];
    const hasProgress = stats.done > 0;
    const allCompleted = stats.done === stats.total && stats.total > 0;

    return {
      byStatus,
      stats,
      currentInProgress,
      lastCompleted,
      hasProgress,
      allCompleted,
    };
  }, [todos]);

  const headerContent = useMemo(() => {
    const { currentInProgress, stats } = todoData;

    // When collapsed, show current in-progress task if available
    if (!isExpanded && currentInProgress) {
      return {
        text: currentInProgress.content,
        icon: <CircleArrowRight className="text-foreground" />,
        showViewAll: stats.total > 1 && stats.done > 0,
      };
    }

    // When expanded OR no in-progress task: the state glyph carries the
    // progress -- a pie filling as tasks complete (the aicss task-list's
    // header), a filled check once everything is done, the plain checklist
    // before anything starts. The count itself rolls at the right edge.
    const allDone = todoData.allCompleted;
    const running = stats.done > 0 && !allDone;

    return {
      text: "To-dos",
      icon: allDone ? (
        <CircleCheck className="text-[var(--success)]" fill="currentColor" stroke="var(--background)" />
      ) : running ? (
        <span
          className="rift-todo-pie"
          aria-hidden
          style={{ "--todo-pie": `${Math.round((stats.done / Math.max(1, stats.total)) * 100)}%` } as React.CSSProperties}
        />
      ) : (
        <ListTodo className="text-foreground" />
      ),
      showViewAll: stats.total > 1 && stats.done > 0,
    };
  }, [todoData, isExpanded]);

  const handleToggleExpanded = () => {
    // Toggle this todo block (manual toggles persist and don't affect auto-opened one)
    toggleTodoBlock(messageId, blockId);
  };

  const handleToggleViewAll = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    setShowAllTodos((prev) => !prev);
    if (!showAllTodos && !isExpanded) {
      // Promote to manual open if user wants to view all while collapsed
      toggleTodoBlock(messageId, blockId);
    }
  };

  const getVisibleTodos = () => {
    const { hasProgress, stats, currentInProgress } = todoData;

    if (!hasProgress || stats.done === 0) {
      return todos;
    }

    if (showAllTodos) {
      return todos;
    }

    // Show collapsed view: input todos + current in-progress
    const visibleTodos = [];

    // If we have inputTodos, show all of them (these are the todos being updated in this call)
    if (inputTodos && inputTodos.length > 0) {
      const inputTodoIds = new Set(inputTodos.map((t) => t.id));
      const inputTodosFromCurrent = todos.filter((todo) =>
        inputTodoIds.has(todo.id),
      );
      visibleTodos.push(...inputTodosFromCurrent);
    } else {
      // Fallback: show most recent completed/cancelled
      const { lastCompleted, byStatus } = todoData;
      const lastCancelled = byStatus.cancelled[byStatus.cancelled.length - 1];

      let mostRecentAction = null;
      if (lastCompleted && lastCancelled) {
        const completedIndex = todos.findIndex(
          (t) => t.id === lastCompleted.id,
        );
        const cancelledIndex = todos.findIndex(
          (t) => t.id === lastCancelled.id,
        );
        mostRecentAction =
          completedIndex > cancelledIndex ? lastCompleted : lastCancelled;
      } else {
        mostRecentAction = lastCompleted || lastCancelled;
      }

      if (mostRecentAction) {
        visibleTodos.push(mostRecentAction);
      }
    }

    // Always show current in-progress task if not already included
    if (
      currentInProgress &&
      !visibleTodos.some((t) => t.id === currentInProgress.id)
    ) {
      visibleTodos.push(currentInProgress);
    }

    // If no in-progress and no visible todos yet, show next pending
    if (!currentInProgress && visibleTodos.length === 0) {
      const nextPending = todos.find((todo) => todo.status === "pending");
      if (nextPending) {
        visibleTodos.push(nextPending);
      }
    }

    return visibleTodos;
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="flex min-h-[30px] items-center">
        <Button
          variant="ghost"
          onClick={handleToggleExpanded}
          className="flex h-[30px] min-w-0 flex-1 items-center justify-start gap-1.5 rounded-none px-0.5 py-1.5 text-left hover:bg-foreground/[0.035]"
          aria-label={isExpanded ? "Collapse todos" : "Expand todos"}
          aria-expanded={isExpanded}
        >
          <ChevronRight
            className={`size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 motion-reduce:transition-none ${isExpanded ? "rotate-90" : ""}`}
            aria-hidden="true"
          />
          <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/65 [&>svg]:size-3.5">
            {headerContent.icon}
          </span>
          <span className="min-w-0 truncate text-[12px] font-medium text-[var(--cursor-text-secondary)]">
            {headerContent.text}
          </span>
          <span title="Resolved tasks (completed or cancelled)" className="ml-auto shrink-0 pr-1 text-[11px] font-medium text-muted-foreground">
            <RollingCount
              value={`${todoData.stats.done}/${todoData.stats.total}`}
            />
          </span>
        </Button>
        {isExpanded && headerContent.showViewAll ? (
          <button
            type="button"
            onClick={handleToggleViewAll}
            className="h-7 shrink-0 rounded-sm px-2 text-[11px] text-muted-foreground transition-colors hover:bg-foreground/[0.035] hover:text-foreground focus-visible:outline-none"
          >
            {showAllTodos ? "Hide" : "View all"}
          </button>
        ) : null}
      </div>

      {isExpanded && (
        <div className="ml-1.5 space-y-0 border-l border-border/70 pb-1 pl-3 [&>*:last-child]:border-b-0">
          {getVisibleTodos().map((todo) => (
            <SharedTodoItem key={todo.id} todo={todo} />
          ))}
        </div>
      )}
    </div>
  );
};
