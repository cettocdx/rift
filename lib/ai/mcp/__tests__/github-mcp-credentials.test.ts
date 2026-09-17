import {
  createGithubMcpHeaderResolver,
  githubMcpCredentialReference,
} from "../github-mcp-credentials";

test.each([
  "https://example.com/mcp",
  "https://api.githubcopilot.com/other",
  "https://api.githubcopilot.com/mcp?target=other",
  "https://user@api.githubcopilot.com/mcp",
])(
  "rejects managed GitHub credentials for %s before loading a token",
  (url) => {
    const loadToken = jest.fn();
    expect(() =>
      createGithubMcpHeaderResolver(
        { url, authKind: "bearer", headers: githubMcpCredentialReference() },
        loadToken,
      ),
    ).toThrow("official GitHub endpoint");
    expect(loadToken).not.toHaveBeenCalled();
  },
);

test("preserves explicitly configured manual tokens even at the official endpoint", () => {
  const loadToken = jest.fn();
  expect(
    createGithubMcpHeaderResolver(
      {
        url: "https://api.githubcopilot.com/mcp",
        authKind: "bearer",
        headers: [{ key: "Authorization", value: "Bearer manual-token" }],
      },
      loadToken,
    ),
  ).toBeUndefined();
  expect(loadToken).not.toHaveBeenCalled();
});

test("rejects references mixed with custom credential headers", () => {
  const loadToken = jest.fn();
  expect(() =>
    createGithubMcpHeaderResolver(
      {
        url: "https://api.githubcopilot.com/mcp",
        authKind: "bearer",
        headers: [
          ...githubMcpCredentialReference(),
          { key: "X-Key", value: "custom-token" },
        ],
      },
      loadToken,
    ),
  ).toThrow("official GitHub endpoint");
  expect(loadToken).not.toHaveBeenCalled();
});
