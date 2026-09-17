"use node";

import { action } from "./_generated/server";
import { v, ConvexError } from "convex/values";
import {
  generateS3UploadUrl,
  generateS3DownloadUrl,
  isS3Configured,
} from "./s3Utils";
import { internal } from "./_generated/api";
import { validateServiceKey } from "./lib/utils";
import { convexLogger } from "./lib/logger";
import { checkFileUploadRateLimit } from "./fileActions";
import { Doc } from "./_generated/dataModel";
import { validateUploadPolicy } from "../lib/utils/upload-policy";

type StorageUsage = {
  usedBytes: number;
  maxBytes: number;
  availableBytes: number;
} | null;

/** File record returned by internal.fileStorage.getFileById */
type FileRecord = Doc<"files"> | null;

const getIdentityEntitlements = (identity: unknown) => {
  if (
    !identity ||
    typeof identity !== "object" ||
    !("entitlements" in identity)
  ) {
    return [];
  }

  const entitlements = identity.entitlements;
  return Array.isArray(entitlements)
    ? entitlements.filter(
        (entitlement: unknown): entitlement is string =>
          typeof entitlement === "string",
      )
    : [];
};

/**
 * Result of an upload-URL request: an S3 presigned PUT target, or a Convex
 * built-in storage POST target when S3 isn't configured. Annotated explicitly
 * so TypeScript doesn't have to infer through the action's own `ctx.runMutation`
 * call (which would create a circular reference in the generated API types).
 */
type UploadTarget = {
  backend: "s3" | "convex";
  uploadUrl: string;
  s3Key?: string;
  rateLimit?: { remaining: number; limit: number; reset: number };
};

/**
 * Generate presigned S3 upload URL for authenticated users
 *
 * This action:
 * - Authenticates the user via ctx.auth
 * - Validates input parameters (fileName, contentType)
 * - Generates a user-scoped S3 key
 * - Returns a presigned upload URL, the S3 key, and rate limit info
 */
