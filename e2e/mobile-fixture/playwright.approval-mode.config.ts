import { defineConfig } from "@playwright/test";
import composer from "./playwright.composer.config";
export default defineConfig({
  ...composer,
  testMatch: "approval-mode.fixture.ts",
  outputDir: "./results/approval-mode",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "e2e/mobile-fixture/results/approval-mode/report.json" },
    ],
  ],
  use: { ...composer.use, baseURL: "http://127.0.0.1:3059" },
  projects: composer.projects!.filter((project) =>
    /(?:desktop|360-coarse)$/.test(project.name!),
  ),
  webServer: {
    command:
      "RIFT_FIXTURE_PORT=3059 RIFT_COMPOSER_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3059/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
