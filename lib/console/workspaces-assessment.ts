import type { NextRequest } from "next/server";
import { makeFunctionReference } from "convex/server";
import { getConvexClient } from "@/lib/db/convex-client";
import { assessmentData } from "@/lib/hack/assessment-data";
import {
  access,
  allMessages,
  authority,
  identityQuery,
  owned,
  WorkspaceError,
} from "./workspaces-server";
export async function readAssessment(req: NextRequest) {
  const { workspace, chatId } = identityQuery(req);
  if (workspace !== "hack")
    throw new WorkspaceError("Reports belong to Hack assessments.");
  const { userId } = await access(req, "hack");
  const chat = await owned(userId, workspace, chatId);
  const operations = await getConvexClient().query(
    makeFunctionReference<"query">("consoleWorkspaces:operations"),
    { ...authority(userId), chatId },
  );
  const target =
    operations.find((op: { target?: string }) => op.target)?.target ??
    req.nextUrl.searchParams.get("target") ??
    "Undeclared scope";
  if (target.length > 2048) throw new WorkspaceError("Invalid target.");
  return assessmentData(await allMessages(userId, chatId), {
    target,
    taskIds: operations
      .filter((op: { status: string }) => op.status === "completed")
      .map((op: { taskId?: string }) => op.taskId)
      .filter(Boolean),
    stoppedEarly:
      !!chat.canceled_at ||
      operations.some((op: { status: string }) =>
        ["failed", "uncertain", "cancel_requested"].includes(op.status),
      ),
  });
}
