import type { NextConfig } from "next";
import {
  PHASE_DEVELOPMENT_SERVER,
  PHASE_PRODUCTION_BUILD,
} from "next/constants";
import path from "node:path";
import { prepareMonacoAssets } from "./scripts/prepare-monaco-assets.cjs";

import { getCompatibilityRedirects } from "./lib/routing/compatibility-redirects";

const configuredDistDir = process.env.RIFT_NEXT_DIST_DIR?.trim();

const nextConfig: NextConfig = {
  ...(process.env.RIFT_TSCONFIG_PATH && {
    typescript: { tsconfigPath: process.env.RIFT_TSCONFIG_PATH },
  }),
  // A sibling cache lets the 3011 visual preview run beside the normal 3010
  // dev server without sharing Next's build lock or generated output.
  distDir: configuredDistDir || ".next",
  // This project can run from a worktree below a home directory that has its
  // own lockfile. Keep file watching and resolution scoped to this checkout.
  turbopack: { root: path.resolve(__dirname) },
  devIndicators: false,
  allowedDevOrigins: ["127.0.0.1"],
  // Resolve retired entry points before React renders their compatibility
  // pages. In development this also avoids profiling a thrown redirect as a
  // component error; the destination remains responsible for auth/security.
  redirects: async () => [
    // Keep one canonical public origin for auth callbacks, billing webhooks,
    // analytics, and search indexing. A 308 also preserves the HTTP method
    // if an integration accidentally calls the www hostname.
    {
      source: "/:path*",
      has: [{ type: "host", value: "www.riftsys.app" }],
      destination: "https://riftsys.app/:path*",
      permanent: true,
    },
    ...getCompatibilityRedirects(),
  ],
  // The MCP SDK (used by lib/ai/mcp/*) is a server-only Node package whose
  // server entrypoints pull in express/cors/hono + Node built-ins. Keep it
  // external so the bundler require()s it at runtime instead of trying to
  // bundle those into the API route.
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@e2b/code-interpreter",
    "e2b",
    "node-pty",
  ],
  // Tree-shake big barrel-import libs so each route only bundles the icons /
  // helpers it actually uses (lucide-react alone is imported by 100+ files).
  experimental: {
    optimizePackageImports: ["lucide-react", "date-fns", "@lobehub/icons"],
    // A large worktree cache can stall the UI preview on disk I/O. Allow the
    // preview launcher to use in-memory caching without changing production.
    ...(process.env.RIFT_DISABLE_TURBOPACK_DISK_CACHE === "1" && {
      turbopackFileSystemCacheForDev: false,
    }),
  },
  ...(process.env.NODE_ENV === "development" && {
    logging: {
      serverFunctions: false,
    },
  }),
  images: {
    unoptimized: true,
    qualities: [75, 86],
    remotePatterns: [
      {
        protocol: "http",
        hostname: "localhost",
      },
      {
        protocol: "http",
        hostname: "127.0.0.1",
      },
      // Convex storage domains (more specific patterns for better performance)
      {
        protocol: "https",
        hostname: "*.convex.cloud",
      },
      {
        protocol: "https",
        hostname: "*.convex.dev",
      },
      // Fallback for other external images
      {
        protocol: "https",
        hostname: "**",
      },
    ],
  },
};

export default function config(phase: string): NextConfig {
  // Covers direct commands and preview builds without writing at production start.
  if (phase === PHASE_DEVELOPMENT_SERVER || phase === PHASE_PRODUCTION_BUILD) {
    prepareMonacoAssets();
  }
  return nextConfig;
}
