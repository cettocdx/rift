import type { Todo } from "@/types/chat";

export interface TodoUpdate {
  id: string;
  content?: string;
  status?: "pending" | "in_progress" | "completed" | "cancelled";
}

/**
 * TodoManager handles backend state management for todos during tool execution.
 * It maintains the current state of todos in memory for the duration of the conversation.
 */
export class TodoManager {
  private todos: Todo[] = [];
  private hasCreatedPlanThisRun: boolean = false;

  constructor(initialTodos?: Todo[]) {
    if (initialTodos) {
      this.todos = [...initialTodos];
    }
  }

  /**
   * Get all current todos
   */
  getAllTodos(): Todo[] {
    return [...this.todos];
  }

  /**
   * Add or update todos with merge capability
   */
  setTodos(
    newTodos: (Partial<Todo> & { id: string })[],
    merge: boolean = false,
  ): Todo[] {
    // Deduplicate incoming todos by id (keep last occurrence)
    const uniqueTodos = Array.from(
      new Map(newTodos.map((todo) => [todo.id, todo])).values(),
    );

    if (!merge) {
      // Replace all assistant-sourced todos; preserve manual ones across runs
      this.todos = this.todos.filter((t) => !t.sourceMessageId);
      this.hasCreatedPlanThisRun = true;
    }

    for (const todo of uniqueTodos) {
      // Defensive check - should never happen with proper typing, but provides clear error
      if (!todo.id) {
        throw new Error("Todo must have an id");
      }

      const existingIndex = this.todos.findIndex((t) => t.id === todo.id);

      if (existingIndex >= 0) {
        // Update existing todo, preserve existing content if not provided
        this.todos[existingIndex] = {
          id: todo.id,
          content: todo.content ?? this.todos[existingIndex].content,
          status: todo.status ?? this.todos[existingIndex].status,
          sourceMessageId:
            todo.sourceMessageId ?? this.todos[existingIndex].sourceMessageId,
        };
      } else {
        // Add new todo
        // If it's the first time (not merge) and content is missing, throw error
        if (!merge && !todo.content) {
          throw new Error(`Content is required for new todos.`);
        }

        this.todos.push({
          id: todo.id,
          content: todo.content ?? "",
          status: todo.status ?? "pending",
          sourceMessageId: todo.sourceMessageId,
        });
      }
    }

    return this.getAllTodos();
  }

  /**
   * Get current stats
   */
  getStats() {
    const todos = this.getAllTodos();
    const completed = todos.filter((t) => t.status === "completed").length;
    const cancelled = todos.filter((t) => t.status === "cancelled").length;

    return {
      total: todos.length,
      pending: todos.filter((t) => t.status === "pending").length,
      inProgress: todos.filter((t) => t.status === "in_progress").length,
      completed: completed,
      cancelled: cancelled,
      // Count both completed and cancelled as "done" for progress tracking
      done: completed + cancelled,
    };
  }

  /**
   * Merge base todos (from client/request) with current manager todos (tool-updated)
   * and tag only newly generated/updated todos with the provided assistantMessageId.
   *
   * A replaced plan must STAY replaced. `setTodos(merge=false)` deliberately
   * purges assistant-sourced todos so the agent can throw out its old plan and
   * write a new one — and this method used to seed unconditionally from `base`,
   * which is the persisted chat.todos and still contains everything just
   * purged. The purge was undone on the way out, so chat.todos became a
   * monotonically growing union across every run of the chat: a real run was
   * observed carrying 18 items, several stuck "in_progress" from runs that had
   * died hours earlier, all of it fed back to the agent as its current plan.
   *
   * Manual todos (no sourceMessageId) are still carried across runs untouched —
   * that is the behaviour setTodos already promises by only purging tagged
   * ones, and the reason this cannot simply ignore `base`.
   */
  mergeWith(baseTodos: Todo[] | undefined, assistantMessageId: string): Todo[] {
    const base: Todo[] = Array.isArray(baseTodos) ? baseTodos : [];
    const baseIdSet = new Set(base.map((t) => t.id));
    const liveIdSet = new Set(this.todos.map((t) => t.id));

    const idToTodo: Record<string, Todo> = {};
    for (const t of base) {
      const purgedByNewPlan =
        this.hasCreatedPlanThisRun && !!t.sourceMessageId && !liveIdSet.has(t.id);
      if (purgedByNewPlan) continue;
      idToTodo[t.id] = t;
    }

    for (const t of this.todos) {
      const shouldTag =
        this.hasCreatedPlanThisRun &&
        !t.sourceMessageId &&
        !baseIdSet.has(t.id);
      idToTodo[t.id] = shouldTag
        ? { ...t, sourceMessageId: assistantMessageId }
        : t;
    }

    return Object.values(idToTodo);
  }
}
