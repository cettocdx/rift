import type { AnySandbox } from "@/types";
import { asCommonSandbox } from "./sandbox-types";

/**
 * Deterministically make a sandboxed dev server reachable through the E2B proxy
 * hostname (`<port>-<id>.e2b.app`).
 *
 * The problem: Vite 5+/6 (and the 4.x security backport) reject any request
 * whose `Host` header isn't in `server.allowedHosts`. Since the live preview
 * loads the E2B proxy hostname, an un-hardened Vite app shows a blank page with
 * "Blocked request. This host is not allowed." This is the single most common
 * Build-mode failure, and we must NOT rely on the model remembering to set it.
 *
 * The fix: before exposing a preview, scan the sandbox for Vite config files and
 * inject `server: { host: true, allowedHosts: true, hmr: {...} }` (idempotently).
 * Vite watches its own config and auto-restarts, so the patched settings take
 * effect within a second — the caller's port probe then waits for it to come
 * back up. Frameworks that don't host-check (Next.js, static servers) have no
 * Vite config and are simply left untouched.
 *
 * Best-effort: any failure here is swallowed so it can never break a preview.
 */

// Node script run INSIDE the sandbox. Authored with String.raw so the regex
// backslashes survive into the file verbatim (a normal template literal would
// turn "\s" into "s"). No ${...} interpolation or backticks inside.
const HARDEN_SCRIPT = String.raw`
const fs = require('fs');
const path = require('path');
const roots = [process.env.HOME || '/home/user', '/home/user', '/root', '/workspace', '/code', '/app', process.cwd()];
const skip = new Set(['node_modules', '.git', '.next', 'dist', 'build', '.cache', '.turbo']);
const found = [];
function walk(dir, depth) {
  if (depth > 6) return;
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of ents) {
    if (e.isDirectory()) { if (!skip.has(e.name)) walk(path.join(dir, e.name), depth + 1); }
    else if (/^vite\.config\.(js|ts|mjs|cjs)$/.test(e.name)) found.push(path.join(dir, e.name));
  }
}
const seen = new Set();
for (const r of roots) { if (r && !seen.has(r)) { seen.add(r); walk(r, 0); } }
const SRV = "host: true, allowedHosts: true, hmr: { clientPort: 443, protocol: 'wss' }";
const patched = [];
for (const f of found) {
  let s;
  try { s = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
  if (s.indexOf('allowedHosts') !== -1) continue;
  let out = null;
  if (/server\s*:\s*\{/.test(s)) out = s.replace(/server\s*:\s*\{/, function (m) { return m + ' ' + SRV + ', '; });
  else if (/defineConfig\s*\(\s*\{/.test(s)) out = s.replace(/defineConfig\s*\(\s*\{/, function (m) { return m + ' server: { ' + SRV + ' }, '; });
  else if (/=>\s*\(\s*\{/.test(s)) out = s.replace(/=>\s*\(\s*\{/, function (m) { return m + ' server: { ' + SRV + ' }, '; });
  else if (/export\s+default\s*\{/.test(s)) out = s.replace(/export\s+default\s*\{/, function (m) { return m + ' server: { ' + SRV + ' }, '; });
  if (out && out !== s) { try { fs.writeFileSync(f, out); patched.push(f); } catch (e) {} }
}
process.stdout.write('RIFT_PATCHED:' + JSON.stringify(patched));
`;

const SCRIPT_PATH = "/tmp/rift_vite_harden.cjs";

export interface ViteHardenResult {
  patched: string[];
}

/**
 * Scan + harden Vite configs in the sandbox so the proxy host is allowed.
 * Returns the list of patched config paths (empty if none / non-Vite project).
 * Never throws.
 */
export async function ensureVitePreviewable(
  sandbox: AnySandbox,
): Promise<ViteHardenResult> {
  try {
    const sb = asCommonSandbox(sandbox);
    await sb.files.write(SCRIPT_PATH, HARDEN_SCRIPT);
    const res = await sb.commands.run(
      `node ${SCRIPT_PATH} 2>/dev/null || true`,
      {
        timeoutMs: 15_000,
      },
    );
    const marker = res.stdout.indexOf("RIFT_PATCHED:");
    if (marker === -1) return { patched: [] };
    const json = res.stdout.slice(marker + "RIFT_PATCHED:".length).trim();
    try {
      const patched = JSON.parse(json) as string[];
      return { patched: Array.isArray(patched) ? patched : [] };
    } catch {
      return { patched: [] };
    }
  } catch {
    return { patched: [] };
  }
}
