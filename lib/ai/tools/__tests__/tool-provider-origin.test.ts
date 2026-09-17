/** @jest-environment node */
const mockActions: Array<{ url: string; args: any }> = [];
const mockVideoKeys: unknown[] = [];
let mockSaveFails = false;
jest.mock("convex/browser", () => ({
  ConvexHttpClient: class {
    constructor(readonly url: string) {}
    async action(_ref: unknown, args: any) {
      mockActions.push({ url: this.url, args });
      if (mockSaveFails && args.name) throw new Error("fixture save failure");
      return args.storageId
        ? { url: "https://files.example.test/result", fileId: "file-a" }
        : "https://uploads.example.test/upload";
    }
  },
}));
jest.mock("ai", () => ({
  ...jest.requireActual("ai"),
  experimental_generateVideo: jest.fn(async (options) => {
    mockVideoKeys.push(
      new Headers(options.model.config.headers()).get("authorization"),
    );
    const downloaded = await options.download({
      url: new URL("https://openrouter.ai/api/v1/videos/fixture/content"),
    });
    return {
      video: { mediaType: "video/mp4", uint8Array: downloaded.data },
      providerMetadata: { openrouter: { cost: 0.42 } },
    };
  }),
}));
jest.mock("../utils/sandbox-manager", () => ({
  DefaultSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));
jest.mock("../utils/hybrid-sandbox-manager", () => ({
  HybridSandboxManager: jest.fn(() => ({ getSandbox: jest.fn() })),
}));
import { createTools } from "../index";
import { createGenerateImage } from "../generate-image";
import { createGenerateVideo } from "../generate-video";
import { createWebSearch } from "../web-search";
import { createOpenUrlTool } from "../open-url";
import { createSecuritySearch } from "../security-search";
import { canPersistGeneratedMedia } from "../utils/generated-media-storage";
import { withConvexClientScope } from "@/lib/db/convex-client-scope";
const names = [
  "OPENAI_API_KEY",
  "OPENROUTER_API_KEY",
  "PERPLEXITY_API_KEY",
  "JINA_API_KEY",
  "PREVIEW_RAG_API_KEY",
  "PREVIEW_RAG_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "CONVEX_SERVICE_ROLE_KEY",
] as const;
const saved = Object.fromEntries(
  names.map((name) => [name, process.env[name]]),
);
const oldFetch = globalThis.fetch;
const requests: Array<{ url: string; key: string | null; body?: any }> = [];
function configure(origin: string) {
  for (const name of names) process.env[name] = `${name}-${origin}`;
  process.env.NEXT_PUBLIC_CONVEX_URL = `https://${origin}.convex.cloud`;
  process.env.PREVIEW_RAG_URL = `https://rag-${origin}.example.test`;
}
const options = { toolCallId: "fixture-call", messages: [] };
const context = (cost: jest.Mock) =>
  ({
    userID: "owner-a",
    userLocation: { country: "TR" },
    onToolCost: cost,
    imageModel: "google/gemini-3-pro-image",
    videoModel: "google/veo-3.1-fast",
    fileAccumulator: { add: jest.fn() },
  }) as any;
const execute = (definition: any, input: any) =>
  definition.execute(input, options);
function factory(mode: "agent" | "ask" = "agent") {
  const args: Parameters<typeof createTools> = [
    "owner-a",
    "chat-a",
    { write: jest.fn() } as never,
    mode,
    {} as never,
  ];
  args[26] = "app";
  return createTools(...args);
}
beforeEach(() => {
  mockSaveFails = false;
  requests.length = 0;
  mockActions.length = 0;
  mockVideoKeys.length = 0;
  globalThis.fetch = jest.fn(async (input, init) => {
    const request = new Request(input, init);
    const body =
      init?.body && typeof init.body === "string"
        ? JSON.parse(init.body)
        : undefined;
    requests.push({
      url: request.url,
      key:
        request.headers.get("authorization") ??
        request.headers.get("x-api-key"),
      body,
    });
    if (request.url.includes("moderations"))
      return Response.json({ results: [{ categories: {} }] });
    if (request.url.includes("/videos/fixture/content"))
      return new Response(new Uint8Array([1, 2]), {
        headers: { "content-type": "video/mp4" },
      });
    if (request.url.includes("openrouter.ai"))
      return Response.json({
        data: [
          {
            b64_json: Buffer.from("image").toString("base64"),
            media_type: "image/png",
          },
        ],
        usage: { cost: 0.047 },
      });
    if (request.url.includes("uploads.example"))
      return Response.json({ storageId: "stored-a" });
    if (request.url.includes("r.jina.ai"))
      return new Response("Fixture article.");
    return Response.json({ results: [] });
  });
});
afterEach(() => {
  globalThis.fetch = oldFetch;
  for (const name of names) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

it.each(["image", "video"])(
  "keeps late %s provider, moderation, storage and cost on A",
  async (kind) => {
    configure("a");
    const costA = jest.fn();
    const tool = withConvexClientScope(undefined, () =>
      kind === "image"
        ? createGenerateImage(context(costA))
        : createGenerateVideo(context(costA)),
    );
    configure("b");
    const result = await withConvexClientScope(undefined, () =>
      execute(tool, { prompt: "A quiet architectural film still" }),
    );
    expect(result.ok).toBe(true);
    expect(
      requests.find((request) => request.url.includes("moderations"))?.key,
    ).toBe("Bearer OPENAI_API_KEY-a");
    if (kind === "image")
      expect(
        requests.find((request) => request.url.includes("openrouter.ai"))?.key,
      ).toBe("Bearer OPENROUTER_API_KEY-a");
    else {
      expect(mockVideoKeys).toEqual(["Bearer OPENROUTER_API_KEY-a"]);
      expect(
        requests.find((request) =>
          request.url.includes("/videos/fixture/content"),
        )?.key,
      ).toBe("Bearer OPENROUTER_API_KEY-a");
    }
    expect(costA).toHaveBeenCalledTimes(1);
    expect(costA).toHaveBeenCalledWith(kind === "image" ? 0.047 : 0.42);
    expect(mockActions).toHaveLength(2);
    expect(
      mockActions.every(
        (call) =>
          call.url === "https://a.convex.cloud" &&
          call.args.serviceKey === "CONVEX_SERVICE_ROLE_KEY-a",
      ),
    ).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/API_KEY|SERVICE_ROLE_KEY/);
  },
);

it("keeps search credentials/endpoints and request cost on the originating tools", async () => {
  configure("a");
  const costA = jest.fn();
  const tools = withConvexClientScope(undefined, () => [
    createWebSearch(context(costA)),
    createOpenUrlTool(),
    createSecuritySearch(),
  ]);
  configure("b");
  await withConvexClientScope(undefined, async () => {
    await execute(tools[0], {
      queries: ["one", "two", "three", "ignored"],
      time: "past_week",
    });
    await execute(tools[1], { url: "https://article.example.test" });
    await execute(tools[2], { query: "fixture", k: 20 });
  });
  expect(requests.map((request) => request.key)).toEqual([
    "Bearer PERPLEXITY_API_KEY-a",
    "Bearer JINA_API_KEY-a",
    "PREVIEW_RAG_API_KEY-a",
  ]);
  expect(requests[2].url).toBe("https://rag-a.example.test/search");
  expect(requests[0].body.query).toEqual(["one", "two", "three"]);
  expect(requests[2].body.k).toBe(5);
  expect(costA.mock.calls).toEqual([[0.005]]);
});

it.each([true, false])(
  "keeps factory availability stable across model rebuilds (configured=%s)",
  (configured) => {
    configure("a");
    if (!configured)
      for (const name of [
        "OPENROUTER_API_KEY",
        "PERPLEXITY_API_KEY",
        "JINA_API_KEY",
      ])
        delete process.env[name];
    const runtime = withConvexClientScope(undefined, () => factory());
    const expected = Object.keys(runtime.tools).sort();
    if (configured)
      for (const name of [
        "OPENROUTER_API_KEY",
        "PERPLEXITY_API_KEY",
        "JINA_API_KEY",
      ])
        delete process.env[name];
    else configure("b");
    const rebuilt = withConvexClientScope(undefined, () =>
      runtime.getToolsForModel("ask-model"),
    );
    expect(Object.keys(rebuilt).sort()).toEqual(expected);
  },
);

it("keeps missing media credentials and storage unavailable after B appears", async () => {
  configure("a");
  delete process.env.OPENROUTER_API_KEY;
  const cost = jest.fn();
  const image = withConvexClientScope(undefined, () =>
    createGenerateImage(context(cost)),
  );
  configure("b");
  const result = await withConvexClientScope(undefined, () =>
    execute(image, { prompt: "Fixture image" }),
  );
  expect(result).toMatchObject({
    ok: false,
    error: expect.stringContaining("not configured"),
  });
  expect(requests).toHaveLength(0);
  expect(cost).not.toHaveBeenCalled();
});

it.each([true, false])(
  "uses scoped storage URL availability (originConfigured=%s)",
  (configured) => {
    configure("a");
    if (!configured) delete process.env.NEXT_PUBLIC_CONVEX_URL;
    withConvexClientScope(undefined, () => {
      if (configured) delete process.env.NEXT_PUBLIC_CONVEX_URL;
      else process.env.NEXT_PUBLIC_CONVEX_URL = "https://b.convex.cloud";
      expect(canPersistGeneratedMedia()).toBe(configured);
    });
  },
);

it.each(["NEXT_PUBLIC_CONVEX_URL", "CONVEX_SERVICE_ROLE_KEY"])(
  "never pays when originating storage lacks %s",
  async (name) => {
    configure("a");
    delete process.env[name];
    const cost = jest.fn();
    const image = withConvexClientScope(undefined, () =>
      createGenerateImage(context(cost)),
    );
    configure("b");
    const result = await withConvexClientScope(undefined, () =>
      execute(image, { prompt: "Fixture image" }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("not configured"),
    });
    expect(requests).toHaveLength(0);
    expect(mockActions).toHaveLength(0);
    expect(cost).not.toHaveBeenCalled();
  },
);

it("keeps missing moderation config missing without borrowing B", async () => {
  configure("a");
  delete process.env.OPENAI_API_KEY;
  const image = withConvexClientScope(undefined, () =>
    createGenerateImage(context(jest.fn())),
  );
  configure("b");
  const result = await withConvexClientScope(undefined, () =>
    execute(image, { prompt: "Fixture image" }),
  );
  expect(result.ok).toBe(true);
  expect(requests.some((request) => request.url.includes("moderations"))).toBe(
    false,
  );
});

it("keeps paid image cleanup and its single receipt on A when saving fails in B", async () => {
  configure("a");
  const cost = jest.fn();
  const image = withConvexClientScope(undefined, () =>
    createGenerateImage(context(cost)),
  );
  configure("b");
  mockSaveFails = true;
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  try {
    const result = await withConvexClientScope(undefined, () =>
      execute(image, { prompt: "Fixture image" }),
    );
    expect(result.ok).toBe(false);
    expect(cost.mock.calls).toEqual([[0.047]]);
    expect(mockActions).toHaveLength(3);
    expect(
      mockActions.every(
        (call) =>
          call.url === "https://a.convex.cloud" &&
          call.args.serviceKey === "CONVEX_SERVICE_ROLE_KEY-a",
      ),
    ).toBe(true);
    expect(mockActions[2].args).toEqual({
      serviceKey: "CONVEX_SERVICE_ROLE_KEY-a",
      storageId: "stored-a",
    });
    expect(JSON.stringify(result)).not.toMatch(/API_KEY|SERVICE_ROLE_KEY/);
  } finally {
    log.mockRestore();
  }
});

it("preserves the media hard block before provider billing", async () => {
  configure("a");
  const cost = jest.fn();
  const image = withConvexClientScope(undefined, () =>
    createGenerateImage(context(cost)),
  );
  configure("b");
  (globalThis.fetch as jest.Mock).mockResolvedValueOnce(
    Response.json({ results: [{ categories: { "sexual/minors": true } }] }),
  );
  const result = await withConvexClientScope(undefined, () =>
    execute(image, { prompt: "Fixture input" }),
  );
  expect(result.ok).toBe(false);
  expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  expect(cost).not.toHaveBeenCalled();
  expect(mockActions).toHaveLength(0);
});

it("rebuilds search execution from the original factory snapshot", async () => {
  configure("a");
  const runtime = withConvexClientScope(undefined, () => factory("ask"));
  configure("b");
  const rebuilt = withConvexClientScope(undefined, () =>
    runtime.getToolsForModel("ask-model"),
  );
  await withConvexClientScope(undefined, () =>
    execute(rebuilt.web_search, { queries: ["fixture"], time: "any" }),
  );
  expect(requests[0].key).toBe("Bearer PERPLEXITY_API_KEY-a");
  expect(JSON.stringify(rebuilt)).not.toMatch(/API_KEY|SERVICE_ROLE_KEY/);
});
