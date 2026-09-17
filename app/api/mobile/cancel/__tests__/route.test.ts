/** @jest-environment node */
import { NextRequest } from "next/server";
import { ConvexError } from "convex/values";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchMutation } from "convex/nextjs";
import { POST } from "../route";
jest.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: jest.fn(),
}));
jest.mock("convex/nextjs", () => ({ fetchMutation: jest.fn() }));
const mutation = jest.mocked(fetchMutation);
const request = (body = JSON.stringify({ chatId: "chat" })) =>
  new NextRequest("https://riftsys.app/api/mobile/cancel", {
    method: "POST",
    body,
  });
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(convexAuthNextjsToken).mockResolvedValue("session");
});
it("rejects unauthenticated stops without a mutation", async () => {
  jest.mocked(convexAuthNextjsToken).mockResolvedValue(undefined);
  expect((await POST(request())).status).toBe(401);
  expect(mutation).not.toHaveBeenCalled();
});
it.each(["{", "null", JSON.stringify({ chatId: "  " })])(
  "rejects malformed input: %s",
  async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mutation).not.toHaveBeenCalled();
  },
);
it("preserves ownership denial instead of reporting a temporary outage", async () => {
  mutation.mockRejectedValue(
    new ConvexError({ code: "ACCESS_DENIED", message: "private" }),
  );
  const response = await POST(request());
  expect(response.status).toBe(403);
  expect(await response.text()).not.toContain("private");
});
it("does not confirm a failed stop", async () => {
  mutation.mockRejectedValue(new Error("private"));
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ canceled: false });
});
it("confirms only the authenticated mutation and prevents caching", async () => {
  mutation.mockResolvedValue(null);
  const response = await POST(request());
  expect(await response.json()).toEqual({ canceled: true });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mutation.mock.calls[0][2]).toEqual({ token: "session" });
});
