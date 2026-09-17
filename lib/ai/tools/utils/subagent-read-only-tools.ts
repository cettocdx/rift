import { tool, type ToolSet } from "ai";
import { z } from "zod";

const READ_ONLY_TOOL_NAMES = new Set([
  "file",
  "list_files",
  "web_search",
  "open_url",
  "browse_url",
  "desktop_workspace_list_grants",
  "desktop_workspace_list",
  "desktop_workspace_read",
]);

const fileReadInput = z
  .object({
    action: z.literal("read").default("read"),
    path: z.string().min(1),
    brief: z.string().default("Read source for the delegated task"),
    range: z.tuple([z.number().int(), z.number().int()]).optional(),
  })
  .strict();

/** Select from the already gated parent set; never construct privileged tools. */
export function createReadOnlySubagentTools(
  parentTools: ToolSet,
  toolIds?: readonly string[],
): ToolSet {
  const allowed = toolIds ? new Set(toolIds) : undefined;
  const selected: ToolSet = {};
  for (const [name, original] of Object.entries(parentTools)) {
    if (
      !READ_ONLY_TOOL_NAMES.has(name) ||
      (allowed && !allowed.has(name)) ||
      typeof original.execute !== "function"
    )
      continue;
    if (name !== "file") {
      selected[name] = original;
      continue;
    }
    const execute = original.execute;
    selected.file = tool({
      description:
        "Read text source, documentation or logs from the parent's workspace. Only read is available; files cannot be changed. Use line ranges for long files.",
      inputSchema: fileReadInput,
      execute: async (input, options) => {
        // Enforce again for direct calls, not only model schema validation.
        const safeInput = fileReadInput.parse(input);
        return execute.call(original, safeInput, options);
      },
    });
  }
  return selected;
}

/** Stop waiting promptly even when a read adapter cannot cancel its transport. */
export function awaitSubagentRead<T>(
  operation: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) {
    // The operation may already have rejected before this wrapper saw Stop.
    void operation.catch(() => undefined);
    return Promise.reject(signal.reason ?? new Error("Subagent cancelled"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () =>
      reject(signal.reason ?? new Error("Subagent cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}
