import type { ChatMessage, Todo } from "@/types/chat";
import { retainedTodos } from "../retained-todos";

function write(
  id: string,
  todos: unknown[],
  merge = false,
  state = "output-available",
): ChatMessage {
  return {
    id,
    role: "assistant",
    parts: [
      {
        type: "tool-todo_write",
        toolCallId: id,
        state,
        input: { todos, merge },
      },
    ],
  } as ChatMessage;
}

it("restores progress produced offscreen over the stale persisted plan", () => {
  const original: Todo[] = [
    {
      id: "a",
      content: "Read files",
      status: "pending",
      sourceMessageId: "plan",
    },
    { id: "b", content: "Build", status: "pending", sourceMessageId: "plan" },
  ];
  const messages = [
    write("plan", original),
    write(
      "progress",
      [
        { id: "a", status: "completed" },
        { id: "b", status: "in_progress" },
      ],
      true,
    ),
  ];
  expect(retainedTodos(messages, original)).toEqual([
    { ...original[0], status: "completed" },
    { ...original[1], status: "in_progress" },
  ]);
  expect(original[0].status).toBe("pending");
});

it("keeps manual todos while replacing old assistant plans and ignores incomplete input streams", () => {
  const manual: Todo = { id: "manual", content: "My task", status: "pending" };
  const old: Todo = {
    id: "old",
    content: "Old plan",
    status: "pending",
    sourceMessageId: "old-message",
  };
  expect(
    retainedTodos(
      [
        write("new-plan", [
          { id: "new", content: "New plan", status: "in_progress" },
        ]),
        write(
          "unfinished",
          [{ id: "new", status: "completed" }],
          true,
          "input-streaming",
        ),
      ],
      [manual, old],
    ),
  ).toEqual([
    {
      id: "new",
      content: "New plan",
      status: "in_progress",
      sourceMessageId: "new-plan",
    },
    manual,
  ]);
});

it("ignores malformed tool inputs and partial updates for unknown todos", () => {
  expect(
    retainedTodos(
      [
        write(
          "partial",
          [null, {}, { id: "unknown", status: "completed" }],
          true,
        ),
      ],
      [],
    ),
  ).toEqual([]);
});
