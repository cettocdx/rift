"use client";
import { useMemo, useState } from "react";
import { ChevronDown, Package, Search } from "lucide-react";
import type {
  RegistryPlugin,
  RegistrySnapshot,
} from "@/lib/ai/mcp/registry/types";
import type { McpCatalogEntry } from "./mcpCatalog";
import { MCP_CATALOG } from "./mcpCatalog";
import { Button } from "@/components/ui/button";

/** Loaded on demand; upstream discovery never delays the local curated catalog. */
export function RegistryPlugins({
  onSelect,
  installedUrls,
  active = true,
}: {
  onSelect: (entry: McpCatalogEntry) => void;
  installedUrls: string[];
  active?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<
    (RegistrySnapshot & { stale: boolean }) | null
  >(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [count, setCount] = useState(24);
  const load = async () => {
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/mcp/discovery");
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Registry unavailable.");
      setSnapshot(body);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Registry unavailable.",
      );
    } finally {
      setLoading(false);
    }
  };
  const entries = useMemo(() => {
    const key = (url: string) => url.replace(/\/$/, "");
    const known = new Set([
      ...MCP_CATALOG.map((entry) => key(entry.url)),
      ...installedUrls.map(key),
    ]);
    const seen = new Set<string>();
    return (snapshot?.entries ?? []).filter((entry) => {
      const url = key(entry.url);
      if (known.has(url) || seen.has(url)) return false;
      seen.add(url);
      return `${entry.name} ${entry.namespace} ${entry.description}`
        .toLowerCase()
        .includes(query.trim().toLowerCase());
    });
  }, [snapshot, installedUrls, query]);
  const select = (entry: RegistryPlugin) =>
    onSelect({
      ...entry,
      category: "Developer Tools",
      auth: "none",
      availability: "requires_configuration",
      domain: new URL(entry.url).hostname,
      logoPath: "/plugin-logos/registry.svg",
    });
  return (
    <section
      className="mb-7 border-t border-border pt-5"
      aria-label="Official MCP Registry"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between rounded-md py-2 text-left text-[13px] font-medium focus-visible:outline focus-visible:outline-1 focus-visible:outline-muted-foreground"
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
          if (!open && !snapshot) void load();
        }}
      >
        <span>
          Explore the MCP Registry{" "}
          <span className="ml-2 text-[12px] font-normal text-muted-foreground">
            Community servers
          </span>
        </span>
        <ChevronDown
          aria-hidden
          className={`size-4 transition-transform motion-reduce:transition-none ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && active ? (
        <div className="pt-3">
          <p className="mb-3 text-[12px] leading-5 text-muted-foreground">
            Published remote servers. Sign-in or an API key may be required;
            tools are verified before a connection is saved.
          </p>
          <label className="mb-4 flex h-9 items-center gap-2 rounded-lg border border-border px-3">
            <Search aria-hidden className="size-3.5 text-muted-foreground" />
            <input
              aria-label="Search registry servers"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
              placeholder="Search name, publisher or purpose"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setCount(24);
              }}
            />
          </label>
          {loading ? (
            <p role="status" className="text-[12px] text-muted-foreground">
              Loading Registry…
            </p>
          ) : null}
          {error ? (
            <div
              role="status"
              className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground"
            >
              <span>{error}</span>
              <Button variant="outline" size="sm" onClick={() => void load()}>
                Retry
              </Button>
            </div>
          ) : null}
          {snapshot?.stale ? (
            <p className="mb-3 text-[12px] text-muted-foreground">
              Showing the last saved catalog. Refreshing in the background.
            </p>
          ) : null}
          <div className="rift-plugin-grid">
            {entries.slice(0, count).map((entry) => (
              <article key={entry.id} className="rift-plugin-row">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border text-muted-foreground">
                  <Package aria-hidden className="size-6" strokeWidth={1.5} />
                </span>
                <div className="min-w-0 flex-1">
                  <span className="rift-plugin-name">{entry.name}</span>
                  <span
                    className="rift-plugin-description"
                    title={entry.description}
                  >
                    {entry.description}
                  </span>
                  <span
                    className="block truncate text-[11px] leading-4 text-muted-foreground"
                    title={`${entry.namespace} · ${entry.version}`}
                  >
                    {entry.namespace}
                  </span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="rift-plugin-action"
                  onClick={() => select(entry)}
                >
                  Set up
                </Button>
              </article>
            ))}
          </div>
          {snapshot && !loading && entries.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">
              No additional remote servers match this search.
            </p>
          ) : null}
          {entries.length > count ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => setCount(count + 24)}
            >
              Show more servers
            </Button>
          ) : null}
          {snapshot ? (
            <div className="mt-4 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>
                Official Registry · {snapshot.entries.length} remote servers
              </span>
              <button
                type="button"
                disabled={loading}
                onClick={() => void load()}
                className="rounded px-2 py-1 hover:text-foreground focus-visible:outline focus-visible:outline-1 focus-visible:outline-muted-foreground disabled:opacity-50"
              >
                Refresh catalog
              </button>
            </div>
          ) : null}
          {snapshot?.truncated ? (
            <p className="mt-3 text-[11px] text-muted-foreground">
              Showing a bounded Registry snapshot. More servers are available in
              the{" "}
              <a
                href="https://registry.modelcontextprotocol.io/"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                official Registry
              </a>
              .
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
