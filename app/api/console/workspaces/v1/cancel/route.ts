import type { NextRequest } from "next/server";
import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import { POST as stopHttp } from "@/app/api/hack-chat/cancel/route";
import { POST as stopDurable } from "@/app/api/hack-long/cancel/route";
import { identitySchema } from "@/lib/console/workspaces-contract";
import {
  access,
  authority,
  body,
  forward,
  json,
  owned,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
import { getConvexClient } from "@/lib/db/convex-client";
const schema = identitySchema
  .extend({ operationId: z.string().uuid() })
  .strict();
export async function POST(req: NextRequest) {
  return route(async () => {
    const parsed = schema.safeParse(await body(req));
    if (!parsed.success) throw new WorkspaceError("Invalid stop request.");
    const { workspace, chatId, operationId } = parsed.data;
    const { userId } = await access(req, workspace, true);
    const chat = await owned(userId, workspace, chatId);
    if (workspace === "hack") {
      const response = chat.active_trigger_run_id
        ? await stopDurable(
            forward(req, "/api/hack-long/cancel", {
              chatId,
              dispatchId: operationId,
            }),
          )
        : await stopHttp(
            forward(req, "/api/hack-chat/cancel", {
              chatId,
              executionId: operationId,
            }),
          );
      if (response.ok) {
        const result = await response
          .clone()
          .json()
          .catch(() => null);
        // Only the producer's confirmed stop releases this operation. An accepted
        // request alone must continue blocking another paid admission.
        await getConvexClient()
          .mutation(
            makeFunctionReference<"mutation">("consoleWorkspaces:finish"),
            {
              ...authority(userId),
              chatId,
              operationId,
              status: result?.canceled === true ? "failed" : "cancel_requested",
            },
          )
          .catch(() => {});
      }
      return response;
    }
    return json(
      await getConvexClient().mutation(
        makeFunctionReference<"mutation">("consoleWorkspaces:cancelStudio"),
        { ...authority(userId), chatId, operationId },
      ),
      202,
    );
  });
}
