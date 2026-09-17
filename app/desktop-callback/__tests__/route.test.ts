import { jest } from "@jest/globals";

const mockExchangeDesktopTransferToken = jest.fn();
const mockUnsealDesktopAuthSession = jest.fn();
const mockCookieSet = jest.fn();
const mockHeaderSet = jest.fn();
const mockRedirect = jest.fn((destination: URL, status: number) => ({
  destination,
  status,
  cookies: { set: mockCookieSet },
  headers: { set: mockHeaderSet },
}));

jest.mock("next/server", () => ({
  NextResponse: { redirect: mockRedirect },
}));

jest.mock("@/lib/desktop-auth", () => ({
  exchangeDesktopTransferToken: mockExchangeDesktopTransferToken,
}));

jest.mock("@/lib/desktop-auth-session", () => ({
  unsealDesktopAuthSession: mockUnsealDesktopAuthSession,
}));

const transferToken = "b".repeat(64);
const desktopAuthState = "a".repeat(64);

function request(path: string, origin = "http://localhost:3014") {
  const nextUrl = new URL(path, origin);
  return { nextUrl } as never;
}

describe("GET /desktop-callback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExchangeDesktopTransferToken.mockResolvedValue({
      sealedSession: "sealed-session",
      returnPath: "/studio",
    } as never);
    mockUnsealDesktopAuthSession.mockResolvedValue({
      token: "access-token",
      refreshToken: "refresh-token",
    } as never);
  });

  it("exchanges a state-bound one-time token and installs httpOnly auth cookies", async () => {
    const { GET } = await import("../route");
    const response = (await GET(
      request(
        `/desktop-callback?token=${transferToken}&desktop_state=${desktopAuthState}`,
      ),
    )) as unknown as { destination: URL; status: number };

    expect(mockExchangeDesktopTransferToken).toHaveBeenCalledWith(
      transferToken,
      { desktopAuthState },
    );
    expect(response.status).toBe(303);
    expect(response.destination.toString()).toBe(
      "http://localhost:3014/studio",
    );
    expect(mockCookieSet).toHaveBeenCalledWith(
      "__convexAuthJWT",
      "access-token",
      expect.objectContaining({
        httpOnly: true,
        sameSite: "lax",
        secure: false,
      }),
    );
    expect(mockCookieSet).toHaveBeenCalledWith(
      "__convexAuthRefreshToken",
      "refresh-token",
      expect.objectContaining({ httpOnly: true, secure: false }),
    );
    expect(mockHeaderSet).toHaveBeenCalledWith("Cache-Control", "no-store");
  });

  it("rejects malformed input before touching the transfer store", async () => {
    const { GET } = await import("../route");
    const response = (await GET(
      request("/desktop-callback?token=bad&desktop_state=bad"),
    )) as unknown as { destination: URL; status: number };

    expect(mockExchangeDesktopTransferToken).not.toHaveBeenCalled();
    expect(response.status).toBe(303);
    expect(response.destination.pathname).toBe("/auth-error");
    expect(response.destination.searchParams.get("code")).toBe("401");
    expect(mockCookieSet).not.toHaveBeenCalled();
  });

  it("refuses an unsafe return URL after a valid exchange", async () => {
    mockExchangeDesktopTransferToken.mockResolvedValueOnce({
      sealedSession: "sealed-session",
      returnPath: "//attacker.example/collect",
    } as never);
    const { GET } = await import("../route");
    const response = (await GET(
      request(
        `/desktop-callback?token=${transferToken}&desktop_state=${desktopAuthState}`,
      ),
    )) as unknown as { destination: URL };

    expect(response.destination.toString()).toBe("http://localhost:3014/");
  });

  it("uses host-prefixed secure cookies outside localhost", async () => {
    const { GET } = await import("../route");
    await GET(
      request(
        `/desktop-callback?token=${transferToken}&desktop_state=${desktopAuthState}`,
        "https://rift.co",
      ),
    );

    expect(mockCookieSet).toHaveBeenCalledWith(
      "__Host-__convexAuthJWT",
      "access-token",
      expect.objectContaining({ secure: true, path: "/" }),
    );
    expect(mockCookieSet).toHaveBeenCalledWith(
      "__Host-__convexAuthRefreshToken",
      "refresh-token",
      expect.objectContaining({ secure: true, path: "/" }),
    );
  });
});
