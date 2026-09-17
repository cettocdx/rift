import { tool } from "ai";
import { z } from "zod";
import { posix } from "node:path";
import type { ToolContext } from "@/types";
import { isE2BSandbox } from "./utils/sandbox-types";

const inputSchema = z.object({
  path: z
    .string()
    .min(1)
    .max(4096)
    .describe(
      "Absolute directory path on the selected execution target, or a path relative to the selected cloud project checkout",
    ),
  offset: z.number().int().min(0).optional().default(0),
  limit: z.number().int().min(1).max(200).optional().default(100),
  brief: z.string().describe("Short purpose of this directory read"),
});

/** Read directory metadata through the existing sandbox API; never invoke a shell. */
export function createListFiles(context: ToolContext) {
  return tool({
    description:
      "List a directory on the selected execution target (cloud workspace or connected local runner) without changing files. Read project instructions and source with the file read action. Listings are paginated; use nextOffset to continue or list a returned directory to descend.",
    inputSchema,
    execute: async (input, { abortSignal }) => {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success)
        return { error: "Invalid directory listing arguments." };
      abortSignal?.throwIfAborted();
      const { offset, limit } = parsed.data;
      let { path } = parsed.data;
      try {
        const { sandbox } = await context.sandboxManager.getSandbox();
        if (
          isE2BSandbox(sandbox) &&
          context.projectWorkingDirectory &&
          !posix.isAbsolute(path)
        ) {
          path = posix.resolve(context.projectWorkingDirectory, path);
        }
        abortSignal?.throwIfAborted();
        const all = await sandbox.files.list(path);
        abortSignal?.throwIfAborted();
        const entries = all.slice(offset, offset + limit).map((entry) => ({
          name: entry.name,
          ...("path" in entry && typeof entry.path === "string"
            ? { path: entry.path }
            : {}),
          ...("type" in entry && typeof entry.type === "string"
            ? { type: entry.type }
            : {}),
        }));
        return {
          path,
          entries,
          total: all.length,
          ...(offset + limit < all.length
            ? { nextOffset: offset + limit }
            : {}),
        };
      } catch (error) {
        abortSignal?.throwIfAborted();
        return {
          error:
            error instanceof Error
              ? error.message
              : "Could not list the directory.",
        };
      }
    },
  });
}
