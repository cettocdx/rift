import { NextResponse, type NextRequest } from "next/server";
import {
  WORKBENCH_TERMINAL_PROFILES,
  type WorkbenchTerminalProfileCapabilities,
} from "@/lib/workbench/interactive-terminal-contract";
import {
  resolveLocalTerminalProfileCapabilities,
  resolveLocalWorkspaceRoot,
} from "@/lib/workbench/local-pty-adapter";
import {
  authorizePremiumWorkbench,
  isLocalMacWorkbenchTerminalRequest,
  workbenchErrorResponse,
} from "@/lib/workbench/workspace-server";

export const runtime = "nodejs";

const REMOTE_PROFILE_REASON =
  "Agent CLI profiles require the explicitly enabled local macOS workspace.";

export async function GET(req: NextRequest) {
  try {
    await authorizePremiumWorkbench(req);

    let result: WorkbenchTerminalProfileCapabilities;
    if (isLocalMacWorkbenchTerminalRequest(req)) {
      // Validate the configured root too. A host with installed binaries is
      // not a usable local runtime when its workspace boundary is invalid.
      resolveLocalWorkspaceRoot();
      result = {
        backend: "local",
        profiles: resolveLocalTerminalProfileCapabilities(),
      };
    } else {
      result = {
        backend: "remote",
        profiles: WORKBENCH_TERMINAL_PROFILES.map(({ id }) => ({
          profile: id,
          available: id === "shell",
          runtimeLabel: id === "shell" ? "Isolated sandbox bash" : "",
          unavailableReason: id === "shell" ? null : REMOTE_PROFILE_REASON,
        })),
      };
    }

    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return workbenchErrorResponse(error);
  }
}
