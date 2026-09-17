import { NextRequest, NextResponse } from "next/server";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

/** Explicit allowlist: never expose MCP credentials or backend service keys. */
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    userId = await getUserID(req);
  } catch {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }
  const kind = req.nextUrl.searchParams.get("kind");
  if (kind !== "skills" && kind !== "plugins")
    return NextResponse.json(
      { error: "Choose skills or plugins" },
      { status: 400 },
    );
  try {
    const client = getConvexClient();
    const args = { userId, serviceKey: process.env.CONVEX_SERVICE_ROLE_KEY! };
    const items =
      kind === "skills"
        ? (await client.query(api.skills.listEnabledForBackend, args)).map(
            (s) => ({
              id: s.catalog_id ?? s.name,
              name: s.name,
              description: s.instructions,
              scope: s.scope,
            }),
          )
        : (await client.query(api.mcpServers.listEnabledForBackend, args)).map(
            (s) => ({
              id: s._id,
              name: s.name,
              status: s.connectionStatus,
              tools: s.toolNames,
            }),
          );
    return NextResponse.json(
      { items },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "RIFT resources are temporarily unavailable" },
      { status: 503 },
    );
  }
}
