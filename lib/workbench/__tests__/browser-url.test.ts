import { normalizeBrowserAddress } from "../browser-url";

describe("browser addresses", () => {
  it.each([
    ["example.com/path?q=yes#part", "https://example.com/path?q=yes#part"],
    ["localhost:3020?preview=1", "http://localhost:3020/?preview=1"],
    ["127.0.0.1:5173#app", "http://127.0.0.1:5173/#app"],
    ["[::1]:8080/path", "http://[::1]:8080/path"],
    ["dev.example:8443/path", "https://dev.example:8443/path"],
    ["https://localhost:3020", "https://localhost:3020/"],
    ["about:blank", "about:blank"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBrowserAddress(input)).toBe(expected);
  });
  it.each([
    "",
    "javascript:alert(1)",
    "javascript:123",
    "data:text/html,test",
    "file:///etc/passwd",
    "tauri://localhost",
    "rift://auth",
    "https:example.com",
    "//example.com",
    "https://user:pass@example.com",
    "user:pass@example.com",
    "https://user@example.com",
    "https://example.com/\nsecret",
    "\thttps://example.com",
    "https://example.com/\u007f",
    "about:blank#other",
    "https://",
    "localhost:99999",
    "https://example.com\\evil",
    "x".repeat(4097),
  ])("rejects unsafe or malformed input %s", (input) => {
    expect(normalizeBrowserAddress(input)).toBeNull();
  });
});
