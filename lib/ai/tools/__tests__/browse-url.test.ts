import {
  createBrowseUrl,
  createBrowserResourceLoader,
  validateDesktopLoopbackBrowseUrl,
  validatePublicBrowseUrl,
  type BrowseUrlResult,
  type DesktopLoopbackFetcher,
} from "../browse-url";

const publicSnapshot: Extract<BrowseUrlResult, { ok: true }> = {
  ok: true,
  scope: "public-web",
  url: "https://example.com/docs",
  title: "Documentation",
  status: 200,
  contentType: "text/html",
  text: "Public documentation",
  links: [{ text: "API", url: "https://example.com/api" }],
  network: { requests: 2, blocked: 0, bytes: 512 },
};

function mockFetchResponse(
  body: string,
  options: { status?: number; headers?: Record<string, string> } = {},
): Response {
  const headerEntries = Object.entries(options.headers ?? {}).map(
    ([name, value]) => [name.toLowerCase(), value] as const,
  );
  const bytes = new TextEncoder().encode(body);
  let consumed = false;
  return {
    status: options.status ?? 200,
    headers: {
      get: (name: string) =>
        headerEntries.find(([key]) => key === name.toLowerCase())?.[1] ?? null,
      forEach: (callback: (value: string, key: string) => void) => {
        for (const [key, value] of headerEntries) callback(value, key);
      },
    },
    body: {
      cancel: jest.fn(async () => undefined),
      getReader: () => ({
        read: jest.fn(async () => {
          if (consumed) return { done: true, value: undefined };
          consumed = true;
          return { done: false, value: bytes };
        }),
        cancel: jest.fn(async () => undefined),
        releaseLock: jest.fn(),
      }),
    },
  } as unknown as Response;
}

function buildContext(purpose: "app" | "security" | "image" = "app") {
  return { purpose } as never;
}

async function runTool(
  rawUrl: string,
  renderer = jest.fn(async () => publicSnapshot),
  purpose: "app" | "security" | "image" = "app",
  desktopLoopbackFetch?: DesktopLoopbackFetcher,
) {
  const browserTool = createBrowseUrl(buildContext(purpose), {
    renderer,
    desktopLoopbackFetch,
  });
  const execute = browserTool.execute as NonNullable<
    typeof browserTool.execute
  >;
  const result = await execute(
    { url: rawUrl, brief: "Read the supplied page" },
    {
      toolCallId: "browse-1",
      messages: [],
    },
  );
  return { result, renderer };
}

