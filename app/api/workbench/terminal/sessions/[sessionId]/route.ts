import type { NextRequest } from "next/server";
import {
  closeInteractiveTerminal,
  closeLocalInteractiveTerminal,
  parseTerminalSessionId,
} from "@/lib/workbench/interactive-terminal";
import {
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  withPremiumLocalWorkbenchTerminal,
  withPremiumWorkspaceSandbox,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const access = await authorizePremiumWorkbench(req);
    const { sessionId: rawSessionId } = await params;
    const sessionId = parseTerminalSessionId(rawSessionId);
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      await withPremiumLocalWorkbenchTerminal(
        req,
        (_userId, workspaceKey) =>
          closeLocalInteractiveTerminal(workspaceKey, sessionId),
        access,
      );
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    await withPremiumWorkspaceSandbox(
      req,
      (sandbox, _userId, workspaceKey) =>
        closeInteractiveTerminal(sandbox, workspaceKey, sessionId),
      access,
    );
    return new Response(null, {
      status: 204,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
