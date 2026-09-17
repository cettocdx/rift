/** Known hosted services may list tools publicly but require credentials to run
 * them. A successful tools/list is not proof of executable capabilities. */
export class McpConfigurationError extends Error {
  readonly code = "credentials_required";
  constructor() {
    super(
      "Browserbase requires an API key before its browser tools can run. Connect an authenticated Browserbase endpoint, or use RIFT's built-in browser.",
    );
    this.name = "McpConfigurationError";
  }
}

type McpCredentialCandidate = {
  url: string;
  headers?: ReadonlyArray<{ key: string; value: string }>;
  resolveHeaders?: unknown;
  authProvider?: unknown;
};
export function hasMissingKnownMcpCredentials(
  config: McpCredentialCandidate,
): boolean {
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    return false;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "mcp.browserbase.com" ||
    url.pathname.replace(/\/$/, "") !== "/mcp"
  )
    return false;
  // This only rejects demonstrably absent credentials. Credential validity and
  // supported authentication methods remain the server's responsibility. Do not
  // accept or persist secrets from URL query parameters here.
  return (
    !config.headers?.some((header) => header.value.trim()) &&
    !config.resolveHeaders &&
    !config.authProvider
  );
}

export function assertKnownMcpConfiguration(config: McpCredentialCandidate) {
  if (hasMissingKnownMcpCredentials(config)) throw new McpConfigurationError();
}
