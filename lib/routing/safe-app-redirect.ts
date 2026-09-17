const SAFE_APP_ORIGIN = "https://rift.invalid";
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_DECODE_PASSES = 4;

function decodedPathForValidation(pathname: string): string | null {
  let decoded = pathname;

  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }

  return null;
}

/**
 * Accepts only an in-app, same-origin relative redirect target.
 *
 * The returned path is canonicalized by URL and retains its query and hash.
 * Absolute/protocol-relative URLs, backslash variants, encoded authority
 * tricks, and control characters fall back to the application root.
 */
export function sanitizeAppRedirectPath(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  if (CONTROL_CHARACTER_PATTERN.test(value) || value.includes("\\")) {
    return "/";
  }

  const pathEnd = value.search(/[?#]/);
  const rawPathname = pathEnd === -1 ? value : value.slice(0, pathEnd);
  const decodedPathname = decodedPathForValidation(rawPathname);

  if (
    decodedPathname === null ||
    decodedPathname.startsWith("//") ||
    decodedPathname.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(decodedPathname)
  ) {
    return "/";
  }

  try {
    const parsed = new URL(value, SAFE_APP_ORIGIN);
    if (
      parsed.origin !== SAFE_APP_ORIGIN ||
      parsed.username ||
      parsed.password ||
      !parsed.pathname.startsWith("/") ||
      parsed.pathname.startsWith("//") ||
      parsed.pathname.includes("\\")
    ) {
      return "/";
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

/**
 * Produces the same-origin path to revisit after a client-side OAuth code
 * exchange. The one-time `code` is removed while every other safe query
 * parameter and the hash are retained (notably the native desktop auth state).
 */
export function sanitizeOAuthCompletionPath(
  href: unknown,
  expectedOrigin: unknown,
): string {
  if (typeof href !== "string" || typeof expectedOrigin !== "string") {
    return "/";
  }

  try {
    const origin = new URL(expectedOrigin);
    if (
      (origin.protocol !== "https:" && origin.protocol !== "http:") ||
      origin.username ||
      origin.password
    ) {
      return "/";
    }

    const current = new URL(href, origin.origin);
    if (current.origin !== origin.origin) return "/";

    current.searchParams.delete("code");
    return sanitizeAppRedirectPath(
      `${current.pathname}${current.search}${current.hash}`,
    );
  } catch {
    return "/";
  }
}
