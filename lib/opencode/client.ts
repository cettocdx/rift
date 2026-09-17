/**
 * Minimal raw-fetch client for the OpenCode v1 HTTP API (1.18.x).
 *
 * Deliberately not `@opencode-ai/sdk`: the routes below were verified live in
 * the feasibility spike, the SDK's generated method names were not, and a
 * ~120-line facade is trivial to fake in tests. Every call carries Basic auth
 * and the session directory (as `?directory=` on GET, header otherwise — the
 * server accepts both; once a session exists its stored directory wins).
 */

export interface OpenCodeClientOptions {
  baseUrl: string;
  authHeader: string;
  directory: string;
  fetchImpl?: typeof fetch;
}

export interface OpenCodeEvent {
  type: string;
  properties?: Record<string, unknown>;
}

export interface PromptPart {
  type: "text";
  text: string;
}

export interface PromptBody {
  parts: PromptPart[];
  model?: { providerID: string; modelID: string };
  agent?: string;
  system?: string;
  variant?: string;
}

export class OpenCodeHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    body: string,
  ) {
    super(`OpenCode ${path} → ${status}: ${body.slice(0, 300)}`);
  }
}

export function createOpenCodeClient(opts: OpenCodeClientOptions) {
  const f = opts.fetchImpl ?? fetch;
  const dir = encodeURIComponent(opts.directory);
  const headers = (json: boolean) => ({
    Authorization: opts.authHeader,
    "x-opencode-directory": dir,
    ...(json ? { "Content-Type": "application/json" } : {}),
  });

  async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const url = `${opts.baseUrl}${path}${method === "GET" ? (path.includes("?") ? "&" : "?") + `directory=${dir}` : ""}`;
    const res = await f(url, {
      method,
      headers: headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
    if (!res.ok) throw new OpenCodeHttpError(res.status, path, await res.text().catch(() => ""));
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  return {
    health: () => call<{ healthy: boolean; version: string }>("GET", "/global/health"),

    createSession: (input?: { title?: string; parentID?: string }) =>
      call<{ id: string; directory?: string }>("POST", "/session", input ?? {}),

    getSession: (id: string) => call<{ id: string }>("GET", `/session/${id}`),

    listMessages: (id: string, limit?: number) =>
      call<Array<{ info: Record<string, unknown>; parts: Array<Record<string, unknown>> }>>(
        "GET",
        `/session/${id}/message${limit ? `?limit=${limit}` : ""}`,
      ),

    /** 204 immediately; the turn streams via events, failures surface as `session.error`. */
    promptAsync: (id: string, body: PromptBody) => call<void>("POST", `/session/${id}/prompt_async`, body),

    abort: (id: string) => call<boolean>("POST", `/session/${id}/abort`, {}),

    replyPermission: (requestID: string, reply: "once" | "always" | "reject", message?: string) =>
      call<void>("POST", `/permission/${requestID}/reply`, { reply, ...(message ? { message } : {}) }),

    rejectQuestion: (requestID: string) => call<void>("POST", `/question/${requestID}/reject`, {}),

    listPendingPermissions: () => call<Array<{ id: string; sessionID: string }>>("GET", "/permission"),

    /**
     * Server-sent events for this directory. Yields parsed frames; ends when the
     * response ends or `signal` aborts. Subscribe BEFORE prompting — listener
     * registration is eager on the server, so nothing published afterwards is lost.
     */
    async *events(signal?: AbortSignal): AsyncGenerator<OpenCodeEvent> {
      const res = await f(`${opts.baseUrl}/event?directory=${dir}`, {
        headers: { Authorization: opts.authHeader },
        signal,
      });
      if (!res.ok || !res.body) throw new OpenCodeHttpError(res.status, "/event", await res.text().catch(() => ""));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame
              .split("\n")
              .filter((l) => l.startsWith("data:"))
              .map((l) => l.slice(5).trim())
              .join("");
            if (!data) continue;
            try {
              yield JSON.parse(data) as OpenCodeEvent;
            } catch {
              /* skip malformed frame */
            }
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

export type OpenCodeClient = ReturnType<typeof createOpenCodeClient>;
