import { NextResponse, type NextRequest } from "next/server";
import {
  MAX_WORKBENCH_TERMINAL_CREATE_BODY_BYTES,
  createInteractiveTerminalSession,
  createLocalInteractiveTerminalSession,
  createLocalInteractiveTerminalInputSender,
  listInteractiveTerminalSessions,
  listLocalInteractiveTerminalSessions,
  parseCreateTerminalRequest,
} from "@/lib/workbench/interactive-terminal";
import { issueWorkbenchTerminalInputLease } from "@/lib/workbench/terminal-input-lease";
import { WORKBENCH_TERMINAL_PROFILES } from "@/lib/workbench/interactive-terminal-contract";
import {
  WorkbenchRequestError,
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  readWorkbenchRequestTextWithLimit,
  withPremiumLocalWorkbenchTerminal,
  withPremiumWorkspaceSandbox,
  workbenchTerminalLeaseContext,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const context = workbenchTerminalLeaseContext(req);
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      const result = await withPremiumLocalWorkbenchTerminal(
        req,
        async (userId, workspaceKey) => {
          const listed =
            await listLocalInteractiveTerminalSessions(workspaceKey);
          return {
            sessions: listed.sessions.map((session) => {
              const sendInput = createLocalInteractiveTerminalInputSender(
                workspaceKey,
                session.id,
              );
              return session.status === "running" && sendInput
                ? {
                    ...session,
                    inputLease: issueWorkbenchTerminalInputLease(
                      {
                        userId,
                        workspaceKey,
                        sessionId: session.id,
                        context,
                      },
                      sendInput,
                    ),
                  }
                : session;
            }),
          };
        },
      );
      return NextResponse.json(result, {
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const result = await withPremiumWorkspaceSandbox(
      req,
      async (sandbox, userId, workspaceKey) => {
        const listed = await listInteractiveTerminalSessions(
          sandbox,
          workspaceKey,
        );
        return {
          sessions: listed.sessions.map((session) => {
            const sendInput = createLocalInteractiveTerminalInputSender(
              workspaceKey,
              session.id,
            );
            return session.status === "running" && sendInput
              ? {
                  ...session,
                  inputLease: issueWorkbenchTerminalInputLease(
                    {
                      userId,
                      workspaceKey,
                      sessionId: session.id,
                      context,
                    },
                    sendInput,
                  ),
                }
              : session;
          }),
        };
      },
    );
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    // Authenticate before consuming any caller-controlled body bytes.
    const access = await authorizePremiumWorkbench(req);
    const raw = await readWorkbenchRequestTextWithLimit(
      req,
      MAX_WORKBENCH_TERMINAL_CREATE_BODY_BYTES,
    );
    let value: unknown = {};
    if (raw.trim()) {
      try {
        value = JSON.parse(raw);
      } catch {
        throw new WorkbenchRequestError(
          "Terminal size and working directory are invalid.",
          400,
          "invalid_terminal_session",
        );
      }
    }
    const request = parseCreateTerminalRequest(value);
    const context = workbenchTerminalLeaseContext(req);
    const isLocalTerminal = isLocalMacWorkbenchTerminalRequest(req);
    if (!isLocalTerminal && request.profile !== "shell") {
      const profileLabel =
        WORKBENCH_TERMINAL_PROFILES.find(({ id }) => id === request.profile)
          ?.label ?? "This agent CLI";
      throw new WorkbenchRequestError(
        `${profileLabel} is unavailable in the isolated sandbox. Use the shell profile or open a local macOS workspace.`,
        409,
        "terminal_profile_unavailable",
      );
    }
    if (isLocalTerminal) {
      const result = await withPremiumLocalWorkbenchTerminal(
        req,
        async (userId, workspaceKey, workspaceRoot) => {
          const created = await createLocalInteractiveTerminalSession(
            workspaceKey,
            workspaceRoot,
            request,
          );
          const sendInput = createLocalInteractiveTerminalInputSender(
            workspaceKey,
            created.session.id,
          );
          const inputLease = sendInput
            ? issueWorkbenchTerminalInputLease(
                {
                  userId,
                  workspaceKey,
                  sessionId: created.session.id,
                  context,
                },
                sendInput,
              )
            : undefined;
          return {
            ...created,
            session: inputLease
              ? { ...created.session, inputLease }
              : created.session,
          };
        },
        access,
      );
      return NextResponse.json(result.session, {
        status: result.created ? 201 : 200,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const result = await withPremiumWorkspaceSandbox(
      req,
      async (sandbox, userId, workspaceKey) => {
        const created = await createInteractiveTerminalSession(
          sandbox,
          workspaceKey,
          request,
        );
        const sendInput = createLocalInteractiveTerminalInputSender(
          workspaceKey,
          created.session.id,
        );
        const inputLease = sendInput
          ? issueWorkbenchTerminalInputLease(
              {
                userId,
                workspaceKey,
                sessionId: created.session.id,
                context,
              },
              sendInput,
            )
          : undefined;
        return {
          ...created,
          session: inputLease
            ? { ...created.session, inputLease }
            : created.session,
        };
      },
      access,
    );
    return NextResponse.json(result.session, {
      status: result.created ? 201 : 200,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
