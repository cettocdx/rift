import { assertKnownMcpConfiguration } from "../mcp-configuration";

it("detects the observed unauthenticated hosted endpoint, independent of its display name", () => {
  for (const url of [
    "https://mcp.browserbase.com/mcp",
    "https://mcp.browserbase.com/mcp/",
  ])
    expect(() => assertKnownMcpConfiguration({ url })).toThrow("API key");
});
it("does not invent credential requirements for other public or self-hosted endpoints", () => {
  for (const url of [
    "https://public.test/mcp",
    "https://mcp.browserbase.com.other.test/mcp",
    "https://my-browserbase.test/mcp",
  ])
    expect(() => assertKnownMcpConfiguration({ url })).not.toThrow();
});
it("lets the transport validate a supplied credential instead of calling it valid locally", () => {
  expect(() =>
    assertKnownMcpConfiguration({
      url: "https://mcp.browserbase.com/mcp",
      headers: [{ key: "X-Api-Key", value: "candidate" }],
    }),
  ).not.toThrow();
  expect(() =>
    assertKnownMcpConfiguration({
      url: "https://mcp.browserbase.com/mcp",
      headers: [{ key: "X-Api-Key", value: " " }],
    }),
  ).toThrow("API key");
});
