import {
  sanitizeAppRedirectPath,
  sanitizeOAuthCompletionPath,
} from "../safe-app-redirect";

describe("sanitizeAppRedirectPath", () => {
  it.each([
    [undefined, "/"],
    [null, "/"],
    ["", "/"],
    ["studio", "/"],
    ["https://attacker.example/steal", "/"],
    ["//attacker.example/steal", "/"],
    ["/\\\\attacker.example/steal", "/"],
    ["/safe\\path", "/"],
    ["javascript:alert(1)", "/"],
    ["data:text/html,<script>alert(1)</script>", "/"],
    ["/%2f%2fattacker.example/steal", "/"],
    ["/%252f%252fattacker.example/steal", "/"],
    ["/%5c%5cattacker.example/steal", "/"],
    ["/%255c%255cattacker.example/steal", "/"],
    ["/%2e%2e//attacker.example/steal", "/"],
    ["/%00attacker", "/"],
    ["/%E0%A4%A", "/"],
  ])("maps unsafe redirect %p to the app root", (input, expected) => {
    expect(sanitizeAppRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["/", "/"],
    ["/agents", "/agents"],
    ["/studio?tab=video#latest", "/studio?tab=video#latest"],
    [
      "/workspace/c/chat-42?panel=terminal&line=12#activity",
      "/workspace/c/chat-42?panel=terminal&line=12#activity",
    ],
    ["/build/../studio?prompt=hello%20world", "/studio?prompt=hello%20world"],
  ])("preserves safe in-app redirect %p", (input, expected) => {
    expect(sanitizeAppRedirectPath(input)).toBe(expected);
  });
});

describe("sanitizeOAuthCompletionPath", () => {
  it("removes only the OAuth code and preserves desktop state, query, and hash", () => {
    const desktopState = "a".repeat(64);
    expect(
      sanitizeOAuthCompletionPath(
        `https://riftsys.app/desktop-login?desktop_state=${desktopState}&returnTo=%2Fstudio&code=one-time-code#finish`,
        "https://riftsys.app",
      ),
    ).toBe(
      `/desktop-login?desktop_state=${desktopState}&returnTo=%2Fstudio#finish`,
    );
  });

  it("returns the root for the normal root OAuth callback", () => {
    expect(
      sanitizeOAuthCompletionPath(
        "http://localhost:3010/?code=one-time-code",
        "http://localhost:3010",
      ),
    ).toBe("/");
  });

  it.each([
    ["https://attacker.example/?code=one-time-code", "https://riftsys.app"],
    [
      "https://riftsys.app/%252f%252fattacker.example?code=one-time-code",
      "https://riftsys.app",
    ],
    ["not a url", "not an origin"],
    [undefined, "https://riftsys.app"],
  ])("rejects an unsafe OAuth completion location", (href, origin) => {
    expect(sanitizeOAuthCompletionPath(href, origin)).toBe("/");
  });
});
