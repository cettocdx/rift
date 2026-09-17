/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
const mockQuery = jest.fn();
const mockIdentity = jest.fn();
jest.mock("@/lib/auth/get-user-id", () => ({
  getUserID: () => mockIdentity(),
}));
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ query: mockQuery }),
  getConvexServiceKey: () => "secret-service",
}));
beforeEach(() => {
  mockQuery.mockReset();
  mockIdentity.mockResolvedValue("owner");
});
const request = (q: string) =>
  new NextRequest(`http://localhost/api/console/usage/v1?${q}`);
test("reads only the authenticated owner's receipts and returns canonical retail dollars", async () => {
  mockQuery.mockResolvedValue([
    { operationId: "op", status: "settled", credits: 25 },
  ]);
  const result = await GET(request("sessionId=s&userId=attacker"));
  expect(result.status).toBe(200);
  expect(result.headers.get("cache-control")).toBe("no-store");
  expect(mockQuery.mock.calls[0][1]).toEqual({
    serviceKey: "secret-service",
    userId: "owner",
    sessionId: "s",
  });
  expect(await result.json()).toMatchObject({
    credits: 25,
    usd: 0.0025,
    status: "settled",
  });
});
test("unknown and unavailable receipts never become zero", async () => {
  mockQuery.mockResolvedValue([]);
  expect(await (await GET(request("sessionId=s"))).json()).toMatchObject({
    credits: null,
    usd: null,
    status: "unknown",
  });
  mockQuery.mockRejectedValue(Error("offline"));
  expect((await GET(request("sessionId=s"))).status).toBe(503);
});
test("validates selection and authentication", async () => {
  expect((await GET(request("sessionId=s&chatId=c"))).status).toBe(400);
  expect((await GET(request("sessionId=bad%2Fpath"))).status).toBe(400);
  mockIdentity.mockRejectedValue(Error("revoked"));
  expect((await GET(request("sessionId=s"))).status).toBe(401);
  expect(mockQuery).not.toHaveBeenCalled();
});
