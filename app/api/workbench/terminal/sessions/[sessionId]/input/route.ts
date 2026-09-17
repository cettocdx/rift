import type { NextRequest } from "next/server";
import {
  MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES,
  parseTerminalInput,
  parseTerminalSessionId,
  sendInteractiveTerminalInput,
  sendLocalInteractiveTerminalInput,
} from "@/lib/workbench/interactive-terminal";
import { WORKBENCH_TERMINAL_INPUT_LEASE_HEADER } from "@/lib/workbench/interactive-terminal-contract";
import {
  consumeWorkbenchTerminalInputLease,
  issueWorkbenchTerminalInputLease,
  revokeWorkbenchTerminalInputLease,
} from "@/lib/workbench/terminal-input-lease";
import {
  WorkbenchRequestError,
  assertSameOriginMutation,
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  readWorkbenchRequestTextWithLimit,
  withPremiumWorkspaceTerminalInputSandbox,
  withPremiumLocalWorkbenchTerminalInput,
  workbenchTerminalLeaseContext,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

async function readTerminalInput(req: NextRequest) {
  const raw = await readWorkbenchRequestTextWithLimit(
    req,
    MAX_WORKBENCH_TERMINAL_MUTATION_BODY_BYTES,
  );
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new WorkbenchRequestError(
      "Terminal input must be canonical base64.",
      400,
      "invalid_terminal_input",
    );
  }
  return parseTerminalInput(value);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  try {
    const leaseToken =
      req.headers.get(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER)?.trim() ?? "";

    if (leaseToken) {
      // The opaque capability replaces repeated account/project resolution,
      // but never the browser mutation boundary or bounded body parser.
      assertSameOriginMutation(req);
      const { sessionId: rawSessionId } = await params;
      const sessionId = parseTerminalSessionId(rawSessionId);
      const bytes = await readTerminalInput(req);
      const binding = consumeWorkbenchTerminalInputLease({
        token: leaseToken,
        sessionId,
        context: workbenchTerminalLeaseContext(req),
        inputBytes: bytes.byteLength,
      });
      try {
        await binding.sendInput(bytes);
      } catch {
        revokeWorkbenchTerminalInputLease(leaseToken);
        throw new WorkbenchRequestError(
          "The fast terminal input path moved to another server instance.",
          409,
          "terminal_fast_path_unavailable",
        );
      }
      return new Response(null, {
        status: 204,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    const access = await authorizePremiumWorkbench(req);
    const { sessionId: rawSessionId } = await params;
    const sessionId = parseTerminalSessionId(rawSessionId);
    const bytes = await readTerminalInput(req);
    const context = workbenchTerminalLeaseContext(req);
    let refreshedLease: string | undefined;
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      await withPremiumLocalWorkbenchTerminalInput(
        req,
        bytes.byteLength,
        async (userId, workspaceKey) => {
          const sendInput = await sendLocalInteractiveTerminalInput(
            workspaceKey,
            sessionId,
            bytes,
          );
          refreshedLease = issueWorkbenchTerminalInputLease(
            { userId, workspaceKey, sessionId, context },
            sendInput,
          );
        },
        access,
      );
      const headers = new Headers({ "Cache-Control": "private, no-store" });
      if (refreshedLease) {
        headers.set(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER, refreshedLease);
      }
      return new Response(null, { status: 204, headers });
    }
    await withPremiumWorkspaceTerminalInputSandbox(
      req,
      bytes.byteLength,
      async (sandbox, userId, workspaceKey) => {
        const sendInput = await sendInteractiveTerminalInput(
          sandbox,
          workspaceKey,
          sessionId,
          bytes,
        );
        refreshedLease = issueWorkbenchTerminalInputLease(
          {
            userId,
            workspaceKey,
            sessionId,
            context,
          },
          sendInput,
        );
      },
      access,
    );
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    if (refreshedLease) {
      headers.set(WORKBENCH_TERMINAL_INPUT_LEASE_HEADER, refreshedLease);
    }
    return new Response(null, {
      status: 204,
      headers,
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
