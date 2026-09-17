import { canonicalizeMcpUrl, classifyIpAddress } from "../mcp-url-validation";

describe("MCP URL validation", () => {
  it("canonicalizes a public HTTPS endpoint", () => {
    expect(canonicalizeMcpUrl(" HTTPS://Example.COM:443/mcp?mode=1 ")).toBe(
      "https://example.com/mcp?mode=1",
    );
    expect(canonicalizeMcpUrl("https://example.com/mcp///")).toBe(
      "https://example.com/mcp",
    );
  });

  it("allows functional query parameters but rejects query-string secrets", () => {
    expect(canonicalizeMcpUrl("https://example.com/mcp?tenant=acme")).toBe(
      "https://example.com/mcp?tenant=acme",
    );
    for (const key of [
      "token",
      "api_key",
      "apiKey",
      "apikey",
      "auth_token",
      "authToken",
      "accessToken",
      "client-secret",
      "clientsecret",
      "signature",
      "X-Amz-Signature",
      "X-Amz-Credential",
      "X-Amz-Security-Token",
    ]) {
      expect(() =>
        canonicalizeMcpUrl(`https://example.com/mcp?${key}=secret`),
      ).toThrow(/query string/);
    }
    for (const key of [
      "tenant",
      "version",
      "workspace",
      "monkey",
      "tokenizer",
    ]) {
      expect(canonicalizeMcpUrl(`https://example.com/mcp?${key}=public`)).toBe(
        `https://example.com/mcp?${key}=public`,
      );
    }
  });

  it.each([
    "ftp://example.com/mcp",
    "https://user:secret@example.com/mcp",
    "https://example.com/mcp#fragment",
    "https://example.com/mcp#",
    "https://example.com/a path",
  ])("rejects unsafe URL syntax: %s", (url) => {
    expect(() => canonicalizeMcpUrl(url)).toThrow();
  });

  it("requires HTTPS outside an explicit localhost development opt-in", () => {
    expect(() => canonicalizeMcpUrl("http://example.com/mcp")).toThrow(/HTTPS/);
    expect(() => canonicalizeMcpUrl("http://localhost:8787/mcp")).toThrow(
      /HTTPS/,
    );
    expect(
      canonicalizeMcpUrl("http://localhost:8787/mcp", {
        allowLocalDevelopment: true,
      }),
    ).toBe("http://localhost:8787/mcp");
    expect(() =>
      canonicalizeMcpUrl("http://localhost.attacker.test/mcp", {
        allowLocalDevelopment: true,
      }),
    ).toThrow(/HTTPS/);
  });

  it.each([
    "https://10.0.0.1/mcp",
    "https://172.16.0.1/mcp",
    "https://192.168.1.1/mcp",
    "https://100.64.0.1/mcp",
    "https://169.254.169.254/latest/meta-data",
    "https://192.0.2.1/mcp",
    "https://198.18.0.1/mcp",
    "https://224.0.0.1/mcp",
    "https://255.255.255.255/mcp",
    "https://[::1]/mcp",
    "https://[fc00::1]/mcp",
    "https://[fe80::1]/mcp",
    "https://[ff02::1]/mcp",
    "https://[2001:db8::1]/mcp",
    "https://[::ffff:127.0.0.1]/mcp",
    "https://[::ffff:169.254.169.254]/mcp",
  ])("rejects a special-use IP literal: %s", (url) => {
    expect(() => canonicalizeMcpUrl(url)).toThrow(/cannot target|opt-in/);
  });

  it.each([
    "http://2130706433/mcp",
    "http://0x7f000001/mcp",
    "http://017700000001/mcp",
    "http://127.1/mcp",
    "http://0177.0.0.1/mcp",
  ])(
    "rejects legacy IPv4 notation even with localhost development enabled: %s",
    (url) => {
      expect(() =>
        canonicalizeMcpUrl(url, { allowLocalDevelopment: true }),
      ).toThrow(/canonical dotted-decimal/);
    },
  );

  it("allows only canonical loopback literals under the development opt-in", () => {
    expect(
      canonicalizeMcpUrl("http://127.0.0.1:9090/mcp", {
        allowLocalDevelopment: true,
      }),
    ).toBe("http://127.0.0.1:9090/mcp");
    expect(
      canonicalizeMcpUrl("http://[::1]:9090/mcp", {
        allowLocalDevelopment: true,
      }),
    ).toBe("http://[::1]:9090/mcp");
    expect(() =>
      canonicalizeMcpUrl("http://[::ffff:127.0.0.1]:9090/mcp", {
        allowLocalDevelopment: true,
      }),
    ).toThrow();
  });

  it("classifies embedded and reserved address families", () => {
    expect(classifyIpAddress("8.8.8.8")).toMatchObject({
      version: 4,
      kind: "public",
    });
    expect(classifyIpAddress("::ffff:0a00:0001")).toMatchObject({
      version: 6,
      kind: "private",
      mappedIpv4: "10.0.0.1",
    });
    expect(classifyIpAddress("2001:4860:4860::8888")).toMatchObject({
      version: 6,
      kind: "public",
    });
    expect(classifyIpAddress("64:ff9b::a00:1")).toMatchObject({
      version: 6,
      kind: "reserved",
    });
  });
});
