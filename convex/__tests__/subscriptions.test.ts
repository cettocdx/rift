import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("../_generated/server", () => ({
  mutation: jest.fn((config: unknown) => config),
  query: jest.fn((config: unknown) => config),
}));

jest.mock("convex/values", () => ({
  v: {
    array: jest.fn(() => "array"),
    boolean: jest.fn(() => "boolean"),
    null: jest.fn(() => "null"),
    object: jest.fn(() => "object"),
    optional: jest.fn(() => "optional"),
    string: jest.fn(() => "string"),
    union: jest.fn(() => "union"),
  },
}));

jest.mock("../lib/utils", () => ({
  validateServiceKey: jest.fn(),
}));

type SubscriptionRow = {
  tier: string;
  status: string;
  updated_at: number;
};

function contextWith(rows: SubscriptionRow[]) {
  return {
    db: {
      query: jest.fn(() => ({
        withIndex: jest.fn(
          (
            _name: string,
            predicate: (query: {
              eq: (field: string, value: string) => unknown;
            }) => unknown,
          ) => {
            predicate({ eq: jest.fn(() => ({})) });
            return { collect: async () => rows };
          },
        ),
      })),
    },
  };
}

describe("activeSubscriptionForUser", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("prefers an entitled Max row over a newer entitled Pro row", async () => {
    const { activeSubscriptionForUser } = await import("../subscriptions");
    const ctx = contextWith([
      { tier: "ultra", status: "active", updated_at: 100 },
      { tier: "pro", status: "active", updated_at: 200 },
    ]);

    await expect(
      activeSubscriptionForUser(ctx as never, "user-1"),
    ).resolves.toMatchObject({ tier: "ultra" });
  });

  it("ignores a non-entitled Max row and keeps an active Pro row", async () => {
    const { activeSubscriptionForUser } = await import("../subscriptions");
    const ctx = contextWith([
      { tier: "ultra", status: "expired", updated_at: 300 },
      { tier: "pro", status: "active", updated_at: 200 },
    ]);

    await expect(
      activeSubscriptionForUser(ctx as never, "user-1"),
    ).resolves.toMatchObject({ tier: "pro" });
  });
});

describe("backend entitlement verification", () => {
  it("uses the live subscription and requires service authority before reading it", async () => {
    const subscriptionModule = jest.requireActual("../subscriptions") as {
      getEntitlementsForBackend?: {
        handler: (ctx: unknown, args: unknown) => Promise<string[]>;
      };
    };
    expect(subscriptionModule.getEntitlementsForBackend).toBeDefined();
    const ctx = contextWith([
      { tier: "ultra", status: "active", updated_at: 1 },
    ]);
    await expect(
      subscriptionModule.getEntitlementsForBackend!.handler(ctx, {
        userId: "owner",
        serviceKey: "fixture",
      }),
    ).resolves.toEqual(["ultra-monthly-plan"]);
    const { validateServiceKey } = jest.requireMock("../lib/utils") as {
      validateServiceKey: ReturnType<typeof jest.fn>;
    };
    expect(validateServiceKey).toHaveBeenCalledWith("fixture");
    validateServiceKey.mockImplementationOnce(() => {
      throw new Error("Unauthorized");
    });
    const denied = contextWith([]);
    await expect(
      subscriptionModule.getEntitlementsForBackend!.handler(denied, {
        userId: "owner",
        serviceKey: "forged",
      }),
    ).rejects.toThrow("Unauthorized");
    expect(denied.db.query).not.toHaveBeenCalled();
  });
});
