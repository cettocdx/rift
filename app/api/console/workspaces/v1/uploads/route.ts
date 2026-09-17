import type { NextRequest } from "next/server";
import { z } from "zod";
import {
  access,
  authority,
  body,
  json,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
import { api } from "@/convex/_generated/api";
import { getConvexClient } from "@/lib/db/convex-client";
import type { Id } from "@/convex/_generated/dataModel";
import { validateUploadPolicy } from "@/lib/utils/upload-policy";
const schema = z
  .object({
    operation: z.enum(["prepare", "complete"]),
    name: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(128),
    size: z.number().int().positive(),
    mode: z.enum(["ask", "agent"]).default("agent"),
    storageId: z.string().min(1).max(128).optional(),
    s3Key: z.string().min(1).max(1024).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.operation === "prepare" ||
      Boolean(value.storageId) !== Boolean(value.s3Key),
  );
export async function POST(req: NextRequest) {
  return route(async () => {
    const identity = await access(req);
    const parsed = schema.safeParse(await body(req));
    if (!parsed.success) throw new WorkspaceError("Invalid upload.");
    const input = parsed.data;
    const validation = validateUploadPolicy({
      mode: input.mode,
      size: input.size,
      mediaType: input.mediaType,
      surface: "client",
    });
    if (!validation.valid) throw new WorkspaceError(validation.message);
    const entitlements = [`${identity.subscription}-plan`];
    const result =
      input.operation === "prepare"
        ? await getConvexClient().action(
            api.s3Actions.generateS3UploadUrlAction,
            {
              ...authority(identity.userId),
              entitlements,
              fileName: input.name,
              contentType: input.mediaType,
              size: input.size,
              mode: input.mode,
            },
          )
        : await getConvexClient().action(api.fileActions.saveFile, {
            ...authority(identity.userId),
            uploadEntitlements: entitlements,
            name: input.name,
            mediaType: input.mediaType,
            size: input.size,
            mode: input.mode,
            ...(input.storageId
              ? { storageId: input.storageId as Id<"_storage"> }
              : {}),
            ...(input.s3Key ? { s3Key: input.s3Key } : {}),
          });
    return json(result);
  });
}
