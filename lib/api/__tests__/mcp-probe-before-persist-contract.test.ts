import fs from "fs";
import path from "path";

const marketplaceSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/components/McpMarketplace.tsx"),
  "utf8",
);
const connectRouteSource = fs.readFileSync(
  path.resolve(__dirname, "../../../app/api/mcp/connect/route.ts"),
  "utf8",
);
const registrySource = fs.readFileSync(
  path.resolve(__dirname, "../../../convex/mcpServers.ts"),
  "utf8",
);

describe("MCP install verification boundary", () => {
  it("uses the server-authoritative connect endpoint instead of a client persistence mutation", () => {
    const connectStart = marketplaceSource.indexOf(
      "const connectWithDraft = async",
    );
    const connectEnd = marketplaceSource.indexOf(
      "const connectPublicEntry",
      connectStart,
    );
    const connectFlow = marketplaceSource.slice(connectStart, connectEnd);

    const connectIndex = connectFlow.indexOf('"/api/mcp/connect"');

    expect(connectStart).toBeGreaterThan(-1);
    expect(connectEnd).toBeGreaterThan(connectStart);
    expect(connectIndex).toBeGreaterThan(-1);
    expect(connectFlow).not.toContain("await addServer");
    expect(marketplaceSource).not.toContain(
      "useMutation(api.mcpServers.addServer)",
    );
  });

  it("persists only after the authenticated route completes a usable-tool handshake", () => {
    const auth = connectRouteSource.indexOf("await getUserID(request)");
    const readBody = connectRouteSource.indexOf(
      "await readLimitedTextBody(request, MAX_BODY_BYTES)",
    );
    const probe = connectRouteSource.indexOf("await connectMcpServer({");
    const usableTools = connectRouteSource.indexOf(
      "connection.toolNames.length === 0",
    );
    const persist = connectRouteSource.indexOf(
      "api.mcpServers.addVerifiedServerForBackend",
    );

    expect(auth).toBeGreaterThan(-1);
    expect(readBody).toBeGreaterThan(auth);
    expect(probe).toBeGreaterThan(readBody);
    expect(usableTools).toBeGreaterThan(probe);
    expect(persist).toBeGreaterThan(usableTools);
  });

  it("does not expose an unverified client persistence mutation", () => {
    expect(registrySource).not.toMatch(/export const addServer\s*=\s*mutation/);
    expect(registrySource).toMatch(
      /export const addVerifiedServerForBackend\s*=\s*mutation/,
    );
    const handler = registrySource.indexOf(
      "export const addVerifiedServerForBackend",
    );
    expect(
      registrySource.indexOf("validateServiceKey(args.serviceKey)", handler),
    ).toBeGreaterThan(handler);
  });
});
