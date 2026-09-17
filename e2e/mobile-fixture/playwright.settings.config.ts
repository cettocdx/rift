import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: ".",
  testMatch: "settings.fixture.ts",
  outputDir: "./results/settings",
  workers: 1,
  retries: 0,
  timeout: 30_000,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/settings/report.json") },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3041",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: ["chromium", "webkit"].flatMap((browserName) => [
    ...[360, 390, 430].flatMap((width) =>
      [true, false].map((hasTouch) => ({
        name: `${browserName}-${width}-${hasTouch ? "coarse" : "fine"}`,
        use: {
          browserName: browserName as "chromium" | "webkit",
          viewport: { width, height: 844 },
          hasTouch,
          isMobile: hasTouch,
        },
      })),
    ),
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
    command: "RIFT_SETTINGS_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3041/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120_000,
  },
});
