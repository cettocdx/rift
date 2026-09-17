import type { NextRequest } from "next/server";
import { identitySchema } from "@/lib/console/workspaces-contract";
import {
  access,
  authority,
  body,
  identityQuery,
  json,
  owned,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { z } from "zod";
export async function GET(req: NextRequest) {
  return route(async () => {
    const { workspace, chatId } = identityQuery(req);
    const { userId } = await access(req, workspace);
    await owned(userId, workspace, chatId);
    return json(
      await getConvexClient().query(api.approvals.pendingForBackend, {
        ...authority(userId),
        chatId,
      }),
    );
  });
}
const schema = identitySchema
  .extend({ id: z.string().min(1).max(128), approve: z.boolean() })
  .strict();
export async function POST(req: NextRequest) {
  return route(async () => {
    const parsed = schema.safeParse(await body(req));
    if (!parsed.success) throw new WorkspaceError("Invalid approval.");
    const { workspace, chatId, id, approve } = parsed.data;
    const { userId } = await access(req, workspace);
    await owned(userId, workspace, chatId);
    await getConvexClient().mutation(api.approvals.decideForBackend, {
      ...authority(userId),
      chatId,
      id: id as Id<"tool_approvals">,
      approve,
    });
    return json({ ok: true });
  });
}
