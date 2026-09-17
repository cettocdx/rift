#!/usr/bin/env node
// Read-only deployment check: an intentionally invalid code cannot issue a token.
// A valid client pair returns bad_verification_code; deleted/invalid apps fail earlier.
const { createRequire } = require("node:module");
const { createHash, randomUUID } = require("node:crypto");
createRequire(require.resolve("next/package.json"))("@next/env").loadEnvConfig(
  process.cwd(),
);
async function main() {
  const clientId = (
    process.env.GITHUB_OAUTH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
  )?.trim();
  const secret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY?.trim();
  const missing = [
    !clientId && "GITHUB_OAUTH_CLIENT_ID",
    !secret && "GITHUB_OAUTH_CLIENT_SECRET",
    !serviceKey && "CONVEX_SERVICE_ROLE_KEY",
  ].filter(Boolean);
  if (missing.length) {
    console.log(JSON.stringify({ ok: false, code: "not_configured", missing }));
    process.exitCode = 1;
    return;
  }
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: secret,
      code: `rift-configuration-check-${randomUUID()}`,
    }),
  });
  const result = await response.json().catch(() => ({}));
  const ok =
    response.ok &&
    result.error === "bad_verification_code" &&
    !result.access_token;
  console.log(
    JSON.stringify({
      ok,
      code: ok ? "client_credentials_valid" : "github_app_not_verified",
      status: response.status,
      clientIdFingerprint: createHash("sha256")
        .update(clientId)
        .digest("hex")
        .slice(0, 10),
      note: ok
        ? "Complete browser authorization separately to verify registered callback URLs."
        : "Check the registered GitHub app and its client credentials.",
    }),
  );
  if (!ok) process.exitCode = 1;
}
main().catch(() => {
  console.log(JSON.stringify({ ok: false, code: "github_unavailable" }));
  process.exitCode = 1;
});
