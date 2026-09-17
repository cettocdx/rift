const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Provide the path to your Next.js app to load next.config.js and .env files in your test environment
  dir: "./",
});

// Add any custom config to be passed to Jest
const customJestConfig = {
  // Keep the default local run within the same concurrency budget as test:ci.
  // Unbounded host-core fanout made UI and subprocess deadline tests race
  // desktop/simulator workloads. CLI --maxWorkers can still override this.
  maxWorkers: 2,
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  moduleNameMapper: {
    // Node ESM source imports name emitted .js files; Jest executes their .ts sources.
    "^(\\.{1,2}/.*)\\.js$": "$1",
    "^@lobehub/icons$": "<rootDir>/__mocks__/lobehub-icons.tsx",
    "^jose$": "<rootDir>/__mocks__/jose.ts",
    "^stripe$": "<rootDir>/__mocks__/stripe.ts",
    // Canvas-drawn dither charts: jsdom has no real canvas and next/jest does
    // not let d3's ESM through the transformer, so the chart boundary is
    // mocked the same way shiki and react-markdown are.
    // Keyed on the tail, not the "@/" alias: next/jest's SWC resolves the
    // tsconfig path alias at compile time, so by the time the resolver runs
    // the specifier is a relative path and an alias-shaped key never fires --
    // which is also why every other mock here is a bare package name.
    "components/dither-kit/sparkline$":
      "<rootDir>/__mocks__/dither-kit-sparkline.tsx",
    "components/dither-kit/gradient$":
      "<rootDir>/__mocks__/dither-kit-gradient.tsx",
    "^@/(.*)$": "<rootDir>/$1",
    // (the generic @/ rule above must stay AFTER the dither-kit mocks:
    // moduleNameMapper applies in order and the first match wins)
    "^convex/react$": "<rootDir>/__mocks__/convex-react.ts",
    "^@convex-dev/auth/react$": "<rootDir>/__mocks__/convex-dev-auth-react.ts",
    "^uuid$": "<rootDir>/__mocks__/uuid.ts",
    "^react-hotkeys-hook$": "<rootDir>/__mocks__/react-hotkeys-hook.ts",
    "^react-markdown$": "<rootDir>/__mocks__/react-markdown.tsx",
    "^streamdown$": "<rootDir>/__mocks__/streamdown.tsx",
    "^react-shiki$": "<rootDir>/__mocks__/react-shiki.tsx",
    "^shiki/langs$": "<rootDir>/__mocks__/shiki.ts",
    "^shiki$": "<rootDir>/__mocks__/shiki.ts",
    "^use-stick-to-bottom$": "<rootDir>/__mocks__/use-stick-to-bottom.ts",
    "^@aws-sdk/client-s3$": "<rootDir>/__mocks__/@aws-sdk/client-s3.ts",
    "^@aws-sdk/s3-request-presigner$":
      "<rootDir>/__mocks__/@aws-sdk/s3-request-presigner.ts",
    "^@upstash/redis$": "<rootDir>/__mocks__/@upstash/redis.ts",
    "^@upstash/ratelimit$": "<rootDir>/__mocks__/@upstash/ratelimit.ts",
    "^convex/browser$": "<rootDir>/__mocks__/convex/browser.ts",
    "^franc-min$": "<rootDir>/__mocks__/franc-min.ts",
  },
  transformIgnorePatterns: [
    "node_modules/(?!(uuid|@ai-sdk|ai|convex|react-hotkeys-hook|react-markdown|streamdown|remark-.*|unified|bail|is-plain-obj|trough|vfile|unist-.*|mdast-.*|micromark.*|decode-named-character-reference|character-entities|escape-string-regexp|markdown-table|property-information|hast-.*|space-separated-tokens|comma-separated-tokens|zwitch|html-void-elements|ccount|devlop|superjson)/)",
  ],
  testMatch: ["**/__tests__/**/*.[jt]s?(x)", "**/?(*.)+(spec|test).[jt]s?(x)"],
  // Next dev/build variants in this workspace use custom `.next-*` dist dirs.
  // Ignore all of them so Jest's haste map does not crawl multi-gigabyte
  // Turbopack caches before a focused unit test.
  modulePathIgnorePatterns: [
    "<rootDir>/\\.next(?:-[^/]+)?/",
    "<rootDir>/\\.worktrees/",
    // Trigger dry runs contain another generated package.json named rift.
    "<rootDir>/\\.trigger/",
  ],
  watchPathIgnorePatterns: [
    "<rootDir>/\\.next(?:-[^/]+)?/",
    "<rootDir>/\\.worktrees/",
    "<rootDir>/\\.trigger/",
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    // macOS AppleDouble sidecars (._*) appear beside every file on exFAT/network
    // volumes; they are not test files and cannot be transformed.
    "/\\._",
    "/\\.next(?:-[^/]+)?/",
    // A stale sibling worktree holds an outdated copy of every file. Running
    // its tests reports failures against code this checkout no longer has.
    "/\\.worktrees/",
    "/\\.trigger/",
    // OpenTUI requires Bun FFI; run with bun test, not the Jest runtime.
    "/packages/console/test/opentui.test.ts",
    "/e2e/",
    "/dist/",
  ],
  collectCoverageFrom: [
    "app/**/*.{js,jsx,ts,tsx}",
    "convex/**/*.{js,jsx,ts,tsx}",
    "!**/*.d.ts",
    "!**/node_modules/**",
    "!**/.next*/**",
    "!**/coverage/**",
    "!**/dist/**",
  ],
  coverageReporters: ["text", "json-summary", "lcov"],
  coverageThreshold: {
    global: {
      statements: 0,
      branches: 0,
      functions: 0,
      lines: 0,
    },
  },
};

// createJestConfig is exported this way to ensure that next/jest can load the Next.js config which is async
module.exports = createJestConfig(customJestConfig);
