/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { getUserID } from "@/lib/auth/get-user-id";
import { consumeGithubHandoff } from "@/lib/github/oauth-handoff";
import { completeGithubOAuth } from "@/lib/github/complete-oauth";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
jest.mock("@/lib/github/oauth-handoff", () => ({
  consumeGithubHandoff: jest.fn(),
}));
jest.mock("@/lib/github/complete-oauth", () => ({
  completeGithubOAuth: jest.fn(),
}));
const ticket = "a".repeat(64);
const request = (origin = "https://riftsys.app") =>
  new NextRequest("https://riftsys.app/github-complete", {
    method: "POST",
    headers: {
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `ticket=${ticket}`,
  });
beforeEach(() => {
  jest.mocked(getUserID).mockReset().mockResolvedValue("right-user");
  jest.mocked(consumeGithubHandoff).mockReset();
  jest.mocked(completeGithubOAuth).mockReset().mockResolvedValue("connected");
});
it("GET reveals no credentials and does not consume the one-use ticket", async () => {
  const response = GET(
    new NextRequest(
      `https://riftsys.app/github-complete?ticket=${ticket}&github=error`,
    ),
  );
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(response.headers.get("Referrer-Policy")).toBe("same-origin");
  expect(await response.text()).toContain('method="post"');
  expect(consumeGithubHandoff).not.toHaveBeenCalled();
});
it("requires a signed-in same-origin POST before consumption", async () => {
  expect((await POST(request("https://evil.test"))).status).toBe(403);
  expect((await POST(request("null"))).status).toBe(403);
  jest.mocked(getUserID).mockRejectedValueOnce(new Error());
  expect((await POST(request())).status).toBe(401);
  expect(consumeGithubHandoff).not.toHaveBeenCalled();
});
it("only exchanges an authenticated one-use handoff and then returns original path", async () => {
  jest
    .mocked(consumeGithubHandoff)
    .mockResolvedValueOnce({ code: "once", returnTo: "/c/chat?foo=bar" })
    .mockResolvedValueOnce(null);
  const response = await POST(request());
  expect(consumeGithubHandoff).toHaveBeenCalledWith(
    "right-user",
    ticket,
    "https://riftsys.app",
  );
  expect(completeGithubOAuth).toHaveBeenCalledWith({
    origin: "https://riftsys.app",
    userId: "right-user",
    code: "once",
    returnTo: "/c/chat?foo=bar",
  });
  expect(response.status).toBe(303);
  expect(response.headers.get("location")).toBe(
    "https://riftsys.app/c/chat?foo=bar&github=connected",
  );
  expect((await POST(request())).status).toBe(400);
  expect(completeGithubOAuth).toHaveBeenCalledTimes(1);
});
it("expired tickets render a branded secure recovery page without redirect loops", async () => {
  const response = GET(
    new NextRequest("https://riftsys.app/github-complete?ticket=bad"),
  );
  expect(response.status).toBe(400);
  expect(response.headers.get("Content-Type")).toContain("text/html");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  const html = await response.text();
  expect(html).toContain("Back to RIFT");
  expect(html).toContain('href="/"');
  expect(html).toContain("prefers-color-scheme");
  expect(html).not.toContain(".submit()");
});
