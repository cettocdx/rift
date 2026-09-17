import type { NextRequest } from "next/server";
import {
  connectInteractiveTerminalEvents,
  connectLocalInteractiveTerminalEvents,
  createLocalInteractiveTerminalInputSender,
  createInteractiveTerminalEventResponse,
  parseTerminalCursor,
  parseTerminalSessionId,
} from "@/lib/workbench/interactive-terminal";
import { issueWorkbenchTerminalInputLease } from "@/lib/workbench/terminal-input-lease";
import {
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  withPremiumLocalWorkbenchTerminal,
  withPremiumWorkspaceSandbox,
  workbenchTerminalLeaseContext,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const access = await authorizePremiumWorkbench(req);
    const { sessionId: rawSessionId } = await params;
    const sessionId = parseTerminalSessionId(rawSessionId);
    const cursor = parseTerminalCursor(req.nextUrl.searchParams.get("cursor"));
    const context = workbenchTerminalLeaseContext(req);
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      const connected = await withPremiumLocalWorkbenchTerminal(
        req,
        async (userId, workspaceKey) => {
          const result = await connectLocalInteractiveTerminalEvents(
            workspaceKey,
            sessionId,
          );
          const sendInput = createLocalInteractiveTerminalInputSender(
            workspaceKey,
            sessionId,
          );
          return {
            ...result,
            inputLease: sendInput
              ? issueWorkbenchTerminalInputLease(
                  {
                    userId,
                    workspaceKey,
                    sessionId,
                    context,
                  },
                  sendInput,
                )
              : undefined,
          };
        },
        access,
      );
      return createInteractiveTerminalEventResponse({
        workspaceKey: connected.workspaceKey,
        session: connected.session,
        cursor,
        reconnected: connected.reconnected,
        signal: req.signal,
        inputLease: connected.inputLease,
      });
    }
    const connected = await withPremiumWorkspaceSandbox(
      req,
      async (sandbox, userId, workspaceKey) => {
        const result = await connectInteractiveTerminalEvents(
          sandbox,
          workspaceKey,
          sessionId,
        );
        const sendInput = createLocalInteractiveTerminalInputSender(
          workspaceKey,
          sessionId,
        );
        return {
          ...result,
          inputLease: sendInput
            ? issueWorkbenchTerminalInputLease(
                {
                  userId,
                  workspaceKey,
                  sessionId,
                  context,
                },
                sendInput,
              )
            : undefined,
        };
      },
      access,
    );
    return createInteractiveTerminalEventResponse({
      workspaceKey: connected.workspaceKey,
      session: connected.session,
      cursor,
      reconnected: connected.reconnected,
      signal: req.signal,
      inputLease: connected.inputLease,
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
