/** @jest-environment node */
import type { NextRequest } from "next/server";
import type { ConvexHttpClient as Client } from "convex/browser";
import { makeFunctionReference } from "convex/server";
// Use the installed SDK rather than the repository's convex/browser mock:
// this test reproduces its real per-client mutation queue.
const { ConvexHttpClient } = jest.requireActual(
  "../../../node_modules/convex/dist/cjs/browser/index.js",
) as { ConvexHttpClient: typeof Client };
let mockClient: Client;
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => mockClient,
}));
import { resolveApiKeyAuth } from "../api-key";
const request = () =>
  new Request("http://localhost", {
    headers: { authorization: "Bearer rift_live_test_only" },
  }) as NextRequest;
const success = (value: unknown) =>
  new Response(JSON.stringify({ status: "success", value, logLines: [] }), {
    headers: { "content-type": "application/json" },
  });
const oldKey = process.env.CONVEX_SERVICE_ROLE_KEY;
beforeEach(() => {
  process.env.CONVEX_SERVICE_ROLE_KEY = "test-service-only";
});
afterEach(() => {
  if (oldKey === undefined) delete process.env.CONVEX_SERVICE_ROLE_KEY;
  else process.env.CONVEX_SERVICE_ROLE_KEY = oldKey;
});
it("validates an API key while an unrelated mutation is still pending", async () => {
  let release!: (response: Response) => void;
  let authStarted = false;
  mockClient = new ConvexHttpClient("https://example.convex.cloud", {
    logger: false,
    fetch: (async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.path === "logs:write")
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      authStarted = true;
      return success({ userId: "user", tier: "pro" });
    }) as typeof fetch,
  });
  const pending = mockClient.mutation(
    makeFunctionReference<"mutation">("logs:write"),
    {},
  );
  const auth = resolveApiKeyAuth(request());
  for (let i = 0; i < 4; i++)
    await new Promise((resolve) => setImmediate(resolve));
  const startedBeforeRelease = authStarted;
  release(success(null));
  await pending;
  expect(await auth).toEqual({ userId: "user", subscription: "pro" });
  expect(startedBeforeRelease).toBe(true);
});
it("still rejects revoked or no-longer-paid keys through live validation", async () => {
  mockClient = new ConvexHttpClient("https://example.convex.cloud", {
    logger: false,
    fetch: (async () => success(null)) as typeof fetch,
  });
  expect(await resolveApiKeyAuth(request())).toBeNull();
});
