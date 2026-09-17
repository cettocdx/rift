import "server-only";
import { NotFoundError, Sandbox } from "@e2b/code-interpreter";
import { getSandboxContext } from "@/lib/ai/sandbox-context";
import type { SavedPreview } from "./saved-preview";

export type PreviewHealthStatus =
  | "running"
  | "stopped"
  | "missing"
  | "paused"
  | "transient"
  | "stale"
  | "unsupported"
  | "unavailable";
export type PreviewHealth = { status: PreviewHealthStatus; url?: string };

/** Extract only the exact ID encoded in a persisted E2B root URL. No URL is fetched. */
export function persistedSandboxId(
  preview: SavedPreview,
  domain: string,
): string | null {
  try {
    const url = new URL(preview.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      !Number.isInteger(preview.port) ||
      preview.port < 1 ||
      preview.port > 65535
    )
      return null;
    const prefix = `${preview.port}-`;
    const suffix = `.${domain}`;
    if (!url.hostname.startsWith(prefix) || !url.hostname.endsWith(suffix))
      return null;
    const id = url.hostname.slice(prefix.length, -suffix.length);
    return /^[a-z0-9][a-z0-9-]{0,127}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function inspectSavedPreview(
  preview: SavedPreview,
  namespace: string,
  options: { resumePaused?: boolean } = {},
): Promise<PreviewHealth> {
  const origin = getSandboxContext();
  const domain = origin.connection.domain ?? "e2b.app";
  try {
    const savedUrl = new URL(preview.url);
    if (
      (savedUrl.protocol === "http:" || savedUrl.protocol === "https:") &&
      !savedUrl.username &&
      !savedUrl.password &&
      !savedUrl.hostname.endsWith(`.${domain}`)
    )
      return { status: "unsupported" };
  } catch {
    return { status: "unavailable" };
  }
  const sandboxId = persistedSandboxId(preview, domain);
  if (!sandboxId) return { status: "unavailable" };
  const connection = { ...origin.connection, requestTimeoutMs: 5000 };
  try {
    const info = await Sandbox.getInfo(sandboxId, connection);
    // Never choose the first sandbox in a namespace or silently follow a replacement.
    if (info.sandboxId !== sandboxId || info.metadata?.userID !== namespace)
      return { status: "unavailable" };
    // connect resumes paused instances; observation must not do that.
    const resuming = info.state === "paused" && options.resumePaused === true;
    if (info.state === "paused" && !resuming) return { status: "paused" };
    if (info.state !== "running" && !resuming) return { status: "transient" };
    const sandbox = await Sandbox.connect(sandboxId, connection);
    const host = sandbox.getHost(preview.port);
    const url = /^https?:\/\//.test(host) ? host : `https://${host}`;
    if (new URL(url).href !== new URL(preview.url).href)
      return { status: "stale" };
    // No redirects, shell interpolation from strings, external requests or file writes.
    const readStatus = `code=$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --connect-timeout 2 --max-time 3 http://127.0.0.1:${preview.port}/); result=$?;`;
    // A resumed process may need a moment to accept connections. This only
    // observes readiness: it never launches a server or modifies its files.
    const command = resuming
      ? `for attempt in 1 2 3; do ${readStatus} case "$result:$code" in 0:2??|0:3??) break;; esac; [ "$attempt" = 3 ] || sleep 1; done;`
      : readStatus;
    const probe = await sandbox.commands.run(
      `${command} printf 'RIFT_PREVIEW:%s:%s' "$result" "$code"`,
      { timeoutMs: resuming ? 13000 : 5000 },
    );
    const match = /^RIFT_PREVIEW:(\d+):(\d{3})$/.exec(probe.stdout.trim());
    if (!match) return { status: "transient" };
    if (match[1] === "7") return { status: "stopped" };
    if (match[1] !== "0") return { status: "transient" };
    const code = Number(match[2]);
    return code >= 200 && code < 400
      ? { status: "running", url }
      : { status: "unavailable" };
  } catch (error) {
    // Auth/rate-limit/network failures are not evidence of deletion.
    return { status: error instanceof NotFoundError ? "missing" : "transient" };
  }
}
