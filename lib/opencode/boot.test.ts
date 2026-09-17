/**
 * @jest-environment node
 */
import { ensureOpenCodeServer, configStamp, type SandboxLike } from "@/lib/opencode/boot";

function fakeSandbox(files: Record<string, string> = {}) {
  const runs: Array<{ cmd: string; opts: any }> = [];
  const sandbox: SandboxLike & { runs: typeof runs; files_: Record<string, string> } = {
    sandboxId: "sbx_1",
    runs,
    files_: files,
    commands: {
      run: async (cmd, opts) => {
        runs.push({ cmd, opts });
        return "";
      },
    },
    files: {
      read: async (path) => {
        if (!(path in files)) throw new Error("ENOENT");
        return files[path];
      },
      write: async (path, data) => {
        files[path] = data;
      },
    },
    getHost: (port) => `${port}-sbx_1.e2b.app`,
  };
  return sandbox;
}

const healthyFetch = (calls: string[] = []): typeof fetch =>
  (async (url: any, init: any) => {
    calls.push(String(url) + "|" + (init?.headers?.Authorization ?? ""));
    return new Response(JSON.stringify({ healthy: true, version: "1.18.26" }), { status: 200 });
  }) as any;

const deadFetch: typeof fetch = (async () => new Response("", { status: 502 })) as any;

const config = { model: "gateway/model-gpt-5.6-sol", provider: {} };

describe("ensureOpenCodeServer", () => {
  it("starts a server: writes config + stamp, kills old, launches with baseline env, waits for health", async () => {
    const sbx = fakeSandbox();
    const calls: string[] = [];
    const handle = await ensureOpenCodeServer({
      sandbox: sbx,
      config,
      password: "pw",
      fetchImpl: healthyFetch(calls),
    });
    expect(handle).toMatchObject({
      baseUrl: "https://4096-sbx_1.e2b.app",
      sandboxId: "sbx_1",
      workspaceDir: "/home/user/workspace",
      bootPath: "started",
    });
    expect(handle.authHeader).toBe("Basic " + Buffer.from("opencode:pw").toString("base64"));
    // config + stamp written
    expect(JSON.parse(sbx.files_["/home/user/.config/opencode/opencode.json"])).toEqual(config);
    const stamp = JSON.parse(sbx.files_["/home/user/.config/opencode/rift-server.json"]);
    expect(stamp).toMatchObject({ port: 4096, password: "pw", stamp: configStamp(config) });
    // pkill then background launch with password + hardening env
    const cmds = sbx.runs.map((r) => r.cmd);
    expect(cmds.some((c) => c.includes("pkill -f '[o]pencode serve'"))).toBe(true);
    const launch = sbx.runs.find((r) => r.cmd.includes("opencode serve --hostname 0.0.0.0 --port 4096"));
    expect(launch?.opts.background).toBe(true);
    expect(launch?.opts.envs).toMatchObject({
      OPENCODE_SERVER_PASSWORD: "pw",
      OPENCODE_CLIENT: "rift",
      OPENCODE_DISABLE_MODELS_FETCH: "1",
      HOME: "/home/user",
    });
    // health probed with auth
    expect(calls[0]).toContain("/global/health|Basic ");
  });

  it("reuses a healthy server whose config stamp matches (no relaunch)", async () => {
    const stamp = configStamp(config);
    const sbx = fakeSandbox({
      "/home/user/.config/opencode/rift-server.json": JSON.stringify({ port: 4096, password: "old", stamp, startedAt: 1 }),
    });
    const handle = await ensureOpenCodeServer({ sandbox: sbx, config, fetchImpl: healthyFetch() });
    expect(handle.bootPath).toBe("reused");
    expect(handle.authHeader).toBe("Basic " + Buffer.from("opencode:old").toString("base64"));
    expect(sbx.runs).toHaveLength(0);
  });

  it("restarts when the config changed even if the old server is healthy", async () => {
    const sbx = fakeSandbox({
      "/home/user/.config/opencode/rift-server.json": JSON.stringify({ port: 4096, password: "old", stamp: "stale", startedAt: 1 }),
    });
    const handle = await ensureOpenCodeServer({ sandbox: sbx, config, password: "new", fetchImpl: healthyFetch() });
    expect(handle.bootPath).toBe("started");
    expect(sbx.runs.some((r) => r.cmd.includes("opencode serve"))).toBe(true);
  });

  it("throws with the log tail when health never comes up", async () => {
    const sbx = fakeSandbox();
    sbx.commands.run = async (cmd: string) => {
      sbx.runs.push({ cmd, opts: {} });
      return cmd.includes("tail -n 40") ? "boom: SIGILL" : "";
    };
    await expect(
      ensureOpenCodeServer({ sandbox: sbx, config, password: "pw", fetchImpl: deadFetch, healthTimeoutMs: 1 }),
    ).rejects.toThrow(/did not become healthy.*SIGILL/s);
  });
});
