/**
 * File-based request/response bridge between RIFT tools that must run on the
 * worker (verify_app needs Playwright, expose_preview needs the E2B handle)
 * and the OpenCode agent inside the sandbox.
 *
 * The sandbox-side tool writes `<dir>/<callID>.req.json` and polls for
 * `<dir>/<callID>.res.json`; the driver notices the tool entering `running`
 * (an event it already receives), reads the request through envd, runs the
 * real RIFT tool, and writes the response. No HTTPS, no token, no extra
 * service — the sandbox filesystem is the channel and the OpenCode event is
 * the notification.
 */

export const BRIDGE_DIR = "/home/user/.rift/bridge";

/** Tools served through the bridge, and the sandbox-side deadline for each. */
export const BRIDGE_TOOLS: Readonly<Record<string, { deadlineMs: number }>> = {
  verify_app: { deadlineMs: 7 * 60 * 1000 },
  expose_preview: { deadlineMs: 90 * 1000 },
};

export interface BridgeRequest {
  v: 1;
  tool: string;
  callID: string;
  sessionID: string;
  args: Record<string, unknown>;
  requestedAt: number;
}

export interface BridgeResponse {
  v: 1;
  ok: boolean;
  /** JSON-serialised tool output (what RIFT's tool returned). */
  output: string;
  error?: string;
}

export const reqPath = (callID: string) => `${BRIDGE_DIR}/${callID}.req.json`;
export const resPath = (callID: string) => `${BRIDGE_DIR}/${callID}.res.json`;
