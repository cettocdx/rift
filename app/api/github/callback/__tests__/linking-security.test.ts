/** @jest-environment node */
import { NextRequest } from "next/server";
import { GET } from "../route";
import { signState } from "@/lib/github/oauth-state";
import { getUserID } from "@/lib/auth/get-user-id";
jest.mock("@/lib/auth/get-user-id", () => ({ getUserID: jest.fn() }));
const mutation = jest.fn();
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => ({ mutation }),
}));
jest.mock("@/lib/ai/mcp/connect-github-plugin", () => ({
  connectGitHubPlugin: jest.fn(),
}));
beforeEach(() => {
  process.env.GITHUB_OAUTH_CLIENT_ID = "client";
  process.env.GITHUB_OAUTH_CLIENT_SECRET = "secret";
  process.env.CONVEX_SERVICE_ROLE_KEY = "service";
  process.env.GITHUB_OAUTH_STATE_SECRET = "state-secret";
  global.fetch = jest.fn();
  mutation.mockReset().mockResolvedValue({ success: true });
  jest.mocked(getUserID).mockResolvedValue("victim");
});
it("rejects a transferred signed state before exchanging victim GitHub credentials", async () => {
  const state = signState("attacker", "/");
  const response = await GET(
    new NextRequest(
      `https://riftsys.app/api/github/callback?state=${state}&code=victim-code`,
    ),
  );
  expect(
    new URL(response.headers.get("location")!).searchParams.get("github"),
  ).toBe("bad_state");
  expect(fetch).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it("desktop callback queues a handoff without exchanging or saving credentials", async () => {
  const state = signState("attacker", "/c/chat", "a".repeat(64));
  const response = await GET(
    new NextRequest(
      `https://riftsys.app/api/github/callback?state=${state}&code=victim-code`,
    ),
  );
  const url = new URL(response.headers.get("location")!);
  expect(url.searchParams.get("github")).toBe("pending");
  expect(url.searchParams.get("return_to")).toMatch(
    /^\/github-complete\?ticket=[a-f0-9]{64}$/,
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(mutation.mock.calls)).not.toContain("victim-code");
});
it("rejects a transferred state even if a browser presents its digest but a different RIFT user", async () => {
  const { githubStateCookie, githubStateDigest } =
    await import("@/lib/github/oauth-browser-binding");
  const state = signState("attacker", "/");
  const response = await GET(
    new NextRequest(
      `https://riftsys.app/api/github/callback?state=${state}&code=victim-code`,
      {
        headers: {
          Cookie: `${githubStateCookie("https://riftsys.app")}=${githubStateDigest(state)}`,
        },
      },
    ),
  );
  expect(
    new URL(response.headers.get("location")!).searchParams.get("github"),
  ).toBe("bad_state");
  expect(fetch).not.toHaveBeenCalled();
  expect(mutation).not.toHaveBeenCalled();
});
it("preserves detailed desktop failure when existing Rust appends generic error", async () => {
  const state = signState("user", "/c/chat?existing=1", "a".repeat(64));
  const response = await GET(
    new NextRequest(
      `https://riftsys.app/api/github/callback?state=${state}&error=access_denied`,
    ),
  );
  const external = new URL(response.headers.get("location")!);
  // Existing Rust joins return_to then appends github=error for non-success.
  const nativeTarget = new URL(
    external.searchParams.get("return_to")!,
    "https://riftsys.app",
  );
  nativeTarget.searchParams.append("github", "error");
  expect(nativeTarget.searchParams.get("github")).toBe("denied");
  expect(nativeTarget.pathname).toBe("/c/chat");
  expect(nativeTarget.searchParams.get("existing")).toBe("1");
});
