/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { getUserID } from "@/lib/auth/get-user-id";
import { getConvexClient } from "@/lib/db/convex-client";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
jest.mock("@/lib/db/convex-client", () => ({ getConvexClient: jest.fn() }));
const query = jest.fn();
const request = (kind: string) =>
  new NextRequest(`http://localhost/api/console/resources?kind=${kind}`);
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getUserID).mockResolvedValue("owner");
  jest.mocked(getConvexClient).mockReturnValue({ query } as any);
});
test("rejects unauthenticated discovery before querying", async () => {
  jest.mocked(getUserID).mockRejectedValue(new Error("auth"));
  expect((await GET(request("plugins"))).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});
test("rejects unsupported resources", async () => {
  expect((await GET(request("credentials"))).status).toBe(400);
  expect(query).not.toHaveBeenCalled();
});
test("never returns MCP headers or credentials", async () => {
  query.mockResolvedValue([
    {
      _id: "plugin",
      name: "Example",
      connectionStatus: "verified",
      toolNames: ["read"],
      url: "secret-url",
      headers: [{ value: "secret" }],
      encryptedCredentials: { cipher: "secret" },
    },
  ]);
  const response = await GET(request("plugins"));
  expect(await response.json()).toEqual({
    items: [
      { id: "plugin", name: "Example", status: "verified", tools: ["read"] },
    ],
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
test("does not leak backend failures", async () => {
  query.mockRejectedValue(new Error("private-service-key"));
  const response = await GET(request("skills"));
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private-service-key");
});
