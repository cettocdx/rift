import { randomUUID } from "node:crypto";
import { getConvexClient, getConvexServiceKey } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";

export interface LoadedGithubToken {
  token: string;
  username?: string;
}

export type GithubTokenOrigin = Readonly<{
  client: ReturnType<typeof getConvexClient>;
  serviceKey: string;
}>;
type CapturedGithubTokenOrigin = GithubTokenOrigin & {
  clientId?: string;
  clientSecret?: string;
};
const pending = new WeakMap<
  GithubTokenOrigin["client"],
  Map<string, Map<string, Promise<LoadedGithubToken | null>>>
>();
const REFRESH_BEFORE_MS = 60_000;
const REFRESH_SAVE_TIMEOUT_MS = 5_000;
const REFRESH_SAVE_ATTEMPTS = 3;
function expiry(seconds: unknown, now: number): number | undefined {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? now + seconds * 1000
    : undefined;
}

/** Backend-only credentials; refresh before injecting them into a sandbox.
 * Coalesce callers in this process; Convex CAS guards reconnects and other workers. */
export async function loadUserGithubToken(
  userId: string,
  origin?: GithubTokenOrigin,
): Promise<LoadedGithubToken | null> {
  try {
    const serviceKey = origin ? origin.serviceKey : getConvexServiceKey();
    if (!serviceKey) return null;
    return await coalescedLoad(
      userId,
      captureOrigin(
        origin ?? {
          client: getConvexClient(),
          serviceKey,
        },
      ),
    );
  } catch {
    return null;
  }
}

/** Capture at admission for lazy MCP requests; never borrow a later deployment. */
export function createGithubTokenLoader(origin: GithubTokenOrigin) {
  const captured = captureOrigin(origin);
  return (userId: string) => coalescedLoad(userId, captured);
}

function captureOrigin(origin: GithubTokenOrigin): CapturedGithubTokenOrigin {
  return {
    client: origin.client,
    serviceKey: origin.serviceKey,
    clientId:
      process.env.GITHUB_OAUTH_CLIENT_ID ||
      process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_OAUTH_CLIENT_SECRET,
  };
}

async function coalescedLoad(
  userId: string,
  origin: CapturedGithubTokenOrigin,
): Promise<LoadedGithubToken | null> {
  if (!origin.serviceKey) return null;
  const scopes = pending.get(origin.client) ?? new Map();
  pending.set(origin.client, scopes);
  const requests = scopes.get(origin.serviceKey) ?? new Map();
  scopes.set(origin.serviceKey, requests);
  const existing = requests.get(userId);
  if (existing) return existing;
  const request = load(userId, origin);
  requests.set(userId, request);
  try {
    return await request;
  } finally {
    if (requests.get(userId) === request) requests.delete(userId);
    if (!requests.size) scopes.delete(origin.serviceKey);
  }
}

