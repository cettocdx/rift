import {
  TaskGoalStore,
  createBrowserLocalStorageAdapter,
  type TaskGoal,
} from "./goal-store";

const GOAL_CHANGED_EVENT = "rift:task-goal-changed";

export type ActiveGoalRequestContext = Readonly<{
  objective: string;
  status: "active";
}>;

export const browserTaskGoalStore = new TaskGoalStore(
  createBrowserLocalStorageAdapter(),
);

export function readTaskGoal(taskId: string): TaskGoal | null {
  const result = browserTaskGoalStore.view(taskId);
  return result.ok ? result.goal : null;
}

export function readActiveGoalRequestContext(
  taskId: string,
): ActiveGoalRequestContext | undefined {
  const goal = readTaskGoal(taskId);
  if (!goal || goal.status !== "active") return undefined;
  return { objective: goal.objective, status: "active" };
}

export function notifyTaskGoalChanged(taskId: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(GOAL_CHANGED_EVENT, { detail: { taskId } }),
  );
}

export function onTaskGoalChanged(
  callback: (taskId: string) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handleGoalChange = (event: Event) => {
    const taskId = (event as CustomEvent<{ taskId?: unknown }>).detail?.taskId;
    if (typeof taskId === "string" && taskId.trim()) callback(taskId);
  };

  window.addEventListener(GOAL_CHANGED_EVENT, handleGoalChange);
  return () => window.removeEventListener(GOAL_CHANGED_EVENT, handleGoalChange);
}
