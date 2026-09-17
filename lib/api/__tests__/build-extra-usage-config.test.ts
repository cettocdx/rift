/**
 * Tests for buildExtraUsageConfig — the function that decides whether a
 * request gets extra-usage overflow capacity.
 *
 * Critical invariant: for team users, the config must reflect the **team
 * pool's** state, not the user's personal extra_usage_enabled or balance.
 * If this regresses, team admins will think they're funding overflow but
 * requests will silently route to the user's empty personal balance.
 */

import { buildExtraUsageConfig } from "@/lib/api/chat-stream-helpers";

jest.mock("@/lib/extra-usage", () => ({
  getExtraUsageBalance: jest.fn(),
  getTeamExtraUsageState: jest.fn(),
}));

jest.mock("@/lib/db/actions", () => ({
  getNotes: jest.fn(),
}));

jest.mock("@/lib/logger", () => ({
  logger: { warn: jest.fn(), info: jest.fn(), error: jest.fn() },
}));

import {
  getExtraUsageBalance,
  getTeamExtraUsageState,
} from "@/lib/extra-usage";

const mockGetUserBalance = getExtraUsageBalance as jest.MockedFunction<
  typeof getExtraUsageBalance
>;
const mockGetTeamState = getTeamExtraUsageState as jest.MockedFunction<
  typeof getTeamExtraUsageState
>;

const USER_ID = "user_abc";
const ORG_ID = "org_123";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("buildExtraUsageConfig — free tier (PAYG)", () => {
  it("enables balance for free users when they hold tokens — no opt-in gate", async () => {
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 5,
      balancePoints: 50000,
      enabled: true,
      autoReloadEnabled: false,
    } as any);

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "free",
      // extra_usage_enabled intentionally absent: holding a balance is consent.
      userCustomization: {} as any,
    });

    expect(config).toEqual({
      enabled: true,
      hasBalance: true,
      balanceDollars: 5,
      autoReloadEnabled: false,
    });
    expect(mockGetTeamState).not.toHaveBeenCalled();
  });

  it("returns undefined for free users with no balance and no auto-reload", async () => {
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 0,
      balancePoints: 0,
      enabled: true,
      autoReloadEnabled: false,
    } as any);

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "free",
      userCustomization: {} as any,
    });
    expect(config).toBeUndefined();
  });

  it("enables free users with auto-reload even at $0 balance", async () => {
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 0,
      balancePoints: 0,
      enabled: true,
      autoReloadEnabled: true,
    } as any);

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "free",
      userCustomization: {} as any,
    });
    expect(config).toEqual({
      enabled: true,
      hasBalance: false,
      balanceDollars: 0,
      autoReloadEnabled: true,
    });
  });
});

describe("buildExtraUsageConfig — team users", () => {
  it("ignores user's personal extra_usage_enabled and reads team state", async () => {
    mockGetTeamState.mockResolvedValue({
      enabled: true,
      balanceDollars: 50,
      balancePoints: 500_000,
      autoReloadEnabled: false,
      memberDisabled: false,
    });

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      // Personal flag is explicitly OFF — team pool should still be used.
      userCustomization: { extra_usage_enabled: false } as any,
      organizationId: ORG_ID,
    });

    expect(mockGetTeamState).toHaveBeenCalledWith(ORG_ID, USER_ID);
    expect(mockGetUserBalance).not.toHaveBeenCalled();
    expect(config).toEqual({
      enabled: true,
      hasBalance: true,
      balanceDollars: 50,
      autoReloadEnabled: false,
    });
  });

  it("returns undefined when team pool is disabled", async () => {
    mockGetTeamState.mockResolvedValue({
      enabled: false,
      balanceDollars: 100,
      balancePoints: 1_000_000,
      autoReloadEnabled: true,
      memberDisabled: false,
    });

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      organizationId: ORG_ID,
    });
    expect(config).toBeUndefined();
  });

  it("returns undefined when the member is admin-disabled", async () => {
    mockGetTeamState.mockResolvedValue({
      enabled: true,
      balanceDollars: 100,
      balancePoints: 1_000_000,
      autoReloadEnabled: true,
      memberDisabled: true,
    });

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      organizationId: ORG_ID,
    });
    expect(config).toBeUndefined();
  });

  it("returns undefined for team users with no organizationId", async () => {
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      // organizationId omitted — can't route to the team pool
    });
    expect(config).toBeUndefined();
    expect(mockGetTeamState).not.toHaveBeenCalled();
  });

  it("returns an optimistic config when the team-state query fails", async () => {
    // null = transient failure (e.g. Convex unreachable). We don't want to
    // silently disable overflow on a network blip.
    mockGetTeamState.mockResolvedValue(null);

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      organizationId: ORG_ID,
    });
    expect(config).toEqual({
      enabled: true,
      hasBalance: true,
      autoReloadEnabled: false,
    });
  });

  it("returns config with autoReload-only when balance is 0 but auto-reload is on", async () => {
    mockGetTeamState.mockResolvedValue({
      enabled: true,
      balanceDollars: 0,
      balancePoints: 0,
      autoReloadEnabled: true,
      memberDisabled: false,
    });
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      organizationId: ORG_ID,
    });
    expect(config).toMatchObject({
      enabled: true,
      hasBalance: false,
      autoReloadEnabled: true,
    });
  });

  it("returns undefined when team pool has no balance and no auto-reload", async () => {
    mockGetTeamState.mockResolvedValue({
      enabled: true,
      balanceDollars: 0,
      balancePoints: 0,
      autoReloadEnabled: false,
      memberDisabled: false,
    });
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      userCustomization: null,
      organizationId: ORG_ID,
    });
    expect(config).toBeUndefined();
  });
});

