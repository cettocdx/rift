import { TodoManager } from "@/lib/ai/tools/utils/todo-manager";
import type { Todo } from "@/types/chat";

const todo = (
  id: string,
  status: Todo["status"] = "pending",
  sourceMessageId?: string,
): Todo => ({
  id,
  content: `task ${id}`,
  status,
  ...(sourceMessageId ? { sourceMessageId } : {}),
});

/*
 * A replaced plan must stay replaced.
 *
 * chat.todos is the persisted list, and it is handed to the next run as
 * baseTodos. mergeWith used to seed from it unconditionally, so the purge that
 * `setTodos(merge=false)` performs — the agent throwing out its old plan to
 * write a new one — was undone on the way out. The list therefore only ever
 * grew: a production run was observed carrying 18 items, several stuck
 * "in_progress" from runs that had died hours before, all of it presented back
 * to the agent as its current plan.
 */
describe("TodoManager.mergeWith", () => {
  it("drops the previous run's plan when the agent writes a new one", () => {
    const previousPlan = [
      todo("old-a", "in_progress", "run_1"),
      todo("old-b", "pending", "run_1"),
    ];
    const manager = new TodoManager(previousPlan);

    manager.setTodos([todo("new-a"), todo("new-b")], false);
    const merged = manager.mergeWith(previousPlan, "run_2");

    expect(merged.map((t) => t.id).sort()).toEqual(["new-a", "new-b"]);
  });

  it("does not grow across runs that each replace the plan", () => {
    let persisted: Todo[] = [];
    for (let run = 1; run <= 5; run++) {
      const manager = new TodoManager(persisted);
      manager.setTodos([todo(`r${run}-a`), todo(`r${run}-b`)], false);
      persisted = manager.mergeWith(persisted, `run_${run}`);
    }

    // Before the fix this reached 10 and would have kept climbing.
    expect(persisted).toHaveLength(2);
    expect(persisted.every((t) => t.id.startsWith("r5-"))).toBe(true);
  });

  it("keeps manual todos, which are what base is actually for", () => {
    const base = [todo("manual"), todo("planned", "pending", "run_1")];
    const manager = new TodoManager(base);

    manager.setTodos([todo("fresh")], false);
    const merged = manager.mergeWith(base, "run_2");

    expect(merged.map((t) => t.id).sort()).toEqual(["fresh", "manual"]);
  });

  it("keeps a previous todo the new plan re-declares, with its progress", () => {
    const base = [todo("shared", "completed", "run_1")];
    const manager = new TodoManager(base);

    manager.setTodos([todo("shared", "completed"), todo("extra")], false);
    const merged = manager.mergeWith(base, "run_2");

    expect(merged.map((t) => t.id).sort()).toEqual(["extra", "shared"]);
    expect(merged.find((t) => t.id === "shared")?.status).toBe("completed");
  });

  // merge=true is the agent ticking items off, not replacing the plan, so the
  // persisted list must survive it intact.
  it("leaves the persisted list alone when only updating statuses", () => {
    const base = [
      todo("a", "pending", "run_1"),
      todo("b", "pending", "run_1"),
    ];
    const manager = new TodoManager(base);

    manager.setTodos([{ id: "a", status: "completed" }], true);
    const merged = manager.mergeWith(base, "run_2");

    expect(merged.map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect(merged.find((t) => t.id === "a")?.status).toBe("completed");
  });

  it("tags only the todos this run introduced", () => {
    const base = [todo("kept")];
    const manager = new TodoManager(base);

    manager.setTodos([todo("kept"), todo("added")], false);
    const merged = manager.mergeWith(base, "run_7");

    expect(merged.find((t) => t.id === "added")?.sourceMessageId).toBe("run_7");
    expect(merged.find((t) => t.id === "kept")?.sourceMessageId).toBeUndefined();
  });
});
