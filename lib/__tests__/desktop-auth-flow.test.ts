import {
  buildDesktopLoginReturnPath,
  buildDesktopNativeCallbackUrl,
  hasDesktopOAuthCode,
  parseDesktopLoginRequest,
  resolveDesktopAppOrigin,
  sanitizeDesktopReturnPath,
} from "../desktop-auth-flow";

const desktopAuthState = "a".repeat(64);
const transferToken = "b".repeat(64);

describe("desktop auth route contract", () => {
  it("recognizes only a bounded OAuth code that the global handler can exchange", () => {
    expect(hasDesktopOAuthCode({ code: "one-time-code" })).toBe(true);
    expect(hasDesktopOAuthCode({ code: ["first-code", "ignored-code"] })).toBe(
      true,
    );
    expect(hasDesktopOAuthCode({})).toBe(false);
    expect(hasDesktopOAuthCode({ code: "   " })).toBe(false);
    expect(hasDesktopOAuthCode({ code: "x".repeat(4097) })).toBe(false);
  });

  it("parses a state-bound development request and preserves a safe return path", () => {
    const request = parseDesktopLoginRequest({
      desktop_state: desktopAuthState,
      dev_callback_port: "43127",
      returnTo: "/studio?tab=video#latest",
      screen_hint: "sign-up",
    });

    expect(request).toEqual({
      desktopAuthState,
      devCallbackPort: 43127,
      returnPath: "/studio?tab=video#latest",
      screenHint: "sign-up",
    });
    expect(buildDesktopLoginReturnPath(request!)).toBe(
      `/desktop-login?desktop_state=${desktopAuthState}&dev_callback_port=43127&returnTo=%2Fstudio%3Ftab%3Dvideo%23latest&screen_hint=sign-up`,
    );
  });

  it("preserves the pricing intent as the canonical desktop return path", () => {
    const request = parseDesktopLoginRequest({
      desktop_state: desktopAuthState,
      intent: "pricing",
    });

    expect(request?.returnPath).toBe("/pricing");
    expect(buildDesktopLoginReturnPath(request!)).toBe(
      `/desktop-login?desktop_state=${desktopAuthState}&returnTo=%2Fpricing`,
    );
  });

  it("rejects malformed desktop state and loopback ports", () => {
    expect(
      parseDesktopLoginRequest({ desktop_state: "not-native-state" }),
    ).toBeNull();
    expect(
      parseDesktopLoginRequest({
        desktop_state: desktopAuthState,
        dev_callback_port: "80",
      }),
    ).toBeNull();
    expect(
      parseDesktopLoginRequest({
        desktop_state: desktopAuthState,
        dev_callback_port: "70000",
      }),
    ).toBeNull();
  });

  it.each([
    ["//attacker.example/path", "/"],
    ["/\\attacker.example/path", "/"],
    ["https://attacker.example", "/"],
    ["/desktop-callback?token=again", "/"],
    ["/agents?create=team", "/agents?create=team"],
  ])("sanitizes desktop return path %s", (input, expected) => {
    expect(sanitizeDesktopReturnPath(input)).toBe(expected);
  });

  it("builds a localhost-only development callback with the native state", () => {
    const request = parseDesktopLoginRequest({
      desktop_state: desktopAuthState,
      dev_callback_port: "43127",
    })!;
    const callback = new URL(
      buildDesktopNativeCallbackUrl({
        transferToken,
        request,
        origin: "http://localhost:3014",
      })!,
    );

    expect(callback.origin).toBe("http://localhost:43127");
    expect(callback.pathname).toBe("/auth-callback");
    expect(callback.searchParams.get("token")).toBe(transferToken);
    expect(callback.searchParams.get("desktop_state")).toBe(desktopAuthState);
    expect(callback.searchParams.get("origin")).toBe("http://localhost:3014");
  });

  it("builds the production deep link without placing session tokens in it", () => {
    const request = parseDesktopLoginRequest({
      desktop_state: desktopAuthState,
    })!;
    const callback = buildDesktopNativeCallbackUrl({
      transferToken,
      request,
      origin: "https://rift.co",
    });

    expect(callback).toBe(
      `rift://auth?token=${transferToken}&origin=https%3A%2F%2Frift.co&desktop_state=${desktopAuthState}`,
    );
    expect(callback).not.toContain("refreshToken");
    expect(callback).not.toContain("__convexAuthJWT");
  });

  it("uses only the canonical desktop origin in production", () => {
    expect(
      resolveDesktopAppOrigin({
        requestHost: "rift.example",
        forwardedProtocol: "https",
        production: true,
      }),
    ).toBe("https://riftsys.app");
    expect(
      resolveDesktopAppOrigin({
        configuredOrigin: "http://rift.example",
        production: true,
      }),
    ).toBeNull();
    expect(
      resolveDesktopAppOrigin({
        configuredOrigin: "https://rift.example/app",
        production: true,
      }),
    ).toBeNull();
    expect(
      resolveDesktopAppOrigin({
        configuredOrigin: "https://riftsys.app/login",
        production: true,
      }),
    ).toBe("https://riftsys.app");
  });
});
