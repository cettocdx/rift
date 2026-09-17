"use node";

import { action } from "./_generated/server";
import { api } from "./_generated/api";
import { v } from "convex/values";
import {
  getBudgetLimits,
  getSubscriptionPrice,
} from "../lib/rate-limit/token-bucket";
import type { SubscriptionTier } from "../types";
import { usesAccountCreditLedger } from "../lib/billing/included-credits";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type RedisConstructor = typeof import("@upstash/redis").Redis;

// Cache the dynamic import without constructing a shared Redis client. Convex
// actions may be reused between requests, while the client itself is cheap and
// keeps request-specific configuration explicit.
let _cachedRedisConstructor: RedisConstructor | null = null;

type AgentRateLimitStatusResult = {
  available: boolean;
  monthly: {
    remaining: number;
    limit: number;
    used: number;
    usagePercentage: number;
    resetTime: string | null;
    cycleStarted: boolean;
  };
  monthlyBudgetUsd: number;
};

const isSubscriptionTier = (value: unknown): value is SubscriptionTier =>
  value === "free" ||
  value === "pro" ||
  value === "pro-plus" ||
  value === "team" ||
  value === "ultra";

async function getRedisConstructor(): Promise<RedisConstructor> {
  if (!_cachedRedisConstructor) {
    const redisModule = await import("@upstash/redis");
    _cachedRedisConstructor = redisModule.Redis;
  }
  return _cachedRedisConstructor;
}

type MonthlyBucketRecord = {
  refilledAt: number | string | null;
  tokens: number | string | null;
};

