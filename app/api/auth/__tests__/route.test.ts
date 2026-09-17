/** @jest-environment node */
import type { NextRequest } from "next/server";

const mockFetchAction = jest.fn();
const mockCookieGet = jest.fn();

jest.mock("convex/nextjs", () => ({
  fetchAction: (...args: unknown[]) => mockFetchAction(...args),
}));
jest.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "localhost:3020" }),
  cookies: async () => ({ get: mockCookieGet }),
}));

import { POST } from "../route";

const request = (args: Record<string, unknown> = { refreshToken: "dummy" }) =>
  new Request("http://localhost:3020/api/auth", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "auth:signIn", args }),
  }) as NextRequest;

describe("auth proxy refresh resilience", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchAction.mockReset();
    mockCookieGet.mockImplementation((name: string) => ({
      value: name.includes("RefreshToken") ? "test-refresh" : "test-token",
    }));
  });

  it("recovers a transient refresh failure with one retry and writes the new session once", async () => {
    mockFetchAction
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce({
        tokens: { token: "new-test-token", refreshToken: "new-test-refresh" },
      });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mockFetchAction).toHaveBeenCalledTimes(2);
    expect(mockFetchAction.mock.calls[0][1]).toEqual({
      refreshToken: "test-refresh",
    });
    expect(mockFetchAction.mock.calls[1][1]).toEqual({
      refreshToken: "test-refresh",
    });
    expect(await response.json()).toEqual({
      tokens: { token: "new-test-token", refreshToken: "dummy" },
    });
    const cookies = response.headers.get("set-cookie") ?? "";
    expect(cookies.match(/__convexAuthJWT=/g)).toHaveLength(1);
    expect(cookies.match(/__convexAuthRefreshToken=/g)).toHaveLength(1);
    expect(cookies).not.toContain("__convexAuthJWT=;");
    expect(cookies).not.toContain("__convexAuthRefreshToken=;");
  });

  it.each([
    ["network", new TypeError("fetch failed")],
    [
      "upstream 503",
      Object.assign(new Error("service unavailable"), { status: 503 }),
    ],
    ["unknown infrastructure", new Error("internal-private-detail")],
  ])(
    "preserves cookies after a persistent %s error and returns a bounded retryable response",
    async (_label, error) => {
      mockFetchAction.mockRejectedValue(error);

      const response = await POST(request());

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("1");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(mockFetchAction).toHaveBeenCalledTimes(2);
      expect(await response.json()).toEqual({
        error: "Sign-in is temporarily unavailable. Please try again.",
        retryable: true,
      });
    },
  );

  it("keeps the explicit expired or revoked refresh response signed out", async () => {
    mockFetchAction.mockResolvedValue({ tokens: null });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tokens: null });
    expect(mockFetchAction).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain("__convexAuthJWT=;");
    expect(response.headers.get("set-cookie")).toContain(
      "__convexAuthRefreshToken=;",
    );
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("clears a definitively malformed refresh without returning its content or retrying", async () => {
    mockFetchAction.mockRejectedValue(
      new Error(
        "[Request ID: test] Server Error\nUncaught Error: Can't parse refresh token: private-value",
      ),
    );

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tokens: null });
    expect(mockFetchAction).toHaveBeenCalledTimes(1);
    expect(response.headers.get("set-cookie")).toContain(
      "__convexAuthRefreshToken=;",
    );
  });

  it("does not replay an OAuth code exchange on infrastructure failure", async () => {
    mockFetchAction.mockRejectedValue(new TypeError("fetch failed"));

    const response = await POST(request({ params: { code: "test-code" } }));

    expect(response.status).toBe(503);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockFetchAction).toHaveBeenCalledTimes(1);
    expect(await response.json()).toEqual({
      error: "Sign-in is temporarily unavailable. Please try again.",
      retryable: true,
    });
  });

  it("returns signed out without a backend call when the refresh cookie is missing", async () => {
    mockCookieGet.mockReturnValue(undefined);

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ tokens: null });
    expect(mockFetchAction).not.toHaveBeenCalled();
  });

  it("keeps a known password rejection non-retryable without exposing backend details", async () => {
    mockFetchAction.mockRejectedValue(
      new Error(
        "[Request ID: test] Server Error\nUncaught Error: InvalidSecret\n    at private-backend-function",
      ),
    );

    const response = await POST(
      request({ provider: "password", params: { flow: "signIn" } }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid credentials" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(mockFetchAction).toHaveBeenCalledTimes(1);
  });
});
