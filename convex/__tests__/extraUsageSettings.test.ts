import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: unknown) => config),
  internalMutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
  internalQuery: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    literal: jest.fn(() => "literal"),
    null: jest.fn(() => "null"),
    number: jest.fn(() => "number"),
    object: jest.fn(() => "object"),
    optional: jest.fn(() => "optional"),
    string: jest.fn(() => "string"),
    union: jest.fn(() => "union"),
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

jest.mock("../lib/logger", () => ({
  convexLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

type ExtraUsageRow = {
  user_id: string;
  balance_points: number;
  monthly_granted_points?: number;
  monthly_granted_used_points?: number;
  monthly_granted_reset_date?: string;
};

type SubscriptionRow = {
  user_id: string;
  tier: string;
  status: string;
  renews_at?: string;
  ends_at?: string;
  updated_at: number;
};

const makeContext = ({
  subject = "user-a|provider",
  extraUsageRows = [],
  subscriptionRows = [],
}: {
  subject?: string | null;
  extraUsageRows?: ExtraUsageRow[];
  subscriptionRows?: SubscriptionRow[];
} = {}) => {
  const queriedUserIds: string[] = [];
  const db = {
    query: jest.fn((table: string) => ({
      withIndex: jest.fn(
        (
          _indexName: string,
          predicate: (q: {
            eq: (field: string, value: string) => unknown;
          }) => unknown,
        ) => {
          let userId = "";
          predicate({
            eq: (_field: string, value: string) => {
              userId = value;
              queriedUserIds.push(value);
              return {};
            },
          });

          if (table === "extra_usage") {
            return {
              first: async () =>
                extraUsageRows.find((row) => row.user_id === userId) ?? null,
            };
          }

          return {
            collect: async () =>
              subscriptionRows.filter((row) => row.user_id === userId),
          };
        },
      ),
    })),
  };

  return {
    ctx: {
      auth: {
        getUserIdentity: jest
          .fn()
          .mockResolvedValue(subject ? { subject } : null),
      },
      db,
    },
    db,
    queriedUserIds,
  };
};

const invoke = async (ctx: ReturnType<typeof makeContext>["ctx"]) => {
  const { getExtraUsageSettings } = await import("../extraUsage");
  return (getExtraUsageSettings as any).handler(ctx);
};

describe("getExtraUsageSettings included credits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns only the authenticated user's allowance and usage", async () => {
    const now = new Date();
    const currentMonth = `${now.getUTCFullYear()}-${String(
      now.getUTCMonth() + 1,
    ).padStart(2, "0")}`;
    const { ctx, queriedUserIds } = makeContext({
      extraUsageRows: [
        {
          user_id: "user-a",
          balance_points: 80_000,
          monthly_granted_points: 500_000,
          monthly_granted_used_points: 125_000,
          monthly_granted_reset_date: currentMonth,
        },
        {
          user_id: "user-b",
          balance_points: 900_000,
          monthly_granted_points: 1_800_000,
          monthly_granted_used_points: 1_000_000,
          monthly_granted_reset_date: currentMonth,
        },
      ],
      subscriptionRows: [
        {
          user_id: "user-a",
          tier: "pro",
          status: "active",
          renews_at: "2026-08-12T00:00:00.000Z",
          updated_at: 10,
        },
        {
          user_id: "user-b",
          tier: "ultra",
          status: "active",
          updated_at: 20,
        },
      ],
    });

    await expect(invoke(ctx)).resolves.toMatchObject({
      balancePoints: 80_000,
      includedCredits: {
        total: 500_000,
        used: 125_000,
        remaining: 375_000,
        resetAt: "2026-08-12T00:00:00.000Z",
      },
    });
    expect(queriedUserIds).toEqual(["user-a", "user-a"]);
    expect(queriedUserIds).not.toContain("user-b");
  });

  it("returns the entitled plan allowance when an older paid account has no grant row", async () => {
    const { ctx } = makeContext({
      extraUsageRows: [],
      subscriptionRows: [
        {
          user_id: "user-a",
          tier: "ultra",
          status: "active",
          renews_at: "2026-08-20T00:00:00.000Z",
          updated_at: 10,
        },
      ],
    });

    await expect(invoke(ctx)).resolves.toMatchObject({
      balanceDollars: 0,
      balancePoints: 0,
      includedCredits: {
        total: 1_800_000,
        used: 0,
        remaining: 1_800_000,
        resetAt: "2026-08-20T00:00:00.000Z",
      },
    });
  });

  it("returns a visible zero balance for a signed-in free account", async () => {
    const { ctx } = makeContext();

    await expect(invoke(ctx)).resolves.toMatchObject({
      balanceDollars: 0,
      balancePoints: 0,
      includedCredits: {
        total: 0,
        used: 0,
        remaining: 0,
        resetAt: null,
      },
    });
  });

  it("returns null without reading account data when no user is signed in", async () => {
    const { ctx, db } = makeContext({ subject: null });

    await expect(invoke(ctx)).resolves.toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });
});
