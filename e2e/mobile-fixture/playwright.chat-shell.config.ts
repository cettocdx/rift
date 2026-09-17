import { defineConfig } from "@playwright/test";
import path from "node:path";
export default defineConfig({
  testDir: ".",
  testMatch: "chat-shell.fixture.ts",
  outputDir: "./results/chat-shell",
  reporter: [
    ["list"],
    [
      "json",
      { outputFile: path.join(__dirname, "results/chat-shell/report.json") },
    ],
  ],
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:3038",
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
    command: "RIFT_CHAT_SHELL_FIXTURE=1 node e2e/mobile-fixture/server.cjs",
    cwd: "../..",
    url: "http://127.0.0.1:3038/health",
    reuseExistingServer: false,
    gracefulShutdown: { signal: "SIGTERM", timeout: 1000 },
    timeout: 120000,
  },
});
