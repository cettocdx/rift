"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { OAUTH_RESULT_MESSAGES } from "@/lib/github/oauth-result-messages";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  CircleHelp,
  ExternalLink,
  KeyRound,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";

import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CodexEmptyState,
  CodexPageHeader,
  CodexPageShell,
  CodexSectionHeading,
} from "./page-shell/CodexPageShell";
import { logoNeedsPlate } from "./mcp-logo-tone";
import { RegistryPlugins } from "./RegistryPlugins";
import styles from "./McpMarketplace.module.css";
import {
  MCP_CATALOG,
  MCP_CATEGORY_ORDER,
  getMcpProviderUrl,
  normalizeMcpUrl,
  type McpCatalogCategory,
  type McpCatalogEntry,
} from "./mcpCatalog";

const CATALOG_PAGE_SIZE = 36;

type MarketplaceStateFilter = "all" | "available" | "setup" | "installed";
type ApiAuthKind = "none" | "bearer" | "api_key_header";
type WizardAuthKind = ApiAuthKind | "oauth";

type ConnectionAuth = {
  kind: ApiAuthKind;
  secret?: string;
  headerName?: string;
};

type ApiResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  authorizationUrl?: string;
  toolCount?: number;
  toolNames?: string[];
};

type ConnectionDraft = {
  catalogId?: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  authKind: WizardAuthKind;
  secret?: string;
  headerName?: string;
};

type MarketplaceServer = {
  _id: string;
  catalogId?: string;
  name: string;
  url: string;
  transport: "http" | "sse";
  enabled: boolean;
  hasAuth: boolean;
  headerKeys: string[];
  authKind?: WizardAuthKind;
  connectionStatus: "verified" | "needs_attention" | "unknown";
  lastCheckedAt?: number;
  toolCount?: number;
  toolNames?: string[];
  created_at: number;
  updated_at: number;
};

type MarketplaceServerWire = Omit<MarketplaceServer, "connectionStatus"> & {
  connectionStatus?: MarketplaceServer["connectionStatus"];
};

type WizardState =
  | { mode: "catalog"; entry: McpCatalogEntry }
  | { mode: "custom" }
  | {
      mode: "edit";
      server: MarketplaceServer;
      entry: McpCatalogEntry | null;
    }
  | null;

type RecentVerification = {
  catalogId?: string;
  url: string;
  toolCount: number;
  toolNames: string[];
};

const MARKETPLACE_STATE_OPTIONS: Array<{
  value: MarketplaceStateFilter;
  label: string;
}> = [
  { value: "all", label: "All plugins" },
  { value: "available", label: "One-click" },
  { value: "setup", label: "Setup required" },
  { value: "installed", label: "Installed" },
];

const AUTH_OPTIONS: Array<{ value: WizardAuthKind; label: string }> = [
  { value: "none", label: "No authentication" },
  { value: "bearer", label: "Bearer token" },
  { value: "api_key_header", label: "API-key header" },
  { value: "oauth", label: "OAuth" },
];

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data?.message) return data.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

function apiError(result: ApiResult | null, fallback: string): string {
  return result?.error?.trim() || result?.message?.trim() || fallback;
}

function recoveryCopy(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes("denied")) {
    return "Start OAuth again when you are ready to approve this connection.";
  }
  if (
    normalized.includes("expired") ||
    normalized.includes("could not be verified")
  ) {
    return "Start the OAuth connection again from the provider card below.";
  }
  if (normalized.includes("storage") || normalized.includes("unavailable")) {
    return "The connection service is not ready. Retry shortly or contact your workspace administrator.";
  }
  if (normalized.includes("credential") || normalized.includes("token")) {
    return "Check the credential at the provider, then enter a fresh value and retry.";
  }
  if (normalized.includes("already connected")) {
    return "Open the existing connection below to verify or edit it.";
  }
  return "Confirm the MCP endpoint and authentication method, then retry verification.";
}

function availability(entry: McpCatalogEntry): string {
  return String(entry.availability);
}

function requiresEndpoint(entry: McpCatalogEntry): boolean {
  // `unsupported` keeps rolling deployments usable while the catalog migrates
  // to the actionable `requires_endpoint` contract.
  return ["requires_endpoint", "unsupported"].includes(availability(entry));
}

function availabilityLabel(entry: McpCatalogEntry): string {
  if (availability(entry) === "available") return "One-click";
  if (entry.auth === "oauth" && !requiresEndpoint(entry)) return "OAuth";
  if (requiresEndpoint(entry)) return "Endpoint required";
  return "Setup required";
}

function entryRank(entry: McpCatalogEntry): number {
  // Whether a hosted endpoint exists is the difference that matters to the
  // reader: those connect in one press, the rest need an endpoint supplied.
  // Sorting on it puts everything that actually works first instead of
  // scattering the working providers through a list of ones that cannot.
  if (!entry.url) return 3;
  if (availability(entry) === "available" && entry.auth === "none") return 0;
  if (!requiresEndpoint(entry)) return 1;
  return 2;
}

function normalizeMarketplaceServer(
  server: MarketplaceServerWire,
): MarketplaceServer {
  return {
    ...server,
    headerKeys: server.headerKeys ?? [],
    toolNames: server.toolNames ?? [],
    connectionStatus: server.connectionStatus ?? "unknown",
  };
}

function catalogEntryForServer(
  server: MarketplaceServer,
): McpCatalogEntry | undefined {
  if (server.catalogId)
    return MCP_CATALOG.find((entry) => entry.id === server.catalogId);
  const exact = MCP_CATALOG.find(
    (entry) =>
      entry.url && normalizeMcpUrl(entry.url) === normalizeMcpUrl(server.url),
  );
  if (exact) return exact;
  // Firecrawl's earlier endpoint used an account-specific URL. Keep an existing
  // connection represented once when showing its new, fixed OAuth endpoint.
  try {
    if (new URL(server.url).hostname === "mcp.firecrawl.dev")
      return MCP_CATALOG.find((entry) => entry.id === "firecrawl");
  } catch {
    /* A malformed legacy endpoint remains a custom connection. */
  }
  return undefined;
}

function inferAuthKind(server: MarketplaceServer): WizardAuthKind {
  if (server.authKind) return server.authKind;
  if (!server.hasAuth) return "none";
  return server.headerKeys.some(
    (header) => header.toLowerCase() === "authorization",
  )
    ? "bearer"
    : "api_key_header";
}

function verificationKey(catalogId: string | undefined, url: string): string {
  return catalogId ? `catalog:${catalogId}` : `url:${normalizeMcpUrl(url)}`;
}

function EntryBadge({
  entry,
  size = 36,
}: {
  entry: Pick<McpCatalogEntry, "logoPath">;
  size?: number;
}) {
  // Consistent optical size; dark brand marks retain a light plate.
  const needsPlate = logoNeedsPlate(entry.logoPath);
  const logoSize = Math.min(24, Math.round(size * 0.67));

  return (
    <span
      className={`rift-plugin-logo flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-border ${
        needsPlate ? "bg-[#f8f9fb]" : "bg-muted/40"
      }`}
      style={{ width: size, height: size }}
    >
      <Image
        src={entry.logoPath}
        alt=""
        width={logoSize}
        height={logoSize}
        unoptimized
        draggable={false}
        className="select-none object-contain"
        style={{ width: logoSize, height: logoSize }}
      />
    </span>
  );
}

