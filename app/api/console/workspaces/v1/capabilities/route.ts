import type { NextRequest } from "next/server";
import { workspaceCapabilities } from "@/lib/console/workspaces-contract";
import {
  access,
  hackExecutionTargets,
  json,
  route,
} from "@/lib/console/workspaces-server";
export async function GET(req: NextRequest) {
  return route(async () => {
    const { userId } = await access(req);
    const capabilities = workspaceCapabilities();
    const targets = await hackExecutionTargets(userId);
    return json({
      ...capabilities,
      studio: {
        ...capabilities.studio,
        targets: [{ value: "e2b", label: "Cloud" }],
      },
      hack: { ...capabilities.hack, targets },
      targets,
    });
  });
}
