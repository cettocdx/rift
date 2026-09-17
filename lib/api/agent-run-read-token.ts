/** Server-only use: callers must authorize ownership before minting a run token.
 * Uses the same claims/signing primitives as Trigger auth.createPublicToken,
 * with a short-lived cache for environment discovery only.
 */
import { apiClientManager, generateJWT } from "@trigger.dev/core/v3";

type Claims = { sub: string; pub: boolean };
type Client = {
  accessToken: string;
  baseUrl: string;
  generateJWTClaims(): Promise<Record<string, unknown>>;
};
type SignOptions = {
  secretKey: string;
  payload: Claims & { scopes: string[] };
  expirationTime: string;
};
export function createRunReadTokenFactory({
  getClient,
  sign,
  now = Date.now,
}: {
  getClient(): Client;
  sign(options: SignOptions): Promise<string>;
  now?: () => number;
}) {
  // Cache environment metadata, NOT user access decisions or run tokens.
  // Only one entry is retained; a different API URL/key replaces it.
  let cached:
    | {
        accessToken: string;
        baseUrl: string;
        expires: number;
        claims: Promise<Record<string, unknown>>;
      }
    | undefined;
  const discover = async () => {
    const client = getClient();
    if (
      !cached ||
      cached.accessToken !== client.accessToken ||
      cached.baseUrl !== client.baseUrl ||
      cached.expires <= now()
    ) {
      const entry = {
        accessToken: client.accessToken,
        baseUrl: client.baseUrl,
        expires: now() + 60_000,
        claims: client.generateJWTClaims(),
      };
      cached = entry;
      void entry.claims.catch(() => {
        if (cached === entry) cached = undefined;
      });
    }
    const entry = cached;
    const discovered = await entry.claims;
    if (
      typeof discovered.sub !== "string" ||
      typeof discovered.pub !== "boolean"
    ) {
      if (cached === entry) cached = undefined;
      throw new Error("Invalid Trigger environment claims");
    }
    const claims: Claims = { sub: discovered.sub, pub: discovered.pub };
    return { client, claims };
  };
  const create = async (runId: string): Promise<string> => {
    const { client, claims } = await discover();
    return sign({
      secretKey: client.accessToken,
      payload: { ...claims, scopes: [`read:runs:${runId}`] },
      expirationTime: "6h",
    });
  };
  return Object.assign(create, { prepare: async () => { await discover(); } });
}
export const createAgentRunReadToken = createRunReadTokenFactory({
  getClient: () => apiClientManager.clientOrThrow(),
  sign: generateJWT,
});

/** Prefetch environment metadata only; this never signs a user/run token. */
export const prepareAgentRunReadToken = () => createAgentRunReadToken.prepare();
