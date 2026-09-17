import { NextResponse, type NextRequest } from "next/server";
import {
  listWorkspaceDirectory,
  withPremiumWorkspaceSandbox,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const path = req.nextUrl.searchParams.get("path") ?? "";
    const result = await withPremiumWorkspaceSandbox(req, (sandbox) =>
      listWorkspaceDirectory(sandbox, path),
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
