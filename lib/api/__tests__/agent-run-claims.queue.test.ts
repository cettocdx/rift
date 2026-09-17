/** @jest-environment node */
import type { ConvexHttpClient as Client } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const { ConvexHttpClient } = jest.requireActual(
  "../../../node_modules/convex/dist/cjs/browser/index.js",
) as { ConvexHttpClient: typeof Client };
let mockClient: Client;
jest.mock("@/lib/db/convex-client", () => ({
  getConvexClient: () => mockClient,
  getConvexServiceKey: () => "test-only",
}));
jest.mock("@/lib/db/actions", () => ({ getChatById: async () => null }));
jest.mock("../agent-long-runs", () => ({
  getOwnedTaggedRunIds: async () => [],
  isRunActive: async () => false,
}));
import { acquireAgentRunStart, AgentRunBusyError } from "../agent-run-claims";
const success = (value: unknown) =>
  new Response(JSON.stringify({ status: "success", value, logLines: [] }), {
    headers: { "content-type": "application/json" },
  });
it.each([true, false])(
  "reserves independently of queued logs while preserving CAS denial (%s)",
  async (acquired) => {
    let release!: (response: Response) => void;
    let reservationStarted = false;
    mockClient = new ConvexHttpClient("https://example.convex.cloud", {
      logger: false,
      fetch: (async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.path === "logs:write")
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        if (body.path === "agentRunClaims:reserveObserved") {
          reservationStarted = true;
          return success({ acquired });
        }
        return success(null);
      }) as typeof fetch,
    });
    const pending = mockClient.mutation(
      makeFunctionReference<"mutation">("logs:write"),
      {},
    );
    const reservation = acquireAgentRunStart({
      userId: "owner",
      chatId: "chat",
    }).then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    for (let i = 0; i < 4; i++)
      await new Promise((resolve) => setImmediate(resolve));
    const beforeRelease = reservationStarted;
    release(success(null));
    await pending;
    const result = await reservation;
    expect(beforeRelease).toBe(true);
    if (acquired) expect(result).toEqual({ value: expect.any(String) });
    else expect(result).toEqual({ error: expect.any(AgentRunBusyError) });
  },
);
