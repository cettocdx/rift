import { defineConfig } from "@playwright/test";
import composer from "./playwright.composer.config";

// Same offline production composer and browser matrix; independent results.
export default defineConfig({
  ...composer,
  testMatch: "mobile-focus.fixture.ts",
  outputDir: "./results/mobile-focus",
  reporter: [["list"]],
  webServer: {
    command: "RIFT_COMPOSER_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3038/health",
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120_000,
    reuseExistingServer: true,
  },
});
