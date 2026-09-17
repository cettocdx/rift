import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "sidebar.fixture.ts",
  outputDir: "./results/sidebar",
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/sidebar/report.json") },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3038",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 1200, height: 800 },
  },
  projects: ["chromium", "webkit"].map((browserName) => ({
    name: browserName,
    use: { browserName: browserName as "chromium" | "webkit" },
  })),
  webServer: {
    command: "RIFT_SIDEBAR_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3038/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
