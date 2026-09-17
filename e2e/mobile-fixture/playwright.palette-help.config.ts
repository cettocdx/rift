import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "palette-help.fixture.ts",
  outputDir: "./results/palette-help",
  workers: 1,
  retries: 0,
  timeout: 30000,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/palette-help/report.json") },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3039",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: ["chromium", "webkit"].flatMap((browserName) => [
    ...[360, 390, 430].map((width) => ({
      name: `${browserName}-${width}`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
    })),
    {
      name: `${browserName}-desktop`,
      use: {
        browserName: browserName as "chromium" | "webkit",
        viewport: { width: 1200, height: 900 },
        hasTouch: false,
      },
    },
  ]),
  webServer: {
    command:
      "RIFT_FIXTURE_PORT=3039 RIFT_COMPOSER_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3039/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