describe("browse_url public target policy", () => {
  it("accepts canonical public HTTPS URLs and preserves browser fragments", () => {
    expect(
      validatePublicBrowseUrl("  https://example.com/docs/#install  "),
    ).toBe("https://example.com/docs#install");
  });

  it.each([
    "http://example.com/docs",
    "http://localhost:3000",
    "https://127.0.0.1:8443",
    "https://10.0.0.8",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]:8443",
    "file:///etc/passwd",
    "https://user:password@example.com/private",
  ])("rejects non-public or non-HTTPS target %s", (url) => {
    expect(() => validatePublicBrowseUrl(url)).toThrow();
  });

  it("does not depend on Jina or Perplexity provider keys", async () => {
    const previousJina = process.env.JINA_API_KEY;
    const previousPerplexity = process.env.PERPLEXITY_API_KEY;
    delete process.env.JINA_API_KEY;
    delete process.env.PERPLEXITY_API_KEY;
    try {
      const { result, renderer } = await runTool("https://example.com/docs");
      expect(result).toEqual(publicSnapshot);
      expect(renderer).toHaveBeenCalledWith("https://example.com/docs", {
        signal: expect.any(AbortSignal),
      });
    } finally {
      if (previousJina) process.env.JINA_API_KEY = previousJina;
      if (previousPerplexity) {
        process.env.PERPLEXITY_API_KEY = previousPerplexity;
      }
    }
  });

  it("fails closed for localhost instead of resolving it in the cloud worker", async () => {
    const renderer = jest.fn(async () => publicSnapshot);
    const { result } = await runTool("http://localhost:5173", renderer);

    expect(result).toMatchObject({
      ok: false,
      code: "local-access-required",
      error: expect.stringContaining("Start RIFT Desktop"),
    });
    expect(renderer).not.toHaveBeenCalled();
  });

  it("routes explicit loopback reads through the consented desktop relay", async () => {
    expect(validateDesktopLoopbackBrowseUrl("http://127.0.0.2:5173/app")).toBe(
      "http://127.0.0.2:5173/app",
    );
    const renderer = jest.fn(async () => publicSnapshot);
    const desktopLoopbackFetch = jest.fn(async () => ({
      status: 200,
      finalUrl: "http://localhost:5173/app",
      contentType: "text/html; charset=utf-8",
      encoding: "utf8" as const,
      body: '<html><head><title>Local app</title></head><body><main>Ready</main><a href="/settings">Settings</a></body></html>',
      bytes: 128,
      truncated: false,
    }));

    const { result } = await runTool(
      "http://localhost:5173/app",
      renderer,
      "app",
      desktopLoopbackFetch,
    );

    expect(desktopLoopbackFetch).toHaveBeenCalledWith(
      "http://localhost:5173/app",
      { signal: expect.any(AbortSignal) },
    );
    expect(result).toMatchObject({
      ok: true,
      scope: "desktop-loopback",
      title: "Local app",
      text: expect.stringContaining("Ready"),
      links: [
        {
          url: "http://localhost:5173/settings",
        },
      ],
    });
    expect(renderer).not.toHaveBeenCalled();
  });

  it("reports a native relay denial without falling back to cloud localhost", async () => {
    const denied = Object.assign(new Error("User denied"), { code: "denied" });
    const desktopLoopbackFetch = jest.fn(async () => {
      throw denied;
    });
    const { result } = await runTool(
      "http://localhost:3000",
      jest.fn(async () => publicSnapshot),
      "app",
      desktopLoopbackFetch,
    );

    expect(result).toMatchObject({
      ok: false,
      code: "local-access-denied",
    });
  });

  it("reads public pages in Hack Workbench", async () => {
    const { result, renderer } = await runTool(
      "https://example.com/docs",
      jest.fn(async () => publicSnapshot),
      "security",
    );
    expect(result).toEqual(publicSnapshot);
    expect(renderer).toHaveBeenCalledTimes(1);
  });

  it("keeps private network addresses blocked in Hack Workbench", async () => {
    const { result, renderer } = await runTool(
      "https://169.254.169.254/latest/meta-data",
      jest.fn(async () => publicSnapshot),
      "security",
    );
    expect(result).toMatchObject({ ok: false });
    expect(renderer).not.toHaveBeenCalled();
  });

  it("cannot be promoted into Studio", async () => {
    const renderer = jest.fn(async () => publicSnapshot);
    const { result } = await runTool("https://example.com", renderer, "image");

    expect(result).toMatchObject({ ok: false, code: "invalid-url" });
    expect(renderer).not.toHaveBeenCalled();
  });
});

describe("browse_url resource transport", () => {
  it("forwards only harmless headers and keeps redirects manual", async () => {
    const safeFetch = jest.fn(async () =>
      mockFetchResponse("hello", {
        status: 200,
        headers: {
          "content-type": "text/plain",
          "set-cookie": "session=secret",
          "x-public": "yes",
        },
      }),
    );
    const load = createBrowserResourceLoader(safeFetch as never);

    const result = await load("https://example.com/page", {
      method: "GET",
      headers: {
        Accept: "text/html",
        Authorization: "Bearer secret",
        Cookie: "session=secret",
        Referer: "https://private.example/",
        "User-Agent": "RIFT Browser",
      },
    });

    expect(safeFetch).toHaveBeenCalledWith(
      "https://example.com/page",
      expect.objectContaining({
        method: "GET",
        redirect: "manual",
        headers: {
          accept: "text/html",
          "accept-encoding": "identity",
          "user-agent": "RIFT Browser",
        },
      }),
    );
    expect(result.body.toString()).toBe("hello");
    expect(result.headers).toMatchObject({
      "content-type": "text/plain",
      "x-public": "yes",
    });
    expect(result.headers).not.toHaveProperty("set-cookie");
  });

  it("blocks state-changing browser requests before network execution", async () => {
    const safeFetch = jest.fn();
    const load = createBrowserResourceLoader(safeFetch as never);

    await expect(
      load("https://example.com/form", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    ).rejects.toThrow("Browser method POST is not allowed");
    expect(safeFetch).not.toHaveBeenCalled();
  });

  it("enforces a per-resource response cap before buffering the body", async () => {
    const safeFetch = jest.fn(async () =>
      mockFetchResponse("small", {
        headers: { "content-length": String(5 * 1024 * 1024) },
      }),
    );
    const load = createBrowserResourceLoader(safeFetch as never);

    await expect(
      load("https://example.com/large.js", {
        method: "GET",
      }),
    ).rejects.toThrow("Web resource exceeded");
  });
});
