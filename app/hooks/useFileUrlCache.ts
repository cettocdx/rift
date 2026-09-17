import { useEffect, useMemo, useCallback } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { isSupportedImageMediaType } from "@/lib/utils/file-utils";
import type { ChatMessage } from "@/types";

interface CachedUrl {
  url: string;
  timestamp: number;
}

const URL_CACHE_EXPIRATION = 50 * 60 * 1000; // 50 minutes (S3 URLs expire in 1 hour)
const MAX_BATCH_SIZE = 50; // Must match server-side limit in convex/s3Actions.ts

/**
 * Hook to manage prefetching and caching of file URLs
 *
 * Features:
 * - Batch prefetches URLs for all S3 image files in messages (images need eager loading)
 * - Caches URLs with expiration handling (50 min, before 1 hour S3 expiry)
 * - Provides methods to get and set cached URLs (for lazy-loaded non-image files)
 * - Automatically cleans up expired URLs
 */
export function useFileUrlCache(messages: ChatMessage[]) {
  const getFileUrlsBatchAction = useAction(
    api.s3Actions.getFileUrlsBatchAction,
  );
  const cache = useMemo(
    () => ({
      batchAction: getFileUrlsBatchAction,
      urls: new Map<string, CachedUrl>(),
      prefetchedIds: new Set<string>(),
      pendingIds: new Map<string, symbol>(),
      active: false,
    }),
    [getFileUrlsBatchAction],
  );

  // This lifetime follows the action/client, not streaming message objects.
  // Clear ownership on teardown so late batches cannot affect a new lifetime.
  useEffect(() => {
    cache.active = true;
    return () => {
      cache.active = false;
      cache.pendingIds.clear();
      cache.urls.clear();
      cache.prefetchedIds.clear();
    };
  }, [cache]);

  // Get cached URL for a file (returns null if expired or not cached)
  const getCachedUrl = useCallback(
    (fileId: string): string | null => {
      const cached = cache.urls.get(fileId);
      if (!cached) return null;

      // Check if URL has expired
      const now = Date.now();
      if (now - cached.timestamp > URL_CACHE_EXPIRATION) {
        cache.urls.delete(fileId);
        cache.prefetchedIds.delete(fileId);
        return null;
      }

      return cached.url;
    },
    [cache],
  );

  // Set/update cached URL for a file (used for lazy-loaded non-image files)
  const setCachedUrl = useCallback(
    (fileId: string, url: string) => {
      if (!cache.active) return;
      // Explicit resolutions supersede a batch that started earlier.
      cache.pendingIds.delete(fileId);
      const now = Date.now();
      cache.urls.set(fileId, { url, timestamp: now });
      cache.prefetchedIds.add(fileId);
    },
    [cache],
  );

  // Prefetch image URLs for messages
  useEffect(() => {
    async function prefetchImageUrls() {
      // Track seen fileIds within this run to avoid duplicates
      const seenInThisRun = new Set<string>();
      const s3ImageFiles: Array<{
        fileId: Id<"files">;
        mediaType: string;
      }> = [];

      for (const message of messages) {
        if (!message.fileDetails) continue;

        for (const file of message.fileDetails) {
          // Only process files that:
          // 1. Have an S3 key (not Convex storage)
          // 2. Are supported image types
          // 3. Haven't been seen in this run
          if (
            file.s3Key &&
            file.mediaType &&
            isSupportedImageMediaType(file.mediaType) &&
            !seenInThisRun.has(file.fileId)
          ) {
            s3ImageFiles.push({
              fileId: file.fileId,
              mediaType: file.mediaType,
            });
            seenInThisRun.add(file.fileId);
          }
        }
      }

      // Also collect image files from message parts
      for (const message of messages) {
        for (const part of message.parts) {
          if (
            part.type === "file" &&
            "fileId" in part &&
            "s3Key" in part &&
            part.s3Key &&
            part.mediaType &&
            isSupportedImageMediaType(part.mediaType) &&
            typeof part.fileId === "string" &&
            !seenInThisRun.has(part.fileId)
          ) {
            s3ImageFiles.push({
              fileId: part.fileId as Id<"files">,
              mediaType: part.mediaType,
            });
            seenInThisRun.add(part.fileId);
          }
        }
      }

      // Removing an image retires only its request; text deltas retain every
      // still-relevant ticket. A later re-add may immediately start a new one.
      for (const id of cache.pendingIds.keys()) {
        if (!seenInThisRun.has(id)) cache.pendingIds.delete(id);
      }
      const fileIds = s3ImageFiles
        .map((file) => file.fileId)
        .filter(
          (id) => !cache.prefetchedIds.has(id) && !cache.pendingIds.has(id),
        );
      if (fileIds.length === 0) return;

      // Reserve IDs before awaiting. Every completion checks its exact ticket,
      // including finally, so an old batch cannot release a replacement.
      const ticket = Symbol("file URL batch");
      fileIds.forEach((id) => cache.pendingIds.set(id, ticket));
      const ownsRequest = (id: string) =>
        cache.active && cache.pendingIds.get(id) === ticket;
      const chunks: Array<Array<Id<"files">>> = [];
      for (let i = 0; i < fileIds.length; i += MAX_BATCH_SIZE) {
        chunks.push(fileIds.slice(i, i + MAX_BATCH_SIZE));
      }
      await Promise.all(
        chunks.map(async (chunk) => {
          try {
            const urlMap = await cache.batchAction({ fileIds: chunk });
            const now = Date.now();
            if (urlMap && typeof urlMap === "object") {
              for (const [fileId, url] of Object.entries(urlMap) as Array<
                [string, string]
              >) {
                if (
                  !chunk.includes(fileId as Id<"files">) ||
                  !ownsRequest(fileId)
                )
                  continue;
                cache.urls.set(fileId, { url, timestamp: now });
                cache.prefetchedIds.add(fileId);
              }
            }
          } catch (error) {
            if (chunk.some(ownsRequest)) {
              console.error("Failed to prefetch image URLs:", error);
            }
          } finally {
            // Failed/omitted IDs remain eligible on a later message update.
            chunk.forEach((id) => {
              if (ownsRequest(id)) cache.pendingIds.delete(id);
            });
          }
        }),
      );
    }

    prefetchImageUrls();
  }, [messages, cache]);

  // Cleanup expired URLs periodically
  useEffect(() => {
    const cleanupInterval = setInterval(
      () => {
        const now = Date.now();
        const entriesToDelete: string[] = [];

        for (const [fileId, cached] of cache.urls.entries()) {
          if (now - cached.timestamp > URL_CACHE_EXPIRATION) {
            entriesToDelete.push(fileId);
          }
        }

        for (const fileId of entriesToDelete) {
          cache.urls.delete(fileId);
          cache.prefetchedIds.delete(fileId);
        }
      },
      5 * 60 * 1000,
    ); // Clean up every 5 minutes

    return () => clearInterval(cleanupInterval);
  }, [cache]);

  return { getCachedUrl, setCachedUrl };
}