describe("buildExtraUsageConfig — individual paid users (pro / pro-plus / ultra)", () => {
  it("returns undefined when extra_usage is off and the balance is empty", async () => {
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 0,
      balancePoints: 0,
      enabled: false,
      autoReloadEnabled: false,
    });
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "pro",
      userCustomization: { extra_usage_enabled: false } as any,
    });
    expect(config).toBeUndefined();
    expect(mockGetTeamState).not.toHaveBeenCalled();
  });

  it("spends the balance even when extra_usage_enabled is off (tokens are the opt-in)", async () => {
    // Token-only model: buying tokens never flips the legacy toggle, so a user
    // with a balance must still be able to spend it — and must not be locked.
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 218,
      balancePoints: 2_180_000,
      enabled: false,
      autoReloadEnabled: false,
    });
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "pro",
      userCustomization: { extra_usage_enabled: false } as any,
    });
    expect(config).toMatchObject({
      enabled: true,
      hasBalance: true,
      balanceDollars: 218,
    });
  });

  it("reads personal balance when extra_usage_enabled is on", async () => {
    mockGetUserBalance.mockResolvedValue({
      balanceDollars: 30,
      balancePoints: 300_000,
      enabled: true,
      autoReloadEnabled: false,
    });

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "pro",
      userCustomization: { extra_usage_enabled: true } as any,
    });

    expect(mockGetUserBalance).toHaveBeenCalledWith(USER_ID);
    expect(mockGetTeamState).not.toHaveBeenCalled();
    expect(config).toMatchObject({
      enabled: true,
      hasBalance: true,
      balanceDollars: 30,
    });
  });

  it("returns optimistic config when personal balance query fails", async () => {
    mockGetUserBalance.mockResolvedValue(null);

    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "ultra",
      userCustomization: { extra_usage_enabled: true } as any,
    });
    expect(config).toEqual({
      enabled: true,
      hasBalance: true,
      autoReloadEnabled: false,
    });
  });
});

describe("request-scoped balance snapshot", () => {
  const requestBalance = {
    balanceDollars: 5,
    balancePoints: 50000,
    enabled: true,
    autoReloadEnabled: false,
    includedTotalPoints: 0,
    includedRemainingPoints: 0,
    debtPoints: 0,
    legacyRedisMigrated: true,
  };
  it.each(["free", "pro"] as const)(
    "reuses the authenticated %s snapshot without another network read",
    async (subscription) => {
      const config = await buildExtraUsageConfig({
        userId: USER_ID,
        subscription,
        userCustomization: null,
        requestBalance,
      });
      expect(config).toMatchObject({ hasBalance: true, balanceDollars: 5 });
      expect(mockGetUserBalance).not.toHaveBeenCalled();
    },
  );
  it("does not retry a failed balance read or invent spendable funds", async () => {
    const config = await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "free",
      userCustomization: null,
      requestBalance: null,
    });
    expect(config).toBeUndefined();
    expect(mockGetUserBalance).not.toHaveBeenCalled();
  });
  it("still checks team funding rather than using a personal snapshot", async () => {
    mockGetTeamState.mockResolvedValue(null);
    await buildExtraUsageConfig({
      userId: USER_ID,
      subscription: "team",
      organizationId: ORG_ID,
      userCustomization: null,
      requestBalance,
    });
    expect(mockGetTeamState).toHaveBeenCalledWith(ORG_ID, USER_ID);
  });
});
