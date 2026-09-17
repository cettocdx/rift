import "server-only";
import { MCP_CATALOG } from "@/app/components/mcpCatalog";
import { canonicalizeMcpUrl } from "./mcp-url-validation";

/**
 * Server-owned identity boundary for catalog OAuth. Keep this compact set in
 * the trusted backend so a caller cannot persist an arbitrary catalog id and
 * make a custom endpoint appear as a curated provider in the UI.
 */
const KNOWN_MCP_CATALOG_IDS = new Set(
  `atlassian deepwiki github context7 hugging-face exa-search stripe higgsfield gitlab bitbucket sentry jira postman vercel netlify circleci jenkins docker kubernetes sourcegraph snyk playwright raygun datadog pagerduty grafana openai replicate elevenlabs pinecone weaviate qdrant cohere stability-ai replicate-flux postgresql mysql mongodb supabase snowflake bigquery redis neon planetscale databricks clickhouse metabase amplitude mixpanel aws google-cloud azure cloudflare digitalocean railway fly-io render terraform pulumi notion linear asana trello clickup todoist monday airtable coda height miro obsidian slack discord microsoft-teams telegram twilio intercom zendesk front gmail outlook brave-search tavily perplexity firecrawl apify browserbase serpapi google-maps salesforce hubspot pipedrive attio close zoho-crm paypal square plaid quickbooks xero brex mercury ramp mailchimp sendgrid customer-io klaviyo webflow contentful sanity wordpress google-drive dropbox box onedrive aws-s3 figma framer canva semgrep 1password hashicorp-vault okta auth0 confluence gitbook google-docs google-sheets google-calendar cal-com calendly shopify woocommerce bigcommerce squarespace x-twitter reddit linkedin youtube medium`
    .split(" ")
    .filter(Boolean),
);

type FixedCatalogEntry = {
  url: string;
  transport: "http" | "sse";
  oauth: boolean;
};

export type McpCatalogAuthKind = "none" | "bearer" | "api_key_header" | "oauth";

/** Every catalog card with a configured endpoint (not only OAuth cards). */
const FIXED_CATALOG_ENDPOINTS: Readonly<Record<string, FixedCatalogEntry>> =
  Object.fromEntries(
    MCP_CATALOG.map((entry) => [
      entry.id,
      {
        url: canonicalizeMcpUrl(entry.url),
        transport: entry.transport,
        oauth: entry.auth === "oauth",
      },
    ]),
  );

export class McpOAuthCatalogBindingError extends Error {
  constructor() {
    super("OAuth plugin identity does not match its catalog configuration.");
    this.name = "McpOAuthCatalogBindingError";
  }
}

export class McpCatalogBindingError extends Error {
  constructor() {
    super("Plugin identity does not match its catalog configuration.");
    this.name = "McpCatalogBindingError";
  }
}

/**
 * Return a catalog identity only when the trusted catalog owns an exact fixed
 * endpoint/auth binding. Endpoint-required cards remain valid custom MCP
 * connections, but deliberately persist without a provider identity because
 * an arbitrary tenant URL cannot prove which catalog provider owns it.
 */
export function resolveMcpCatalogIdForConnection(input: {
  catalogId?: string;
  url: string;
  transport: "http" | "sse";
  authKind: McpCatalogAuthKind;
}): string | undefined {
  if (!input.catalogId) return undefined;
  if (!KNOWN_MCP_CATALOG_IDS.has(input.catalogId)) {
    throw new McpCatalogBindingError();
  }
  const fixed = FIXED_CATALOG_ENDPOINTS[input.catalogId];
  if (!fixed) return undefined;
  const usesOAuth = input.authKind === "oauth";
  return fixed.url === input.url &&
    fixed.transport === input.transport &&
    fixed.oauth === usesOAuth
    ? input.catalogId
    : undefined;
}

/**
 * Fixed cards must use their exact official endpoint and declare OAuth.
 * Endpoint-required cards may use a tenant/provider URL, but only under a
 * catalog id that actually exists in the server-owned catalog identity set.
 */
export function assertMcpOAuthCatalogBinding(input: {
  catalogId: string;
  url: string;
  transport: "http" | "sse";
}): void {
  if (!KNOWN_MCP_CATALOG_IDS.has(input.catalogId)) {
    throw new McpOAuthCatalogBindingError();
  }
  const fixed = FIXED_CATALOG_ENDPOINTS[input.catalogId];
  if (
    fixed &&
    (!fixed.oauth ||
      fixed.url !== input.url ||
      fixed.transport !== input.transport)
  ) {
    throw new McpOAuthCatalogBindingError();
  }
}
