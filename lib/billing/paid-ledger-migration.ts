import {
  getExtraUsageBalance,
  migrateLegacyPlanCredits,
} from "@/lib/extra-usage";
import { createRedisClient } from "@/lib/rate-limit/redis";
import { getIncludedCreditsForTier } from "./included-credits";

export const PAID_LEDGER_MIGRATION_KEY = "paid-account-ledger-v1";

const LEGACY_MONTHLY_CREDITS: Readonly<Record<"pro" | "ultra", number>> = {
  pro: 250_000,
  ultra: 2_000_000,
};

const monthlyBucketKey = (userId: string, tier: "pro" | "ultra") =>
  `usage:monthly:${userId}:${tier}`;

/** Same-request server read; never construct from client input. */
export type PaidLedgerSnapshot = {
  userId: string;
  state: Awaited<ReturnType<typeof getExtraUsageBalance>>;
};

/** Retry-safe, one-time cutover that preserves all already-consumed credits. */
export async function migratePaidPlanLedger(
  userId: string,
  subscription: "pro" | "ultra",
  snapshot?: PaidLedgerSnapshot,
): Promise<void> {
  if (snapshot && snapshot.userId !== userId) {
    throw new Error("Account ledger snapshot owner mismatch");
  }
  const accountState = snapshot ? snapshot.state : await getExtraUsageBalance(userId);
  if (!accountState) {
    throw new Error("Unable to read account ledger migration state");
  }
  if (accountState.legacyRedisMigrated) return;

  const redis = createRedisClient();
  if (!redis && process.env.NODE_ENV === "production") {
    throw new Error("Rate limiting service is not configured for migration");
  }

  let legacyConsumedPoints = 0;
  if (redis) {
    const oldLimit = LEGACY_MONTHLY_CREDITS[subscription];
    const storedTokens = await redis.hget<number>(
      monthlyBucketKey(userId, subscription),
      "tokens",
    );
    if (storedTokens !== null && storedTokens !== undefined) {
      legacyConsumedPoints = Math.min(
        oldLimit,
        Math.max(0, oldLimit - Number(storedTokens)),
      );
    }
  }

  await migrateLegacyPlanCredits(
    userId,
    getIncludedCreditsForTier(subscription),
    legacyConsumedPoints,
    PAID_LEDGER_MIGRATION_KEY,
  );

  if (redis) {
    await Promise.all([
      redis.del(monthlyBucketKey(userId, "pro")),
      redis.del(monthlyBucketKey(userId, "ultra")),
    ]);
  }
}

/** A real renewal starts fresh; old-cycle Redis consumption is discarded. */
export async function retireLegacyPaidBucketsForRenewal(
  userId: string,
  subscription: "pro" | "ultra",
): Promise<void> {
  const redis = createRedisClient();
  if (!redis && process.env.NODE_ENV === "production") {
    throw new Error("Rate limiting service is not configured for migration");
  }
  if (redis) {
    await Promise.all([
      redis.del(monthlyBucketKey(userId, "pro")),
      redis.del(monthlyBucketKey(userId, "ultra")),
    ]);
  }
  await migrateLegacyPlanCredits(
    userId,
    getIncludedCreditsForTier(subscription),
    0,
    PAID_LEDGER_MIGRATION_KEY,
  );
}
