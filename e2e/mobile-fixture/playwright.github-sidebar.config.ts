import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "github-sidebar.fixture.ts",
  outputDir: "./results/github-sidebar",
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: "e2e/mobile-fixture/results/github-sidebar/report.json" },
    ],
  ],
  use: {
    baseURL: "http://127.0.0.1:3058",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { browserName: "chromium", viewport: { width: 1200, height: 800 } },
    },
    {
      name: "mobile360-chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: "mobile360-webkit",
      use: {
        browserName: "webkit",
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "node e2e/mobile-fixture/github-sidebar-server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3058/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