function FallbackBadge({ name, size = 36 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-[10px] border border-border bg-muted/40 text-ui-caption font-medium text-muted-foreground"
      style={{ width: size, height: size }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

function StatusBadge({ server }: { server: MarketplaceServer }) {
  const needsAttention = server.connectionStatus === "needs_attention";
  const unknown = server.connectionStatus === "unknown";
  return (
    <span
      className={`inline-flex min-h-6 items-center gap-1 rounded-[4px] border px-2 text-ui-caption font-medium ${
        needsAttention
          ? "border-amber-500/30 bg-amber-500/10 text-amber-500"
          : unknown
            ? "border-border/80 bg-muted/20 text-muted-foreground"
            : server.enabled
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
              : "border-border/80 bg-muted/20 text-muted-foreground"
      }`}
    >
      {needsAttention ? (
        <CircleAlert className="size-3" aria-hidden />
      ) : unknown ? (
        <CircleHelp className="size-3" aria-hidden />
      ) : (
        <Check className="size-3" aria-hidden />
      )}
      {needsAttention
        ? "Needs attention"
        : unknown
          ? "Not checked"
          : server.enabled
            ? "Connected"
            : "Disabled"}
    </span>
  );
}

function InlineError({
  message,
  showRecovery = true,
}: {
  message: string;
  showRecovery?: boolean;
}) {
  return (
    <div
      role="alert"
      className="mt-2.5 rounded-md border border-destructive/35 bg-destructive/5 px-3 py-2.5 text-ui-label leading-4"
    >
      <div className="flex items-start gap-2 font-medium text-foreground">
        <CircleAlert
          className="mt-0.5 size-3.5 shrink-0 text-destructive"
          aria-hidden
        />
        <span>{message}</span>
      </div>
      {showRecovery && (
        <p className="mt-1 pl-[22px] text-muted-foreground">
          {recoveryCopy(message)}
        </p>
      )}
    </div>
  );
}

async function readApiResult(response: Response): Promise<ApiResult> {
  return (await response.json().catch(() => ({}))) as ApiResult;
}

function buildAuth(draft: ConnectionDraft): ConnectionAuth {
  const secret = draft.secret?.trim();
  if (draft.authKind === "bearer") {
    return { kind: "bearer", ...(secret ? { secret } : {}) };
  }
  if (draft.authKind === "api_key_header") {
    return {
      kind: "api_key_header",
      headerName: draft.headerName?.trim() || "X-API-Key",
      ...(secret ? { secret } : {}),
    };
  }
  return { kind: "none" };
}

export function McpMarketplace({
  extensionTabs,
  active = true,
  navigateToAuthorization = (url) => window.location.assign(url),
}: {
  extensionTabs?: ReactNode;
  active?: boolean;
  navigateToAuthorization?: (url: string) => void;
} = {}) {
  const router = useRouter();
  const serverQuery = useQuery(api.mcpServers.listForUser, {});
  const setEnabled = useMutation(api.mcpServers.setServerEnabled);
  const removeServer = useMutation(api.mcpServers.removeServer);

  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<McpCatalogCategory | "All">("All");
  // Which side of the category row still has chips off-screen. Drives the edge
  // fade below, standing in for the scrollbar the row deliberately hides.
  const categoryRowRef = useRef<HTMLDivElement>(null);
  const [categoryEdges, setCategoryEdges] = useState({
    start: false,
    end: false,
  });

  useEffect(() => {
    const row = categoryRowRef.current;
    if (!row) return;
    const update = () => {
      const maxScroll = row.scrollWidth - row.clientWidth;
      setCategoryEdges((previous) => {
        // A 2px tolerance keeps sub-pixel scroll offsets from flickering the
        // fade on and off at either end.
        const next = {
          start: row.scrollLeft > 2,
          end: row.scrollLeft < maxScroll - 2,
        };
        return previous.start === next.start && previous.end === next.end
          ? previous
          : next;
      });
    };
    update();
    row.addEventListener("scroll", update, { passive: true });
    // The row also has to re-measure when the panel is resized or the chip set
    // changes, not only when it is scrolled. Guarded because the fade is a
    // refinement, not a requirement: an environment without ResizeObserver
    // should still render the categories rather than throw on mount.
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(row);
    return () => {
      row.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, []);

  const categoryFadeMask =
    categoryEdges.start || categoryEdges.end
      ? `linear-gradient(to right, transparent 0, black ${
          categoryEdges.start ? "24px" : "0px"
        }, black calc(100% - ${categoryEdges.end ? "24px" : "0px"}), transparent 100%)`
      : undefined;
  const [activeState, setActiveState] = useState<MarketplaceStateFilter>("all");
  const [visibleCount, setVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [wizard, setWizard] = useState<WizardState>(null);
  // The card the reader tapped. Its sheet is where the endpoint, the
  // description and the single connect action live.
  const [detailEntry, setDetailEntry] = useState<McpCatalogEntry | null>(null);

  // Some providers need an endpoint or credentials, so connecting from the
  // sheet hands off to the wizard. The sheet steps aside when that happens
  // rather than sitting open behind it.
  useEffect(() => {
    if (wizard) setDetailEntry(null);
  }, [wizard]);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [busyConnectionId, setBusyConnectionId] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [openConnectionMenuId, setOpenConnectionMenuId] = useState<
    string | null
  >(null);
  useEffect(() => {
    if (active) return;
    // Keep filters/scroll when switching tabs, never a hidden portalled dialog
    // or an armed destructive confirmation above the newly selected panel.
    setWizard(null);
    setDetailEntry(null);
    setConfirmRemoveId(null);
    setOpenConnectionMenuId(null);
  }, [active]);
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [oauthResultError, setOauthResultError] = useState<string | null>(null);
  const [recentVerifications, setRecentVerifications] = useState<
    ReadonlyMap<string, RecentVerification>
  >(() => new Map());

  useEffect(() => {
    const handleResult = () => {
      const currentUrl = new URL(window.location.href);
      const githubResult = currentUrl.searchParams.get("github");
      if (githubResult && currentUrl.searchParams.get("connect") === "github") {
        // Claim this plugin return before another mounted consumer can read it.
        // The sidebar defers connect=github results to this page.
        currentUrl.searchParams.delete("github");
        currentUrl.searchParams.delete("connect");
        window.history.replaceState(
          window.history.state,
          "",
          `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
        );
        const entry =
          OAUTH_RESULT_MESSAGES[githubResult] ?? OAUTH_RESULT_MESSAGES.error;
        if (entry.kind === "success") {
          setOauthResultError(null);
          toast.success(entry.message);
        } else {
          setOauthResultError(entry.message);
          toast.error(entry.message);
        }
      }
      const oauthResult = currentUrl.searchParams.get("oauth");
      if (!oauthResult) return;
      const reason = currentUrl.searchParams.get("reason");
      currentUrl.searchParams.delete("oauth");
      currentUrl.searchParams.delete("reason");
      window.history.replaceState(
        window.history.state,
        "",
        `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
      );

      if (oauthResult === "connected") {
        setOauthResultError(null);
        toast.success("OAuth plugin connected and verified.");
      } else {
        const message =
          reason === "denied"
            ? "OAuth authorization was denied. No plugin was connected."
            : reason === "expired"
              ? "OAuth authorization expired. Start the connection again."
              : reason === "invalid"
                ? "OAuth callback could not be verified. Start again from Plugins."
                : reason === "unavailable"
                  ? "The provider connection could not be verified. Retry the connection."
                  : "OAuth authorization could not be completed. Retry the connection.";
        setOauthResultError(message);
        toast.error(message);
      }
    };
    handleResult();
    window.addEventListener("popstate", handleResult);
    return () => window.removeEventListener("popstate", handleResult);
  }, []);

  const installedServers = useMemo(
    () =>
      ((serverQuery ?? []) as unknown as MarketplaceServerWire[]).map(
        normalizeMarketplaceServer,
      ),
    [serverQuery],
  );

  const installedByCatalogId = useMemo(() => {
    const result = new Map<string, MarketplaceServer>();
    for (const server of installedServers) {
      const entry = catalogEntryForServer(server);
      if (entry) result.set(entry.id, server);
    }
    return result;
  }, [installedServers]);

  const installedByUrl = useMemo(() => {
    const result = new Map<string, MarketplaceServer>();
    for (const server of installedServers) {
      // A persisted catalog id is authoritative. URL fallback is reserved for
      // legacy/custom rows so one provider cannot impersonate another card by
      // sharing an endpoint during a migration.
      if (!server.catalogId && server.url) {
        result.set(normalizeMcpUrl(server.url), server);
      }
    }
    return result;
  }, [installedServers]);

  const serverForEntry = (entry: McpCatalogEntry) =>
    installedByCatalogId.get(entry.id) ??
    (entry.url ? installedByUrl.get(normalizeMcpUrl(entry.url)) : undefined);

  const recentForEntry = (entry: McpCatalogEntry) =>
    recentVerifications.get(verificationKey(entry.id, entry.url));

  useEffect(() => {
    setRecentVerifications((current) => {
      if (current.size === 0) return current;
      const next = new Map(current);
      for (const server of installedServers) {
        const key = verificationKey(server.catalogId, server.url);
        if (!next.has(key)) continue;
        const recent = next.get(key);
        if (
          recent &&
          server.toolCount === undefined &&
          (!server.toolNames || server.toolNames.length === 0)
        ) {
          continue;
        }
        next.delete(key);
      }
      return next.size === current.size ? current : next;
    });
  }, [installedServers]);

  const visibleEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return MCP_CATALOG.filter((entry) => {
      if (activeCat !== "All" && entry.category !== activeCat) return false;
      const installed = Boolean(
        installedByCatalogId.has(entry.id) ||
        (entry.url && installedByUrl.has(normalizeMcpUrl(entry.url))) ||
        recentVerifications.has(verificationKey(entry.id, entry.url)),
      );
      if (activeState === "installed" && !installed) return false;
      // Connected providers appear once, in the managed connections group.
      if (activeState === "all" && installed) return false;
      if (activeState === "available") {
        if (installed || availability(entry) !== "available") return false;
      }
      if (activeState === "setup") {
        if (installed || availability(entry) === "available") return false;
      }
      if (!normalizedQuery) return true;
      return [entry.name, entry.description, entry.category]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    }).sort((left, right) => {
      const rankDifference = entryRank(left) - entryRank(right);
      return rankDifference || left.name.localeCompare(right.name);
    });
  }, [
    activeCat,
    activeState,
    installedByCatalogId,
    installedByUrl,
    query,
    recentVerifications,
  ]);

  const renderedEntries = visibleEntries.slice(0, visibleCount);
  const grouped = MCP_CATEGORY_ORDER.map((category) => ({
    category,
    items: renderedEntries.filter((entry) => entry.category === category),
  })).filter((group) => group.items.length > 0);

  const filteredInstalledServers = installedServers.filter((server) => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const entry =
      (server.catalogId
        ? MCP_CATALOG.find((candidate) => candidate.id === server.catalogId)
        : undefined) ??
      MCP_CATALOG.find(
        (candidate) =>
          candidate.url &&
          normalizeMcpUrl(candidate.url) === normalizeMcpUrl(server.url),
      );
    if (activeCat !== "All" && entry?.category !== activeCat) return false;
    return (
      !normalizedQuery ||
      [server.name, server.url, ...(server.toolNames ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery)
    );
  });

  const loading = serverQuery === undefined;
  const connectionHealthMeta = useMemo(() => {
    const connected = installedServers.filter(
      (server) => server.enabled && server.connectionStatus === "verified",
    ).length;
    const attention = installedServers.filter(
      (server) => server.connectionStatus === "needs_attention",
    ).length;
    const disabled = installedServers.filter(
      (server) => !server.enabled,
    ).length;
    const unknown = installedServers.filter(
      (server) => server.enabled && server.connectionStatus === "unknown",
    ).length;
    return [
      `${connected} connected`,
      attention > 0 ? `${attention} attention` : null,
      unknown > 0 ? `${unknown} unchecked` : null,
      disabled > 0 ? `${disabled} disabled` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  }, [installedServers]);
  const filtersActive =
    Boolean(query.trim()) || activeCat !== "All" || activeState !== "all";
  const chips: Array<McpCatalogCategory | "All"> = [
    "All",
    ...MCP_CATEGORY_ORDER,
  ];

  const clearFilters = () => {
    setQuery("");
    setActiveCat("All");
    setActiveState("all");
    setVisibleCount(CATALOG_PAGE_SIZE);
  };

  const recordVerification = (
    catalogId: string | undefined,
    url: string,
    result: ApiResult,
  ) => {
    const verification: RecentVerification = {
      catalogId,
      url,
      toolCount: result.toolCount ?? result.toolNames?.length ?? 0,
      toolNames: result.toolNames ?? [],
    };
    setRecentVerifications((current) => {
      const next = new Map(current);
      next.set(verificationKey(catalogId, url), verification);
      return next;
    });
  };

  const connectWithDraft = async (
    draft: ConnectionDraft,
    server?: MarketplaceServer,
  ): Promise<{ ok: boolean; error?: string }> => {
    if (draft.authKind === "oauth") {
      if (!draft.catalogId) {
        return {
          ok: false,
          error:
            "OAuth setup must start from a catalog plugin so RIFT can verify the provider.",
        };
      }
      try {
        const response = await fetch("/api/mcp/oauth/start", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            catalogId: draft.catalogId,
            name: draft.name,
            url: draft.url,
            transport: draft.transport,
            ...(server ? { connectionId: server._id } : {}),
          }),
        });
        const result = await readApiResult(response);
        if (!response.ok || !result.ok || !result.authorizationUrl) {
          return {
            ok: false,
            error: apiError(result, "OAuth authorization could not start."),
          };
        }
        navigateToAuthorization(result.authorizationUrl);
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: errorMessage(error, "OAuth authorization could not start."),
        };
      }
    }

    const auth = buildAuth(draft);
    try {
      const response = await fetch(
        server ? "/api/mcp/recheck" : "/api/mcp/connect",
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(server ? { id: server._id } : {}),
            catalogId: draft.catalogId,
            name: draft.name,
            url: draft.url,
            transport: draft.transport,
            auth,
          }),
        },
      );
      const result = await readApiResult(response);
      if (!response.ok || !result.ok) {
        return {
          ok: false,
          error: apiError(
            result,
            server
              ? "Plugin verification failed."
              : "Plugin connection failed.",
          ),
        };
      }
      recordVerification(draft.catalogId, draft.url, result);
      toast.success(
        `${server ? "Verified" : "Connected"} ${draft.name} · ${result.toolCount ?? result.toolNames?.length ?? 0} tools`,
      );
      setWizard(null);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: errorMessage(
          error,
          server ? "Plugin verification failed." : "Plugin connection failed.",
        ),
      };
    }
  };

  const connectPublicEntry = async (entry: McpCatalogEntry) => {
    setBusyActionId(entry.id);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    const result = await connectWithDraft({
      catalogId: entry.id,
      name: entry.name,
      url: entry.url,
      transport: entry.transport,
      authKind: "none",
    });
    if (!result.ok && result.error) {
      setActionErrors((current) => ({ ...current, [entry.id]: result.error! }));
    }
    setBusyActionId(null);
  };

  const startEntryOAuth = async (entry: McpCatalogEntry) => {
    setBusyActionId(entry.id);
    setActionErrors((current) => {
      const next = { ...current };
      delete next[entry.id];
      return next;
    });
    const result = await connectWithDraft(
      {
        catalogId: entry.id,
        name: entry.name,
        url: entry.url,
        transport: entry.transport,
        authKind: "oauth",
      },
      serverForEntry(entry),
    );
    if (!result.ok && result.error) {
      setActionErrors((current) => ({ ...current, [entry.id]: result.error! }));
    }
    setBusyActionId(null);
  };

  const handleEntryAction = (entry: McpCatalogEntry) => {
    if (entry.connectFlow === "github") {
      navigateToAuthorization(
        "/api/github/authorize?return_to=%2Fplugins%3Fconnect%3Dgithub",
      );
      return;
    }
    if (requiresEndpoint(entry)) {
      setDetailEntry(null);
      setWizard({ mode: "catalog", entry });
      return;
    }
    if (entry.auth === "oauth") {
      void startEntryOAuth(entry);
      return;
    }
    if (availability(entry) === "available" && entry.auth === "none") {
      void connectPublicEntry(entry);
      return;
    }
    setDetailEntry(null);
    setWizard({ mode: "catalog", entry });
  };

  const handleToggle = async (server: MarketplaceServer, enabled: boolean) => {
    setBusyConnectionId(server._id);
    try {
      const result = await setEnabled({ id: server._id as never, enabled });
      const outcome = result as
        | { success?: boolean; error?: string }
        | undefined;
      if (outcome?.success === false) {
        throw new Error(outcome.error || "Plugin state could not be updated.");
      }
      toast.success(`${enabled ? "Enabled" : "Disabled"} ${server.name}`);
    } catch (error) {
      toast.error(errorMessage(error, "Plugin state could not be updated."));
    } finally {
      setBusyConnectionId(null);
    }
  };

  const handleRemove = async (server: MarketplaceServer) => {
    if (confirmRemoveId !== server._id) {
      setConfirmRemoveId(server._id);
      return;
    }
    setBusyConnectionId(server._id);
    try {
      const result = await removeServer({ id: server._id as never });
      const outcome = result as
        | { success?: boolean; error?: string }
        | undefined;
      if (outcome?.success === false) {
        throw new Error(outcome.error || "Plugin could not be removed.");
      }
      toast.success(`Removed ${server.name}`);
    } catch (error) {
      toast.error(errorMessage(error, "Plugin could not be removed."));
    } finally {
      setBusyConnectionId(null);
      setConfirmRemoveId(null);
    }
  };

  return (
    <CodexPageShell busy={loading} className="rift-plugins-page">
      <CodexPageHeader
        title="Plugins"
        description="Bring your tools and knowledge into every conversation."
        leading={
          <button
            type="button"
            onClick={() => router.push("/")}
            aria-label="Back to chat"
            className="mt-0.5 flex size-11 shrink-0 touch-manipulation items-center justify-center rounded-md border border-border/80 bg-card/20 text-muted-foreground transition-colors duration-(--duration-hover) hover:bg-accent hover:text-foreground focus-visible:outline-none md:hidden"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </button>
        }
      />

      {extensionTabs ? <div className="mb-5">{extensionTabs}</div> : null}
      {!filtersActive ? (
        <div className="rift-plugins-banner">
          <div>
            <p className="rift-plugins-banner-title">
              Your tools, working together.
            </p>
            <p>Bring your projects, knowledge and creative tools into Rift.</p>
          </div>
          <div className="rift-plugin-banner-connections" aria-hidden>
            {["Notion", "Linear", "GitHub"].map((name, index) => {
              const entry = MCP_CATALOG.find((item) => item.name === name)!;
              return (
                <div
                  className="rift-plugin-banner-pill"
                  key={name}
                  style={{ marginLeft: index === 1 ? 26 : 0 }}
                >
                  <EntryBadge entry={entry} size={28} />
                  <span>
                    {index === 0
                      ? "Find answers in your workspace"
                      : index === 1
                        ? "Keep your projects moving"
                        : "Work with your repositories"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {oauthResultError ? (
        <InlineError message={oauthResultError} showRecovery={false} />
      ) : null}

      <div className="sticky top-0 z-10 -mx-1 bg-background/95 px-1 pb-4 pt-1 backdrop-blur-md">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setVisibleCount(CATALOG_PAGE_SIZE);
              }}
              placeholder="Search by name or capability…"
              name="plugin-search"
              aria-label="Search plugins"
              autoComplete="off"
              spellCheck={false}
              className="h-11 touch-manipulation rounded-md border-border bg-[var(--surface,theme(colors.card.DEFAULT))] pl-9 pr-12 text-ui md:pr-9 md:pointer-fine:h-9"
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear plugin search"
                className="absolute right-0 top-1/2 flex size-11 -translate-y-1/2 touch-manipulation items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none md:right-1 md:pointer-fine:size-7"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            ) : null}
          </div>
          <label className="shrink-0">
            <span className="sr-only">Connection state</span>
            <select
              value={activeState}
              onChange={(event) => {
                setActiveState(event.target.value as MarketplaceStateFilter);
                setVisibleCount(CATALOG_PAGE_SIZE);
              }}
              aria-label="Filter plugins by state"
              className="h-11 w-full touch-manipulation rounded-md border border-border bg-[var(--surface,theme(colors.card.DEFAULT))] px-2.5 text-ui-label text-foreground outline-none md:w-auto md:pointer-fine:h-9"
            >
              {MARKETPLACE_STATE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* The row holds roughly twice as many categories as fit, and its
            scrollbar is hidden — so the last visible chip was being cut mid-word
            with nothing to say more existed. The mask fades whichever edge still
            has content behind it, which is the signal the hidden scrollbar used
            to carry. It fades neither edge once you reach that end, so the first
            and last chips are never dimmed for no reason. */}
        <div
          ref={categoryRowRef}
          style={{
            maskImage: categoryFadeMask,
            WebkitMaskImage: categoryFadeMask,
          }}
          className="mt-2.5 flex gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Plugin categories"
        >
          {chips.map((category) => (
            <button
              key={category}
              type="button"
              aria-pressed={activeCat === category}
              onClick={() => {
                setActiveCat(category);
                setVisibleCount(CATALOG_PAGE_SIZE);
              }}
              className={`min-h-11 shrink-0 touch-manipulation rounded-[4px] px-2.5 text-ui-label font-medium transition-colors duration-(--duration-hover) focus-visible:outline-none md:py-1.5 md:pointer-fine:min-h-0 ${
                activeCat === category
                  ? "bg-accent text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              }`}
            >
              {category}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div
          role="status"
          className="mb-5 mt-3 flex min-h-11 items-center gap-2 rounded-md border border-border/70 bg-card/[0.12] px-3 text-ui-nav text-muted-foreground"
        >
          <Loader2
            className="size-3.5 animate-spin motion-reduce:animate-none"
            aria-hidden
          />
          Syncing connection health…
        </div>
      ) : null}

      {(activeState === "all" || activeState === "installed") &&
      (filteredInstalledServers.length > 0 || activeState === "installed") ? (
        <section
          className="mb-7 mt-4"
          aria-labelledby="installed-plugins-heading"
        >
          <CodexSectionHeading meta={connectionHealthMeta}>
            Connections
          </CodexSectionHeading>

          {filteredInstalledServers.length > 0 ? (
            // Same board as the catalog below it: a connection is a provider
            // you already have, not a different kind of object, and giving it
            // its own bordered table made the page read as two systems.
            <div className="rift-plugin-grid">
              {filteredInstalledServers.map((server) => {
                const entry = catalogEntryForServer(server) ?? null;
                const busy = busyConnectionId === server._id;
                return (
                  <article key={server._id} className="rift-plugin-row">
                    <button
                      type="button"
                      aria-label={entry?.name ?? server.name}
                      onClick={() =>
                        entry
                          ? setDetailEntry(entry)
                          : setWizard({ mode: "edit", server, entry })
                      }
                      className={`${styles.connectionIdentity} group flex min-w-0 flex-1 touch-manipulation items-center gap-3 rounded-[10px] text-left`}
                    >
                      {entry ? (
                        <EntryBadge entry={entry} size={40} />
                      ) : server.catalogId === "browserbase" ||
                        (() => {
                          try {
                            return new URL(server.url).hostname.endsWith(
                              ".browserbase.com",
                            );
                          } catch {
                            return false;
                          }
                        })() ? (
                        <EntryBadge
                          entry={{ logoPath: "/plugin-logos/browserbase.svg" }}
                        />
                      ) : (
                        <FallbackBadge name={server.name} />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-ui font-medium leading-[21px] tracking-[-0.1px] text-foreground group-hover:underline underline-offset-4">
                          {server.name}
                        </span>
                        <span className="rift-plugin-description">
                          {entry?.description ??
                            "Connect tools from your custom endpoint"}
                        </span>
                        {server.connectionStatus === "needs_attention" ||
                        !server.enabled ? (
                          <span className="text-ui-caption text-muted-foreground">
                            {server.connectionStatus === "needs_attention"
                              ? "Needs attention"
                              : "Disabled"}
                          </span>
                        ) : null}
                      </span>
                    </button>

                    <div className="flex min-h-11 flex-wrap items-center justify-end gap-1.5 sm:min-h-0 sm:flex-nowrap">
                      {server.connectionStatus === "needs_attention" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => {
                            if (
                              entry &&
                              (entry.connectFlow === "github" ||
                                entry.auth === "oauth")
                            )
                              handleEntryAction(entry);
                            else setWizard({ mode: "edit", server, entry });
                          }}
                          className="rift-plugin-action"
                        >
                          Reconnect
                        </Button>
                      ) : !server.enabled ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          aria-busy={busy}
                          onClick={() => void handleToggle(server, true)}
                          className="rift-plugin-action"
                        >
                          {busy ? "Connecting…" : "Connect"}
                        </Button>
                      ) : (
                        <span className="rift-plugin-state">
                          <StatusBadge server={server} />
                        </span>
                      )}
                      <DropdownMenu
                        open={active && openConnectionMenuId === server._id}
                        onOpenChange={(open) =>
                          setOpenConnectionMenuId(open ? server._id : null)
                        }
                      >
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`More actions for ${server.name}`}
                            className={`${styles.connectionMore} flex size-8 shrink-0 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors duration-(--duration-hover) hover:bg-accent hover:text-foreground focus-visible:outline-none`}
                          >
                            {busy ? (
                              <Loader2
                                className="size-3.5 animate-spin motion-reduce:animate-none"
                                aria-hidden
                              />
                            ) : (
                              <MoreHorizontal className="size-4" aria-hidden />
                            )}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-44">
                          {server.enabled ? (
                            <DropdownMenuItem
                              onSelect={() => void handleToggle(server, false)}
                            >
                              Disconnect
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            onSelect={() =>
                              setWizard({ mode: "edit", server, entry })
                            }
                          >
                            <Settings2 className="size-3.5" aria-hidden />
                            Edit endpoint
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            onSelect={(event) => {
                              // Removal is confirmed by the existing two-press
                              // handler; the menu must not close the moment it
                              // arms itself or the confirmation never shows.
                              event.preventDefault();
                              void handleRemove(server);
                            }}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {confirmRemoveId === server._id
                              ? "Confirm remove"
                              : "Remove"}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <CodexEmptyState
              icon={<Search className="size-4" strokeWidth={1.7} aria-hidden />}
              title="No matching connections"
              description="No connected plugin matches the current search and category."
              action={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearFilters}
                  className="min-h-11 touch-manipulation md:pointer-fine:min-h-0"
                >
                  Clear filters
                </Button>
              }
            />
          )}
        </section>
      ) : null}

      {activeState !== "installed" ? (
        grouped.length > 0 ? (
          grouped.map(({ category, items }) => (
            <section
              key={category}
              className="mb-7"
              aria-label={`${category} plugins`}
            >
              <CodexSectionHeading meta={`${items.length} shown`}>
                {category}
              </CodexSectionHeading>
              <div className="rift-plugin-grid">
                {items.map((entry) => {
                  const recent = recentForEntry(entry);
                  const busy = busyActionId === entry.id;
                  return (
                    <article key={entry.id} className="rift-plugin-row">
                      <button
                        type="button"
                        onClick={() => setDetailEntry(entry)}
                        aria-label={entry.name}
                        className="rift-plugin-identity"
                      >
                        <EntryBadge entry={entry} size={40} />
                        <span className="min-w-0 flex-1">
                          <span className="rift-plugin-name">{entry.name}</span>
                          <span className="rift-plugin-description">
                            {entry.description}
                          </span>
                        </span>
                      </button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy || loading || Boolean(recent)}
                        aria-label={`${requiresEndpoint(entry) ? "Set up" : "Connect"} ${entry.name}`}
                        aria-busy={busy}
                        onClick={() => {
                          setDetailEntry(entry);
                          handleEntryAction(entry);
                        }}
                        className="rift-plugin-action"
                      >
                        {busy ? (
                          <Loader2
                            aria-hidden
                            className="size-3.5 motion-safe:animate-spin"
                          />
                        ) : recent ? (
                          <Check aria-hidden className="size-3.5" />
                        ) : null}
                        {busy
                          ? "Connecting…"
                          : recent
                            ? "Connected"
                            : requiresEndpoint(entry)
                              ? "Set up"
                              : "Connect"}
                      </Button>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        ) : activeState !== "all" || filteredInstalledServers.length === 0 ? (
          <CodexEmptyState
            icon={<Search className="size-4" strokeWidth={1.7} aria-hidden />}
            title="No matching plugins"
            description={
              query
                ? `No results for “${query.trim()}”. Clear the search or show every setup state.`
                : "No plugins match the selected category and connection state."
            }
            action={
              filtersActive ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={clearFilters}
                  className="min-h-11 touch-manipulation md:pointer-fine:min-h-0"
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : null
      ) : null}

      {activeState === "all" && activeCat === "All" && !query.trim() ? (
        <RegistryPlugins
          active={active}
          installedUrls={installedServers.map((server) => server.url)}
          onSelect={(entry) => setWizard({ mode: "catalog", entry })}
        />
      ) : null}

      {activeState !== "installed" &&
      renderedEntries.length < visibleEntries.length ? (
        <div className="mb-7 flex justify-center">
          <Button
            type="button"
            variant="outline"
            onClick={() =>
              setVisibleCount((count) => count + CATALOG_PAGE_SIZE)
            }
            aria-label="Show more plugins"
            className="h-11 touch-manipulation rounded-md px-4 text-ui md:pointer-fine:h-9"
          >
            Show more
          </Button>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setWizard({ mode: "custom" })}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-dashed border-border/80 bg-card/[0.08] px-4 py-3 text-ui font-medium text-muted-foreground transition-colors duration-(--duration-hover) hover:border-foreground/30 hover:bg-card/20 hover:text-foreground focus-visible:outline-none"
      >
        <Plus className="size-4" aria-hidden />
        Add a custom MCP endpoint
      </button>

      <PluginDetailSheet
        entry={active ? detailEntry : null}
        installedServer={
          (detailEntry ? serverForEntry(detailEntry) : null) ?? null
        }
        busy={detailEntry ? busyActionId === detailEntry.id : false}
        loading={loading}
        onClose={() => setDetailEntry(null)}
        justVerified={
          detailEntry ? Boolean(recentForEntry(detailEntry)) : false
        }
        error={detailEntry ? actionErrors[detailEntry.id] : undefined}
        onConnect={(entry) => {
          // The sheet stays open: the reader pressed Connect here, so this is
          // where an authentication failure has to be answered. On success the
          // action turns into Manage, which is its own confirmation.
          handleEntryAction(entry);
        }}
        onManage={(entry, server) => {
          setDetailEntry(null);
          setWizard({ mode: "edit", server, entry });
        }}
      />

      <ConnectionWizard
        key={
          wizard?.mode === "catalog"
            ? `catalog:${wizard.entry.id}`
            : wizard?.mode === "edit"
              ? `edit:${wizard.server._id}`
              : (wizard?.mode ?? "closed")
        }
        state={active ? wizard : null}
        onClose={() => setWizard(null)}
        onSubmit={connectWithDraft}
      />
    </CodexPageShell>
  );
}

function initialDraft(state: Exclude<WizardState, null>): ConnectionDraft {
  if (state.mode === "custom") {
    return {
      name: "",
      url: "",
      transport: "http",
      authKind: "none",
      headerName: "X-API-Key",
    };
  }
  if (state.mode === "edit") {
    const authKind =
      state.server.connectionStatus === "needs_attention" &&
      state.entry?.auth === "oauth"
        ? "oauth"
        : inferAuthKind(state.server);
    return {
      catalogId: state.server.catalogId ?? state.entry?.id,
      name: state.server.name,
      url: state.server.url,
      transport: state.server.transport,
      authKind,
      headerName:
        authKind === "api_key_header"
          ? (state.server.headerKeys[0] ?? "X-API-Key")
          : "X-API-Key",
    };
  }
  const entry = state.entry;
  return {
    catalogId: entry.id,
    name: entry.name,
    url: entry.url,
    transport: entry.transport,
    authKind:
      entry.auth === "token"
        ? "bearer"
        : entry.auth === "oauth"
          ? "oauth"
          : "none",
    headerName: "X-API-Key",
  };
}

function validateDraft(
  draft: ConnectionDraft,
  canReuseSavedSecret: boolean,
): Partial<Record<"name" | "url" | "secret" | "headerName" | "oauth", string>> {
  const errors: Partial<
    Record<"name" | "url" | "secret" | "headerName" | "oauth", string>
  > = {};
  if (!draft.name.trim()) errors.name = "Enter a connection name.";
  try {
    const url = new URL(draft.url.trim());
    const localHttp =
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !localHttp) {
      errors.url = "Use an HTTPS MCP endpoint.";
    }
  } catch {
    errors.url = "Enter a valid MCP endpoint URL.";
  }
  if (
    (draft.authKind === "bearer" || draft.authKind === "api_key_header") &&
    !canReuseSavedSecret &&
    !draft.secret?.trim()
  ) {
    errors.secret = "Enter the credential supplied by the provider.";
  }
  if (
    draft.authKind === "api_key_header" &&
    !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(draft.headerName?.trim() ?? "")
  ) {
    errors.headerName = "Enter a valid HTTP header name.";
  }
  if (draft.authKind === "oauth" && !draft.catalogId) {
    errors.oauth =
      "Start OAuth from a catalog plugin so the provider can be verified.";
  }
  return errors;
}

/**
 * What a provider card opens.
 *
 * Deliberately small: the mark, the name, its category, one action, the
 * sentence describing what it does, and the endpoint it will talk to. The
 * endpoint is shown because connecting a plugin hands an agent a network
 * destination, and the person approving that should be able to read it before
 * they agree rather than after.
 */
function PluginDetailSheet({
  entry,
  installedServer,
  busy,
  loading,
  justVerified,
  error,
  onClose,
  onConnect,
  onManage,
}: {
  entry: McpCatalogEntry | null;
  installedServer: MarketplaceServer | null;
  busy: boolean;
  /** Health is still syncing, so we do not yet know what connecting means. */
  loading: boolean;
  /** Connected moments ago — the registry query has not caught up yet. */
  justVerified: boolean;
  error?: string;
  onClose: () => void;
  onConnect: (entry: McpCatalogEntry) => void;
  onManage: (entry: McpCatalogEntry, server: MarketplaceServer) => void;
}) {
  return (
    <Dialog open={Boolean(entry)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="rift-plugin-detail gap-0 rounded-2xl p-0 sm:max-w-[440px]">
        {entry ? (
          <>
            <div className="flex items-start gap-3 p-5">
              <EntryBadge entry={entry} size={40} />
              <div className="min-w-0 flex-1">
                <DialogTitle className="truncate text-ui-section font-medium">
                  {entry.name}
                </DialogTitle>
                <DialogDescription className="mt-0.5 text-ui-nav">
                  {entry.category}
                </DialogDescription>
              </div>
              {!entry.url && !installedServer && !justVerified ? (
                // No hosted server exists for this provider, so the button
                // cannot honestly say "Connect" — pressing it opens a form
                // asking for an endpoint the reader has to supply.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onConnect(entry)}
                  className="h-8 shrink-0 rounded-full px-4 text-ui-nav"
                >
                  Add endpoint
                </Button>
              ) : justVerified && !installedServer ? (
                // The mutation succeeded but the registry query has not
                // returned yet; saying "Connect" here would invite a second
                // attempt at something that already worked.
                <span className="shrink-0 text-ui-nav text-emerald-500">
                  Connected
                </span>
              ) : installedServer ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => onManage(entry, installedServer)}
                  className="h-8 shrink-0 rounded-full px-4 text-ui-nav"
                >
                  Manage
                </Button>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || loading}
                  onClick={() => onConnect(entry)}
                  className="h-8 shrink-0 rounded-full px-4 text-ui-nav"
                >
                  {busy ? (
                    <Loader2
                      className="size-3.5 animate-spin motion-reduce:animate-none"
                      aria-hidden
                    />
                  ) : (
                    "Connect"
                  )}
                </Button>
              )}
            </div>

            <div className="space-y-4 px-5 pb-5">
              <p className="text-ui leading-[1.55] text-muted-foreground">
                {entry.description}
              </p>

              <div>
                <p className="text-ui-label text-muted-foreground">
                  Server URL
                </p>
                {entry.url ? (
                  <p className="mt-1 break-all font-mono text-ui-nav text-foreground">
                    {entry.url}
                  </p>
                ) : (
                  // Saying "provided during setup" implied one existed and was
                  // simply being withheld. This provider publishes no hosted
                  // MCP server; whoever connects it brings their own.
                  <p className="mt-1 text-ui-nav leading-[1.5] text-muted-foreground">
                    {entry.name} does not publish a hosted MCP server. Connect
                    it with your own endpoint — self-hosted, or one your
                    organisation runs.
                  </p>
                )}
              </div>

              {error ? <InlineError message={error} /> : null}

              <p className="text-ui-label leading-[1.55] text-muted-foreground">
                Third-party plugins are not built or maintained by RIFT. Review
                what you are granting access to before connecting.
              </p>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectionWizard({
  state,
  onClose,
  onSubmit,
}: {
  state: WizardState;
  onClose: () => void;
  onSubmit: (
    draft: ConnectionDraft,
    server?: MarketplaceServer,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const open = state !== null;
  const editing = state?.mode === "edit";
  const entry =
    state?.mode === "catalog"
      ? state.entry
      : state?.mode === "edit"
        ? state.entry
        : null;
  const server = state?.mode === "edit" ? state.server : undefined;
  const [draft, setDraft] = useState<ConnectionDraft>(() =>
    state
      ? initialDraft(state)
      : {
          name: "",
          url: "",
          transport: "http",
          authKind: "none",
          headerName: "X-API-Key",
        },
  );
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<
    ReturnType<typeof validateDraft>
  >({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const savedAuthKind = server ? inferAuthKind(server) : undefined;
  const savedHeaderName =
    savedAuthKind === "api_key_header" ? server?.headerKeys[0] : undefined;
  const canReuseSavedSecret = Boolean(
    editing &&
    draft.authKind === savedAuthKind &&
    (draft.authKind !== "api_key_header" ||
      (draft.headerName?.trim() || "X-API-Key").toLowerCase() ===
        (savedHeaderName || "X-API-Key").toLowerCase()),
  );

  const updateDraft = <Key extends keyof ConnectionDraft>(
    key: Key,
    value: ConnectionDraft[Key],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      const next = { ...current };
      if (key === "authKind") {
        delete next.secret;
        delete next.headerName;
        delete next.oauth;
      } else if (key in next) {
        delete next[key as keyof typeof next];
      }
      return next;
    });
    setSubmitError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const errors = validateDraft(draft, canReuseSavedSecret);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setSubmitting(true);
    setSubmitError(null);
    const result = await onSubmit(draft, server);
    if (!result.ok) setSubmitError(result.error ?? "Connection failed.");
    setSubmitting(false);
  };

  const title = editing
    ? `${server?.connectionStatus === "needs_attention" ? "Reconnect" : "Edit"} ${server?.name ?? "plugin"}`
    : entry
      ? `Connect ${entry.name}`
      : "Add a custom MCP endpoint";

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) onClose();
      }}
    >
      <DialogContent
        data-ui="mcp-connection-dialog"
        className="bottom-0 top-auto max-h-[calc(100dvh-env(safe-area-inset-top))] w-screen max-w-none translate-y-0 overflow-y-auto overscroll-contain rounded-b-none rounded-t-xl border-x-0 border-b-0 pb-[max(1rem,env(safe-area-inset-bottom))] sm:max-w-none md:bottom-auto md:top-1/2 md:max-h-[calc(100dvh-1.5rem)] md:w-full md:max-w-[520px] md:-translate-y-1/2 md:rounded-lg md:border md:pb-4"
        aria-busy={submitting}
        showCloseButton={false}
      >
        <DialogClose
          disabled={submitting}
          aria-label="Close plugin connection"
          className="absolute right-2 top-2 z-10 flex size-11 touch-manipulation items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 md:pointer-fine:size-8"
        >
          <X className="size-4" aria-hidden />
        </DialogClose>
        <DialogHeader>
          <DialogTitle className="pr-12 text-ui-section md:pr-7">
            {title}
          </DialogTitle>
          <DialogDescription className="pr-12 text-ui leading-5 md:pr-5">
            {editing
              ? "Update the endpoint or authentication method, then verify it before the saved connection changes."
              : "RIFT verifies the endpoint and lists usable tools before saving this connection."}
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
          noValidate
        >
          {entry ? (
            <a
              href={getMcpProviderUrl(entry)}
              target="_blank"
              rel="noreferrer noopener"
              className="flex min-h-11 items-center justify-between rounded-md border border-border/80 bg-card/30 px-3 text-ui font-medium text-foreground transition-colors duration-(--duration-hover) hover:bg-accent focus-visible:outline-none"
            >
              Open {entry.name} setup
              <ExternalLink
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
            </a>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="mcp-connection-name" className="text-ui-nav">
              Connection name
            </Label>
            <Input
              id="mcp-connection-name"
              name="mcp-connection-name"
              value={draft.name}
              onChange={(event) => updateDraft("name", event.target.value)}
              placeholder="Internal tools"
              autoComplete="off"
              maxLength={80}
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={
                fieldErrors.name ? "mcp-connection-name-error" : undefined
              }
              className="h-11 touch-manipulation text-ui md:pointer-fine:h-9"
            />
            {fieldErrors.name ? (
              <p
                id="mcp-connection-name-error"
                role="alert"
                className="text-ui-label text-destructive"
              >
                {fieldErrors.name}
              </p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="mcp-connection-url" className="text-ui-nav">
              MCP endpoint
            </Label>
            <Input
              id="mcp-connection-url"
              name="mcp-connection-url"
              type="url"
              inputMode="url"
              value={draft.url}
              onChange={(event) => updateDraft("url", event.target.value)}
              placeholder="https://example.com/mcp"
              spellCheck={false}
              autoComplete="url"
              aria-invalid={Boolean(fieldErrors.url)}
              aria-describedby="mcp-connection-url-help mcp-connection-url-error"
              className="h-11 touch-manipulation font-mono text-ui-nav md:pointer-fine:h-9"
            />
            <p
              id="mcp-connection-url-help"
              className="text-ui-caption leading-4 text-muted-foreground"
            >
              Use the provider&apos;s official remote endpoint or your
              organization&apos;s MCP URL.
            </p>
            {fieldErrors.url ? (
              <p
                id="mcp-connection-url-error"
                role="alert"
                className="text-ui-label text-destructive"
              >
                {fieldErrors.url}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-ui-nav">
              Transport
              <select
                name="mcp-connection-transport"
                value={draft.transport}
                onChange={(event) =>
                  updateDraft(
                    "transport",
                    event.target.value === "sse" ? "sse" : "http",
                  )
                }
                className="h-11 touch-manipulation rounded-md border border-input bg-background px-3 text-ui text-foreground outline-none md:pointer-fine:h-9"
              >
                <option value="http">Streamable HTTP</option>
                <option value="sse">SSE</option>
              </select>
            </label>

            <label className="grid gap-1.5 text-ui-nav">
              Authentication
              <select
                name="mcp-connection-auth"
                value={draft.authKind}
                onChange={(event) =>
                  updateDraft("authKind", event.target.value as WizardAuthKind)
                }
                className="h-11 touch-manipulation rounded-md border border-input bg-background px-3 text-ui text-foreground outline-none md:pointer-fine:h-9"
              >
                {AUTH_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draft.authKind === "api_key_header" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-header-name" className="text-ui-nav">
                API-key header
              </Label>
              <Input
                id="mcp-header-name"
                name="mcp-header-name"
                value={draft.headerName ?? ""}
                onChange={(event) =>
                  updateDraft("headerName", event.target.value)
                }
                placeholder="X-API-Key"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(fieldErrors.headerName)}
                aria-describedby={
                  fieldErrors.headerName ? "mcp-header-name-error" : undefined
                }
                className="h-11 touch-manipulation font-mono text-ui-nav md:pointer-fine:h-9"
              />
              {fieldErrors.headerName ? (
                <p
                  id="mcp-header-name-error"
                  role="alert"
                  className="text-ui-label text-destructive"
                >
                  {fieldErrors.headerName}
                </p>
              ) : null}
            </div>
          ) : null}

          {draft.authKind === "bearer" ||
          draft.authKind === "api_key_header" ? (
            <div className="grid gap-1.5">
              <Label htmlFor="mcp-connection-secret" className="text-ui-nav">
                {draft.authKind === "bearer"
                  ? (entry?.tokenLabel ?? "Bearer token")
                  : "API key"}
                {canReuseSavedSecret ? (
                  <span className="font-normal text-muted-foreground">
                    {" "}
                    (optional)
                  </span>
                ) : null}
              </Label>
              <Input
                id="mcp-connection-secret"
                name="mcp-connection-secret"
                value={draft.secret ?? ""}
                onChange={(event) => updateDraft("secret", event.target.value)}
                placeholder={
                  canReuseSavedSecret
                    ? "Leave blank to use the saved credential"
                    : "Stored securely after verification"
                }
                type="password"
                required={!canReuseSavedSecret}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={Boolean(fieldErrors.secret)}
                aria-describedby="mcp-connection-secret-help mcp-connection-secret-error"
                className="h-11 touch-manipulation text-ui md:pointer-fine:h-9"
              />
              <p
                id="mcp-connection-secret-help"
                className="text-ui-caption leading-4 text-muted-foreground"
              >
                {entry?.tokenHint
                  ? `${entry.tokenHint} The secret is never returned to this screen after setup.`
                  : "The secret is never returned to this screen after setup."}
              </p>
              {fieldErrors.secret ? (
                <p
                  id="mcp-connection-secret-error"
                  role="alert"
                  className="text-ui-label text-destructive"
                >
                  {fieldErrors.secret}
                </p>
              ) : null}
            </div>
          ) : null}

          {draft.authKind === "oauth" ? (
            <div
              className="rounded-md border border-border/80 bg-muted/20 px-3 py-2.5"
              role="note"
            >
              <div className="flex items-start gap-2">
                <ShieldCheck
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden
                />
                <p className="text-ui-label leading-4 text-muted-foreground">
                  Continue to the provider to approve access. RIFT verifies the
                  callback and stores only encrypted credentials.
                </p>
              </div>
              {fieldErrors.oauth ? (
                <p role="alert" className="mt-2 text-ui-label text-destructive">
                  {fieldErrors.oauth}
                </p>
              ) : null}
            </div>
          ) : null}

          {submitError ? <InlineError message={submitError} /> : null}

          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={submitting}
              className="h-11 touch-manipulation gap-1.5 text-ui md:pointer-fine:h-9"
            >
              <X className="size-3.5" aria-hidden />
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={submitting}
              className="h-11 touch-manipulation gap-1.5 text-ui md:pointer-fine:h-9"
            >
              {submitting ? (
                <Loader2
                  className="size-3.5 animate-spin motion-reduce:animate-none"
                  aria-hidden
                />
              ) : draft.authKind === "oauth" ? (
                <ShieldCheck className="size-3.5" aria-hidden />
              ) : editing ? (
                <ShieldCheck className="size-3.5" aria-hidden />
              ) : (
                <KeyRound className="size-3.5" aria-hidden />
              )}
              {submitting
                ? draft.authKind === "oauth"
                  ? "Opening provider…"
                  : "Verifying…"
                : draft.authKind === "oauth"
                  ? "Continue with OAuth"
                  : editing
                    ? "Verify changes"
                    : "Verify and connect"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