const parseFiniteNumber = (value: number | string | null): number | null => {
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Get the current rate limit status for the authenticated user.
 *
 * Returns monthly limit status.
 */
export const getAgentRateLimitStatus = action({
  args: {
    subscription: v.union(
      v.literal("free"),
      v.literal("pro"),
      v.literal("pro-plus"),
      v.literal("team"),
      v.literal("ultra"),
    ),
  },
  returns: v.object({
    available: v.boolean(),
    monthly: v.object({
      remaining: v.number(),
      limit: v.number(),
      used: v.number(),
      usagePercentage: v.number(),
      resetTime: v.union(v.string(), v.null()),
      cycleStarted: v.boolean(),
    }),
    monthlyBudgetUsd: v.number(),
  }),
  handler: async (ctx, args): Promise<AgentRateLimitStatusResult> => {
    // Authenticate user
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Unauthenticated: User must be logged in");
    }

    const userId = identity.subject.split("|")[0];
    // Keep the argument for wire compatibility with deployed clients, but do
    // not trust it. Billing identity is derived from the authenticated user's
    // entitlement row so callers cannot ask for another tier's allowance.
    void args.subscription;
    const activeSubscription: { tier: string } | null = await ctx.runQuery(
      api.subscriptions.getActiveSubscription,
      {},
    );
    const subscription: SubscriptionTier = isSubscriptionTier(
      activeSubscription?.tier,
    )
      ? activeSubscription.tier
      : "free";

    // Calculate limits using shared token-bucket logic
    const { monthly: monthlyLimit } = getBudgetLimits(subscription);
    const monthlyBudgetUsd = getSubscriptionPrice(subscription);

    const emptyStatus: {
      remaining: number;
      limit: number;
      used: number;
      usagePercentage: number;
      resetTime: string | null;
      cycleStarted: boolean;
    } = {
      remaining: 0,
      limit: 0,
      used: 0,
      usagePercentage: 0,
      resetTime: null,
      cycleStarted: false,
    };

    // Default response for free tier or no limits
    if (subscription === "free" || monthlyLimit === 0) {
      return {
        available: true,
        monthly: emptyStatus,
        monthlyBudgetUsd: 0,
      };
    }

    if (usesAccountCreditLedger(subscription)) {
      const settings: {
        includedCredits: {
          total: number;
          used: number;
          remaining: number;
          resetAt: string | null;
        };
      } | null = await ctx.runQuery(api.extraUsage.getExtraUsageSettings, {});
      if (!settings) {
        return {
          available: false,
          monthly: emptyStatus,
          monthlyBudgetUsd,
        };
      }
      const included = settings.includedCredits;
      const total = Math.min(monthlyLimit, Math.max(0, included.total));
      const used = Math.min(total, Math.max(0, included.used));
      const remaining = Math.max(0, total - used);
      return {
        available: true,
        monthly: {
          remaining,
          limit: total,
          used,
          usagePercentage: total > 0 ? Math.round((used / total) * 100) : 0,
          resetTime: included.resetAt,
          cycleStarted: used > 0 || included.resetAt !== null,
        },
        monthlyBudgetUsd,
      };
    }

    // Check if Redis is configured
    const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
    const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!redisUrl || !redisToken) {
      return {
        available: false,
        monthly: emptyStatus,
        monthlyBudgetUsd,
      };
    }

    try {
      const Redis = await getRedisConstructor();

      const redis = new Redis({
        url: redisUrl,
        token: redisToken,
      });

      // Read the token-bucket hash directly. Even `limit(key, { rate: 0 })`
      // executes the mutating limiter script: on a missing key it writes a new
      // hash and starts the 30-day cycle. HMGET is a true read and mirrors the
      // @upstash/ratelimit token-bucket fields (`refilledAt`, `tokens`).
      const monthlyKey = `usage:monthly:${userId}:${subscription}`;
      const bucket = await redis.hmget<MonthlyBucketRecord>(
        monthlyKey,
        "refilledAt",
        "tokens",
      );

      // A missing bucket is a valid, authoritative state: the user has not
      // started this rolling allowance yet. Return the full display balance,
      // but no reset date. This action is status-only and is never used to
      // authorize a model run.
      if (bucket === null) {
        return {
          available: true,
          monthly: {
            remaining: monthlyLimit,
            limit: monthlyLimit,
            used: 0,
            usagePercentage: 0,
            resetTime: null,
            cycleStarted: false,
          },
          monthlyBudgetUsd,
        };
      }

      const refilledAt = parseFiniteNumber(bucket.refilledAt);
      const storedTokens = parseFiniteNumber(bucket.tokens);
      if (refilledAt === null || refilledAt < 0 || storedTokens === null) {
        throw new Error("Invalid monthly usage bucket");
      }

      const resetAt = refilledAt + THIRTY_DAYS_MS;
      if (
        !Number.isFinite(resetAt) ||
        !Number.isFinite(Date.parse(new Date(resetAt).toISOString()))
      ) {
        throw new Error("Invalid monthly usage reset time");
      }

      // Redis normally expires the hash at the refill boundary. Treat a stale
      // record observed during an expiry race like a missing bucket without
      // mutating it; the next real usage request remains responsible for
      // creating/refilling the cycle.
      if (resetAt <= Date.now()) {
        return {
          available: true,
          monthly: {
            remaining: monthlyLimit,
            limit: monthlyLimit,
            used: 0,
            usagePercentage: 0,
            resetTime: null,
            cycleStarted: false,
          },
          monthlyBudgetUsd,
        };
      }

      const monthlyRemaining = Math.min(
        Math.max(0, storedTokens),
        monthlyLimit,
      );
      const monthlyUsed = monthlyLimit - monthlyRemaining;

      return {
        available: true,
        monthly: {
          remaining: monthlyRemaining,
          limit: monthlyLimit,
          used: monthlyUsed,
          usagePercentage: Math.round((monthlyUsed / monthlyLimit) * 100),
          resetTime: new Date(resetAt).toISOString(),
          cycleStarted: true,
        },
        monthlyBudgetUsd,
      };
    } catch (error) {
      console.warn({
        event: "rate_limit_status_failed",
        error_name: error instanceof Error ? error.name : "UnknownError",
      });
      return {
        available: false,
        monthly: emptyStatus,
        monthlyBudgetUsd,
      };
    }
  },
});
