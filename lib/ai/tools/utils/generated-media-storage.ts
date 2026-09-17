import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { MAX_GENERATED_FILE_SIZE_BYTES } from "@/lib/constants/s3";
import {
  getConvexClient,
  getConvexServiceKey,
  getConvexUrl,
} from "@/lib/db/convex-client";
import type { FileAccumulator } from "./file-accumulator";

export type GeneratedMediaStorageOrigin = Readonly<{
  client?: ReturnType<typeof getConvexClient>;
  serviceKey: string | undefined;
}>;

/** Capture storage authority before a tool can escape its originating run. */
export function captureGeneratedMediaStorageOrigin(): GeneratedMediaStorageOrigin {
  const serviceKey = getConvexServiceKey();
  let client: ReturnType<typeof getConvexClient> | undefined;
  if (serviceKey) {
    try {
      getConvexUrl();
      client = getConvexClient();
    } catch {
      // Missing scoped configuration remains unavailable even if a later run has it.
    }
  }
  return Object.freeze({ client, serviceKey });
}

export function canPersistGeneratedMedia(
  origin = captureGeneratedMediaStorageOrigin(),
): boolean {
  return Boolean(origin.client && origin.serviceKey);
}

/** @deprecated Use the media-wide capability check. */
export const canPersistGeneratedVideo = canPersistGeneratedMedia;

export async function persistGeneratedMediaBytes(
  args: {
    bytes: Uint8Array;
    mediaType: string;
    name: string;
    userId: string;
    /**
     * Request-scoped attachment registry. Registering here keeps the durable
     * file row and the message linkage in the same success path, so completed
     * generations are not later treated as orphan uploads.
     */
    fileAccumulator?: FileAccumulator;
    /**
     * What this asset was made from. Persisted alongside the file so a generated
     * image or video can be traced, reproduced and attributed rather than being
     * an anonymous blob (spec 24.5).
     */
    generation?: {
      prompt: string;
      model: string;
      surface?: string;
      settings?: unknown;
      costDollars?: number;
      runId?: string;
    };
  },
  origin = captureGeneratedMediaStorageOrigin(),
): Promise<{
  url: string;
  fileId: Id<"files">;
  storageId: Id<"_storage">;
  mediaType: string;
  name: string;
  size: number;
}> {
  if (!canPersistGeneratedMedia(origin)) {
    throw new Error("Generated media storage is not configured");
  }

  const size = args.bytes.byteLength;
  if (size <= 0) throw new Error("Generated media is empty");
  if (size > MAX_GENERATED_FILE_SIZE_BYTES) {
    throw new Error(
      `Generated media exceeds ${MAX_GENERATED_FILE_SIZE_BYTES / (1024 * 1024)} MB`,
    );
  }

  const convex = origin.client!;
  const uploadUrl = await convex.action(
    api.imageStorage.createGeneratedMediaUploadUrl,
    { serviceKey: origin.serviceKey! },
  );

  const uploaded = await fetch(uploadUrl, {
    method: "POST",
    headers: { "Content-Type": args.mediaType },
    body: Buffer.from(args.bytes),
  });
  if (!uploaded.ok) {
    await uploaded.text().catch(() => "");
    throw new Error(`Generated media upload failed (${uploaded.status})`);
  }

  const uploadResult = (await uploaded.json()) as { storageId?: string };
  if (!uploadResult.storageId) {
    throw new Error("Generated media upload returned no storage id");
  }

  const storageId = uploadResult.storageId as Id<"_storage">;
  let saved: { url: string; fileId: Id<"files"> };
  try {
    saved = await convex.action(api.fileActions.saveFile, {
      storageId,
      name: args.name,
      mediaType: args.mediaType,
      size,
      serviceKey: origin.serviceKey!,
      userId: args.userId,
      skipTokenValidation: true,
      mode: "agent-long",
      generation: args.generation,
    });
  } catch (error) {
    // A completed provider job must not leave unreferenced storage behind if
    // metadata validation or ownership finalization fails.
    await convex
      .action(api.imageStorage.deleteGeneratedMedia, {
        serviceKey: origin.serviceKey!,
        storageId,
      })
      .catch(() => undefined);
    throw error;
  }

  const persisted = {
    url: saved.url,
    fileId: saved.fileId,
    storageId,
    mediaType: args.mediaType,
    name: args.name,
    size,
  };

  args.fileAccumulator?.add({
    fileId: persisted.fileId,
    storageId: persisted.storageId,
    name: persisted.name,
    mediaType: persisted.mediaType,
  });

  return persisted;
}
