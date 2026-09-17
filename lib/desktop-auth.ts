import { Redis } from "@upstash/redis";

const TRANSFER_TOKEN_TTL_SECONDS = 300;
const OAUTH_STATE_TTL_SECONDS = 300;
const TRANSFER_TOKEN_PREFIX = "desktop-auth-transfer:";
const OAUTH_STATE_PREFIX = "desktop-oauth-state:";
const TOKEN_FORMAT_REGEX = /^[a-f0-9]{64}$/;

type TransferTokenData = {
  sealedSession: string;
  createdAt: number;
  returnPath?: string;
  desktopAuthState?: string;
};

type DevelopmentStoreEntry = {
  value: unknown;
  expiresAt: number;
};

const DEVELOPMENT_STORE_KEY = "__riftDesktopAuthTransferStore";

type DesktopAuthGlobal = typeof globalThis & {
  [DEVELOPMENT_STORE_KEY]?: Map<string, DevelopmentStoreEntry>;
};

function developmentStore(): Map<string, DevelopmentStoreEntry> | null {
  if (process.env.NODE_ENV === "production") return null;
  const runtime = globalThis as DesktopAuthGlobal;
  runtime[DEVELOPMENT_STORE_KEY] ??= new Map();
  return runtime[DEVELOPMENT_STORE_KEY] ?? null;
}

function setDevelopmentValue(
  key: string,
  value: unknown,
  ttlSeconds: number,
): boolean {
  const store = developmentStore();
  if (!store) return false;
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  return true;
}

function consumeDevelopmentValue<T>(key: string): T | null {
  const store = developmentStore();
  if (!store) return null;
  const entry = store.get(key);
  store.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.value as T;
}

function getRedis(): Redis | null {
  // Vercel's Redis/KV integrations expose KV_REST_API_* while standalone
  // Upstash projects expose UPSTASH_REDIS_REST_*. Accept both so desktop auth
  // uses the same configured store as the rest of the production app.
  const redisUrl =
    process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const redisToken =
    process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

  if (!redisUrl || !redisToken) {
    return null;
  }

  return new Redis({
    url: redisUrl,
    token: redisToken,
  });
}

function generateTransferToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export async function createDesktopTransferToken(
  sealedSession: string,
  options?: { returnPath?: string; desktopAuthState?: string },
): Promise<string | null> {
  const redis = getRedis();
  const transferToken = generateTransferToken();
  const key = `${TRANSFER_TOKEN_PREFIX}${transferToken}`;

  const data: TransferTokenData = {
    sealedSession,
    createdAt: Date.now(),
  };
  if (options?.returnPath) {
    data.returnPath = options.returnPath;
  }
  if (options?.desktopAuthState) {
    data.desktopAuthState = options.desktopAuthState;
  }

  if (!redis) {
    if (setDevelopmentValue(key, data, TRANSFER_TOKEN_TTL_SECONDS)) {
      return transferToken;
    }
    console.error(
      "[Desktop Auth] Redis not configured, cannot create transfer token",
    );
    return null;
  }

  try {
    await redis.set(key, data, { ex: TRANSFER_TOKEN_TTL_SECONDS });
  } catch (err) {
    console.error(
      "[Desktop Auth] Failed to store transfer token in Redis:",
      err,
    );
    return null;
  }

  return transferToken;
}

