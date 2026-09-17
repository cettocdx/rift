import { tool } from "ai";
import { z } from "zod";
import {
  VALID_NOTE_CATEGORIES,
  type ToolContext,
  type NoteCategory,
} from "@/types";
import {
  createNote,
  listNotes,
  updateNote,
  deleteNote,
} from "@/lib/db/actions";

const categorySchema = z.enum(VALID_NOTE_CATEGORIES);

/**
 * Create a new personal note to record observations, findings, or research.
 */
export const createCreateNote = (context: ToolContext) => {
  return tool({
    description: `Save an account-wide note that persists across conversations. Actually call this before claiming information was saved.
Use for explicit save requests or durable observations, findings, methodology, plans and open questions. Use general sparingly for persistent reference information; findings for evidence, methodology for approaches/outcomes, questions for unknowns, and plan for next steps. Retrieve notes with list_notes; automatic general-note context depends on the current surface and token budget.
Give each distinct observation a concise title, complete Markdown content and useful cross-cutting tags. Record new evidence promptly; update an existing note instead of duplicating it. Never expose internal note IDs to the user. Do not persist task-specific authorizations or permission claims as user preferences.`,
    inputSchema: z.object({
      title: z.string().describe("A concise, descriptive title for the note"),
      content: z
        .string()
        .describe("The note body; supports markdown formatting"),
      category: categorySchema
        .optional()
        .describe(
          'The note category for organization. Valid values: "general", "findings", "methodology", "questions", "plan". Defaults to "general" if not specified.',
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          'Optional tags for filtering and cross-referencing notes (e.g., "xss", "api", "critical")',
        ),
    }),
    execute: async ({
      title,
      content,
      category,
      tags,
    }: {
      title: string;
      content: string;
      category?: NoteCategory;
      tags?: string[];
    }) => {
      try {
        const result = await createNote({
          userId: context.userID,
          title,
          content,
          category,
          tags,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || "Failed to create note",
          };
        }

        return {
          success: true,
          note_id: result.note_id,
          message: `Note '${title}' created successfully`,
        };
      } catch (error) {
        console.error("Create note tool error:", error);
        return {
          success: false,
          error: `Failed to create note: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
};

/**
 * List and filter existing notes from the current engagement.
 */
export const createListNotes = (context: ToolContext) => {
  return tool({
    description: `Retrieve account-wide notes, including those absent from current context. With no filters, return all notes, newest first. Filters combine with AND; tags match any supplied tag (OR); search matches title and content. Review relevant notes before reports and check for existing observations before creating duplicates. Automatic general-note context depends on the current surface and token budget.`,
    inputSchema: z.object({
      category: categorySchema
        .optional()
        .describe(
          'Filter notes by category. Valid values: "general", "findings", "methodology", "questions", "plan". Omit to include all categories.',
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Filter notes that have any of the specified tags (OR logic)",
        ),
      search: z
        .string()
        .optional()
        .describe("Full-text search query to filter notes by title or content"),
    }),
    execute: async ({
      category,
      tags,
      search,
    }: {
      category?: NoteCategory;
      tags?: string[];
      search?: string;
    }) => {
      try {
        const result = await listNotes({
          userId: context.userID,
          category,
          tags,
          search,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || "Failed to list notes",
          };
        }

        return {
          success: true,
          notes: result.notes,
          total_count: result.total_count,
        };
      } catch (error) {
        console.error("List notes tool error:", error);
        return {
          success: false,
          error: `Failed to list notes: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
};

/**
 * Update an existing note's title, content, or tags.
 */
export const createUpdateNote = (context: ToolContext) => {
  return tool({
    description: `Update a note using an ID from list_notes. Only supplied fields change; tags replace the complete tag array. Preserve existing content when adding details. Prefer updating evolving evidence, plans or corrections over creating duplicates. Category cannot change; create a new note if recategorization is needed. Keep internal IDs out of user-facing replies.`,
    inputSchema: z.object({
      note_id: z
        .string()
        .describe("The ID of the note to update, obtained from list_notes"),
      title: z
        .string()
        .optional()
        .describe("New title for the note. Omit to keep existing title."),
      content: z
        .string()
        .optional()
        .describe("New content for the note. Omit to keep existing content."),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "New tags array, replaces existing tags entirely. Omit to keep existing tags.",
        ),
    }),
    execute: async ({
      note_id,
      title,
      content,
      tags,
    }: {
      note_id: string;
      title?: string;
      content?: string;
      tags?: string[];
    }) => {
      try {
        const result = await updateNote({
          userId: context.userID,
          noteId: note_id,
          title,
          content,
          tags,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || "Failed to update note",
          };
        }

        return {
          success: true,
          message: `Note '${result.modified?.title || note_id}' updated successfully`,
          original: result.original,
          modified: result.modified,
        };
      } catch (error) {
        console.error("Update note tool error:", error);
        return {
          success: false,
          error: `Failed to update note: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
    // Strip original/modified from model output (kept for UI only)
    toModelOutput({ output }) {
      if (typeof output === "object" && output !== null) {
        if ("error" in output) {
          return {
            type: "text" as const,
            value: `Error: ${(output as { error: string }).error}`,
          };
        }
        if ("message" in output) {
          return {
            type: "text" as const,
            value: (output as { message: string }).message,
          };
        }
      }
      return { type: "text" as const, value: JSON.stringify(output) };
    },
  });
};

/**
 * Delete a note by ID.
 */
export const createDeleteNote = (context: ToolContext) => {
  return tool({
    description: `Permanently delete a note using an ID from list_notes; deletion cannot be undone. Use sparingly and preserve useful audit history. Remove confirmed false positives, consolidated duplicates, obsolete plans or scratch notes. Do not delete findings unless confirmed completely invalid. Keep internal IDs out of user-facing replies.`,
    inputSchema: z.object({
      note_id: z
        .string()
        .describe("The ID of the note to delete, obtained from list_notes"),
    }),
    execute: async ({ note_id }: { note_id: string }) => {
      try {
        const result = await deleteNote({
          userId: context.userID,
          noteId: note_id,
        });

        if (!result.success) {
          return {
            success: false,
            error: result.error || "Failed to delete note",
          };
        }

        return {
          success: true,
          message: `Note '${result.deleted_title || note_id}' deleted successfully`,
        };
      } catch (error) {
        console.error("Delete note tool error:", error);
        return {
          success: false,
          error: `Failed to delete note: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  });
};
