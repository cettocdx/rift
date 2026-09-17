import { beforeEach, describe, expect, it, jest } from "@jest/globals";

describe("paid account-ledger migration", () => {
  const mockGetExtraUsageBalance = jest.fn();
  const mockMigrateLegacyPlanCredits = jest.fn();
  const mockCreateRedisClient = jest.fn();
  const mockHget = jest.fn();
  const mockDel = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockGetExtraUsageBalance.mockResolvedValue({
      legacyRedisMigrated: false,
    });
    mockMigrateLegacyPlanCredits.mockResolvedValue({
      usedPoints: 0,
      remainingPoints: 0,
    });
    mockHget.mockResolvedValue(null);
    mockDel.mockResolvedValue(1);
    mockCreateRedisClient.mockReturnValue({
      hget: mockHget,
      del: mockDel,
    });
  });

  const getIsolatedModule = () => {
    let isolatedModule: typeof import("../paid-ledger-migration");

    jest.isolateModules(() => {
      jest.doMock("@/lib/extra-usage", () => ({
        getExtraUsageBalance: mockGetExtraUsageBalance,
        migrateLegacyPlanCredits: mockMigrateLegacyPlanCredits,
      }));
      jest.doMock("@/lib/rate-limit/redis", () => ({
        createRedisClient: mockCreateRedisClient,
      }));
      isolatedModule = require("../paid-ledger-migration");
    });

    return isolatedModule!;
  };

  it("carries consumed legacy Max credits into the canonical 1.8M ledger and retires both Redis authorities", async () => {
    mockHget.mockResolvedValue(500_000);
    const { migratePaidPlanLedger, PAID_LEDGER_MIGRATION_KEY } =
      getIsolatedModule();

    await migratePaidPlanLedger("user-1", "ultra");

    expect(mockHget).toHaveBeenCalledWith(
      "usage:monthly:user-1:ultra",
      "tokens",
    );
    expect(mockMigrateLegacyPlanCredits).toHaveBeenCalledWith(
      "user-1",
      1_800_000,
      1_500_000,
      PAID_LEDGER_MIGRATION_KEY,
    );
    expect(mockDel).toHaveBeenCalledWith("usage:monthly:user-1:pro");
    expect(mockDel).toHaveBeenCalledWith("usage:monthly:user-1:ultra");
  });

  it("uses the former 250k Pro bucket only to preserve its consumed amount, then grants the canonical 500k allowance", async () => {
    mockHget.mockResolvedValue(100_000);
    const { migratePaidPlanLedger, PAID_LEDGER_MIGRATION_KEY } =
      getIsolatedModule();

    await migratePaidPlanLedger("user-2", "pro");

    expect(mockMigrateLegacyPlanCredits).toHaveBeenCalledWith(
      "user-2",
      500_000,
      150_000,
      PAID_LEDGER_MIGRATION_KEY,
    );
  });

  it("is retry-safe once the account has the migration marker", async () => {
    mockGetExtraUsageBalance.mockResolvedValue({ legacyRedisMigrated: true });
    const { migratePaidPlanLedger } = getIsolatedModule();

    await migratePaidPlanLedger("user-3", "ultra");

    expect(mockCreateRedisClient).not.toHaveBeenCalled();
    expect(mockMigrateLegacyPlanCredits).not.toHaveBeenCalled();
  });

  it("reuses the same user's migrated snapshot without a second read", async () => {
    const { migratePaidPlanLedger } = getIsolatedModule();
    await migratePaidPlanLedger("user-3", "ultra", {
      userId: "user-3", state: { legacyRedisMigrated: true } as any,
    });
    expect(mockGetExtraUsageBalance).not.toHaveBeenCalled();
    expect(mockMigrateLegacyPlanCredits).not.toHaveBeenCalled();
  });

  it("rejects a snapshot belonging to another account", async () => {
    const { migratePaidPlanLedger } = getIsolatedModule();
    await expect(migratePaidPlanLedger("user-3", "ultra", {
      userId: "other", state: { legacyRedisMigrated: true } as any,
    })).rejects.toThrow("snapshot owner");
    expect(mockMigrateLegacyPlanCredits).not.toHaveBeenCalled();
  });

  it("does not authorize migration after a failed server balance read", async () => {
    const { migratePaidPlanLedger } = getIsolatedModule();
    await expect(migratePaidPlanLedger("user-3", "ultra", {
      userId: "user-3", state: null,
    })).rejects.toThrow("Unable to read");
    expect(mockGetExtraUsageBalance).not.toHaveBeenCalled();
    expect(mockMigrateLegacyPlanCredits).not.toHaveBeenCalled();
  });

  it("discards old-cycle Redis spend on a provider-confirmed renewal", async () => {
    const { PAID_LEDGER_MIGRATION_KEY, retireLegacyPaidBucketsForRenewal } =
      getIsolatedModule();

    await retireLegacyPaidBucketsForRenewal("user-4", "ultra");

    expect(mockHget).not.toHaveBeenCalled();
    expect(mockMigrateLegacyPlanCredits).toHaveBeenCalledWith(
      "user-4",
      1_800_000,
      0,
      PAID_LEDGER_MIGRATION_KEY,
    );
    expect(mockDel).toHaveBeenCalledTimes(2);
  });
});