export const generateS3UploadUrlAction = action({
  args: {
    serviceKey: v.optional(v.string()),
    userId: v.optional(v.string()),
    entitlements: v.optional(v.array(v.string())),
    fileName: v.string(),
    contentType: v.string(),
    size: v.optional(v.number()),
    mode: v.optional(v.union(v.literal("ask"), v.literal("agent"))),
  },
  returns: v.object({
    // "s3": client PUTs to uploadUrl, then saveFile({ s3Key }).
    // "convex": client POSTs to uploadUrl, gets { storageId }, saveFile({ storageId }).
    backend: v.union(v.literal("s3"), v.literal("convex")),
    uploadUrl: v.string(),
    s3Key: v.optional(v.string()),
    rateLimit: v.optional(
      v.object({
        remaining: v.number(),
        limit: v.number(),
        reset: v.number(),
      }),
    ),
  }),
  handler: async (ctx, args): Promise<UploadTarget> => {
    // Authenticate user
    if (args.serviceKey) validateServiceKey(args.serviceKey);
    const identity =
      args.serviceKey && args.userId
        ? { subject: args.userId, entitlements: args.entitlements ?? [] }
        : await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "Unauthenticated: User must be logged in to upload files",
      );
    }

    // Validate inputs
    if (!args.fileName || args.fileName.trim().length === 0) {
      throw new Error("Invalid fileName: fileName cannot be empty");
    }

    if (!args.contentType || args.contentType.trim().length === 0) {
      throw new Error("Invalid contentType: contentType cannot be empty");
    }

    if (
      args.size === undefined ||
      !Number.isFinite(args.size) ||
      args.size <= 0
    ) {
      throw new ConvexError({
        code: "INVALID_FILE_SIZE",
        message:
          "A positive file size is required before generating an upload URL",
      });
    }

    const validation = validateUploadPolicy({
      mode: args.mode ?? "ask",
      size: args.size,
      mediaType: args.contentType,
      surface: "client",
    });

    if (!validation.valid) {
      throw new ConvexError({
        code: validation.code,
        message: validation.message,
      });
    }

    const userId = identity.subject.split("|")[0];
    const entitlements = getIdentityEntitlements(identity);

    // File uploads are available to every signed-in user (the composer's
    // attach button advertises this — no plan gate). Storage + rate limits
    // below still apply.

    // Check storage limit before allowing upload
    const storageUsage: StorageUsage = await ctx.runQuery(
      internal.fileStorage.getUserStorageUsage,
      { userId },
    );
    if (storageUsage.availableBytes <= 0) {
      const usedGB = (storageUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      throw new ConvexError({
        code: "STORAGE_LIMIT_EXCEEDED",
        message: `Storage limit exceeded. You are using ${usedGB} GB of 10 GB. Please delete some files to upload new ones.`,
      });
    }
    if (args.size !== undefined && storageUsage.availableBytes < args.size) {
      const usedGB = (storageUsage.usedBytes / (1024 * 1024 * 1024)).toFixed(2);
      const requestedMB = (args.size / (1024 * 1024)).toFixed(2);
      throw new ConvexError({
        code: "STORAGE_LIMIT_EXCEEDED",
        message: `Storage limit exceeded. You are using ${usedGB} GB of 10 GB and this file requires ${requestedMB} MB. Please delete some files to upload new ones.`,
      });
    }

    // Check rate limit and consume a token
    // This prevents abuse by spamming URL generation
    const rateLimitResult = await checkFileUploadRateLimit(userId, true, {
      entitlements,
    });

    const rateLimit = rateLimitResult
      ? {
          remaining: rateLimitResult.remaining,
          limit: rateLimitResult.limit,
          reset: rateLimitResult.reset,
        }
      : undefined;

    try {
      // When S3 isn't configured, fall back to Convex's built-in file storage
      // so uploads work out of the box with no external setup.
      if (!isS3Configured()) {
        const uploadUrl: string = await ctx.runMutation(
          internal.fileStorage.generateConvexUploadUrl,
          {},
        );
        return { backend: "convex", uploadUrl, rateLimit };
      }

      // Generate presigned upload URL with user-scoped S3 key
      const { uploadUrl, s3Key } = await generateS3UploadUrl(
        args.fileName,
        args.contentType,
        userId,
        args.size,
      );

      await ctx.runMutation(internal.fileStorage.createPendingS3File, {
        s3Key,
        userId,
        name: args.fileName,
        mediaType: args.contentType,
        size: args.size,
      });

      return { backend: "s3", uploadUrl, s3Key, rateLimit };
    } catch (error) {
      if (error instanceof ConvexError) {
        throw error;
      }
      convexLogger.error("file_upload_url_generation_failed", {
        userId,
        fileName: args.fileName,
        contentType: args.contentType,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw new Error(
        "Failed to generate upload URL: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    }
  },
});

/**
 * Generate download URL for a file (S3 presigned or Convex storage URL)
 *
 * This action:
 * - Authenticates the user via ctx.auth
 * - Fetches the file record from database
 * - Verifies user has access to the file (ownership check)
 * - Generates appropriate URL based on storage type:
 *   - S3: Returns presigned URL (valid for 1 hour)
 *   - Convex: Returns Convex storage URL
 * - Enforces storage invariant (exactly one storage reference)
 */
export const getFileUrlAction = action({
  args: {
    fileId: v.id("files"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // Authenticate user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "Unauthenticated: User must be logged in to access files",
      );
    }

    try {
      // Get file record using internal query
      const file: FileRecord = await ctx.runQuery(
        internal.fileStorage.getFileById,
        {
          fileId: args.fileId,
        },
      );

      if (!file) {
        throw new Error("File not found");
      }

      // Verify user has access to this file
      if (file.user_id !== identity.subject.split("|")[0]) {
        throw new Error(
          "Access denied: You do not have permission to access this file",
        );
      }

      // Enforce storage invariant: exactly one storage reference
      const hasS3Key = !!file.s3_key;
      const hasStorageId = !!file.storage_id;

      if (!hasS3Key && !hasStorageId) {
        throw new Error("File has no storage reference");
      }

      if (hasS3Key && hasStorageId) {
        throw new Error(
          "File has both S3 and Convex storage references (invalid state)",
        );
      }

      // Generate appropriate URL based on storage type
      if (file.s3_key) {
        // S3 file: Generate presigned download URL (valid for 1 hour)
        return await generateS3DownloadUrl(file.s3_key);
      } else {
        // Convex file: Get Convex storage URL
        const url = await ctx.storage.getUrl(file.storage_id!);
        if (!url) {
          throw new Error("Failed to generate Convex storage URL");
        }
        return url;
      }
    } catch (error) {
      convexLogger.error("file_get_url_failed", {
        userId: identity.subject.split("|")[0],
        fileId: args.fileId,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      throw new Error(
        "Failed to get file URL: " +
          (error instanceof Error ? error.message : "Unknown error"),
      );
    }
  },
});

/**
 * Backend batch URL generation for service key (server-side processing)
 *
 * This action:
 * - Authenticates via service key (for backend use)
 * - Accepts array of file IDs (max 50 files)
 * - Generates URLs for both S3 and Convex storage files
 * - Returns array of URLs (matching order of fileIds, null for missing files)
 * - Handles partial failures gracefully
 */
export const getFileUrlsByFileIdsAction = action({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    fileIds: v.array(v.id("files")),
  },
  returns: v.array(v.union(v.string(), v.null())),
  handler: async (ctx, args): Promise<Array<string | null>> => {
    // Verify service role key
    validateServiceKey(args.serviceKey);

    // Enforce batch size limit
    const MAX_BATCH_SIZE = 50;
    if (args.fileIds.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size exceeds limit: Maximum ${MAX_BATCH_SIZE} files allowed per request (requested: ${args.fileIds.length})`,
      );
    }

    // Get file records and generate URLs
    const urls: Array<string | null> = await Promise.all(
      args.fileIds.map(async (fileId): Promise<string | null> => {
        try {
          // Get file record using internal query
          const file: FileRecord = await ctx.runQuery(
            internal.fileStorage.getFileById,
            { fileId },
          );

          // Return null if file not found
          if (!file || file.user_id !== args.userId) {
            return null;
          }

          if (file.user_id !== args.userId) {
            convexLogger.warn("file_batch_url_access_denied", {
              fileId,
              caller: "service",
              userId: args.userId,
            });
            return null;
          }

          // Generate URL based on storage type
          if (file.s3_key) {
            // S3 file: Generate presigned download URL
            return await generateS3DownloadUrl(file.s3_key);
          } else if (file.storage_id) {
            // Convex file: Get Convex storage URL
            return await ctx.storage.getUrl(file.storage_id);
          }

          return null;
        } catch (error) {
          convexLogger.error("file_batch_url_generation_failed", {
            fileId,
            caller: "service",
            error:
              error instanceof Error
                ? { name: error.name, message: error.message }
                : String(error),
          });
          return null;
        }
      }),
    );

    return urls;
  },
});

/**
 * Batch URL generation for multiple files
 *
 * This action:
 * - Authenticates the user via ctx.auth
 * - Accepts array of file IDs (max 50 files)
 * - Fetches file records using internal query
 * - Applies access control per file (skips files user doesn't own)
 * - Generates URLs for accessible files only (S3 presigned or Convex storage)
 * - Processes S3 URLs in parallel for better performance
 * - Returns map of fileId -> url (only includes accessible files)
 * - Handles partial failures gracefully (skips failed files)
 */
export const getFileUrlsBatchAction = action({
  args: {
    fileIds: v.array(v.id("files")),
  },
  returns: v.record(v.string(), v.string()),
  handler: async (ctx, args): Promise<Record<string, string>> => {
    // Authenticate user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error(
        "Unauthenticated: User must be logged in to access files",
      );
    }

    // Enforce batch size limit
    const MAX_BATCH_SIZE = 50;
    if (args.fileIds.length > MAX_BATCH_SIZE) {
      throw new Error(
        `Batch size exceeds limit: Maximum ${MAX_BATCH_SIZE} files allowed per request (requested: ${args.fileIds.length})`,
      );
    }

    const urlMap: Record<string, string> = {};

    // Process each file - access control per file
    for (const fileId of args.fileIds) {
      try {
        // Get file record using internal query
        const file: FileRecord = await ctx.runQuery(
          internal.fileStorage.getFileById,
          {
            fileId,
          },
        );

        // Skip if file not found
        if (!file) {
          continue;
        }

        // Skip if user doesn't own this file (access control)
        if (file.user_id !== identity.subject.split("|")[0]) {
          continue;
        }

        // Enforce storage invariant
        const hasS3Key = !!file.s3_key;
        const hasStorageId = !!file.storage_id;

        // Skip if no storage reference
        if (!hasS3Key && !hasStorageId) {
          continue;
        }

        // Skip if both storage references (invalid state)
        if (hasS3Key && hasStorageId) {
          continue;
        }

        // Generate URL based on storage type
        if (file.s3_key) {
          // S3 file: Generate presigned download URL
          const url = await generateS3DownloadUrl(file.s3_key);
          urlMap[fileId] = url;
        } else if (file.storage_id) {
          // Convex file: Get Convex storage URL
          const url = await ctx.storage.getUrl(file.storage_id);
          if (url) {
            urlMap[fileId] = url;
          }
        }
      } catch (error) {
        // Log error but continue processing other files (partial failure handling)
        convexLogger.error("file_batch_url_generation_failed", {
          userId: identity.subject.split("|")[0],
          fileId,
          caller: "user",
          error:
            error instanceof Error
              ? { name: error.name, message: error.message }
              : String(error),
        });
        continue;
      }
    }

    return urlMap;
  },
});

/**
 * Upload URL for a file the agent produced inside a sandbox.
 *
 * The sandbox uploader used to call the raw `generateS3UploadUrl` helper
 * directly, which throws when AWS credentials are absent. That bypassed the
 * fallback every other upload path gets, so `file` view previews and generated
 * artifacts failed outright on a deployment with no S3 configured -- even
 * though the product is designed to work without one.
 *
 * This is the service-key twin of `generateS3UploadUrlAction`: same choice of
 * backend, no user identity, because the caller is the agent runtime rather
 * than a signed-in browser.
 */
export const generateSandboxUploadUrlAction = action({
  args: {
    serviceKey: v.string(),
    userId: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    size: v.number(),
  },
  returns: v.union(
    v.object({
      backend: v.literal("s3"),
      uploadUrl: v.string(),
      s3Key: v.string(),
    }),
    v.object({
      backend: v.literal("convex"),
      uploadUrl: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    validateServiceKey(args.serviceKey);

    if (!isS3Configured()) {
      const uploadUrl: string = await ctx.runMutation(
        internal.fileStorage.generateConvexUploadUrl,
        {},
      );
      return { backend: "convex" as const, uploadUrl };
    }

    const { uploadUrl, s3Key } = await generateS3UploadUrl(
      args.fileName,
      args.contentType,
      args.userId,
      args.size,
    );

    await ctx.runMutation(internal.fileStorage.createPendingS3File, {
      s3Key,
      userId: args.userId,
      name: args.fileName,
      mediaType: args.contentType,
      size: args.size,
    });

    return { backend: "s3" as const, uploadUrl, s3Key };
  },
});
