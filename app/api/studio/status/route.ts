import { NextResponse } from "next/server";
import { getStudioRuntimeStatus } from "./runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getStudioRuntimeStatus(), {
    headers: { "Cache-Control": "private, no-store" },
  });
}
