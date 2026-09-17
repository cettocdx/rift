import { getStudioRuntimeStatus } from "../runtime";

describe("Studio runtime status", () => {
  it("reports ready only when generation and durable storage are configured", () => {
    expect(
      getStudioRuntimeStatus({
        OPENROUTER_API_KEY: "openrouter-key",
        NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
        CONVEX_SERVICE_ROLE_KEY: "service-key",
      }),
    ).toEqual({ ready: true, missing: [] });
  });

  it("reports each missing dependency without exposing configured values", () => {
    const status = getStudioRuntimeStatus({
      OPENROUTER_API_KEY: "",
      NEXT_PUBLIC_CONVEX_URL: "https://example.convex.cloud",
      CONVEX_SERVICE_ROLE_KEY: "",
    });

    expect(status).toEqual({
      ready: false,
      missing: ["OpenRouter generation", "durable media storage"],
    });
    expect(JSON.stringify(status)).not.toContain("example.convex.cloud");
  });
});
