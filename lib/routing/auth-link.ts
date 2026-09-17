import { sanitizeAppRedirectPath } from "./safe-app-redirect";

type AuthPath = "/login" | "/signup";

/** Keep auth intent and a safe in-app return destination in the same URL. */
export function buildAuthLink(
  path: AuthPath,
  returnPath?: string,
  params?: Record<string, string>,
): AuthPath | `${AuthPath}?${string}` {
  const search = new URLSearchParams(params);
  if (returnPath !== undefined) {
    search.set("redirect", sanitizeAppRedirectPath(returnPath));
  }
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}
