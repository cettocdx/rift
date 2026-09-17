import { NextResponse, type NextRequest } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { ChatSDKError } from "@/lib/errors";
import { getRegistrySnapshot } from "@/lib/ai/mcp/registry/catalog";
export const runtime = "nodejs";
export const maxDuration = 20;
export async function GET(request: NextRequest) {
  try {
    await getUserID(request);
    const snapshot = await getRegistrySnapshot();
    return NextResponse.json(
      { ...snapshot, stale: Date.now() - snapshot.fetchedAt > 3_600_000 },
      { headers: { "Cache-Control": "private, max-age=60" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof ChatSDKError
            ? error.message
            : "The Registry is temporarily unavailable. Your curated plugins and existing connections are still available.",
      },
      {
        status: error instanceof ChatSDKError ? error.statusCode : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
