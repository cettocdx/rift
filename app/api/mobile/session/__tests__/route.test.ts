/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
jest.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: jest.fn(),
}));
jest.mock("convex/nextjs", () => ({ fetchQuery: jest.fn() }));
const query = jest.mocked(fetchQuery);
const req = (search = "") =>
  new NextRequest("https://riftsys.app/api/mobile/session" + search);
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(convexAuthNextjsToken).mockResolvedValue("verified-by-convex");
});
it("rejects a missing session before querying user data", async () => {
  jest.mocked(convexAuthNextjsToken).mockResolvedValue(undefined);
  expect((await GET(req())).status).toBe(401);
  expect(query).not.toHaveBeenCalled();
});
it("does not read a conversation's messages when it is unavailable to this user", async () => {
  query.mockResolvedValueOnce({ _id: "owner" }).mockResolvedValueOnce(null);
  expect((await GET(req("?chatId=other"))).status).toBe(404);
  expect(query).toHaveBeenCalledTimes(2);
});
it("returns only the native user and chat projection, never credentials or account internals", async () => {
  query
    .mockResolvedValueOnce({
      _id: "owner",
      name: "RIFT User",
      email: "hidden@example.com",
      privateField: "never",
    })
    .mockResolvedValueOnce({
      page: [
        {
          id: "chat",
          title: "Hello",
          user_id: "owner",
          active_trigger_run_id: "secret-run",
        },
      ],
      isDone: true,
      continueCursor: "",
    });
  const response = await GET(req());
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toEqual({
    user: { name: "RIFT User", image: null },
    page: [{ id: "chat", title: "Hello", purpose: "security" }],
    isDone: true,
    continueCursor: "",
  });
  for (const call of query.mock.calls)
    expect(call[2]).toEqual({ token: "verified-by-convex" });
});
it("preserves the session during a backend outage", async () => {
  query.mockRejectedValueOnce(
    new Error("internal diagnostic must stay private"),
  );
  const response = await GET(req());
  expect(response.status).toBe(503);
  expect(response.headers.get("Set-Cookie")).toBeNull();
  expect(await response.text()).not.toContain("internal diagnostic");
});

it("restores owner-checked file display metadata without storage internals", async () => {
  query
    .mockResolvedValueOnce({ _id: "owner" })
    .mockResolvedValueOnce({ purpose: "image" })
    .mockResolvedValueOnce({
      page: [
        {
          id: "m",
          role: "assistant",
          parts: [],
          fileDetails: [
            {
              fileId: "f",
              name: "art.png",
              mediaType: "image/png",
              s3Key: "private-storage-key",
            },
          ],
        },
      ],
      isDone: true,
    });
  const result = await (await GET(req("?chatId=chat"))).json();
  expect(result.page[0].fileDetails).toEqual([
    { fileId: "f", name: "art.png", mediaType: "image/png" },
  ]);
  expect(JSON.stringify(result)).not.toContain("private-storage-key");
});
