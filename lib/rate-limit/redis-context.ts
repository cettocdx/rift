import type { Redis } from "@upstash/redis";

/** Per-run configuration and lazy client; this module must stay Node-free. */
export type RedisClientContext = {
  readonly url: string | undefined;
  readonly token: string | undefined;
  client?: Redis | null;
};
let readContext: (() => RedisClientContext | undefined) | undefined;

export function installRedisClientContextReader(
  reader: () => RedisClientContext | undefined,
) {
  readContext = reader;
}

export function getRedisClientContext(): RedisClientContext | undefined {
  return readContext?.();
}

export function captureRedisClientContext(): RedisClientContext {
  return {
    url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
    token:
      process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
  };
}
