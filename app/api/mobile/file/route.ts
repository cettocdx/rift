import { NextRequest, NextResponse } from "next/server";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
export async function GET(request: NextRequest) {
  const token = await convexAuthNextjsToken();
  if (!token) return new Response(null, { status: 401 });
  const id = request.nextUrl.searchParams.get("id");
  if (!id || !/^[a-zA-Z0-9_-]{1,128}$/.test(id))
    return new Response(null, { status: 400 });
  try {
    const urls = await fetchAction(
      api.s3Actions.getFileUrlsBatchAction,
      { fileIds: [id as Id<"files">] },
      { token },
    );
    return NextResponse.json(
      { url: urls[id] ?? null },
      {
        status: urls[id] ? 200 : 404,
        headers: { "Cache-Control": "private, no-store" },
      },
    );
  } catch {
    return new Response(null, { status: 503 });
  }
}
