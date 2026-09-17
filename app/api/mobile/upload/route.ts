import { NextRequest, NextResponse } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { z } from "zod";
const schema = z
  .object({
    operation: z.enum(["prepare", "complete"]),
    name: z.string().min(1).max(255),
    mediaType: z.string().min(1).max(128),
    size: z.number().int().positive(),
    mode: z.enum(["ask", "agent"]),
    storageId: z.string().min(1).max(128).optional(),
    s3Key: z.string().min(1).max(1024).optional(),
  })
  .refine(
    (value) =>
      value.operation === "prepare" ||
      Boolean(value.storageId) !== Boolean(value.s3Key),
    { message: "Exactly one storage reference is required." },
  );
export async function POST(request: NextRequest) {
  const token = await convexAuthNextjsToken();
  if (!token)
    return NextResponse.json(
      { error: "Sign in to upload files." },
      { status: 401 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid upload." }, { status: 400 });
  const { operation, name, mediaType, size, mode, storageId, s3Key } =
    parsed.data;
  try {
    // Existing actions enforce ownership, storage quotas and content validation.
    const result =
      operation === "prepare"
        ? await fetchAction(
            api.s3Actions.generateS3UploadUrlAction,
            { fileName: name, contentType: mediaType, size, mode },
            { token },
          )
        : await fetchAction(
            api.fileActions.saveFile,
            {
              name,
              mediaType,
              size,
              mode,
              ...(storageId ? { storageId: storageId as Id<"_storage"> } : {}),
              ...(s3Key ? { s3Key } : {}),
            },
            { token },
          );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Upload could not be completed. Check file permissions and storage availability, then retry.",
      },
      { status: 400 },
    );
  }
}
