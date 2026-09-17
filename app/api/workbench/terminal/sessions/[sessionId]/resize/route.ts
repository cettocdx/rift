import type { NextRequest } from "next/server";
import {
  MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES,
  parseTerminalResize,
  parseTerminalSessionId,
  resizeInteractiveTerminal,
  resizeLocalInteractiveTerminal,
} from "@/lib/workbench/interactive-terminal";
import {
  WorkbenchRequestError,
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  readWorkbenchRequestTextWithLimit,
  withPremiumWorkspaceSandbox,
  withPremiumLocalWorkbenchTerminal,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const access = await authorizePremiumWorkbench(req);
    const { sessionId: rawSessionId } = await params;
    const sessionId = parseTerminalSessionId(rawSessionId);
    const raw = await readWorkbenchRequestTextWithLimit(
      req,
      MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES,
    );
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new WorkbenchRequestError(
        "Terminal columns or rows are outside the supported range.",
        400,
        "invalid_terminal_size",
      );
    }
    const size = parseTerminalResize(value);
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      await withPremiumLocalWorkbenchTerminal(
        req,
        (_userId, workspaceKey) =>
          resizeLocalInteractiveTerminal(workspaceKey, sessionId, size),
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
        resizeInteractiveTerminal(sandbox, workspaceKey, sessionId, size),
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
