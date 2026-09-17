import { NextResponse, type NextRequest } from "next/server";
import {
  parseWorkbenchTerminalCommand,
  runWorkbenchTerminalCommand,
} from "@/lib/workbench/manual-terminal";
import {
  authorizePremiumWorkbench,
  readWorkbenchRequestTextWithLimit,
  withPremiumManualTerminalSandbox,
  workbenchErrorResponse,
  WorkbenchRequestError,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_TERMINAL_REQUEST_BYTES = 16 * 1024;

export async function POST(req: NextRequest) {
  try {
    // Authorization deliberately precedes body parsing so cross-origin
    // callers, free accounts, and raw API keys cannot make the server consume
    // an attacker-controlled request body.
    const access = await authorizePremiumWorkbench(req);
    const rawBody = await readWorkbenchRequestTextWithLimit(
      req,
      MAX_TERMINAL_REQUEST_BYTES,
    );

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new WorkbenchRequestError(
        "Enter one terminal command and a valid working directory.",
        400,
        "invalid_terminal_command",
      );
    }

    const command = parseWorkbenchTerminalCommand(json);
    const result = await withPremiumManualTerminalSandbox(
      req,
      (sandbox) => runWorkbenchTerminalCommand(sandbox, command, req.signal),
      access,
    );

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
