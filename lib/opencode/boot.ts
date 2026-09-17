import crypto from "crypto";

/**
 * Ensures `opencode serve` is running inside a chat sandbox and returns how to
 * reach it.
 *
 * One server per sandbox, reused across legs: the OpenCode session state lives
 * on the sandbox disk, so a reused (or restarted) server continues the same
 * sessions. We restart only when nothing is listening or when the generated
 * config changed (a per-run proxy token lives in it, so in practice a new run
 * restarts the server; that is cheap — ~2 s — and sessions survive it). The
 * port is public through E2B, so the server always boots with a random Basic
 * auth password that is stored only in the sandbox and returned to the driver.
 */

export interface SandboxLike {
  sandboxId: string;
  commands: {
    run: (
      cmd: string,
      opts?: { background?: boolean; envs?: Record<string, string>; user?: string; timeoutMs?: number },
    ) => Promise<unknown>;
  };
  files: {
    read: (path: string, opts?: { user?: string }) => Promise<string>;
    write: (path: string, data: string, opts?: { user?: string }) => Promise<unknown>;
  };
  getHost: (port: number) => string;
}

export interface OpenCodeServerHandle {
  baseUrl: string;
  authHeader: string;
  sandboxId: string;
  workspaceDir: string;
  bootPath: "reused" | "started";
}

export interface EnsureOpenCodeServerArgs {
  sandbox: SandboxLike;
  /** Fully built opencode.json (see buildOpenCodeConfig). */
  config: Record<string, unknown>;
  port?: number;
  homeDir?: string;
  user?: string;
  workspaceDir?: string;
  binaryPath?: string;
  healthTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Injected for tests; defaults to crypto random. */
  password?: string;
}

export const OPENCODE_VERSION = "1.18.26";

interface ServerStamp {
  port: number;
  password: string;
  stamp: string;
  startedAt: number;
}

export const OPENCODE_BASELINE_ENV: Record<string, string> = {
  OPENCODE_SERVER_USERNAME: "opencode",
  OPENCODE_CLIENT: "rift", // non-listed client → blocking `question` tool is not registered
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_DISABLE_MODELS_FETCH: "1",
  OPENCODE_DISABLE_LSP_DOWNLOAD: "true",
  OPENCODE_DISABLE_EMBEDDED_WEB_UI: "1",
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
  OPENCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: "1",
  NO_PROXY: "localhost,127.0.0.1",
};

export function configStamp(config: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(JSON.stringify(config)).digest("hex").slice(0, 16);
}

function baseUrlFor(sandbox: SandboxLike, port: number): string {
  const host = sandbox.getHost(port);
  return /^https?:\/\//.test(host) ? host : `https://${host}`;
}

function basicAuth(password: string): string {
  return "Basic " + Buffer.from(`opencode:${password}`).toString("base64");
}

async function healthy(fetchImpl: typeof fetch, baseUrl: string, authHeader: string): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/global/health`, {
      headers: { Authorization: authHeader },
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { healthy?: boolean } | null;
    return body?.healthy === true;
  } catch {
    return false;
  }
}

export async function ensureOpenCodeServer(args: EnsureOpenCodeServerArgs): Promise<OpenCodeServerHandle> {
  const port = args.port ?? 4096;
  const homeDir = args.homeDir ?? "/home/user";
  const user = args.user ?? "user";
  const workspaceDir = args.workspaceDir ?? `${homeDir}/workspace`;
  const binaryPath = args.binaryPath ?? "opencode";
  const fetchImpl = args.fetchImpl ?? fetch;
  const healthTimeoutMs = args.healthTimeoutMs ?? 90_000;
  const configDir = `${homeDir}/.config/opencode`;
  const stampPath = `${configDir}/rift-server.json`;
  const stamp = configStamp(args.config);
  const baseUrl = baseUrlFor(args.sandbox, port);

  // 1. Reuse a live server whose config has not changed.
  let previous: ServerStamp | null = null;
  try {
    previous = JSON.parse(await args.sandbox.files.read(stampPath, { user })) as ServerStamp;
  } catch {
    previous = null;
  }
  if (previous && previous.stamp === stamp && previous.port === port) {
    const auth = basicAuth(previous.password);
    if (await healthy(fetchImpl, baseUrl, auth)) {
      return { baseUrl, authHeader: auth, sandboxId: args.sandbox.sandboxId, workspaceDir, bootPath: "reused" };
    }
  }

  // 2. (Re)write config + stamp, stop any old server, start a fresh one.
  const password = args.password ?? crypto.randomBytes(24).toString("base64url");
  const authHeader = basicAuth(password);
  await args.sandbox.commands.run(`mkdir -p '${configDir}' '${workspaceDir}'`, { user });
  // Images before SANDBOX_VERSION v15 have no OpenCode binary (and one bad
  // build shipped a broken wrapper). Probe by RUNNING it; if that fails, install
  // the pinned baseline build over /usr/local/bin/opencode. No-op on a good image.
  if (binaryPath === "opencode") {
    await args.sandbox.commands.run(
      `opencode --version >/dev/null 2>&1 || (set -e; cd /tmp; curl -fsSL -o oc.tgz https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/opencode-linux-x64-baseline.tar.gz; tar xzf oc.tgz; install -m 755 opencode /usr/local/bin/opencode; rm -f oc.tgz opencode)`,
      { user: "root", timeoutMs: 180_000 },
    );
  }
  await args.sandbox.files.write(`${configDir}/opencode.json`, JSON.stringify(args.config, null, 2), { user });
  const next: ServerStamp = { port, password, stamp, startedAt: Date.now() };
  await args.sandbox.files.write(stampPath, JSON.stringify(next), { user });
  // `[o]pencode` keeps pkill from matching its own command line (which would
  // kill this very shell and surface as "signal: terminated").
  await args.sandbox.commands.run(`pkill -f '[o]pencode serve' || true`, { user }).catch(() => undefined);
  await args.sandbox.commands.run(
    `nohup ${binaryPath} serve --hostname 0.0.0.0 --port ${port} > '${homeDir}/.opencode-server.log' 2>&1 &`,
    {
      user,
      background: true,
      envs: { ...OPENCODE_BASELINE_ENV, HOME: homeDir, OPENCODE_SERVER_PASSWORD: password },
    },
  );

  // 3. Wait for health.
  const deadline = Date.now() + healthTimeoutMs;
  while (Date.now() < deadline) {
    if (await healthy(fetchImpl, baseUrl, authHeader)) {
      return { baseUrl, authHeader, sandboxId: args.sandbox.sandboxId, workspaceDir, bootPath: "started" };
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  let tail = "";
  try {
    tail = String(await args.sandbox.commands.run(`tail -n 40 '${homeDir}/.opencode-server.log' 2>/dev/null || true`, { user }));
  } catch {
    /* ignore */
  }
  throw new Error(`opencode serve did not become healthy within ${healthTimeoutMs}ms. ${tail ? "Log tail: " + tail.slice(0, 1500) : ""}`);
}
