import { createHash } from "node:crypto";
export const githubStateDigest = (state: string) =>
  createHash("sha256").update(state).digest("hex");
export const githubStateCookie = (origin: string) =>
  origin.startsWith("https:")
    ? "__Host-rift-github-oauth-state"
    : "rift_github_oauth_state";
export const githubStateCookieOptions = (origin: string) => ({
  httpOnly: true,
  secure: origin.startsWith("https:"),
  sameSite: "lax" as const,
  path: "/",
  maxAge: 600,
});
