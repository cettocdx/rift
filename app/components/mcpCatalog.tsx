/**
 * Curated MCP discovery catalog. Every listing names an endpoint its provider
 * publishes, so each card offers the same honest next action: verify that
 * endpoint, supplying whatever credential `auth` calls for. A server RIFT does
 * not list is reached through the marketplace's custom-endpoint form instead.
 *
 * `auth` drives supported connection UX:
 *  - "none"  → public endpoint; ready to verify and connect.
 *  - "token" → requires a bearer token.
 *  - "oauth" → use the provider-owned authentication/setup flow.
 *
 * `auth` states the credential the endpoint asks for up front; runtime
 * verification is what proves a connection actually works.
 */

export type McpCatalogCategory =
  | "Featured"
  | "Developer Tools"
  | "Productivity"
  | "Communication"
  | "Data & Analytics"
  | "Cloud & Infrastructure"
  | "CRM & Sales"
  | "Payments & Finance"
  | "Marketing"
  | "Design"
  | "Storage & Files"
  | "Search & Web"
  | "AI & ML"
  | "Security & Identity"
  | "Productivity & Docs"
  | "Calendar"
  | "E-commerce"
  | "Social & Content";

export type McpCatalogAvailability = "available" | "requires_configuration";

export interface McpCatalogEntry {
  id: string;
  name: string;
  description: string;
  category: McpCatalogCategory;
  url: string;
  transport: "http" | "sse";
  auth: "none" | "token" | "oauth";
  availability: McpCatalogAvailability;
  tokenLabel?: string;
  tokenHint?: string;
  /** Brand domain used to resolve the provider-owned setup page. */
  domain: string;
  /** Bundled official brand mark. Kept local so the marketplace works offline. */
  logoPath: string;
  /** Provider-owned page where the user can enable the integration or get credentials. */
  setupUrl?: string;
  connectFlow?: "github";
}

/**
 * Where each category sits once it has something to show. The full taxonomy
 * lives here rather than in the exported filter order, so adding the first
 * entry in a category places it without anyone having to remember this list.
 */
const CATEGORY_DISPLAY_ORDER: McpCatalogCategory[] = [
  "Featured",
  "Developer Tools",
  "AI & ML",
  "Data & Analytics",
  "Cloud & Infrastructure",
  "Productivity",
  "Communication",
  "Search & Web",
  "CRM & Sales",
  "Payments & Finance",
  "Marketing",
  "Storage & Files",
  "Design",
  "Security & Identity",
  "Productivity & Docs",
  "Calendar",
  "E-commerce",
  "Social & Content",
];

type Seed = {
  name: string;
  description: string;
  category: McpCatalogCategory;
  url: string;
  transport?: "http" | "sse";
  auth?: "none" | "token" | "oauth";
  availability?: McpCatalogAvailability;
  tokenLabel?: string;
  tokenHint?: string;
  domain?: string;
  setupUrl?: string;
  connectFlow?: "github";
};

// Keyed by the slug `def()` derives from the name, not by the brand's own
// spelling — "Hugging Face" arrives here as "hugging-face". `def()` consults
// this map only for a seed that omits `domain`, and falls back to
// "<slug without dashes>.com" when neither of those supplies one.
const DOMAIN_OVERRIDES: Record<string, string> = {
  sentry: "sentry.io",
  linear: "linear.app",
  "exa-search": "exa.ai",
};

function guessDomain(id: string): string {
  return DOMAIN_OVERRIDES[id] ?? `${id.replace(/-/g, "")}.com`;
}

