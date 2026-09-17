/**
 * @jest-environment node
 */
jest.mock("@/lib/opencode/run-lease", () => ({
  createRunLease: jest.fn().mockResolvedValue(undefined),
  readRunUsage: jest.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, requests: 0, costDollars: 0 }),
}));
import { prepareOpenCodeRun } from "@/lib/opencode/prepare-run";
import { createRunLease } from "@/lib/opencode/run-lease";
import { verifyRunToken } from "@/lib/llm-proxy/token";
import type { SandboxLike } from "@/lib/opencode/boot";

process.env.LLM_PROXY_SECRET = "s";

function fakeSandbox() {
  const files: Record<string, string> = {};
  const sandbox: SandboxLike & { files_: typeof files } = {
    sandboxId: "sbx_9",
    files_: files,
    commands: { run: async () => "" },
    files: {
      read: async (p) => {
        if (!(p in files)) throw new Error("ENOENT");
        return files[p];
      },
      write: async (p, d) => {
        files[p] = d;
      },
    },
    getHost: (port) => `${port}-sbx_9.e2b.app`,
  };
  return sandbox;
}

/** fetch stub: health ok; GET /session/:id 404 unless `existingOk`; POST /session creates. */
function fakeFetch(opts: { existingOk?: boolean } = {}) {
  const calls: string[] = [];
  const f = (async (url: any, init: any) => {
    const u = String(url);
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.includes("/global/health")) return new Response(JSON.stringify({ healthy: true, version: "1.18.26" }));
    if (/\/session\/ses_old(\?|$)/.test(u)) return new Response(opts.existingOk ? JSON.stringify({ id: "ses_old" }) : "nf", { status: opts.existingOk ? 200 : 404 });
    if (/\/session(\?|$)/.test(u) && init?.method === "POST") return new Response(JSON.stringify({ id: "ses_new" }));
    return new Response("?", { status: 500 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const args = (sandbox: SandboxLike, f: typeof fetch, over: Record<string, unknown> = {}) => ({
  sandbox,
  runId: "run_1",
  chatId: "chat_1",
  userId: "user_1",
  subscription: "pro",
  modelKey: "model-gpt-5.6-sol",
  ceilingDollars: 5,
  workingContextTokens: 200000,
  maxSteps: 100,
  maxOutputTokens: 30000,
  proxyBaseUrl: "https://riftsys.app/api/llm/v1",
  fetchImpl: f,
  ...over,
});

describe("prepareOpenCodeRun", () => {
  it("boots the server, creates a session, opens a lease, and mints a token bound to the sandbox", async () => {
    const sbx = fakeSandbox();
    const { f, calls } = fakeFetch();
    const run = await prepareOpenCodeRun(args(sbx, f) as any);
    expect(run.sessionId).toBe("ses_new");
    expect(run.sessionReused).toBe(false);
    expect(run.serverBaseUrl).toBe("https://4096-sbx_9.e2b.app");
    expect(calls.some((c) => c.startsWith("POST") && /\/session(\?|$)/.test(c))).toBe(true);

    // config written with a verifiable per-run token pointing at the proxy
    const cfg = JSON.parse(sbx.files_["/home/user/.config/opencode/opencode.json"]);
    expect(cfg.provider.gateway.options.baseURL).toBe("https://riftsys.app/api/llm/v1");
    expect(verifyRunToken(cfg.provider.gateway.options.apiKey)).toEqual({
      runId: "run_1",
      chatId: "chat_1",
      userId: "user_1",
      sandboxId: "sbx_9",
    });
    expect(cfg.model).toBe("gateway/model-gpt-5.6-sol");

    expect(createRunLease).toHaveBeenCalledWith(
      expect.objectContaining({ runId: "run_1", sandboxId: "sbx_9", sessionId: "ses_new", ceilingDollars: 5, serverAuth: run.serverAuth }),
    );
  });

  it("reuses the chat's existing session when it is still on this sandbox", async () => {
    const sbx = fakeSandbox();
    const { f } = fakeFetch({ existingOk: true });
    const run = await prepareOpenCodeRun(args(sbx, f, { existingSessionId: "ses_old", existingSandboxId: "sbx_9" }) as any);
    expect(run.sessionId).toBe("ses_old");
    expect(run.sessionReused).toBe(true);
  });

  it("falls back to a new session when the old one is gone or on another sandbox", async () => {
    const sbx = fakeSandbox();
    const gone = await prepareOpenCodeRun(args(sbx, fakeFetch({ existingOk: false }).f, { existingSessionId: "ses_old", existingSandboxId: "sbx_9" }) as any);
    expect(gone.sessionId).toBe("ses_new");
    const other = await prepareOpenCodeRun(args(sbx, fakeFetch({ existingOk: true }).f, { existingSessionId: "ses_old", existingSandboxId: "sbx_other" }) as any);
    expect(other.sessionId).toBe("ses_new");
  });
});
