import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { canonicalizeMcpUrl } from "../mcp-url-validation";
import type { RegistryPlugin, RegistrySnapshot } from "./types";

const REGISTRY = "https://registry.modelcontextprotocol.io/v0.1/servers";
const OFFICIAL = "io.modelcontextprotocol.registry/official";
const FRESH_MS = 60 * 60_000;
const BINDING_MAX_AGE_MS = 24 * FRESH_MS;
const MAX_PAGES = 20;
const MAX_PAGE_BYTES = 2_000_000;
const cacheFile = () =>
  process.env.RIFT_MCP_REGISTRY_CACHE_PATH ||
  join(homedir(), ".cache", "rift", "mcp-registry-v1.json");
let memory: RegistrySnapshot | undefined;
let pending: Promise<RegistrySnapshot> | undefined;
let diskRead = false;
let retryAfter = 0;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, max: number) =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .trim()
        .slice(0, max)
    : "";
export function registryIdentity(
  namespace: string,
  version: string,
  url: string,
  transport: string,
) {
  return `registry-${createHash("sha256")
    .update(JSON.stringify([namespace, version, url, transport]))
    .digest("hex")
    .slice(0, 40)}`;
}

/** Registry descriptions remain inert text; remote icons and package commands are never executed. */
export function normalizeRegistryRecords(records: unknown): RegistryPlugin[] {
  if (!Array.isArray(records)) return [];
  const result = new Map<string, RegistryPlugin>();
  for (const raw of records.slice(0, 200)) {
    const record = object(raw),
      server = object(record.server);
    const meta = object(object(record._meta)[OFFICIAL]);
    if (meta.status !== "active" || meta.isLatest !== true) continue;
    const namespace = text(server.name, 200),
      version = text(server.version, 100);
    if (!namespace.includes("/") || !version) continue;
    for (const rawRemote of (Array.isArray(server.remotes)
      ? server.remotes
      : []
    ).slice(0, 8)) {
      const remote = object(rawRemote);
      if (remote.type !== "streamable-http" && remote.type !== "sse") continue;
      if (typeof remote.url !== "string" || /[{}]/.test(remote.url)) continue;
      try {
        const url = canonicalizeMcpUrl(remote.url);
        // Parameterized/custom-header servers need provider-specific setup; never assume credentials.
        if (
          Array.isArray(remote.headers) &&
          remote.headers.some((header) => object(header).isRequired === true)
        )
          continue;
        const transport = remote.type === "sse" ? "sse" : "http";
        const id = registryIdentity(namespace, version, url, transport);
        let setupUrl = `https://registry.modelcontextprotocol.io/?q=${encodeURIComponent(namespace)}`;
        try {
          if (server.websiteUrl)
            setupUrl = canonicalizeMcpUrl(String(server.websiteUrl));
        } catch {
          /* registry detail fallback */
        }
        result.set(id, {
          id,
          namespace,
          version,
          name:
            text(server.title, 80) || namespace.split("/").at(-1)!.slice(0, 80),
          description: text(server.description, 280),
          url,
          transport,
          setupUrl,
        });
        break; // One canonical supported endpoint per published server.
      } catch {
        /* Unsafe, local, credential-bearing and malformed endpoints are not offered. */
      }
    }
  }
  return [...result.values()];
}

export async function fetchRegistrySnapshot(
  fetcher: typeof fetch = fetch,
): Promise<RegistrySnapshot> {
  const entries = new Map<string, RegistryPlugin>();
  const cursors = new Set<string>();
  let cursor = "",
    truncated = false;
  const signal = AbortSignal.timeout(15_000);
  const startedAt = Date.now();
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(REGISTRY);
    url.searchParams.set("limit", "100");
    url.searchParams.set("version", "latest");
    if (cursor) url.searchParams.set("cursor", cursor);
    let response: Response;
    try {
      response = await fetcher(url, {
        signal,
        redirect: "error",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      if (signal.aborted && entries.size > 0) {
        truncated = true;
        break;
      }
      throw error;
    }
    if (!response.ok) throw new Error("Registry unavailable");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Registry returned an empty response");
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        size += chunk.value.length;
        if (size > MAX_PAGE_BYTES)
          throw new Error("Registry response too large");
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    const body = object(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!Array.isArray(body.servers))
      throw new Error("Invalid registry response");
    for (const entry of normalizeRegistryRecords(body.servers))
      entries.set(entry.id, entry);
    const next = object(body.metadata).nextCursor;
    if (typeof next !== "string" || !next) {
      truncated = false;
      break;
    }
    if (next.length > 1000 || cursors.has(next))
      throw new Error("Invalid registry cursor");
    cursors.add(next);
    cursor = next;
    truncated = page === MAX_PAGES - 1;
    if (Date.now() - startedAt > 8_000) {
      truncated = true;
      break;
    }
  }
  return { entries: [...entries.values()], fetchedAt: Date.now(), truncated };
}

function refresh() {
  if (!pending)
    pending = fetchRegistrySnapshot()
      .then(async (snapshot) => {
        memory = snapshot;
        try {
          const file = cacheFile();
          await mkdir(dirname(file), { recursive: true });
          const temporary = `${file}.${randomUUID()}.tmp`;
          await writeFile(temporary, JSON.stringify(snapshot), { mode: 0o600 });
          await rename(temporary, file);
        } catch {
          /* Read-only hosts keep memory cache; curated entries remain available. */
        }
        return snapshot;
      })
      .catch((error) => {
        retryAfter = Date.now() + 60_000;
        throw error;
      })
      .finally(() => {
        pending = undefined;
      });
  return pending;
}

export async function getRegistrySnapshot(): Promise<RegistrySnapshot> {
  if (!diskRead) {
    diskRead = true;
    try {
      // This per-user runtime cache is not a bundled source asset.
      const raw = await readFile(/* turbopackIgnore: true */ cacheFile(), "utf8");
      if (raw.length < 4_000_000) {
        const snapshot = JSON.parse(raw) as RegistrySnapshot;
        if (
          Number.isFinite(snapshot.fetchedAt) &&
          snapshot.fetchedAt <= Date.now() &&
          Array.isArray(snapshot.entries) &&
          snapshot.entries.length <= 2000 &&
          snapshot.entries.every(
            (entry) =>
              entry.id ===
              registryIdentity(
                entry.namespace,
                entry.version,
                canonicalizeMcpUrl(entry.url),
                entry.transport,
              ),
          )
        )
          memory = snapshot;
      }
    } catch {
      /* First launch or damaged cache. */
    }
  }
  if (memory) {
    if (Date.now() - memory.fetchedAt > FRESH_MS && Date.now() > retryAfter)
      void refresh().catch(() => undefined);
    return memory;
  }
  if (Date.now() < retryAfter)
    throw new Error("Registry temporarily unavailable");
  return refresh();
}

export async function resolveRegistryBinding(input: {
  catalogId?: string;
  url: string;
  transport: "http" | "sse";
}): Promise<boolean> {
  if (!input.catalogId?.startsWith("registry-")) return false;
  let snapshot = await getRegistrySnapshot();
  if (Date.now() - snapshot.fetchedAt > BINDING_MAX_AGE_MS)
    snapshot = await refresh();
  const entry = snapshot.entries.find(
    (candidate) => candidate.id === input.catalogId,
  );
  if (!entry || entry.url !== input.url || entry.transport !== input.transport)
    throw new Error(
      "Registry plugin changed. Refresh the catalog before connecting.",
    );
  return true;
}
