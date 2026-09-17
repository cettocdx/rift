import { query } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Artifacts — every image or video the user has sent or received, gathered
 * retroactively from their messages. Generated media lives in
 * `tool-generate_image` / `tool-generate_video` outputs; uploaded media lives in
 * `file` parts. New file parts intentionally omit expiring URLs, so owned Convex
 * storage records are resolved here when needed.
 */

// Cap how many recent messages we scan so the gallery query stays cheap.
const MAX_MESSAGES_SCANNED = 800;
// Message count alone does not bound a read: tool output can make a single
// message very large. Leave half the transaction budget for file recovery.
const MAX_MESSAGE_BYTES = 8 * 1024 * 1024;
// Keep the recovery path below Convex's transaction read ceiling. Inline URLs
// remain eligible even after this cap, and newest messages win because the
// message query is descending.
const MAX_PERSISTED_FILES_RESOLVED = 800;

function authedUserId(subject: string): string {
  return subject.split("|")[0];
}

type MessagePart = Record<string, unknown>;

function objectPart(value: unknown): MessagePart | null {
  return value && typeof value === "object" ? (value as MessagePart) : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function supportedMediaType(value: unknown): string | null {
  const mediaType = nonEmptyString(value);
  return mediaType?.startsWith("image/") || mediaType?.startsWith("video/")
    ? mediaType
    : null;
}

function partFileId(part: MessagePart): string | null {
  if (part.type === "file") return nonEmptyString(part.fileId);
  if (
    part.type !== "tool-generate_image" &&
    part.type !== "tool-generate_video"
  ) {
    return null;
  }
  return nonEmptyString(objectPart(part.output)?.fileId);
}

function partInlineUrl(part: MessagePart): string | null {
  if (part.type === "file") return nonEmptyString(part.url);
  if (
    part.type !== "tool-generate_image" &&
    part.type !== "tool-generate_video"
  ) {
    return null;
  }
  return nonEmptyString(objectPart(part.output)?.url);
}

export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      url: v.string(),
      mediaType: v.string(),
      kind: v.union(v.literal("generated"), v.literal("uploaded")),
      chat_id: v.string(),
      time: v.number(),
      // What a generated asset was made from. Absent on uploads, which have no
      // lineage to show, and on generations that predate lineage recording.
      generation: v.optional(
        v.object({
          prompt: v.string(),
          model: v.string(),
          cost_dollars: v.optional(v.number()),
          run_id: v.optional(v.string()),
        }),
      ),
    }),
  ),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new ConvexError({
        code: "UNAUTHORIZED",
        message: "Unauthorized: User not authenticated",
      });
    }
    const userId = authedUserId(identity.subject);

    const messagePage = await ctx.db
      .query("messages")
      .withIndex("by_user_id", (q) => q.eq("user_id", userId))
      .order("desc")
      .paginate({
        numItems: MAX_MESSAGES_SCANNED,
        cursor: null,
        maximumBytesRead: MAX_MESSAGE_BYTES,
      });
    const messages = messagePage.page;

    // Generated media normally retains its Convex URL in the tool output. This
    // recovery path covers stopped/legacy messages and modern file parts, which
    // persist only an opaque file ID so expiring URLs are never stored in chat.
    const unresolvedFileIds: string[] = [];
    const unresolvedFileIdSet = new Set<string>();
    for (const message of messages) {
      const parts = Array.isArray(message.parts) ? message.parts : [];
      for (const value of parts) {
        const part = objectPart(value);
        if (!part || partInlineUrl(part)) continue;
        const fileId = partFileId(part);
        if (
          !fileId ||
          unresolvedFileIdSet.has(fileId) ||
          unresolvedFileIds.length >= MAX_PERSISTED_FILES_RESOLVED
        ) {
          continue;
        }
        unresolvedFileIdSet.add(fileId);
        unresolvedFileIds.push(fileId);
      }
    }

    // Legacy file documents can contain inline content. Recover within a
    // separate budget instead of reading hundreds of large documents at once.
    const persistedFiles: Array<Doc<"files"> | null> = [];
    let recoveredBytes = 0;
    for (const fileId of unresolvedFileIds) {
      if (recoveredBytes >= 4 * 1024 * 1024) break;
      const file = await ctx.db.get(fileId as Id<"files">).catch(() => null);
      persistedFiles.push(file);
      if (file)
        recoveredBytes += new TextEncoder().encode(
          JSON.stringify(file),
        ).byteLength;
    }
    const ownedFiles = new Map<string, Doc<"files">>();
    for (let index = 0; index < unresolvedFileIds.length; index++) {
      const file = persistedFiles[index];
      if (file?.user_id === userId) {
        ownedFiles.set(unresolvedFileIds[index], file);
      }
    }

    const persistedUrls = new Map<string, string>();
    await Promise.all(
      Array.from(ownedFiles.entries()).map(async ([fileId, file]) => {
        // S3 links must be signed in an action and are deliberately not exposed
        // from this cached query. Generated media uses Convex storage, whose URL
        // can be recovered without disclosing a bucket key.
        if (!file.storage_id) return;
        const url = await ctx.storage.getUrl(file.storage_id).catch(() => null);
        if (url) persistedUrls.set(fileId, url);
      }),
    );

    const out: Array<{
      url: string;
      mediaType: string;
      kind: "generated" | "uploaded";
      chat_id: string;
      time: number;
      generation?: {
        prompt: string;
        model: string;
        cost_dollars?: number;
        run_id?: string;
      };
    }> = [];
    const artifactIndexByIdentity = new Map<string, number>();
    const addArtifact = (identity: string, artifact: (typeof out)[number]) => {
      const existingIndex = artifactIndexByIdentity.get(identity);
      if (existingIndex === undefined) {
        artifactIndexByIdentity.set(identity, out.length);
        out.push(artifact);
        return;
      }

      // A generated-media tool output is authoritative for classification,
      // even if a companion file part happens to appear first in the message.
      if (
        artifact.kind === "generated" &&
        out[existingIndex].kind === "uploaded"
      ) {
        out[existingIndex] = artifact;
      }
    };

    for (const m of messages) {
      const parts = Array.isArray(m.parts) ? m.parts : [];
      for (const rawPart of parts) {
        const part = objectPart(rawPart);
        if (!part) continue;

        // Generated image or video — tool output.
        if (
          part.type === "tool-generate_image" ||
          part.type === "tool-generate_video"
        ) {
          const output = objectPart(part.output);
          const fileId = partFileId(part);
          const url =
            partInlineUrl(part) ||
            (fileId ? (persistedUrls.get(fileId) ?? null) : null);
          if (url) {
            const dedupeKey = fileId ? `file:${fileId}` : `url:${url}`;
            const persistedMediaType = fileId
              ? supportedMediaType(ownedFiles.get(fileId)?.media_type)
              : null;
            const lineage = fileId
              ? ownedFiles.get(fileId)?.generation
              : undefined;
            addArtifact(dedupeKey, {
              url,
              mediaType:
                supportedMediaType(output?.mediaType) ||
                persistedMediaType ||
                (part.type === "tool-generate_video"
                  ? "video/mp4"
                  : "image/png"),
              kind: "generated",
              chat_id: m.chat_id,
              time: m.update_time,
              generation: lineage
                ? {
                    prompt: lineage.prompt,
                    model: lineage.model,
                    cost_dollars: lineage.cost_dollars,
                    run_id: lineage.run_id,
                  }
                : undefined,
            });
          }
          continue;
        }

        // Uploaded image or video — file part.
        if (part.type === "file") {
          const fileId = partFileId(part);
          const persistedFile = fileId ? ownedFiles.get(fileId) : undefined;
          const mediaType =
            supportedMediaType(part.mediaType) ||
            supportedMediaType(part.mimeType) ||
            supportedMediaType(persistedFile?.media_type);
          const url =
            partInlineUrl(part) ||
            (fileId ? (persistedUrls.get(fileId) ?? null) : null);
          if (url && mediaType) {
            const dedupeKey = fileId ? `file:${fileId}` : `url:${url}`;
            addArtifact(dedupeKey, {
              url,
              mediaType,
              kind: "uploaded",
              chat_id: m.chat_id,
              time: m.update_time,
            });
          }
        }
      }
    }

    return out;
  },
});

/**
 * The lineage of a generated asset: what it was made from.
 *
 * A generated image or video used to be an anonymous file. This returns the
 * prompt, model, settings, cost and source run recorded at generation time, so
 * the asset can be traced, reproduced and attributed (spec 24.5). Returns null
 * for an uploaded file (which has no generation) or one the caller does not own.
 */
export const getFileLineage = query({
  args: { fileId: v.id("files") },
  returns: v.union(
    v.object({
      prompt: v.string(),
      model: v.string(),
      surface: v.optional(v.string()),
      settings: v.optional(v.any()),
      cost_dollars: v.optional(v.number()),
      run_id: v.optional(v.string()),
      created_at: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const userId = identity.subject.split("|")[0];

    const file = await ctx.db.get(args.fileId);
    if (!file || file.user_id !== userId || !file.generation) return null;

    return file.generation;
  },
});