function isValidHttpsEndpoint(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function def(seed: Seed): McpCatalogEntry {
  const id = seed.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // A seed that names no credential is a public endpoint: nothing has to be
  // collected first, so it derives the ready-to-verify "available" state.
  const auth = seed.auth ?? "none";
  const availability =
    seed.availability ??
    (auth === "none" || auth === "oauth" || seed.connectFlow
      ? "available"
      : "requires_configuration");
  return {
    id,
    name: seed.name,
    description: seed.description,
    category: seed.category,
    url: seed.url,
    transport: seed.transport ?? "http",
    auth,
    availability,
    tokenLabel: seed.tokenLabel,
    tokenHint: seed.tokenHint,
    domain: seed.domain ?? guessDomain(id),
    logoPath: `/plugin-logos/${id}.svg`,
    setupUrl: seed.setupUrl,
    connectFlow: seed.connectFlow,
  };
}

/**
 * Returns a provider-owned HTTPS destination for setup/help. Catalog entries
 * are static product data, but this still rejects non-HTTPS overrides so a
 * future edit cannot turn a plugin card into an unsafe navigation target.
 */
export function getMcpProviderUrl(entry: McpCatalogEntry): string {
  const fallback = `https://${entry.domain}`;
  if (!entry.setupUrl) return fallback;
  try {
    const url = new URL(entry.setupUrl);
    const providerHost = entry.domain.toLowerCase();
    const setupHost = url.hostname.toLowerCase();
    const belongsToProvider =
      setupHost === providerHost || setupHost.endsWith(`.${providerHost}`);
    return url.protocol === "https:" && belongsToProvider
      ? url.toString()
      : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Whether this catalog card carries a syntactically valid HTTPS endpoint.
 * Runtime probing determines whether it is reachable and MCP-compatible before
 * anything is saved. Landing surfaces filter on it so their connector marks
 * only name providers that host a server of their own.
 */
export function hasConfiguredMcpEndpoint(entry: McpCatalogEntry): boolean {
  return isValidHttpsEndpoint(entry.url);
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  // ── Featured (connectable entries + discovery) ─────────────────────────────
  def({
    name: "Firecrawl",
    description: "Search, scrape and turn websites into structured data.",
    category: "Search & Web",
    url: "https://mcp.firecrawl.dev/v2/mcp-oauth",
    auth: "oauth",
    domain: "firecrawl.dev",
    setupUrl: "https://docs.firecrawl.dev/mcp-server",
  }),
  def({
    name: "DeepWiki",
    description: "Ask questions about any public GitHub repo.",
    category: "Featured",
    url: "https://mcp.deepwiki.com/mcp",
    auth: "none",
  }),
  def({
    name: "GitHub",
    description: "Triage PRs, issues, browse code & CI.",
    category: "Featured",
    url: "https://api.githubcopilot.com/mcp/",
    // GitHub uses Rift's registered OAuth app; its resulting token is kept
    // server-side and verified against the remote MCP endpoint.
    connectFlow: "github",
    auth: "token",
    tokenLabel: "GitHub personal access token",
    tokenHint:
      "Create a fine-grained PAT at github.com/settings/tokens with the scopes you want RIFT to use.",
    setupUrl: "https://github.com/settings/tokens",
  }),
  def({
    name: "Context7",
    description: "Up-to-date docs & code examples for any library.",
    category: "Featured",
    url: "https://mcp.context7.com/mcp",
    auth: "none",
    setupUrl: "https://context7.com/docs/installation",
  }),
  def({
    name: "Hugging Face",
    description: "Search models, datasets, papers & Spaces.",
    category: "Featured",
    url: "https://huggingface.co/mcp",
    auth: "none",
    domain: "huggingface.co",
    setupUrl: "https://huggingface.co/settings/mcp",
  }),
  def({
    name: "Exa Search",
    description: "Neural web search built for AI agents.",
    category: "Featured",
    url: "https://mcp.exa.ai/mcp",
    auth: "none",
    setupUrl: "https://exa.ai/docs/reference/exa-mcp",
  }),
  def({
    name: "Stripe",
    description: "Query customers, payments & invoices.",
    category: "Featured",
    url: "https://mcp.stripe.com",
    auth: "oauth",
    setupUrl: "https://docs.stripe.com/mcp",
  }),
  def({
    name: "Higgsfield",
    description: "Cinematic image, video, editing & character workflows.",
    category: "Featured",
    url: "https://mcp.higgsfield.ai/mcp",
    auth: "oauth",
    domain: "higgsfield.ai",
    setupUrl: "https://higgsfield.ai/mcp",
  }),

  // ── Developer Tools ────────────────────────────────────────────────────────
  def({
    name: "Sentry",
    description: "Inspect errors, issues & releases.",
    category: "Developer Tools",
    url: "https://mcp.sentry.dev/mcp",
    auth: "oauth",
  }),
  def({
    name: "CircleCI",
    description: "Pipelines, jobs & artifacts.",
    category: "Developer Tools",
    url: "https://mcp.circleci.com/v1/mcp",
    auth: "oauth",
  }),

  // ── Data & Analytics ───────────────────────────────────────────────────────
  def({
    name: "Amplitude",
    description: "Product analytics & events.",
    category: "Data & Analytics",
    url: "https://mcp.amplitude.com/mcp",
    auth: "oauth",
  }),

  // ── Cloud & Infrastructure ─────────────────────────────────────────────────
  def({
    name: "Cloudflare",
    description: "DNS, Workers, R2 & KV.",
    category: "Cloud & Infrastructure",
    url: "https://mcp.cloudflare.com/mcp",
    auth: "oauth",
    setupUrl: "https://developers.cloudflare.com/agents/tools/mcp/",
  }),
  def({
    // Verified live: an unauthenticated initialize returns 401, which is the
    // correct answer from an OAuth-protected MCP server rather than a dead host.
    name: "Vercel",
    description: "Inspect projects, deployments and logs.",
    category: "Cloud & Infrastructure",
    url: "https://mcp.vercel.com",
    auth: "oauth",
    domain: "vercel.com",
    setupUrl: "https://vercel.com/docs/mcp/vercel-mcp",
  }),

  // ── Productivity ───────────────────────────────────────────────────────────
  def({
    name: "Notion",
    description: "Search & edit your workspace.",
    category: "Productivity",
    url: "https://mcp.notion.com/mcp",
    auth: "oauth",
    domain: "notion.com",
    setupUrl: "https://developers.notion.com/guides/mcp/get-started-with-mcp",
  }),
  def({
    name: "Linear",
    description: "Create & track issues.",
    category: "Productivity",
    url: "https://mcp.linear.app/mcp",
    transport: "http",
    auth: "oauth",
    setupUrl: "https://linear.app/docs/mcp",
  }),
  def({
    name: "Supabase",
    description: "Work with databases, projects and edge functions.",
    category: "Data & Analytics",
    url: "https://mcp.supabase.com/mcp",
    auth: "oauth",
    domain: "supabase.com",
    setupUrl: "https://supabase.com/docs/guides/ai-tools/mcp",
  }),
  def({
    name: "Atlassian",
    description: "Search Jira issues and Confluence knowledge.",
    category: "Productivity",
    url: "https://mcp.atlassian.com/v1/mcp/authv2",
    auth: "oauth",
    domain: "atlassian.com",
    setupUrl:
      "https://support.atlassian.com/atlassian-ai-gateway/docs/how-to-upgrade-from-atlassian-rovo-mcp-v1-to-atlassian-rovo-mcp-v2/",
  }),
];

/**
 * Category filters, in canonical order, narrowed to the categories the catalog
 * can actually fill. A chip for an empty category is a filter that blanks the
 * board, so a category the catalog cannot fill never reaches the row.
 */
export const MCP_CATEGORY_ORDER: McpCatalogCategory[] =
  CATEGORY_DISPLAY_ORDER.filter((category) =>
    MCP_CATALOG.some((entry) => entry.category === category),
  );

/** Normalize a URL for "is this catalog entry already installed?" matching. */
export function normalizeMcpUrl(raw: string): string {
  try {
    const url = new URL(raw.trim());
    if (url.pathname.length > 1) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }
    return url.toString();
  } catch {
    return raw.trim().replace(/\/+$/, "");
  }
}
