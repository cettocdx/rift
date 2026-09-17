import "server-only";
import type { UIMessage } from "ai";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "./convex-client";

/** Commit the original bytes before replacing any inline detail. */
export async function archiveMessage({message, userId, serviceKey}: {
  message: UIMessage; userId: string; serviceKey: string;
}) {
  const client = getConvexClient();
  const body = JSON.stringify(message);
  const size = new TextEncoder().encode(body).byteLength;
  const name = `rift-run-${message.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100)}.json`;
  const mediaType = "application/json";
  const target = await client.action(api.s3Actions.generateSandboxUploadUrlAction, {
    serviceKey, userId, fileName: name, contentType: mediaType, size,
  });
  const response = await fetch(target.uploadUrl, {
    method: target.backend === "s3" ? "PUT" : "POST",
    headers: {"Content-Type": mediaType}, body,
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Run archive upload failed (${response.status})`);
  const location = target.backend === "s3"
    ? {s3Key: target.s3Key}
    : {storageId: (await response.json()).storageId};
  if (!(location.s3Key || location.storageId)) throw new Error("Run archive location missing");
  const saved = await client.action(api.fileActions.saveSandboxGeneratedFile, {
    ...location, serviceKey, userId, name, mediaType, size,
  });
  return {type: "file" as const, fileId: saved.fileId, url: saved.url,
    filename: name, name, size, mediaType, isRunArchive: true};
}
