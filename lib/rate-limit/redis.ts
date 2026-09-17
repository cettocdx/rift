import { Redis } from "@upstash/redis";
import {
  captureRedisClientContext,
  getRedisClientContext,
  type RedisClientContext,
} from "./redis-context";

let defaultContext: RedisClientContext | undefined;

/** Lazily create a client for this run, or the current unscoped configuration. */
export const createRedisClient = (): Redis | null => {
  const scoped = getRedisClientContext();
  let context = scoped;
  if (!context) {
    const current = captureRedisClientContext();
    if (
      !defaultContext ||
      defaultContext.url !== current.url ||
      defaultContext.token !== current.token
    ) {
      defaultContext = current;
    }
    context = defaultContext;
  }
  if (context.client !== undefined) return context.client;
  if (!context.url || !context.token) return (context.client = null);
  // Assign only after construction succeeds; transient initialization failures
  // must not leave a permanently unavailable client in the process cache.
  return (context.client = new Redis({
    url: context.url,
    token: context.token,
  }));
};

/**
 * Format time difference into a human-readable string.
 */
export const formatTimeRemaining = (resetTime: Date): string => {
  const now = new Date();
  const timeDiff = resetTime.getTime() - now.getTime();

  if (timeDiff <= 0) {
    return "less than a minute";
  }

  const hours = Math.floor(timeDiff / (1000 * 60 * 60));

  // For short durations (< 24h), show relative time with "in" prefix
  if (hours < 24) {
    const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
    if (hours <= 0) {
      if (minutes <= 0) {
        return "in less than a minute";
      }
      return `in ${minutes} minute${minutes > 1 ? "s" : ""}`;
    }
    return `in ${hours} hour${hours > 1 ? "s" : ""}${minutes > 0 ? ` and ${minutes} minute${minutes > 1 ? "s" : ""}` : ""}`;
  }

  // For longer durations, show the reset date and time with "on" prefix
  return `on ${resetTime.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })}`;
};
