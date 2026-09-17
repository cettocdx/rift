import type { NextRequest } from "next/server";
import {
  access,
  allMessages,
  artifacts,
  fileIdsFromMessages,
  identityQuery,
  json,
  owned,
  route,
  WorkspaceError,
} from "@/lib/console/workspaces-server";
export async function GET(req: NextRequest) {
  return route(async () => {
    const { userId } = await access(req);
    const fileId = req.nextUrl.searchParams.get("fileId");
    if (fileId) {
      if (fileId.length > 128) throw new WorkspaceError("Invalid artifact.");
      const result = await artifacts(userId, [fileId]);
      if (!result[0]) throw new WorkspaceError("Artifact unavailable.", 404);
      return json({ artifacts: result });
    }
    const { workspace, chatId } = identityQuery(req);
    await access(req, workspace);
    await owned(userId, workspace, chatId);
    const ids = fileIdsFromMessages(await allMessages(userId, chatId));
    const result = [];
    for (let index = 0; index < ids.length; index += 50)
      result.push(...(await artifacts(userId, ids.slice(index, index + 50))));
    return json({ artifacts: result.filter(Boolean) });
  });
}
