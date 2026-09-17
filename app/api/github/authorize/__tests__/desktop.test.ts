/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET, POST } from "../route";
import { GET as complete } from "@/app/github-desktop-return/route";
import { getUserID } from "@/lib/auth/get-user-id";
import {
  signState,
  verifyState,
  sanitizeReturnTo,
} from "@/lib/github/oauth-state";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
const nonce = "a".repeat(64);
const request = (body: unknown, origin = "https://riftsys.app") =>
  new NextRequest("https://riftsys.app/api/github/authorize", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  process.env.GITHUB_OAUTH_STATE_SECRET = "test-secret";
  process.env.GITHUB_OAUTH_CLIENT_ID = "public-id";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "test-client-secret";
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-service-key";
  jest.mocked(getUserID).mockResolvedValue("real-user");
});
it("starts web authorization through the same authenticated POST without a desktop nonce", async () => {
  const response = await POST(request({ return_to: "/c/chat?x=1" }));
  expect(response.status).toBe(200);
  const url = new URL((await response.json()).url);
  expect(verifyState(url.searchParams.get("state"))).toEqual({
    userId: "real-user",
    returnTo: "/c/chat?x=1",
  });
});
it.each(["GITHUB_OAUTH_CLIENT_SECRET", "CONVEX_SERVICE_ROLE_KEY"])(
  "does not leave RIFT when %s is missing",
  async (key) => {
    delete process.env[key];
    const response = await POST(request({ desktop_state: nonce }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "not_configured" });
    const redirect = await GET(
      new NextRequest(
        "https://riftsys.app/api/github/authorize?return_to=%2Fc%2Fchat%3Fx%3D1",
      ),
    );
    expect(
      new URL(redirect.headers.get("location")!).searchParams.get("github"),
    ).toBe("not_configured");
  },
);
it("binds desktop return to authenticated user and signed nonce", async () => {
  const response = await POST(
    request({
      return_to: "/c/chat?x=1",
      desktop_state: nonce,
      userId: "forged-user",
    }),
  );
  const url = new URL((await response.json()).url);
  expect(url.origin).toBe("https://github.com");
  expect(verifyState(url.searchParams.get("state"))).toEqual({
    userId: "real-user",
    returnTo: "/c/chat?x=1",
    desktopState: nonce,
    desktopScheme: "rift",
  });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
it("rejects cross-origin, anonymous and malformed initiations", async () => {
  expect(
    (await POST(request({ desktop_state: nonce }, "https://evil.test"))).status,
  ).toBe(403);
  expect((await POST(request({ desktop_state: "bad" }))).status).toBe(400);
  jest.mocked(getUserID).mockRejectedValue(new Error("signed out"));
  expect((await POST(request({ desktop_state: nonce }))).status).toBe(401);
});
it.each(["//evil.test", "/\\evil.test", "https://evil.test"])(
  "rejects off-origin return %s",
  (path) => {
    expect(sanitizeReturnTo(path)).toBe("/");
  },
);
it("rejects tampered and expired signed desktop states", () => {
  const signed = signState("user", "/", nonce);
  expect(verifyState(signed + ".extra")).toBeNull();
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 11 * 60_000);
  expect(verifyState(signed)).toBeNull();
  now.mockRestore();
});
it("provides an escaped, credential-free native return with manual fallback", async () => {
  const response = complete(
    new NextRequest(
      `https://riftsys.app/github-desktop-return?desktop_state=${nonce}&github=connected&return_to=${encodeURIComponent('/c/chat?x="<script>')}`,
    ),
  );
  const html = await response.text();
  expect(html).toContain("Open RIFT");
  expect(html).toContain("rift://github");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("access_token");
  expect(response.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(
    complete(
      new NextRequest(
        "https://riftsys.app/github-desktop-return?desktop_state=bad",
      ),
    ).status,
  ).toBe(400);
});
it("keeps preview return distinct from the production app", async () => {
  const response = await POST(
    request({ desktop_state: nonce, desktop_scheme: "rift-preview" }),
  );
  const authorization = new URL((await response.json()).url);
  expect(
    verifyState(authorization.searchParams.get("state"))?.desktopScheme,
  ).toBe("rift-preview");
  const html = await complete(
    new NextRequest(
      `https://riftsys.app/github-desktop-return?desktop_state=${nonce}&desktop_scheme=rift-preview&github=connected`,
    ),
  ).text();
  expect(html).toContain("rift-preview://github");
  expect(html).not.toContain('"rift://github');
});
it("binds web authorization to a host-only HttpOnly cookie", async () => {
  const response = await POST(request({ return_to: "/" }));
  const cookie = response.headers.get("set-cookie")!;
  expect(cookie).toContain("__Host-rift-github-oauth-state=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("Secure");
  expect(cookie).toContain("SameSite=lax");
  expect(cookie).toContain("Max-Age=600");
  expect(cookie).not.toContain("Domain=");
});
it("external desktop return says pending and carries completion only through the native nonce gate", async () => {
  const response = complete(
    new NextRequest(
      `https://riftsys.app/github-desktop-return?desktop_state=${nonce}&github=pending&return_to=${encodeURIComponent("/github-complete?ticket=" + "b".repeat(64))}`,
    ),
  );
  const html = await response.text();
  expect(html).toContain("Finish connecting GitHub");
  expect(html).not.toContain("GitHub connected");
  expect(html).toContain("rift://github");
  expect(html).toContain("github-complete");
});
