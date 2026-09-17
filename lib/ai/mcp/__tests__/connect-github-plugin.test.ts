jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/db/convex-client", () => ({
  ...jest.requireActual<typeof import("@/lib/db/convex-client")>(
    "@/lib/db/convex-client",
  ),
  getConvexClient: jest.fn(),
}));
jest.mock("../mcp-client", () => ({ connectMcpServer: jest.fn() }));
jest.mock("../mcp-credential-vault", () => ({
  encryptMcpCredentials: jest.fn(() => ({ encrypted: "opaque" })),
}));
import { connectGitHubPlugin } from "../connect-github-plugin";
import { connectMcpServer } from "../mcp-client";
import { encryptMcpCredentials } from "../mcp-credential-vault";
import { getConvexClient } from "@/lib/db/convex-client";
const mutation = jest.fn();
const query = jest.fn();
const close = jest.fn(async () => undefined);
const previousKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-key";
  jest.mocked(getConvexClient).mockReturnValue({ mutation, query } as never);
  mutation.mockResolvedValue({ success: true });
  query.mockResolvedValue(null);
  jest
    .mocked(connectMcpServer)
    .mockResolvedValue({ toolNames: ["read_issue"], close } as never);
});
afterAll(() => {
  if (previousKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = previousKey;
});
it("stores only encrypted OAuth-derived credentials after a real tool handshake", async () => {
  await connectGitHubPlugin("owner", "oauth-token");
  expect(connectMcpServer).toHaveBeenCalledWith(
    expect.objectContaining({
      url: "https://api.githubcopilot.com/mcp",
      headers: [{ key: "Authorization", value: "Bearer oauth-token" }],
    }),
  );
  expect(mutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      userId: "owner",
      catalogId: "github",
      encryptedCredentials: { encrypted: "opaque" },
      toolCount: 1,
    }),
  );
  expect(encryptMcpCredentials).toHaveBeenCalledWith(
    [{ key: "Authorization", value: "rift:github-connection:v1" }],
    { userId: "owner", url: "https://api.githubcopilot.com/mcp" },
  );
  expect(JSON.stringify(mutation.mock.calls)).not.toContain("oauth-token");
  expect(close).toHaveBeenCalledTimes(1);
});
it("refreshes an existing connection with its revision instead of creating duplicates", async () => {
  query.mockResolvedValue({ id: "existing", configRevision: 4 });
  await connectGitHubPlugin("owner", "new-token");
  expect(mutation).toHaveBeenCalledTimes(1);
  expect(mutation.mock.calls[0][1]).toMatchObject({
    id: "existing",
    expectedConfigRevision: 4,
  });
});
it("does not persist an unverified endpoint", async () => {
  jest
    .mocked(connectMcpServer)
    .mockResolvedValue({ toolNames: [], close } as never);
  await expect(connectGitHubPlugin("owner", "token")).rejects.toThrow(
    "no tools",
  );
  expect(mutation).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalled();
});
it("reports stale updates without overwriting a newer connection", async () => {
  mutation.mockResolvedValue({
    success: false,
    error: "Configuration changed",
  });
  await expect(connectGitHubPlugin("owner", "token")).rejects.toThrow(
    "Configuration changed",
  );
  expect(close).toHaveBeenCalled();
});