export async function exchangeDesktopTransferToken(
  transferToken: string,
  options?: { desktopAuthState?: string },
): Promise<{
  sealedSession: string;
  returnPath?: string;
} | null> {
  if (!TOKEN_FORMAT_REGEX.test(transferToken)) {
    console.warn("[Desktop Auth] Invalid transfer token format");
    return null;
  }

  const redis = getRedis();
  const key = `${TRANSFER_TOKEN_PREFIX}${transferToken}`;

  let rawData: TransferTokenData | string | null;
  if (!redis) {
    rawData = consumeDevelopmentValue<TransferTokenData | string>(key);
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[Desktop Auth] Redis not configured, cannot exchange transfer token",
      );
      return null;
    }
  } else {
    try {
      // getdel makes the transfer one-time and prevents token replay.
      rawData = await redis.getdel<TransferTokenData>(key);
    } catch (err) {
      console.error(
        "[Desktop Auth] Failed to retrieve transfer token from Redis:",
        err,
      );
      return null;
    }
  }

  if (!rawData) {
    console.warn("[Desktop Auth] Transfer token not found or expired");
    return null;
  }

  let data: TransferTokenData;
  if (typeof rawData === "object") {
    // Upstash auto-deserialized the JSON
    data = rawData as unknown as TransferTokenData;
  } else {
    try {
      data = JSON.parse(rawData) as TransferTokenData;
    } catch (err) {
      console.error("[Desktop Auth] Failed to parse transfer token data:", err);
      return null;
    }
  }

  if (
    !data ||
    typeof data.sealedSession !== "string" ||
    data.sealedSession.length === 0
  ) {
    console.error("[Desktop Auth] Invalid transfer token payload");
    return null;
  }

  if (data.desktopAuthState && !options?.desktopAuthState) {
    console.warn("[Desktop Auth] Desktop auth state required but not provided");
    return null;
  }

  if (
    options?.desktopAuthState &&
    data.desktopAuthState !== options.desktopAuthState
  ) {
    console.warn("[Desktop Auth] Desktop auth state mismatch");
    return null;
  }

  const result: { sealedSession: string; returnPath?: string } = {
    sealedSession: data.sealedSession,
  };
  if (typeof data.returnPath === "string") {
    result.returnPath = data.returnPath;
  }
  return result;
}

export type OAuthStateMetadata = {
  devCallbackPort?: number;
  returnPath?: string;
  desktopAuthState?: string;
};

export async function createOAuthState(
  metadata?: OAuthStateMetadata,
): Promise<string | null> {
  const redis = getRedis();
  const state = generateTransferToken();
  const key = `${OAUTH_STATE_PREFIX}${state}`;

  const value = metadata ? JSON.stringify(metadata) : "1";

  if (!redis) {
    if (setDevelopmentValue(key, value, OAUTH_STATE_TTL_SECONDS)) return state;
    console.error(
      "[Desktop Auth] Redis not configured, cannot create OAuth state",
    );
    return null;
  }

  try {
    await redis.set(key, value, { ex: OAUTH_STATE_TTL_SECONDS });
  } catch (err) {
    console.error("[Desktop Auth] Failed to store OAuth state in Redis:", err);
    return null;
  }

  return state;
}

export async function verifyAndConsumeOAuthState(
  state: string,
): Promise<{ valid: boolean; metadata?: OAuthStateMetadata }> {
  if (!TOKEN_FORMAT_REGEX.test(state)) {
    console.warn("[Desktop Auth] Invalid OAuth state format");
    return { valid: false };
  }

  const redis = getRedis();
  const key = `${OAUTH_STATE_PREFIX}${state}`;

  try {
    const value = redis
      ? await redis.getdel<string>(key)
      : consumeDevelopmentValue<string>(key);
    if (!redis && process.env.NODE_ENV === "production") {
      console.error(
        "[Desktop Auth] Redis not configured, cannot verify OAuth state",
      );
      return { valid: false };
    }
    if (!value) {
      return { valid: false };
    }

    if (value === "1") {
      return { valid: true };
    }

    try {
      const metadata =
        typeof value === "object"
          ? (value as unknown as OAuthStateMetadata)
          : (JSON.parse(value) as OAuthStateMetadata);
      return { valid: true, metadata };
    } catch {
      // If we can't parse metadata, state is still valid
      return { valid: true };
    }
  } catch (err) {
    console.error("[Desktop Auth] Failed to verify OAuth state:", err);
    return { valid: false };
  }
}
