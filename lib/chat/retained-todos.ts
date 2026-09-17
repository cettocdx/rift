import type { ChatMessage, Todo } from "@/types/chat";
import {
  computeReplaceAssistantTodos,
  mergeTodos,
  shouldTreatAsMerge,
  type TodoLike,
} from "@/lib/utils/todo-utils";

/** Rebuild plan progress from the retained stream, including offscreen tool calls. */
export function retainedTodos(
  messages: readonly ChatMessage[],
  fallback: Todo[],
): Todo[] {
  let todos = fallback;
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (
        part.type !== "tool-todo_write" &&
        !(part.type === "dynamic-tool" && part.toolName === "todo_write")
      )
        continue;
      if (
        part.state === "input-streaming" ||
        !part.input ||
        typeof part.input !== "object"
      )
        continue;
      const input = part.input as { merge?: boolean; todos?: TodoLike[] };
      if (!Array.isArray(input.todos)) continue;
      const valid = input.todos.filter(
        (todo) => todo && typeof todo.id === "string",
      );
      todos = shouldTreatAsMerge(input.merge, valid)
        ? mergeTodos(todos, valid)
        : computeReplaceAssistantTodos(todos, valid as Todo[], message.id);
    }
  }
  return Array.from(new Map(todos.map((todo) => [todo.id, todo])).values());
}
