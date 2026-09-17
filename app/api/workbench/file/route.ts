import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  authorizePremiumWorkbench,
  assertSameOriginMutation,
  readWorkbenchRequestTextWithLimit,
  readWorkspaceFile,
  withPremiumWorkspaceSandbox,
  workbenchErrorResponse,
  writeWorkspaceFile,
  WorkbenchRequestError,
} from "@/lib/workbench/workspace-server";
import {
  MAX_EDITABLE_FILE_BYTES,
  MAX_WORKSPACE_PATH_LENGTH,
} from "@/lib/workbench/path-policy";

export const runtime = "nodejs";
export const maxDuration = 60;

// JSON can encode one input byte as a six-byte `\u00xx` escape. Keep the
// transport envelope large enough for every otherwise-valid editable file;
// writeWorkspaceFile still enforces the decoded UTF-8 byte limit.
const MAX_FILE_REQUEST_BYTES = MAX_EDITABLE_FILE_BYTES * 6 + 64 * 1024;
const writeFileSchema = z.object({
  path: z.string().min(1).max(MAX_WORKSPACE_PATH_LENGTH),
  content: z.string(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
});

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get("path") ?? "";
    const result = await withPremiumWorkspaceSandbox(req, (sandbox) =>
      readWorkspaceFile(sandbox, path),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}

export async function PUT(req: NextRequest) {
  try {
    assertSameOriginMutation(req);
    const access = await authorizePremiumWorkbench(req);

    const rawBody = await readWorkbenchRequestTextWithLimit(
      req,
      MAX_FILE_REQUEST_BYTES,
    );

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WorkbenchRequestError(
        "A path, content, and revision are required.",
        400,
        "invalid_payload",
      );
    }
    const parsed = writeFileSchema.safeParse(json);
    if (!parsed.success) {
      throw new WorkbenchRequestError(
        "A path, content, and revision are required.",
        400,
        "invalid_payload",
      );
    }

    const result = await withPremiumWorkspaceSandbox(
      req,
      (sandbox) =>
        writeWorkspaceFile(sandbox, {
          path: parsed.data.path,
          content: parsed.data.content,
          expectedRevision: parsed.data.expectedRevision,
        }),
      access,
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
