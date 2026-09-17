import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { ChatSDKError } from "@/lib/errors";

const mockConvexAuthNextjsToken = jest.fn();
const mockFetchQuery = jest.fn();
const mockResolveApiKeyAuth = jest.fn();
const mockCookies = jest.fn();

jest.mock("@convex-dev/auth/nextjs/server", () => ({
  convexAuthNextjsToken: mockConvexAuthNextjsToken,
}));

jest.mock("convex/nextjs", () => ({
  fetchQuery: mockFetchQuery,
}));

jest.mock("@/lib/auth/api-key", () => ({
  resolveApiKeyAuth: mockResolveApiKeyAuth,
}));

jest.mock("next/headers", () => ({
  cookies: mockCookies,
}));

let getUserIDAndPro: typeof import("@/lib/auth/get-user-id").getUserIDAndPro;

describe("getUserIDAndPro verified browser sessions", () => {
  beforeAll(async () => {
    ({ getUserIDAndPro } = await import("@/lib/auth/get-user-id"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.MOCK_BILLING;

    mockResolveApiKeyAuth.mockResolvedValue(null as never);
    mockConvexAuthNextjsToken.mockResolvedValue(
      "verified-session-token" as never,
    );
    mockCookies.mockResolvedValue({ get: jest.fn(() => undefined) } as never);
  });

  it("uses the Convex-verified viewer and live paid entitlements", async () => {
    mockFetchQuery
      .mockResolvedValueOnce({ _id: "user_paid" } as never)
      .mockResolvedValueOnce(["pro-monthly-plan"] as never);

    await expect(getUserIDAndPro()).resolves.toEqual({
      userId: "user_paid",
      subscription: "pro",
      organizationId: undefined,
      pricingMargin: 2.5,
    });

    expect(mockFetchQuery).toHaveBeenCalledTimes(2);
    expect(mockFetchQuery).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      {},
      { token: "verified-session-token" },
    );
    expect(mockFetchQuery).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      {},
      { token: "verified-session-token" },
    );
  });

  it("resolves owner pricing from the verified viewer only", async () => {
    mockFetchQuery
      .mockResolvedValueOnce({
        _id: "owner",
        email: "ahmetcet92@hotmail.com",
      } as never)
      .mockResolvedValueOnce(["ultra-monthly-plan"] as never);
    await expect(getUserIDAndPro()).resolves.toMatchObject({
      userId: "owner",
      pricingMargin: 1,
    });
  });

  it("keeps the API key's verified account pricing", async () => {
    mockResolveApiKeyAuth.mockResolvedValue({
      userId: "owner",
      subscription: "ultra",
      pricingMargin: 1,
    } as never);
    await expect(getUserIDAndPro()).resolves.toMatchObject({
      userId: "owner",
      pricingMargin: 1,
    });
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });

  it("keeps a verified user without paid entitlements on the free tier", async () => {
    mockFetchQuery
      .mockResolvedValueOnce({ _id: "user_free" } as never)
      .mockResolvedValueOnce([] as never);

    await expect(getUserIDAndPro()).resolves.toMatchObject({
      userId: "user_free",
      subscription: "free",
    });
  });

  it("rejects a request with no browser session token", async () => {
    mockConvexAuthNextjsToken.mockResolvedValue(undefined as never);

    await expect(getUserIDAndPro()).rejects.toMatchObject({
      type: "unauthorized",
      surface: "auth",
      statusCode: 401,
    });
    expect(mockFetchQuery).not.toHaveBeenCalled();
  });

  it("fails closed when Convex rejects a forged or expired token", async () => {
    const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockFetchQuery.mockRejectedValue(new Error("invalid auth token") as never);

    try {
      await getUserIDAndPro();
      throw new Error("expected getUserIDAndPro to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ChatSDKError);
      expect(error).toMatchObject({
        type: "unauthorized",
        surface: "auth",
        statusCode: 401,
      });
    }

    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it("fails closed when the verified token has no matching viewer", async () => {
    mockFetchQuery
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(["ultra-monthly-plan"] as never);

    await expect(getUserIDAndPro()).rejects.toMatchObject({
      type: "unauthorized",
      surface: "auth",
      statusCode: 401,
    });
  });
});
