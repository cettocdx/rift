/** @jest-environment node */
import { getUserID } from "@/lib/auth/get-user-id";
import {
  githubStateCookie,
  githubStateDigest,
} from "@/lib/github/oauth-browser-binding";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
import { NextRequest } from "next/server";
import { GET } from "../route";
import { signState } from "@/lib/github/oauth-state";
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({
    mutation: (...args: unknown[]) => mutation(...args),
  }),
}));
jest.mock("@/lib/ai/mcp/connect-github-plugin", () => ({
  connectGitHubPlugin: jest.fn(),
}));
const fetchMock = jest.fn();
const originalFetch = global.fetch;
const env = { ...process.env };
beforeEach(() => {
  jest.mocked(getUserID).mockResolvedValue("user");
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  process.env.CONVEX_SERVICE_ROLE_KEY = "service";
  process.env.GITHUB_OAUTH_STATE_SECRET = "state-secret";
  global.fetch = fetchMock;
  fetchMock.mockReset();
  mutation.mockReset().mockResolvedValue({ success: true });
});
afterAll(() => {
  global.fetch = originalFetch;
  process.env = env;
});
function request(extra = "", path = "/c/chat?existing=1") {
  const state = signState("user", path);
  return new NextRequest(
    `https://riftsys.app/api/github/callback?state=${state}&code=once${extra}`,
    {
      headers: {
        Cookie: `${githubStateCookie("https://riftsys.app")}=${githubStateDigest(state)}`,
      },
    },
  );
}
const status = (response: Response) =>
  new URL(response.headers.get("location")!).searchParams.get("github");
it("stores refresh lifetime and verified account before returning to the original chat", async () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(1780000000000);
  fetchMock.mockResolvedValueOnce(
    Response.json({
      access_token: "token",
      expires_in: 28800,
      refresh_token: "refresh",
      refresh_token_expires_in: 15811200,
    }),
  );
  fetchMock.mockResolvedValueOnce(Response.json({ login: "cetto" }));
  const response = await GET(request());
  expect(status(response)).toBe("connected");
  expect(new URL(response.headers.get("location")!).pathname).toBe("/c/chat");
  expect(mutation).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({
      userId: "user",
      token: "token",
      username: "cetto",
      refreshToken: "refresh",
      expiresAt: 1780028800000,
      refreshExpiresAt: 1795811200000,
    }),
  );
  for (const [, init] of fetchMock.mock.calls)
    expect(init).toMatchObject({
      cache: "no-store",
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  now.mockRestore();
});
it.each([404, 401])(
  "reports invalid GitHub configuration on HTTP %s without saving credentials",
  async (code) => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ error: "Not Found" }, { status: code }),
    );
    expect(status(await GET(request()))).toBe("configuration_error");
    expect(mutation).not.toHaveBeenCalled();
  },
);
it.each(["incorrect_client_credentials", "redirect_uri_mismatch"])(
  "reports %s as app configuration failure",
  async (error) => {
    fetchMock.mockResolvedValueOnce(Response.json({ error }));
    expect(status(await GET(request()))).toBe("configuration_error");
  },
);
it("distinguishes provider configuration error from user denying access", async () => {
  expect(status(await GET(request("&error=redirect_uri_mismatch")))).toBe(
    "configuration_error",
  );
  expect(status(await GET(request("&error=access_denied")))).toBe("denied");
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not claim connected when credential storage declined", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ access_token: "token" }))
    .mockResolvedValueOnce(Response.json({ login: "cetto" }));
  mutation.mockResolvedValue({ success: false });
  expect(status(await GET(request()))).toBe("error");
});
it("does not persist an unverified account token", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ access_token: "token" }))
    .mockResolvedValueOnce(Response.json({}, { status: 401 }));
  expect(status(await GET(request()))).toBe("exchange_failed");
  expect(mutation).not.toHaveBeenCalled();
});
it("handles provider timeouts without logging credential-bearing exceptions", async () => {
  const log = jest.spyOn(console, "warn").mockImplementation(() => {});
  fetchMock.mockRejectedValueOnce(
    new Error("request failed with secret-token-body"),
  );
  expect(status(await GET(request()))).toBe("provider_unavailable");
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token-body");
  log.mockRestore();
});
it("rejects a malformed state and missing signing configuration without a 500", async () => {
  delete process.env.GITHUB_OAUTH_STATE_SECRET;
  delete process.env.CONVEX_SERVICE_ROLE_KEY;
  expect(
    status(
      await GET(
        new NextRequest(
          "https://riftsys.app/api/github/callback?state=body.signature&code=bad",
        ),
      ),
    ),
  ).toBe("not_configured");
});
