import { BRIDGE_DIR, BRIDGE_TOOLS } from "@/lib/opencode/bridge-protocol";

/**
 * Source of the custom tool files written into `~/.config/opencode/tools/`
 * inside the sandbox. Each is a thin client of the file bridge: write the
 * request, poll for the response honouring OpenCode's abort signal, return the
 * RIFT tool's JSON output as the tool result. Descriptions and argument shapes
 * mirror the RIFT tools so the model sees the same contract as in the legacy
 * loop. `@opencode-ai/plugin` is bundled in the OpenCode binary (verified live).
 */

const bridgeLib = `
import * as fs from "node:fs/promises"
const DIR = ${JSON.stringify(BRIDGE_DIR)}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
export async function callRift(tool, callID, sessionID, args, ctx, deadlineMs) {
  await fs.mkdir(DIR, { recursive: true })
  const req = DIR + "/" + callID + ".req.json"
  const res = DIR + "/" + callID + ".res.json"
  await fs.writeFile(req + ".tmp", JSON.stringify({ v: 1, tool, callID, sessionID, args, requestedAt: Date.now() }))
  await fs.rename(req + ".tmp", req)
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    if (ctx.abort?.aborted) throw new Error(tool + " aborted")
    try {
      const raw = await fs.readFile(res, "utf8")
      const parsed = JSON.parse(raw)
      await fs.rm(res, { force: true }).catch(() => {})
      if (!parsed.ok) throw new Error(parsed.error || tool + " failed")
      return parsed.output
    } catch (e) {
      if (e && e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e
    }
    await sleep(500)
  }
  throw new Error(tool + " timed out waiting for RIFT (" + Math.round(deadlineMs / 1000) + "s)")
}
`;

const verifyApp = `
import { tool } from "@opencode-ai/plugin"
import { callRift } from "../lib/rift-bridge"
export default tool({
  description: "Verify that a generated web app is genuinely runnable before presenting it as complete, and SEE what it looks like. Run this after meaningful code changes and before expose_preview. It performs a production build (or validates a standalone static entry point) and, when a port is supplied, probes the live server and renders it in Chromium. If any check fails, fix the reported issue and call verify_app again. Never call expose_preview after a failed verification.",
  args: {
    project_path: tool.schema.string().describe("Absolute path to the generated app directory containing package.json or index.html."),
    port: tool.schema.number().int().min(1).max(65535).optional().describe("Port of the already-running dev server, to also verify the live app."),
    brief: tool.schema.string().describe("One sentence on what is being verified."),
  },
  async execute(args, ctx) {
    ctx.metadata({ title: "Verifying app" })
    return await callRift("verify_app", ctx.callID ?? ctx.messageID + "-" + Date.now(), ctx.sessionID, args, ctx, ${BRIDGE_TOOLS.verify_app.deadlineMs})
  },
})
`;

const exposePreview = `
import { tool } from "@opencode-ai/plugin"
import { callRift } from "../lib/rift-bridge"
export default tool({
  description: "Expose a running dev-server port as a public preview URL the user can open. Call this AFTER verify_app passed and the dev server is listening on 0.0.0.0. The user sees the app in an embedded live preview automatically; do not paste the URL.",
  args: {
    port: tool.schema.number().int().min(1).max(65535).describe("The port the dev server is listening on (e.g. 5173)."),
    brief: tool.schema.string().describe("One sentence describing what is being previewed."),
  },
  async execute(args, ctx) {
    ctx.metadata({ title: "Exposing preview" })
    return await callRift("expose_preview", ctx.callID ?? ctx.messageID + "-" + Date.now(), ctx.sessionID, args, ctx, ${BRIDGE_TOOLS.expose_preview.deadlineMs})
  },
})
`;

export interface SandboxToolFile {
  path: string;
  content: string;
}

/** Files to write under `<homeDir>/.config/opencode/` before `opencode serve` starts. */
export function sandboxToolFiles(homeDir = "/home/user"): SandboxToolFile[] {
  const base = `${homeDir}/.config/opencode`;
  return [
    { path: `${base}/lib/rift-bridge.ts`, content: bridgeLib.trimStart() },
    { path: `${base}/tools/verify_app.ts`, content: verifyApp.trimStart() },
    { path: `${base}/tools/expose_preview.ts`, content: exposePreview.trimStart() },
  ];
}
