import type { MetadataRoute } from "next";

import { DISALLOWED_PATHS, absoluteUrl } from "@/lib/site/canonical";

/**
 * There was no robots.txt at all.
 *
 * Its absence is not neutral. Without one a crawler has no instruction to find
 * the sitemap, and it spends its budget on the surfaces that cannot help it —
 * the authenticated workspace, the API, and the three superseded landing
 * variants still sitting on disk.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: DISALLOWED_PATHS,
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    host: absoluteUrl("/"),
  };
}
