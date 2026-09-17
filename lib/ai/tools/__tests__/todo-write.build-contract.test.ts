import { createTodoWrite } from "../todo-write";
import type { ToolContext } from "@/types";
import { TodoManager } from "../utils/todo-manager";
import { z } from "zod";

function contextFor(purpose: ToolContext["purpose"]): ToolContext {
  return {
    purpose,
    assistantMessageId: "assistant-1",
    todoManager: {
      setTodos: jest.fn(() => []),
      getStats: jest.fn(() => ({ done: 0, total: 0 })),
    },
  } as unknown as ToolContext;
}

describe("todo_write Build presentation contract", () => {
  it("accepts the real status-only merge payload and preserves task labels", async () => {
    const todoManager = new TodoManager([
      {
        id: "check_deps",
        content: "Check dependencies",
        status: "in_progress",
      },
    ]);
    const t = createTodoWrite({ ...contextFor("app"), todoManager });
    const payload = (t.inputSchema as z.ZodType).parse({
      merge: true,
      todos: [{ id: "check_deps", status: "completed" }],
    });
    await t.execute!(payload as never, {} as never);
    expect(todoManager.getAllTodos()).toEqual([
      { id: "check_deps", content: "Check dependencies", status: "completed" },
    ]);
  });
  it.each([false, true])(
    "rejects a new task without content atomically (merge=%s)",
    async (merge) => {
      const todoManager = new TodoManager([
        { id: "original", content: "Keep original", status: "pending" },
      ]);
      const t = createTodoWrite({ ...contextFor("app"), todoManager });
      const result = await t.execute!(
        { merge, todos: [{ id: "new", status: "pending" }] } as never,
        {} as never,
      );
      expect(result).toEqual({
        error: expect.stringContaining("missing required content"),
      });
      expect(todoManager.getAllTodos()).toEqual([
        { id: "original", content: "Keep original", status: "pending" },
      ]);
    },
  );
  it("requires observable named progress instead of private reasoning", () => {
    const buildTool = createTodoWrite(contextFor("app"));

    expect(buildTool.description).toContain("observable execution plan");
    expect(buildTool.description).toContain("roughly 2-7 words");
    expect(buildTool.description).toContain(
      "Keep exactly one item in_progress",
    );
    expect(buildTool.description).toContain("private chain-of-thought");
    expect(buildTool.description).toContain("final type/test/build");
  });

  it("preserves the security-specific task contract outside Build", () => {
    const securityTool = createTodoWrite(contextFor("security"));

    expect(securityTool.description).toContain("penetration testing session");
    expect(securityTool.description).not.toContain(
      "observable execution plan for a complex Build request",
    );
  });
});
