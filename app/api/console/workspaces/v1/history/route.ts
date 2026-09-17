import { makeFunctionReference } from "convex/server";
import type { NextRequest } from "next/server";
import { workspaceSchema } from "@/lib/console/workspaces-contract";
import {
  access,
  authority,
  identityQuery,
  json,
  listWorkspaces,
  messages,
  owned,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
import { getConvexClient } from "@/lib/db/convex-client";
export async function GET(req: NextRequest) {
  return route(async () => {
    const parsed = workspaceSchema.safeParse(
      req.nextUrl.searchParams.get("workspace"),
    );
    if (!parsed.success) throw new WorkspaceError("Select a workspace.");
    const { userId } = await access(req, parsed.data);
    if (!req.nextUrl.searchParams.has("chatId"))
      return json({
        sessions: await getConvexClient().query(listWorkspaces, {
          ...authority(userId),
          workspace: parsed.data,
        }),
      });
    const { workspace, chatId } = identityQuery(req);
    await owned(userId, workspace, chatId);
    const cursor = req.nextUrl.searchParams.get("cursor");
    if (cursor && cursor.length > 4096)
      throw new WorkspaceError("Invalid cursor.");
    const [history, operations] = await Promise.all([
      messages(userId, chatId, cursor),
      getConvexClient().query(
        makeFunctionReference<"query">("consoleWorkspaces:operations"),
        { ...authority(userId), chatId },
      ),
    ]);
    return json({ ...history, operations });
  });
}
