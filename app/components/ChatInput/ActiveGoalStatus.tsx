"use client";

import { useCallback, useEffect, useState } from "react";
import { Flag, Pause, Play, X } from "lucide-react";
import {
  browserTaskGoalStore,
  notifyTaskGoalChanged,
  onTaskGoalChanged,
  readTaskGoal,
} from "@/lib/composer/browser-goal-store";
import { getGoalStorageKey, type TaskGoal } from "@/lib/composer/goal-store";

export function ActiveGoalStatus({ taskId }: { taskId: string }) {
  const [goal, setGoal] = useState<TaskGoal | null>(() => readTaskGoal(taskId));

  const refresh = useCallback(() => setGoal(readTaskGoal(taskId)), [taskId]);

  useEffect(() => {
    const unsubscribe = onTaskGoalChanged((changedTaskId) => {
      if (changedTaskId === taskId) refresh();
    });
    const storageKey = getGoalStorageKey(taskId);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === storageKey) refresh();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", handleStorage);
    };
  }, [refresh, taskId]);

  if (!goal) return null;

  const updateStatus = () => {
    const result =
      goal.status === "active"
        ? browserTaskGoalStore.pause(taskId)
        : browserTaskGoalStore.resume(taskId);
    if (result.ok) notifyTaskGoalChanged(taskId);
  };

  const clearGoal = () => {
    const result = browserTaskGoalStore.clear(taskId);
    if (result.ok) notifyTaskGoalChanged(taskId);
  };

  return (
    <div
      aria-live="polite"
      className="mx-3 flex shrink-0 min-w-0 items-center gap-1.5 border-b border-border py-1.5 text-ui-caption"
      data-testid="active-goal-status"
    >
      <Flag
        aria-hidden
        className={
          goal.status === "active"
            ? "size-3.5 shrink-0 text-foreground/75"
            : "size-3.5 shrink-0 text-muted-foreground"
        }
        strokeWidth={1.7}
      />
      <span className="shrink-0 font-medium text-foreground">Goal</span>
      <span
        className="min-w-0 flex-1 truncate text-muted-foreground"
        title={goal.objective}
      >
        {goal.objective}
      </span>
      {goal.status === "paused" ? (
        <span className="shrink-0 rounded-[4px] border border-border bg-muted px-1.5 py-0.5 text-[9.5px] font-medium text-muted-foreground">
          Paused
        </span>
      ) : null}
      <button
        type="button"
        onClick={updateStatus}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground active:bg-accent motion-reduce:transition-none"
        aria-label={goal.status === "active" ? "Pause goal" : "Resume goal"}
        title={goal.status === "active" ? "Pause goal" : "Resume goal"}
      >
        {goal.status === "active" ? (
          <Pause aria-hidden className="size-3" strokeWidth={1.8} />
        ) : (
          <Play aria-hidden className="size-3" strokeWidth={1.8} />
        )}
      </button>
      <button
        type="button"
        onClick={clearGoal}
        className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-[6px] text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground active:bg-accent motion-reduce:transition-none"
        aria-label="Clear goal"
        title="Clear goal"
      >
        <X aria-hidden className="size-3" strokeWidth={1.8} />
      </button>
    </div>
  );
}
