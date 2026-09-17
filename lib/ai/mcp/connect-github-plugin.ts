import "server-only";
import { randomUUID } from "node:crypto";
import { api } from "@/convex/_generated/api";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { connectMcpServer } from "./mcp-client";
import { encryptMcpCredentials } from "./mcp-credential-vault";
import {
  GITHUB_MCP_URL,
  githubMcpCredentialReference,
} from "./github-mcp-credentials";

/** Invoked only after the signed, user-initiated GitHub OAuth flow completes. */
export async function connectGitHubPlugin(
  userId: string,
  token: string,
): Promise<void> {
  const serviceKey = getConvexServiceKey();
  if (!serviceKey) throw new Error("Plugin storage is unavailable");
  const url = GITHUB_MCP_URL;
  const headers = [{ key: "Authorization", value: `Bearer ${token}` }];
  const encryptedCredentials = encryptMcpCredentials(
    githubMcpCredentialReference(),
    { userId, url },
  );
  const connection = await connectMcpServer({
    id: randomUUID(),
    name: "GitHub",
    url,
    transport: "http",
    headers,
  });
  if (!connection) throw new Error("GitHub MCP verification failed");
  try {
    if (!connection.toolNames.length)
      throw new Error("GitHub returned no tools");
    const client = getConvexClient();
    const existing = await client.query(api.mcpServers.findEndpointForBackend, {
      serviceKey,
      userId,
      url,
    });
    const configuration = {
      serviceKey,
      userId,
      catalogId: "github",
      name: "GitHub",
      url,
      transport: "http" as const,
      authKind: "bearer" as const,
      encryptedCredentials,
      credentialHeaderKeys: ["Authorization"],
      toolCount: connection.toolNames.length,
      toolNames: connection.toolNames,
    };
    const result = existing
      ? await client.mutation(api.mcpServers.updateVerifiedServerForBackend, {
          ...configuration,
          id: existing.id,
          expectedConfigRevision: existing.configRevision,
        })
      : await client.mutation(
          api.mcpServers.addVerifiedServerForBackend,
          configuration,
        );
    if (!result.success)
      throw new Error(result.error ?? "Could not save GitHub plugin");
  } finally {
    await connection.close();
  }
}
