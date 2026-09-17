import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import type { NextRequest } from "next/server";

const mockGetUserID = jest.fn();
const mockQuery = jest.fn();
const mockNextResponseJson = jest.fn(
  (body: unknown, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    json: async () => body,
  }),
);

let GET: typeof import("../route").GET;
let RouteChatSDKError: typeof import("@/lib/errors").ChatSDKError;
const originalServiceKey = process.env.CONVEX_SERVICE_ROLE_KEY;

describe("GET /api/usage/monthly", () => {
  beforeAll(() => {
    jest.resetModules();
    jest.doMock("next/server", () => ({
      NextResponse: { json: mockNextResponseJson },
    }));
    jest.doMock("@/lib/auth/get-user-id", () => ({
      getUserID: mockGetUserID,
    }));
    jest.doMock("@/lib/db/convex-client", () => ({
      getConvexClient: () => ({ query: mockQuery }),
    }));
    jest.doMock("@/convex/_generated/api", () => ({
      api: { unitEconomics: { getEntitySummary: "economics.summary" } },
    }));
    ({ ChatSDKError: RouteChatSDKError } =
      require("@/lib/errors") as typeof import("@/lib/errors"));
    ({ GET } = require("../route") as typeof import("../route"));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.CONVEX_SERVICE_ROLE_KEY = "service-key";
    mockGetUserID.mockResolvedValue("user-1" as never);
    mockQuery.mockResolvedValue({
      totals: {
        usageRequestCount: 42,
        inputTokens: 1_000,
        outputTokens: 250,
        cacheReadTokens: 300,
        cacheWriteTokens: 100,
        totalTokens: 1_250,
      },
    } as never);
  });

  afterAll(() => {
    if (originalServiceKey === undefined) {
      delete process.env.CONVEX_SERVICE_ROLE_KEY;
    } else {
      process.env.CONVEX_SERVICE_ROLE_KEY = originalServiceKey;
    }
  });

  it("returns a bounded authenticated aggregate without raw usage rows", async () => {
    const response = await GET({} as NextRequest);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mockQuery).toHaveBeenCalledWith("economics.summary", {
      serviceKey: "service-key",
      entityType: "user",
      entityId: "user-1",
      startDay: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      endDay: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(body).toEqual(
      expect.objectContaining({
        ok: true,
        requestCount: 42,
        inputTokens: 1_000,
        outputTokens: 250,
        totalTokens: 1_250,
      }),
    );
    expect(body).not.toHaveProperty("days");
    expect(body).not.toHaveProperty("logs");
  });

  it("fails closed when the service credential is unavailable", async () => {
    delete process.env.CONVEX_SERVICE_ROLE_KEY;

    const response = await GET({} as NextRequest);

    expect(response.status).toBe(503);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not turn missing or malformed billing totals into zero usage", async () => {
    const log = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockQuery.mockResolvedValueOnce({ totals: undefined } as never);

    const missing = await GET({} as NextRequest);
    expect(missing.status).toBe(500);
    await expect(missing.json()).resolves.toEqual({
      ok: false,
      error: "Usage data is unavailable.",
    });

    mockQuery.mockResolvedValueOnce({
      totals: {
        usageRequestCount: 1,
        inputTokens: Number.NaN,
        outputTokens: 10,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 10,
      },
    } as never);
    const malformed = await GET({} as NextRequest);
    expect(malformed.status).toBe(500);

    expect(JSON.stringify(await malformed.json())).not.toContain("NaN");
    log.mockRestore();
  });

  it("keeps an authoritative all-zero aggregate as genuine no usage", async () => {
    mockQuery.mockResolvedValueOnce({
      totals: {
        usageRequestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
    } as never);

    const response = await GET({} as NextRequest);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({
        ok: true,
        requestCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }),
    );
  });

  it("preserves the authenticated error status", async () => {
    mockGetUserID.mockRejectedValue(
      new RouteChatSDKError("unauthorized:auth") as never,
    );

    const response = await GET({} as NextRequest);

    expect(response.status).toBe(401);
    expect(mockQuery).not.toHaveBeenCalled();
  });
  it("returns the month's zero-filled per-day token series", async () => {
    // The rollup already had the day rows; only the totals were forwarded,
    // so the shape of the month was computed and then thrown away.
    mockQuery.mockResolvedValue({
      totals: {
        usageRequestCount: 2,
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 15,
      },
      days: [
        {
          day: new Date().toISOString().slice(0, 8) + "02",
          input_tokens: 7,
          output_tokens: 3,
          cache_read_tokens: 0,
          cache_write_tokens: 0,
        },
      ],
    } as never);

    const response = await GET({} as NextRequest);
    const body = (await response.json()) as {
      ok: boolean;
      dailyTokens?: number[];
    };

    expect(body.ok).toBe(true);
    const series = body.dailyTokens!;
    // One slot per day of the month, all zero except the row's day.
    expect(series.length).toBeGreaterThanOrEqual(28);
    expect(series.length).toBeLessThanOrEqual(31);
    expect(series[1]).toBe(10);
    expect(series.filter((v) => v !== 0)).toEqual([10]);
  });
});
