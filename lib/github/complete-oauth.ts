import "server-only";
import { connectGitHubPlugin } from "@/lib/ai/mcp/connect-github-plugin";
import { getConvexClient } from "@/lib/db/convex-client";
import { api } from "@/convex/_generated/api";
import { githubOAuthConfig } from "./oauth-config";

export async function completeGithubOAuth({
  origin,
  userId,
  returnTo,
  code,
}: {
  origin: string;
  userId: string;
  returnTo: string;
  code: string;
}): Promise<string> {
  const config = githubOAuthConfig();
  if (!config) return "not_configured";
  // Never forward raw upstream error bodies or log credentials. Every external
  // step is bounded; a failed exchange does not create a connected account.
  let token: string;
  let username: string;
  let refreshToken: string | undefined;
  let expiresAt: number | undefined;
  let refreshExpiresAt: number | undefined;
  try {
    const tokenRes = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          code,
          redirect_uri: `${origin}/api/github/callback`,
        }),
      },
    );
    if ([401, 404].includes(tokenRes.status)) return "configuration_error";
    if (!tokenRes.ok) return "provider_unavailable";
    const data = await tokenRes.json();
    if (
      ["incorrect_client_credentials", "redirect_uri_mismatch"].includes(
        data.error,
      )
    )
      return "configuration_error";
    if (typeof data.access_token !== "string" || !data.access_token.trim())
      return "exchange_failed";
    token = data.access_token;
    const expiry = (seconds: unknown) =>
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds > 0 &&
      seconds <= 366 * 86400
        ? Date.now() + seconds * 1000
        : undefined;
    expiresAt = expiry(data.expires_in);
    refreshToken =
      typeof data.refresh_token === "string" && data.refresh_token.trim()
        ? data.refresh_token
        : undefined;
    refreshExpiresAt = refreshToken
      ? expiry(data.refresh_token_expires_in)
      : undefined;
    if (data.expires_in !== undefined && expiresAt === undefined)
      return "exchange_failed";
    if (
      data.refresh_token_expires_in !== undefined &&
      refreshExpiresAt === undefined
    )
      return "exchange_failed";
    const userRes = await fetch("https://api.github.com/user", {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    });
    if (userRes.status === 401) return "exchange_failed";
    if (!userRes.ok) return "provider_unavailable";
    const user = await userRes.json();
    if (typeof user.login !== "string" || !user.login.trim())
      return "exchange_failed";
    username = user.login;
  } catch {
    return "provider_unavailable";
  }

  try {
    const saved = await getConvexClient().mutation(
      api.github.connectForBackend,
      {
        serviceKey: config.serviceKey,
        userId: userId,
        token,
        username,
        ...(refreshToken ? { refreshToken } : {}),
        ...(expiresAt !== undefined ? { expiresAt } : {}),
        ...(refreshExpiresAt !== undefined ? { refreshExpiresAt } : {}),
      },
    );
    if (!saved.success) return "error";
    if (returnTo === "/plugins?connect=github") {
      try {
        await connectGitHubPlugin(userId, token);
      } catch {
        return "mcp_failed";
      }
    }
    return "connected";
  } catch {
    return "error";
  }
}
