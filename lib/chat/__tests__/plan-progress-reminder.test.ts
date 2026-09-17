import { withPlanProgressReminder } from "../plan-progress-reminder";
import type { Todo } from "@/types/chat";

const active: Todo = {
  id: "verify",
  content: "Verify the game",
  status: "in_progress",
  sourceMessageId: "assistant_1",
};

it("keeps incomplete plan truthful and separates task data from instructions", () => {
  const todos = [active];
  const result = withPlanProgressReminder([], todos);
  expect(result).toHaveLength(1);
  expect(result[0].content).toContain('"status":"in_progress"');
  expect(result[0].content).toContain("only when observed results establish");
  expect(todos).toEqual([active]);
});

it("does not revive resolved or manual tasks", () => {
  const messages = [];
  expect(
    withPlanProgressReminder(messages, [
      { ...active, status: "completed" },
      { ...active, status: "cancelled" },
      { ...active, sourceMessageId: undefined },
    ]),
  ).toBe(messages);
});

it("bounds plan prompt cost even for oversized labels and histories", () => {
  const result = withPlanProgressReminder(
    [],
    Array.from({ length: 1000 }, (_, i) => ({
      ...active,
      id: String(i).repeat(1000),
      content: "x".repeat(10000),
    })),
  );
  expect(String(result[0].content).length).toBeLessThan(5500);
  expect(result[0].content).toContain("1000 unfinished");
});

it("refreshes SDK-retained reminders without removing user-authored marker text", () => {
  const registry = new Set<string>();
  const user = {
    role: "user" as const,
    content: "<rift-plan-progress>my actual request</rift-plan-progress>",
  };
  const first = withPlanProgressReminder([user], [active], registry);
  const refreshed = withPlanProgressReminder(
    first,
    [{ ...active, status: "pending" }],
    registry,
  );
  expect(refreshed).toHaveLength(2);
  expect(refreshed[0]).toBe(user);
  expect(refreshed[1].content).toContain('"status":"pending"');
  expect(
    withPlanProgressReminder(
      refreshed,
      [{ ...active, status: "completed" }],
      registry,
    ),
  ).toEqual([user]);
});
