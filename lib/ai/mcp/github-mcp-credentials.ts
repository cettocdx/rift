import type { McpCredentialHeader } from "./mcp-credential-types";

export const GITHUB_MCP_URL = "https://api.githubcopilot.com/mcp";
// Stored only inside an owner/endpoint-bound encrypted envelope. This is a
// reference, never a credential and never an outgoing Authorization header.
const GITHUB_CONNECTION_REFERENCE = "rift:github-connection:v1";
export const githubMcpCredentialReference = (): McpCredentialHeader[] => [
  { key: "Authorization", value: GITHUB_CONNECTION_REFERENCE },
];

export function hasGithubMcpCredentialReference(
  headers?: McpCredentialHeader[],
): boolean {
  return Boolean(
    headers?.some((header) => header.value === GITHUB_CONNECTION_REFERENCE),
  );
}

export function createGithubMcpHeaderResolver(
  config: { url: string; authKind: string; headers?: McpCredentialHeader[] },
  loadToken: () => Promise<{ token: string } | null>,
): (() => Promise<McpCredentialHeader[]>) | undefined {
  if (!hasGithubMcpCredentialReference(config.headers)) return undefined;
  const url = new URL(config.url);
  if (
    url.origin !== "https://api.githubcopilot.com" ||
    !["/mcp", "/mcp/"].includes(url.pathname) ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    config.authKind !== "bearer" ||
    config.headers?.length !== 1 ||
    config.headers[0].key.toLowerCase() !== "authorization"
  )
    throw new Error(
      "Managed GitHub credentials require the official GitHub endpoint.",
    );
  return async () => {
    const current = await loadToken();
    if (!current?.token)
      throw new Error("GitHub connection unavailable. Reconnect GitHub.");
    return [{ key: "Authorization", value: `Bearer ${current.token}` }];
  };
}
