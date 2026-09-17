/** Server-side configuration only. A public client ID alone cannot finish OAuth. */
export function githubOAuthConfig() {
  const clientId = (
    process.env.GITHUB_OAUTH_CLIENT_ID ||
    process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID
  )?.trim();
  const clientSecret = process.env.GITHUB_OAUTH_CLIENT_SECRET?.trim();
  const serviceKey = process.env.CONVEX_SERVICE_ROLE_KEY?.trim();
  if (!clientId || !clientSecret || !serviceKey) return null;
  return { clientId, clientSecret, serviceKey };
}
