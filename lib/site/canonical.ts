/**
 * The site's canonical origin, in one place.
 *
 * `metadataBase` defaulted to `https://rift.co`, a domain this product does not
 * serve from — riftsys.app appears 29 times across the codebase, rift.co six,
 * and the footer's own contact address is hello@riftsys.app. Anywhere the env
 * var is unset, that default silently resolved every canonical URL, every Open
 * Graph image URL and every share preview to the wrong host. A share card that
 * points at a domain you do not own is worse than no share card.
 *
 * The env var still wins, because local development and preview deployments
 * legitimately serve from somewhere else.
 */
export const SITE_ORIGIN =
  process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") || "https://riftsys.app";

export const SITE_NAME = "RIFT";

/** Absolute URL for a path, for canonicals and sitemaps. */
export const absoluteUrl = (path: string): string =>
  `${SITE_ORIGIN}${path.startsWith("/") ? path : `/${path}`}`;

/**
 * The pages a search engine should know about.
 *
 * Deliberately not "every route with a page.tsx". The landing variants are
 * noindexed working copies, the workspace is behind auth, and login/signup are
 * doorways rather than destinations — listing them dilutes the set that
 * matters.
 */
export const INDEXABLE_ROUTES = [
  { path: "/", changeFrequency: "weekly" as const, priority: 1 },
  { path: "/pricing", changeFrequency: "weekly" as const, priority: 0.9 },
  { path: "/download", changeFrequency: "monthly" as const, priority: 0.8 },
  {
    path: "/terms-of-service",
    changeFrequency: "yearly" as const,
    priority: 0.3,
  },
  {
    path: "/privacy-policy",
    changeFrequency: "yearly" as const,
    priority: 0.3,
  },
  { path: "/refund-policy", changeFrequency: "yearly" as const, priority: 0.3 },
];

/** Routes that exist but must never be indexed. */
export const DISALLOWED_PATHS = [
  "/api/",
  "/admin",
  "/workspace",
  "/hack",
  "/landing/",
  "/lab",
  "/desktop-login",
  "/desktop-callback",
  "/auth-error",
  "/invite",
  "/share/",
];
