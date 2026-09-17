import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { githubOAuthConfig } from "./oauth-config";
import { verifyState } from "./oauth-state";
function config() {
  const value = githubOAuthConfig();
  if (!value) throw new Error("GitHub OAuth unavailable");
  const key = createHash("sha256")
    .update("rift/github/oauth-handoff/v1\0")
    .update(process.env.GITHUB_OAUTH_STATE_SECRET || value.serviceKey)
    .digest();
  return { ...value, key };
}
const hash = (ticket: string) =>
  createHash("sha256").update(ticket).digest("hex");
export async function createGithubHandoff(
  userId: string,
  state: string,
  code: string,
  origin: string,
): Promise<string> {
  const { key, serviceKey } = config();
  const ticket = randomBytes(32).toString("hex");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([
    cipher.update(JSON.stringify({ state, code, origin }), "utf8"),
    cipher.final(),
  ]);
  const ciphertext = Buffer.concat([iv, cipher.getAuthTag(), body]).toString(
    "base64url",
  );
  await getConvexClient().mutation(api.githubOAuthHandoffs.createForBackend, {
    serviceKey,
    userId,
    ticketHash: hash(ticket),
    ciphertext,
  });
  return ticket;
}
export async function consumeGithubHandoff(
  userId: string,
  ticket: string,
  origin: string,
) {
  if (!/^[a-f0-9]{64}$/.test(ticket)) return null;
  const { key, serviceKey } = config();
  const ciphertext = await getConvexClient().mutation(
    api.githubOAuthHandoffs.consumeForBackend,
    { serviceKey, userId, ticketHash: hash(ticket) },
  );
  if (!ciphertext) return null;
  try {
    const raw = Buffer.from(ciphertext, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(userId));
    decipher.setAuthTag(raw.subarray(12, 28));
    const payload = JSON.parse(
      Buffer.concat([
        decipher.update(raw.subarray(28)),
        decipher.final(),
      ]).toString("utf8"),
    );
    const verified = verifyState(payload.state);
    if (
      !verified ||
      verified.userId !== userId ||
      !verified.desktopState ||
      payload.origin !== origin ||
      typeof payload.code !== "string"
    )
      return null;
    return { code: payload.code as string, returnTo: verified.returnTo };
  } catch {
    return null;
  }
}
