import type { MetadataRoute } from "next";

import { INDEXABLE_ROUTES, absoluteUrl } from "@/lib/site/canonical";

/**
 * The pages worth indexing, listed once.
 *
 * Generated from the same constant robots.ts reads, so a route can never be
 * disallowed and submitted at the same time — which is the usual way these two
 * files drift apart.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return INDEXABLE_ROUTES.map((route) => ({
    url: absoluteUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