async function load(
  userId: string,
  origin: CapturedGithubTokenOrigin,
): Promise<LoadedGithubToken | null> {
  const { client, serviceKey, clientId, clientSecret } = origin;
  if (!serviceKey) return null;
  try {
    const read = () =>
      client.query(api.github.getTokenForBackend, { serviceKey, userId });
    const gh = await read();
    if (!gh?.token) return null;
    const usable = (
      row: Awaited<ReturnType<typeof read>>,
    ): LoadedGithubToken | null =>
      row?.token && (row.expiresAt === undefined || row.expiresAt > Date.now())
        ? { token: row.token, username: row.username }
        : null;
    if (
      gh.expiresAt === undefined ||
      gh.expiresAt > Date.now() + REFRESH_BEFORE_MS
    )
      return usable(gh);
    if (
      !gh.refreshToken ||
      !clientId ||
      !clientSecret ||
      (gh.refreshExpiresAt !== undefined && gh.refreshExpiresAt <= Date.now())
    )
      return usable(gh);
    const lease = {
      serviceKey,
      userId,
      connectionId: gh.connectionId,
      credentialsVersion: gh.credentialsVersion,
      leaseId: randomUUID(),
    };
    const acquired = await client.mutation(
      api.github.acquireRefreshForBackend,
      lease,
    );
    if (!acquired.success) {
      // Another process may already have rotated remotely but not committed yet.
      // Never hand out its old access token while waiting for the new pair.
      for (let attempt = 0; attempt < 40; attempt++) {
        const current = await read();
        if (!current) return null;
        if (
          current.connectionId !== gh.connectionId ||
          current.credentialsVersion !== gh.credentialsVersion
        )
          return usable(current);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return null;
    }
    let requireNewVersion = false;
    const isNewVersion = (row: NonNullable<Awaited<ReturnType<typeof read>>>) =>
      row.connectionId !== gh.connectionId ||
      row.credentialsVersion > gh.credentialsVersion;
    const currentUsable = async () => {
      const current = await read();
      return requireNewVersion && current && !isNewVersion(current)
        ? null
        : usable(current);
    };
    try {
      const requestedAt = Date.now();
      // Once issued, a lost response or timeout may hide a completed remote
      // rotation. Only an explicit temporary rejection can reuse the old pair.
      requireNewVersion = true;
      const response = await fetch(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: "refresh_token",
            refresh_token: gh.refreshToken,
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (!response.ok) {
        requireNewVersion = ![429, 503].includes(response.status);
        return await currentUsable();
      }
      // A successful response may already have invalidated the old pair, even
      // if its body is malformed or its guarded persistence later fails.
      const data = await response.json();
      const expiresAt = expiry(data.expires_in, requestedAt);
      if (
        typeof data.access_token !== "string" ||
        !data.access_token.trim() ||
        !expiresAt ||
        data.error
      )
        return await currentUsable();
      const refreshToken =
        typeof data.refresh_token === "string" && data.refresh_token.trim()
          ? data.refresh_token
          : gh.refreshToken;
      const rotation = {
        ...lease,
        token: data.access_token,
        refreshToken,
        expiresAt,
        refreshExpiresAt:
          expiry(data.refresh_token_expires_in, requestedAt) ??
          gh.refreshExpiresAt,
      };
      let timedOut = false;
      let deadlineTimer: ReturnType<typeof setTimeout>;
      const deadline = new Promise<never>((_resolve, reject) => {
        deadlineTimer = setTimeout(() => {
          timedOut = true;
          reject(new Error("GitHub credential persistence timed out"));
        }, REFRESH_SAVE_TIMEOUT_MS);
      });
      const beforeDeadline = <T>(request: () => Promise<T>) =>
        Promise.race([request(), deadline]);
      try {
        for (let attempt = 0; attempt < REFRESH_SAVE_ATTEMPTS; attempt++) {
          let saved: { success: boolean } | undefined;
          try {
            // Retry only the same CAS and lease. Never request another remote
            // rotation after GitHub has returned this new credential pair.
            saved = await beforeDeadline(() =>
              client.mutation(api.github.refreshForBackend, rotation),
            );
            if (saved.success)
              return { token: data.access_token, username: gh.username };
          } catch {}
          if (timedOut) return null;
          try {
            // A lost acknowledgement may hide a successful commit; reconnects
            // and disconnects also take precedence over this attempted rotation.
            const current = await beforeDeadline(read);
            if (!current) return null;
            if (isNewVersion(current)) return usable(current);
          } catch {}
          if (timedOut || saved?.success === false) return null;
        }
        return null;
      } finally {
        clearTimeout(deadlineTimer!);
      }
    } catch {
      // Re-read after failures: another worker may have rotated, or the user disconnected.
      return await currentUsable();
    } finally {
      // Cleanup is best-effort and bounded; late releases retain the original
      // connection/version/lease guard and cannot release a competing lease.
      let releaseTimer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          client
            .mutation(api.github.releaseRefreshForBackend, lease)
            .catch(() => undefined),
          new Promise<void>((resolve) => {
            releaseTimer = setTimeout(resolve, 1_000);
          }),
        ]);
      } finally {
        clearTimeout(releaseTimer!);
      }
    }
  } catch {
    // Provider/Convex exceptions may contain credentials. Do not log their bodies.
    return null;
  }
}
